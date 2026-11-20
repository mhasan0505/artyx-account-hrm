import { describe, expect, it } from 'vitest'
import {
  computeClientDsoProfile,
  projectRealisticCollectionDate,
} from '@/lib/finance/dso-engine'
import {
  build13WeekCashFlow,
  cashFlowAssumptionsSchema,
  computeRunwayClock,
  type CashFlowModelInput,
} from '@/lib/finance/cashflow-engine'
import {
  DEFAULT_GUARDRAIL_THRESHOLDS,
  evaluateGuardrails,
} from '@/lib/finance/guardrail-engine'

describe('Phase 2 — DSO, 13-Week Cash Flow, Runway & Guardrails', () => {
  describe('DSO Engine', () => {
    it('computes per-client DSO and late days past dueDate', () => {
      const profile = computeClientDsoProfile([
        {
          clientId: 'c1',
          issueDate: '2026-09-01',
          dueDate: '2026-09-16',
          paidDate: '2026-09-26', // 25d DSO, 10d late
        },
        {
          clientId: 'c1',
          issueDate: '2026-10-01',
          dueDate: '2026-10-16',
          paidDate: '2026-10-20', // 19d DSO, 4d late
        },
        {
          clientId: 'c2',
          issueDate: '2026-10-01',
          dueDate: '2026-10-16',
          paidDate: '2026-10-10', // 9d DSO, 0d late
        },
      ])

      expect(profile.byClientId.c1.avgDsoDays).toBe(22)
      expect(profile.byClientId.c1.avgLateDays).toBe(7)
      expect(profile.byClientId.c2.avgLateDays).toBe(0)
    })

    it('rolls already-overdue invoices conservatively into +7d + manual delay weeks', () => {
      const asOf = new Date('2026-11-20T00:00:00Z')
      const projected = projectRealisticCollectionDate({
        dueDate: '2026-10-01T00:00:00Z',
        asOfDate: asOf,
        clientLateDays: 10,
        manualDelayWeeks: 2,
      })
      const diffDays = Math.round(
        (projected.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24)
      )
      expect(diffDays).toBe(21) // 7d baseline + 14d manual delay
    })
  })

  describe('13-Week Cash Flow & What-If Sandbox', () => {
    const baseInput: CashFlowModelInput = {
      asOfDate: '2026-11-01T00:00:00Z',
      startingCash: 500000,
      agencyFallbackLateDays: 0,
      monthlyPayrollBase: 200000,
      payrollDayOfMonth: 28,
      openReceivables: [
        {
          id: 'inv1',
          invoiceNumber: 'INV-2026-0101',
          clientId: 'c1',
          clientName: 'Apex',
          dueAmountBase: 150000,
          dueDate: '2026-11-10T00:00:00Z',
          clientLateDays: 0,
        },
      ],
      activeRetainers: [
        {
          id: 'ret1',
          clientId: 'c2',
          clientName: 'Nova Labs',
          serviceName: 'AI Retainer',
          monthlyFee: 180000,
          billingDay: 5,
        },
      ],
      upcomingMilestones: [],
      recurringCommitments: [
        {
          id: 'com1',
          name: 'Office Rent',
          category: 'RENT',
          amount: 50000,
          frequency: 'MONTHLY',
          dueDay: 1,
        },
      ],
      pendingPayables: [],
    }

    it('produces exact 13 rolling weeks with consistent opening/closing balances', () => {
      const res = build13WeekCashFlow(baseInput)
      expect(res.weeks).toHaveLength(13)
      expect(res.weeks[0].openingBalance).toBe(500000)

      for (let i = 1; i < 13; i++) {
        expect(res.weeks[i].openingBalance).toBe(res.weeks[i - 1].closingBalance)
      }
      expect(res.endingCash).toBe(res.weeks[12].closingBalance)
      expect(res.endingCash).toBeCloseTo(
        res.startingCash + res.totalInflows - res.totalOutflows,
        1
      )
    })

    it('lowers ending cash and detects negative cash week under hiring + retainer churn stress', () => {
      const baseline = build13WeekCashFlow(baseInput)
      const stressed = build13WeekCashFlow(baseInput, {
        additionalHiresCount: 4,
        additionalHireMonthlySalary: 120000,
        hireStartWeek: 1,
        retainerMrrDelta: -180000,
        retainerDeltaStartWeek: 1,
      })

      expect(stressed.endingCash).toBeLessThan(baseline.endingCash)
      expect(stressed.firstNegativeWeek).not.toBeNull()
    })

    it('rejects invalid What-If scenario payloads via Zod validation', () => {
      expect(() =>
        cashFlowAssumptionsSchema.parse({
          additionalHiresCount: 999, // exceeds max 25
          hireStartWeek: 20,         // exceeds week 13
        })
      ).toThrow()
    })
  })

  describe('Runway Clock (Current vs. Worst-Case)', () => {
    it('computes cash-positive current runway alongside finite worst-case runway', () => {
      const clock = computeRunwayClock({
        startingCash: 900000,
        avgMonthlyInflow: 600000,
        retainerOnlyMonthlyInflow: 200000,
        grossMonthlyBurn: 500000,
        asOfDate: new Date('2026-11-20T00:00:00Z'),
      })

      expect(clock.isCurrentCashFlowPositive).toBe(true)
      expect(clock.currentRunwayMonths).toBeNull()
      expect(clock.isRetainerCovered).toBe(false)
      expect(clock.worstCaseNetMonthlyBurn).toBe(300000)
      expect(clock.worstCaseRunwayMonths).toBe(3)
      expect(clock.worstCaseZeroCashDate).not.toBeNull()
    })

    it('marks worst-case runway as retainer-covered when MRR >= burn', () => {
      const clock = computeRunwayClock({
        startingCash: 400000,
        avgMonthlyInflow: 500000,
        retainerOnlyMonthlyInflow: 450000,
        grossMonthlyBurn: 400000,
      })
      expect(clock.isRetainerCovered).toBe(true)
      expect(clock.worstCaseRunwayMonths).toBeNull()
    })
  })

  describe('Executive Guardrails Engine', () => {
    it('scores 100 when all 5 metrics are within safe zones', () => {
      const res = evaluateGuardrails(
        {
          billableUtilizationPct: 78,
          hasTimeLogs: true,
          topClientName: 'Acme',
          topClientSharePct: 16,
          activeProjectsTotal: 4,
          projectsBelowMarginCount: 0,
          lowestActiveProjectName: null,
          lowestActiveProjectMarginPct: 58,
          worstCaseRunwayMonths: 6.5,
          severeOverdueAmount: 0,
          severeOverdueCount: 0,
        },
        DEFAULT_GUARDRAIL_THRESHOLDS
      )
      expect(res.healthScore).toBe(100)
      expect(res.breaches).toHaveLength(0)
    })

    it('flags breaches accurately and reduces health score when thresholds fail', () => {
      const res = evaluateGuardrails(
        {
          billableUtilizationPct: 50, // CRITICAL (< 55)
          hasTimeLogs: true,
          topClientName: 'Whale Corp',
          topClientSharePct: 42, // CRITICAL (> 35)
          activeProjectsTotal: 3,
          projectsBelowMarginCount: 1, // WARNING
          lowestActiveProjectName: 'Legacy Migration',
          lowestActiveProjectMarginPct: 32,
          worstCaseRunwayMonths: 2.1, // WARNING (< 3)
          severeOverdueAmount: 250000, // CRITICAL
          severeOverdueCount: 2,
        },
        DEFAULT_GUARDRAIL_THRESHOLDS
      )
      expect(res.criticalCount).toBe(3)
      expect(res.warningCount).toBe(2)
      expect(res.breaches).toHaveLength(5)
      expect(res.healthScore).toBeLessThan(30)
    })
  })
})
