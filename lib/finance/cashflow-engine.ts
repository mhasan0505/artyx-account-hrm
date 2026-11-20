/**
 * Pure 13-Week Rolling Cash Flow, Runway Clock & What-If Scenario Engine.
 * Shared across Server Actions, interactive client Sandbox, and Vitest unit tests.
 */

import { z } from 'zod'
import { round2 } from '@/lib/finance/accounting-math'
import { projectRealisticCollectionDate } from '@/lib/finance/dso-engine'

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Strict Zod schema for What-If Scenario Sandbox assumptions (validated on write & simulation).
 */
export const cashFlowAssumptionsSchema = z.object({
  additionalHiresCount: z.number().int().min(-10).max(25).default(0),
  additionalHireMonthlySalary: z.number().min(0).max(5_000_000).default(85000),
  hireStartWeek: z.number().int().min(1).max(13).default(2),
  retainerMrrDelta: z.number().min(-10_000_000).max(10_000_000).default(0),
  retainerDeltaStartWeek: z.number().int().min(1).max(13).default(2),
  monthlyAdSpendDelta: z.number().min(-5_000_000).max(5_000_000).default(0),
  arDelayWeeks: z.number().int().min(0).max(12).default(0),
  oneTimeCashDelta: z.number().min(-50_000_000).max(50_000_000).default(0),
  oneTimeDeltaWeek: z.number().int().min(1).max(13).default(1),
})

export type CashFlowAssumptions = z.infer<typeof cashFlowAssumptionsSchema>

export const DEFAULT_CASHFLOW_ASSUMPTIONS: CashFlowAssumptions = {
  additionalHiresCount: 0,
  additionalHireMonthlySalary: 85000,
  hireStartWeek: 2,
  retainerMrrDelta: 0,
  retainerDeltaStartWeek: 2,
  monthlyAdSpendDelta: 0,
  arDelayWeeks: 0,
  oneTimeCashDelta: 0,
  oneTimeDeltaWeek: 1,
}

export interface CashFlowArInput {
  id: string
  invoiceNumber: string
  clientId: string
  clientName: string
  dueAmountBase: number
  dueDate: string // ISO string so payload serializes cleanly across RSC boundary
  clientLateDays?: number
}

export interface CashFlowRetainerInput {
  id: string
  clientId: string
  clientName: string
  serviceName: string
  monthlyFee: number
  billingDay: number
}

export interface CashFlowMilestoneInput {
  id: string
  title: string
  projectName: string
  clientName: string
  billableAmount: number
  targetDate: string
}

export interface CashFlowCommitmentInput {
  id: string
  name: string
  category: string
  amount: number
  frequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
  dueDay: number
}

export interface CashFlowPayableInput {
  id: string
  description: string
  amountBase: number
  dueDate: string
}

export interface CashFlowModelInput {
  asOfDate: string
  startingCash: number
  agencyFallbackLateDays: number
  monthlyPayrollBase: number
  payrollDayOfMonth?: number
  openReceivables: CashFlowArInput[]
  activeRetainers: CashFlowRetainerInput[]
  upcomingMilestones: CashFlowMilestoneInput[]
  recurringCommitments: CashFlowCommitmentInput[]
  pendingPayables: CashFlowPayableInput[]
}

export interface WeeklyCashEvent {
  id: string
  direction: 'INFLOW' | 'OUTFLOW'
  category: 'AR' | 'RETAINER' | 'MILESTONE' | 'PAYROLL' | 'COMMITMENT' | 'PAYABLE' | 'SCENARIO'
  label: string
  amount: number
  projectedDate: string
}

export interface CashFlowWeekBucket {
  weekNumber: number // 1..13
  label: string      // "W1".."W13"
  dateRangeLabel: string
  startDate: string
  endDate: string
  openingBalance: number
  inflows: number
  outflows: number
  netCashFlow: number
  closingBalance: number
  events: WeeklyCashEvent[]
}

export interface CashFlow13WeekResult {
  weeks: CashFlowWeekBucket[]
  startingCash: number
  endingCash: number
  totalInflows: number
  totalOutflows: number
  lowestCashBalance: number
  lowestCashWeek: number
  firstNegativeWeek: number | null
}

function getWeekIndex(eventDate: Date, startMs: number): number {
  const diffDays = Math.floor((eventDate.getTime() - startMs) / MS_PER_DAY)
  if (diffDays < 0) return -1
  const idx = Math.floor(diffDays / 7)
  return idx >= 0 && idx < 13 ? idx : -1
}

function formatShortMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Generates an itemized 13-week rolling cash flow projection with optional What-If overrides.
 */
