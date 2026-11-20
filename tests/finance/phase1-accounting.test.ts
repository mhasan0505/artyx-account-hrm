import { describe, expect, it } from 'vitest'
import {
  computeAGI,
  computeArAgingAndBadDebt,
  computeEHR,
  computeGMROL,
  computeLoadedHourlyCost,
  computeMilestoneInvoiceAllocation,
  computeNetWorkingCapital,
  computeProjectOverUnderBilling,
  computeRealizedFxGainLoss,
  computeUnrealizedFx,
  splitStraightLineSchedule,
  WEEKS_PER_MONTH,
} from '@/lib/finance/accounting-math'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import {
  ACTIVE_LEDGER_ENTRY_WHERE,
  POSTED_JOURNAL_WHERE,
} from '@/lib/finance/journal-engine'

describe('Phase 1 Hybrid Agency Accounting Math', () => {
  describe('computeLoadedHourlyCost', () => {
    it('uses explicit per-employee loadedHourlyCostOverride when provided', () => {
      expect(
        computeLoadedHourlyCost({
          basicSalary: 80000,
          weeklyCapacityHours: 40,
          overheadMultiplier: 1.25,
          loadedHourlyCostOverride: 950,
        })
      ).toBe(950)
    })

    it('derives monthly workable hours from weeklyCapacityHours * 4.3333 with configurable overheadMultiplier', () => {
      const rate = computeLoadedHourlyCost({
        basicSalary: 100000,
        weeklyCapacityHours: 35,
        overheadMultiplier: 1.2,
      })
      const expected = Math.round(((100000 * 1.2) / (35 * WEEKS_PER_MONTH)) * 100) / 100
      expect(rate).toBe(expected)
    })

    it('defaults to 40h/week and 1.15x overhead multiplier when omitted', () => {
      const rate = computeLoadedHourlyCost({ basicSalary: 86666 })
      expect(rate).toBeCloseTo(575, 0)
    })
  })

  describe('AGI, EHR, and GMROL', () => {
    it('strips Pass-Through reimbursables cleanly from Gross Billings to compute AGI', () => {
      const res = computeAGI(500000, 120000)
      expect(res.agi).toBe(380000)
      expect(res.passThroughPct).toBe(24)
    })

    it('computes Effective Hourly Rate (EHR) across all logged hours', () => {
      expect(computeEHR(250000, 125)).toBe(2000)
      expect(computeEHR(250000, 0)).toBe(0)
    })

    it('computes Gross Margin Return on Labor (GMROL)', () => {
      expect(computeGMROL(300000, 100000)).toBe(3)
      expect(computeGMROL(300000, 0)).toBe(0)
    })
  })

  describe('Multi-Currency Realized & Unrealized FX', () => {
    it('calculates positive Realized FX Gain when BDT settlement rate rises', () => {
      const fx = computeRealizedFxGainLoss({
        amountForeign: 5000,
        invoiceRate: 118,
        settlementRate: 121.5,
      })
      expect(fx.bookedBase).toBe(590000)
      expect(fx.settledBase).toBe(607500)
      expect(fx.realizedGainLoss).toBe(17500)
    })

    it('calculates negative Realized FX Loss when BDT settlement rate drops', () => {
      const fx = computeRealizedFxGainLoss({
        amountForeign: 2000,
        invoiceRate: 120,
        settlementRate: 117,
      })
      expect(fx.realizedGainLoss).toBe(-6000)
    })

    it('computes Unrealized FX mark-to-market on open foreign receivables', () => {
      const ufx = computeUnrealizedFx({
        openForeignAmount: 10000,
        invoiceRate: 119,
        spotRate: 120.25,
      })
      expect(ufx.unrealizedGainLoss).toBe(12500)
    })
  })

  describe('Partial Milestone Invoicing & Revenue Recognition Rule', () => {
    it('defers 100% of a partial upfront deposit on an incomplete milestone', () => {
      const alloc = computeMilestoneInvoiceAllocation({
        milestoneValue: 100000,
        alreadyInvoicedForMilestone: 0,
        newInvoiceNonPassThrough: 40000,
        isMilestoneCompleted: false,
      })
      expect(alloc.deferredAmount).toBe(40000)
      expect(alloc.immediateEarnedAmount).toBe(0)
      expect(alloc.remainingUnbilledWip).toBe(0)
    })

    it('clears remaining Unbilled WIP immediately when final balance invoice is issued after completion', () => {
      const alloc = computeMilestoneInvoiceAllocation({
        milestoneValue: 100000,
        alreadyInvoicedForMilestone: 40000,
        newInvoiceNonPassThrough: 60000,
        isMilestoneCompleted: true,
      })
      expect(alloc.immediateEarnedAmount).toBe(60000)
      expect(alloc.deferredAmount).toBe(0)
      expect(alloc.remainingUnbilledWip).toBe(0)
    })

    it('defers only the over-billed excess if a completed milestone is over-invoiced', () => {
      const alloc = computeMilestoneInvoiceAllocation({
        milestoneValue: 100000,
        alreadyInvoicedForMilestone: 40000,
        newInvoiceNonPassThrough: 75000,
        isMilestoneCompleted: true,
      })
      expect(alloc.immediateEarnedAmount).toBe(60000)
      expect(alloc.deferredAmount).toBe(15000)
    })

    it('splits annual/multi-month retainers straight-line with exact sum reconciliation', () => {
      const lines = splitStraightLineSchedule(100000, new Date(2026, 0, 15), 3)
      expect(lines).toHaveLength(3)
      expect(lines[0]).toEqual({ periodYear: 2026, periodMonth: 1, amount: 33333.33 })
      expect(lines[1]).toEqual({ periodYear: 2026, periodMonth: 2, amount: 33333.33 })
      expect(lines[2]).toEqual({ periodYear: 2026, periodMonth: 3, amount: 33333.34 })
      const sum = lines.reduce((s, l) => s + l.amount, 0)
      expect(sum).toBeCloseTo(100000, 2)
    })
  })

  describe('Over/Under Billings, AR Aging, Bad Debt & Net Working Capital', () => {
    it('detects Under-Billed (WIP) vs Over-Billed (Deferred) project states', () => {
      const under = computeProjectOverUnderBilling({
        invoicedAgi: 100000,
        recognizedAgi: 100000,
        unbilledWipValue: 50000,
      })
      expect(under.status).toBe('UNDER_BILLED')
      expect(under.netPosition).toBe(50000)

      const over = computeProjectOverUnderBilling({
        invoicedAgi: 200000,
        recognizedAgi: 80000,
        unbilledWipValue: 0,
      })
      expect(over.status).toBe('OVER_BILLED')
      expect(over.deferredLiability).toBe(120000)
    })

    it('computes aging buckets and aging-weighted Bad Debt Allowance', () => {
      const asOf = new Date('2026-11-20T00:00:00Z')
      const res = computeArAgingAndBadDebt(
        [
          { dueAmountBase: 100000, dueDate: new Date('2026-12-01T00:00:00Z') }, // current (0%)
          { dueAmountBase: 50000, dueDate: new Date('2026-11-01T00:00:00Z') },  // 19d -> 2% = 1000
          { dueAmountBase: 40000, dueDate: new Date('2026-10-01T00:00:00Z') },  // 50d -> 10% = 4000
          { dueAmountBase: 20000, dueDate: new Date('2026-07-01T00:00:00Z') },  // 142d -> 60% = 12000
        ],
        asOf
      )
      expect(res.totalOpenReceivable).toBe(210000)
      expect(res.badDebtAllowance).toBe(17000)
      expect(res.netReceivables).toBe(193000)
    })

    it('computes Net Working Capital (NWC) and Current Ratio', () => {
      const nwc = computeNetWorkingCapital({
        cashAndBank: 500000,
        netReceivables: 200000,
        unbilledWip: 100000,
        accountsPayable: 80000,
        deferredRevenue: 220000,
        accruedPayroll: 100000,
      })
      expect(nwc.currentAssets).toBe(800000)
      expect(nwc.currentLiabilities).toBe(400000)
      expect(nwc.nwc).toBe(400000)
      expect(nwc.currentRatio).toBe(2)
    })
  })

  describe('Double-Entry & Soft-Void Guardrails', () => {
    it('rejects unbalanced journal entries', () => {
      expect(() =>
        assertBalancedJournal([
          { accountId: 'ar', type: 'DEBIT', amount: 1000 },
          { accountId: 'rev', type: 'CREDIT', amount: 950 },
        ])
      ).toThrow(/JOURNAL_UNBALANCED/)
    })

    it('enforces POSTED-only status filter predicates so VOID entries never leak', () => {
      expect(POSTED_JOURNAL_WHERE).toEqual({ status: 'POSTED' })
      expect(ACTIVE_LEDGER_ENTRY_WHERE).toEqual({
        OR: [{ journalEntryId: null }, { journalEntry: { status: 'POSTED' } }],
      })
    })
  })
})
