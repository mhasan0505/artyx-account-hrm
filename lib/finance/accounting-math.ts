/**
 * Pure domain math for Hybrid Software Agency Accounting (Phase 1).
 * Zero Next.js or Prisma runtime dependencies so every edge case is unit-testable in Vitest.
 */

export const WEEKS_PER_MONTH = 4.3333

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface EmployeeCostInput {
  basicSalary: number
  weeklyCapacityHours?: number | null
  overheadMultiplier?: number | null
  loadedHourlyCostOverride?: number | null
}

/**
 * Computes fully-loaded hourly labor cost per employee.
 * - Uses explicit per-employee override when set (> 0).
 * - Otherwise derives monthly workable hours from `weeklyCapacityHours * 4.3333`
 *   and applies configurable `overheadMultiplier` (defaults to 1.15x).
 */
export function computeLoadedHourlyCost(input: EmployeeCostInput): number {
  const override = Number(input.loadedHourlyCostOverride ?? 0)
  if (override > 0) {
    return round2(override)
  }

  const salary = Math.max(0, Number(input.basicSalary) || 0)
  if (salary <= 0) return 0

  const weeklyHours =
    Number(input.weeklyCapacityHours) > 0
      ? Number(input.weeklyCapacityHours)
      : 40
  const multiplier =
    Number(input.overheadMultiplier) > 0
      ? Number(input.overheadMultiplier)
      : 1.15

  const monthlyWorkableHours = weeklyHours * WEEKS_PER_MONTH
  return round2((salary * multiplier) / monthlyWorkableHours)
}

export function computeMonthlyCapacityHours(weeklyCapacityHours?: number | null): number {
  const weekly = Number(weeklyCapacityHours) > 0 ? Number(weeklyCapacityHours) : 40
  return round2(weekly * WEEKS_PER_MONTH)
}

/**
 * Agency Gross Income (AGI) = Gross Billings - Pass-Through Costs (Reimbursables).
 * All true agency margin ratios use AGI as denominator.
 */
export function computeAGI(grossBillings: number, passThroughBillings: number) {
  const gross = Math.max(0, round2(grossBillings))
  const passThrough = Math.max(0, Math.min(gross, round2(passThroughBillings)))
  const agi = round2(gross - passThrough)
  const passThroughPct = gross > 0 ? round2((passThrough / gross) * 100) : 0
  return {
    grossBillings: gross,
    passThroughBillings: passThrough,
    agi,
    passThroughPct,
  }
}

/**
 * Effective Hourly Rate (EHR):
 * Fixed-fee (or total project) AGI revenue divided by ALL hours logged (billable + unbilled revisions + PM).
 */
export function computeEHR(projectAgiRevenue: number, totalLoggedHours: number): number {
  if (totalLoggedHours <= 0) return 0
  return round2(projectAgiRevenue / totalLoggedHours)
}

/**
 * Gross Margin Return on Labor (GMROL):
 * Dollars/Taka of Gross Profit generated for every 1 unit spent on Direct Labor.
 */
export function computeGMROL(grossProfit: number, directLaborCost: number): number {
  if (directLaborCost <= 0) return 0
  return round2(grossProfit / directLaborCost)
}

/**
 * Realized Foreign Exchange Gain/Loss on foreign-currency invoice settlement.
 * Positive = FX Gain (received more BDT than booked on invoice date).
 * Negative = FX Loss (received fewer BDT than booked on invoice date).
 */
export function computeRealizedFxGainLoss(params: {
  amountForeign: number
  invoiceRate: number
  settlementRate: number
}) {
  const amount = Math.max(0, Number(params.amountForeign) || 0)
  const invRate = Number(params.invoiceRate) > 0 ? Number(params.invoiceRate) : 1
  const setRate = Number(params.settlementRate) > 0 ? Number(params.settlementRate) : invRate

  const bookedBase = round2(amount * invRate)
  const settledBase = round2(amount * setRate)
  const realizedGainLoss = round2(settledBase - bookedBase)

  return {
    bookedBase,
    settledBase,
    realizedGainLoss,
  }
}