export function build13WeekCashFlow(
  input: CashFlowModelInput,
  rawAssumptions?: Partial<CashFlowAssumptions>
): CashFlow13WeekResult {
  const assumptions = cashFlowAssumptionsSchema.parse({
    ...DEFAULT_CASHFLOW_ASSUMPTIONS,
    ...(rawAssumptions ?? {}),
  })

  const asOf = new Date(input.asOfDate)
  asOf.setHours(0, 0, 0, 0)
  const startMs = asOf.getTime()
  const horizonEndMs = startMs + 13 * 7 * MS_PER_DAY

  const weekEvents: WeeklyCashEvent[][] = Array.from({ length: 13 }, () => [])

  const pushEvent = (date: Date, event: Omit<WeeklyCashEvent, 'projectedDate'>) => {
    const idx = getWeekIndex(date, startMs)
    if (idx === -1 || event.amount <= 0) return
    weekEvents[idx].push({
      ...event,
      amount: round2(event.amount),
      projectedDate: date.toISOString(),
    })
  }

  // 1. Open AR Invoices (DSO-adjusted + What-If AR delay weeks)
  for (const inv of input.openReceivables) {
    if (inv.dueAmountBase <= 0) continue
    const projected = projectRealisticCollectionDate({
      dueDate: inv.dueDate,
      asOfDate: asOf,
      clientLateDays: inv.clientLateDays,
      agencyFallbackLateDays: input.agencyFallbackLateDays,
      manualDelayWeeks: assumptions.arDelayWeeks,
    })
    pushEvent(projected, {
      id: `ar-${inv.id}`,
      direction: 'INFLOW',
      category: 'AR',
      label: `${inv.invoiceNumber} · ${inv.clientName}`,
      amount: inv.dueAmountBase,
    })
  }

  // 2. Scheduled Unbilled Project Milestones (+14 days payment term + AR delay)
  for (const ms of input.upcomingMilestones) {
    if (ms.billableAmount <= 0) continue
    const target = new Date(ms.targetDate)
    const cashDate = new Date(
      target.getTime() + (14 + assumptions.arDelayWeeks * 7) * MS_PER_DAY
    )
    pushEvent(cashDate, {
      id: `ms-${ms.id}`,
      direction: 'INFLOW',
      category: 'MILESTONE',
      label: `Milestone: ${ms.title} (${ms.clientName})`,
      amount: ms.billableAmount,
    })
  }

  // 3. Monthly Recurring Retainers across the next 4 calendar months inside the 91-day window
  for (let mOffset = 0; mOffset <= 3; mOffset++) {
    const refMonth = new Date(asOf.getFullYear(), asOf.getMonth() + mOffset, 1)
    const y = refMonth.getFullYear()
    const m = refMonth.getMonth()

    for (const ret of input.activeRetainers) {
      if (ret.monthlyFee <= 0) continue
      const day = Math.min(28, Math.max(1, ret.billingDay || 1))
      const billDate = new Date(y, m, day)
      const collectDate = new Date(
        billDate.getTime() + assumptions.arDelayWeeks * 7 * MS_PER_DAY
      )
      if (collectDate.getTime() >= startMs && collectDate.getTime() < horizonEndMs) {
        pushEvent(collectDate, {
          id: `ret-${ret.id}-${y}-${m}`,
          direction: 'INFLOW',
          category: 'RETAINER',
          label: `Retainer: ${ret.clientName}`,
          amount: ret.monthlyFee,
        })
      }
    }

    // 4. Monthly Payroll Run
    if (input.monthlyPayrollBase > 0) {
      const payrollDay = Math.min(28, Math.max(1, input.payrollDayOfMonth ?? 28))
      const payDate = new Date(y, m, payrollDay)
      if (payDate.getTime() >= startMs && payDate.getTime() < horizonEndMs) {
        pushEvent(payDate, {
          id: `payroll-${y}-${m}`,
          direction: 'OUTFLOW',
          category: 'PAYROLL',
          label: `Monthly Team Payroll`,
          amount: input.monthlyPayrollBase,
        })
      }
    }

    // 5. Monthly & Quarterly Recurring Commitments
    for (const c of input.recurringCommitments) {
      if (c.amount <= 0) continue
      if (c.frequency === 'MONTHLY' || (c.frequency === 'QUARTERLY' && mOffset % 3 === 0)) {
        const day = Math.min(28, Math.max(1, c.dueDay || 1))
        const dueDate = new Date(y, m, day)
        if (dueDate.getTime() >= startMs && dueDate.getTime() < horizonEndMs) {
          pushEvent(dueDate, {
            id: `com-${c.id}-${y}-${m}`,
            direction: 'OUTFLOW',
            category: 'COMMITMENT',
            label: `${c.name} (${c.category.replace(/_/g, ' ')})`,
            amount: c.amount,
          })
        }
      }
    }
  }

  // Weekly recurring commitments
  for (const c of input.recurringCommitments) {
    if (c.frequency !== 'WEEKLY' || c.amount <= 0) continue
    for (let w = 0; w < 13; w++) {
      const d = new Date(startMs + (w * 7 + Math.min(6, Math.max(0, (c.dueDay || 1) - 1))) * MS_PER_DAY)
      pushEvent(d, {
        id: `com-w-${c.id}-${w}`,
        direction: 'OUTFLOW',
        category: 'COMMITMENT',
        label: `${c.name} (Weekly)`,
        amount: c.amount,
      })
    }
  }

  // 6. Pending AP / Unpaid Expenses
  for (const ap of input.pendingPayables) {
    if (ap.amountBase <= 0) continue
    const due = new Date(ap.dueDate)
    const payDate = due.getTime() < startMs ? new Date(startMs + 2 * MS_PER_DAY) : due
    pushEvent(payDate, {
      id: `ap-${ap.id}`,
      direction: 'OUTFLOW',
      category: 'PAYABLE',
      label: `Payable: ${ap.description}`,
      amount: ap.amountBase,
    })
  }

  // 7. Apply "What-If" Scenario Deltas cleanly onto weekly buckets
  const hireWeeklyPayrollDelta = round2(
    (assumptions.additionalHiresCount * assumptions.additionalHireMonthlySalary) / 4.3333
  )
  const retainerWeeklyDelta = round2(assumptions.retainerMrrDelta / 4.3333)
  const adSpendWeeklyDelta = round2(assumptions.monthlyAdSpendDelta / 4.3333)

  for (let w = 0; w < 13; w++) {
    const weekNum = w + 1
    const weekMidDate = new Date(startMs + (w * 7 + 3) * MS_PER_DAY)

    if (hireWeeklyPayrollDelta !== 0 && weekNum >= assumptions.hireStartWeek) {
      weekEvents[w].push({
        id: `sim-hire-${weekNum}`,
        direction: hireWeeklyPayrollDelta > 0 ? 'OUTFLOW' : 'INFLOW',
        category: 'SCENARIO',
        label:
          assumptions.additionalHiresCount > 0
            ? `What-If: +${assumptions.additionalHiresCount} Hire Payroll`
            : `What-If: ${assumptions.additionalHiresCount} Headcount Savings`,
        amount: Math.abs(hireWeeklyPayrollDelta),
        projectedDate: weekMidDate.toISOString(),
      })
    }

    if (retainerWeeklyDelta !== 0 && weekNum >= assumptions.retainerDeltaStartWeek) {
      weekEvents[w].push({
        id: `sim-retainer-${weekNum}`,
        direction: retainerWeeklyDelta > 0 ? 'INFLOW' : 'OUTFLOW',
        category: 'SCENARIO',
        label:
          retainerWeeklyDelta > 0
            ? 'What-If: New Retainer Revenue'
            : 'What-If: Lost Retainer Impact',
        amount: Math.abs(retainerWeeklyDelta),
        projectedDate: weekMidDate.toISOString(),
      })
    }

    if (adSpendWeeklyDelta !== 0) {
      weekEvents[w].push({
        id: `sim-ads-${weekNum}`,
        direction: adSpendWeeklyDelta > 0 ? 'OUTFLOW' : 'INFLOW',
        category: 'SCENARIO',
        label:
          adSpendWeeklyDelta > 0
            ? 'What-If: Increased Ad Spend'
            : 'What-If: Reduced Ad Spend',
        amount: Math.abs(adSpendWeeklyDelta),
        projectedDate: weekMidDate.toISOString(),
      })
    }

    if (assumptions.oneTimeCashDelta !== 0 && weekNum === assumptions.oneTimeDeltaWeek) {
      weekEvents[w].push({
        id: `sim-onetime-${weekNum}`,
        direction: assumptions.oneTimeCashDelta > 0 ? 'INFLOW' : 'OUTFLOW',
        category: 'SCENARIO',
        label:
          assumptions.oneTimeCashDelta > 0
            ? 'What-If: One-Time Cash Inflow'
            : 'What-If: One-Time Capital Outflow',
        amount: Math.abs(assumptions.oneTimeCashDelta),
        projectedDate: weekMidDate.toISOString(),
      })
    }
  }

  // 8. Roll Balances Across Weeks 1..13
  let runningBalance = round2(input.startingCash)
  let totalInflows = 0
  let totalOutflows = 0
  let lowestCashBalance = runningBalance
  let lowestCashWeek = 1
  let firstNegativeWeek: number | null = runningBalance < 0 ? 1 : null

  const weeks: CashFlowWeekBucket[] = []

  for (let w = 0; w < 13; w++) {
    const weekStart = new Date(startMs + w * 7 * MS_PER_DAY)
    const weekEnd = new Date(startMs + (w * 7 + 6) * MS_PER_DAY)
    const events = weekEvents[w]

    const inflows = round2(
      events.filter(e => e.direction === 'INFLOW').reduce((s, e) => s + e.amount, 0)
    )
    const outflows = round2(
      events.filter(e => e.direction === 'OUTFLOW').reduce((s, e) => s + e.amount, 0)
    )
    const netCashFlow = round2(inflows - outflows)
    const openingBalance = runningBalance
    const closingBalance = round2(openingBalance + netCashFlow)

    totalInflows = round2(totalInflows + inflows)
    totalOutflows = round2(totalOutflows + outflows)

    if (closingBalance < lowestCashBalance) {
      lowestCashBalance = closingBalance
      lowestCashWeek = w + 1
    }
    if (firstNegativeWeek === null && closingBalance < 0) {
      firstNegativeWeek = w + 1
    }

    weeks.push({
      weekNumber: w + 1,
      label: `W${w + 1}`,
      dateRangeLabel: `${formatShortMonthDay(weekStart)} – ${formatShortMonthDay(weekEnd)}`,
      startDate: weekStart.toISOString(),
      endDate: weekEnd.toISOString(),
      openingBalance,
      inflows,
      outflows,
      netCashFlow,
      closingBalance,
      events,
    })

    runningBalance = closingBalance
  }

  return {
    weeks,
    startingCash: round2(input.startingCash),
    endingCash: runningBalance,
    totalInflows,
    totalOutflows,
    lowestCashBalance,
    lowestCashWeek,
    firstNegativeWeek,
  }
}