export function computeUnrealizedFx(params: {
  openForeignAmount: number
  invoiceRate: number
  spotRate: number
}) {
  const amount = Math.max(0, Number(params.openForeignAmount) || 0)
  const invRate = Number(params.invoiceRate) > 0 ? Number(params.invoiceRate) : 1
  const spot = Number(params.spotRate) > 0 ? Number(params.spotRate) : invRate

  const bookedBase = round2(amount * invRate)
  const markToMarketBase = round2(amount * spot)
  return {
    bookedBase,
    markToMarketBase,
    unrealizedGainLoss: round2(markToMarketBase - bookedBase),
  }
}

export interface OpenReceivableInput {
  dueAmountBase: number
  dueDate: Date
}

export interface BadDebtRates {
  current: number
  days1to30: number
  days31to60: number
  days61to90: number
  days90Plus: number
}

export const DEFAULT_BAD_DEBT_RATES: BadDebtRates = {
  current: 0,
  days1to30: 0.02,
  days31to60: 0.1,
  days61to90: 0.25,
  days90Plus: 0.6,
}

/**
 * Computes AR Aging Buckets & Aging-Weighted Bad Debt Allowance.
 */
export function computeArAgingAndBadDebt(
  openInvoices: OpenReceivableInput[],
  asOfDate: Date = new Date(),
  rates: BadDebtRates = DEFAULT_BAD_DEBT_RATES
) {
  const buckets = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90Plus: 0,
  }

  const msPerDay = 1000 * 60 * 60 * 24

  for (const inv of openInvoices) {
    const due = Math.max(0, Number(inv.dueAmountBase) || 0)
    if (due <= 0) continue

    const daysOverdue = Math.floor(
      (asOfDate.getTime() - new Date(inv.dueDate).getTime()) / msPerDay
    )

    if (daysOverdue <= 0) {
      buckets.current += due
    } else if (daysOverdue <= 30) {
      buckets.days1to30 += due
    } else if (daysOverdue <= 60) {
      buckets.days31to60 += due
    } else if (daysOverdue <= 90) {
      buckets.days61to90 += due
    } else {
      buckets.days90Plus += due
    }
  }

  buckets.current = round2(buckets.current)
  buckets.days1to30 = round2(buckets.days1to30)
  buckets.days31to60 = round2(buckets.days31to60)
  buckets.days61to90 = round2(buckets.days61to90)
  buckets.days90Plus = round2(buckets.days90Plus)

  const totalOpenReceivable = round2(
    buckets.current +
      buckets.days1to30 +
      buckets.days31to60 +
      buckets.days61to90 +
      buckets.days90Plus
  )

  const badDebtAllowance = round2(
    buckets.current * rates.current +
      buckets.days1to30 * rates.days1to30 +
      buckets.days31to60 * rates.days31to60 +
      buckets.days61to90 * rates.days61to90 +
      buckets.days90Plus * rates.days90Plus
  )

  return {
    buckets,
    totalOpenReceivable,
    badDebtAllowance,
    netReceivables: round2(Math.max(0, totalOpenReceivable - badDebtAllowance)),
  }
}

/**
 * Net Working Capital (NWC) = Current Assets - Current Liabilities.
 */
export function computeNetWorkingCapital(params: {
  cashAndBank: number
  netReceivables: number
  unbilledWip: number
  accountsPayable: number
  deferredRevenue: number
  accruedPayroll: number
}) {
  const currentAssets = round2(
    (params.cashAndBank || 0) +
      (params.netReceivables || 0) +
      (params.unbilledWip || 0)
  )
  const currentLiabilities = round2(
    (params.accountsPayable || 0) +
      (params.deferredRevenue || 0) +
      (params.accruedPayroll || 0)
  )
  const nwc = round2(currentAssets - currentLiabilities)
  const currentRatio =
    currentLiabilities > 0 ? round2(currentAssets / currentLiabilities) : null

  return {
    currentAssets,
    currentLiabilities,
    nwc,
    currentRatio,
  }
}

/**
 * Partial Milestone Invoicing & Deferred vs. Immediate Recognition Rule:
 *
 * - If the milestone is NOT yet completed (upfront deposit or partial progress bill):
 *   100% of the new non-pass-through billed amount enters Deferred Revenue (liability).
 *   When the milestone completes later, deferred amounts are recognized into Earned Revenue,
 *   and any unbilled remainder (milestoneValue - totalInvoiced) becomes Unbilled WIP.
 *
 * - If the milestone IS already completed:
 *   Up to the unbilled milestone remainder is recognized immediately (clearing WIP),
 *   and only an amount exceeding milestoneValue enters Deferred Revenue.
 */
export function computeMilestoneInvoiceAllocation(params: {
  milestoneValue: number
  alreadyInvoicedForMilestone: number
  newInvoiceNonPassThrough: number
  isMilestoneCompleted: boolean
}) {
  const newAmt = Math.max(0, round2(params.newInvoiceNonPassThrough))
  const milestoneVal = Math.max(0, round2(params.milestoneValue))
  const prevInvoiced = Math.max(0, round2(params.alreadyInvoicedForMilestone))

  if (newAmt <= 0) {
    return {
      deferredAmount: 0,
      immediateEarnedAmount: 0,
      remainingUnbilledWip: params.isMilestoneCompleted
        ? round2(Math.max(0, milestoneVal - prevInvoiced))
        : 0,
    }
  }

  if (!params.isMilestoneCompleted) {
    return {
      deferredAmount: newAmt,
      immediateEarnedAmount: 0,
      remainingUnbilledWip: 0,
    }
  }

  // Milestone already completed: clear unbilled earned balance first
  const unbilledEarnedAvailable = Math.max(0, round2(milestoneVal - prevInvoiced))
  const immediateEarnedAmount = round2(Math.min(newAmt, unbilledEarnedAvailable))
  const deferredAmount = round2(Math.max(0, newAmt - immediateEarnedAmount))
  const remainingUnbilledWip = round2(
    Math.max(0, unbilledEarnedAvailable - immediateEarnedAmount)
  )

  return {
    deferredAmount,
    immediateEarnedAmount,
    remainingUnbilledWip,
  }
}

/**
 * Over / Under Billings per Project:
 * - Over-billed (Deferred Revenue liability) = Invoiced AGI > Recognized Earned Revenue
 * - Under-billed (Unbilled WIP asset) = Completed unbilled milestones + unbilled work value
 */
export function computeProjectOverUnderBilling(params: {
  invoicedAgi: number
  recognizedAgi: number
  unbilledWipValue: number
}) {
  const deferredLiability = round2(
    Math.max(0, (params.invoicedAgi || 0) - (params.recognizedAgi || 0))
  )
  const unbilledAsset = round2(Math.max(0, params.unbilledWipValue || 0))
  const netPosition = round2(unbilledAsset - deferredLiability)

  let status: 'UNDER_BILLED' | 'OVER_BILLED' | 'BALANCED' = 'BALANCED'
  if (netPosition > 1) status = 'UNDER_BILLED'
  else if (netPosition < -1) status = 'OVER_BILLED'

  return {
    deferredLiability,
    unbilledAsset,
    netPosition,
    status,
  }
}

/**
 * Straight-line monthly amortization splitter for multi-month / annual retainers.
 * Guarantees exact sum equality by absorbing rounding remainder in the final period.
 */
export function splitStraightLineSchedule(
  totalAmount: number,
  startDate: Date,
  months: number
): Array<{ periodYear: number; periodMonth: number; amount: number }> {
  const total = Math.max(0, round2(totalAmount))
  const count = Math.max(1, Math.floor(months))
  if (total <= 0) return []

  const baseMonthly = round2(total / count)
  const result: Array<{ periodYear: number; periodMonth: number; amount: number }> = []
  let allocated = 0

  for (let i = 0; i < count; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
    const isLast = i === count - 1
    const amount = isLast ? round2(total - allocated) : baseMonthly
    allocated = round2(allocated + amount)
    result.push({
      periodYear: d.getFullYear(),
      periodMonth: d.getMonth() + 1,
      amount,
    })
  }

  return result
}