export interface RunwayClockResult {
  startingCash: number
  grossMonthlyBurn: number
  currentNetMonthlyBurn: number
  currentRunwayMonths: number | null // null = Cash-Flow Positive (Infinite)
  currentZeroCashDate: string | null
  isCurrentCashFlowPositive: boolean
  worstCaseNetMonthlyBurn: number
  worstCaseRunwayMonths: number | null // null = Retainers cover 100% of burn
  worstCaseZeroCashDate: string | null
  isRetainerCovered: boolean
  retainerCoveragePct: number
}

/**
 * Computes both Current Burn Runway and Worst-Case Runway (zero new project sales — retainer inflows only).
 */
export function computeRunwayClock(params: {
  startingCash: number
  avgMonthlyInflow: number
  retainerOnlyMonthlyInflow: number
  grossMonthlyBurn: number
  asOfDate?: Date
}): RunwayClockResult {
  const asOf = params.asOfDate ?? new Date()
  const cash = round2(Math.max(0, params.startingCash))
  const burn = round2(Math.max(0, params.grossMonthlyBurn))
  const avgIn = round2(Math.max(0, params.avgMonthlyInflow))
  const retIn = round2(Math.max(0, params.retainerOnlyMonthlyInflow))

  const currentNetBurn = round2(burn - avgIn)
  const isCurrentPositive = currentNetBurn <= 0
  const currentRunwayMonths = isCurrentPositive
    ? null
    : round2(cash / currentNetBurn)
  const currentZeroCashDate =
    currentRunwayMonths !== null
      ? new Date(asOf.getTime() + currentRunwayMonths * 30.4375 * MS_PER_DAY).toISOString()
      : null

  const worstCaseNetBurn = round2(burn - retIn)
  const isRetainerCovered = worstCaseNetBurn <= 0
  const worstCaseRunwayMonths = isRetainerCovered
    ? null
    : round2(cash / worstCaseNetBurn)
  const worstCaseZeroCashDate =
    worstCaseRunwayMonths !== null
      ? new Date(asOf.getTime() + worstCaseRunwayMonths * 30.4375 * MS_PER_DAY).toISOString()
      : null

  const retainerCoveragePct =
    burn > 0 ? round2(Math.min(200, (retIn / burn) * 100)) : 100

  return {
    startingCash: cash,
    grossMonthlyBurn: burn,
    currentNetMonthlyBurn: Math.max(0, currentNetBurn),
    currentRunwayMonths,
    currentZeroCashDate,
    isCurrentCashFlowPositive: isCurrentPositive,
    worstCaseNetMonthlyBurn: Math.max(0, worstCaseNetBurn),
    worstCaseRunwayMonths,
    worstCaseZeroCashDate,
    isRetainerCovered,
    retainerCoveragePct,
  }
}
