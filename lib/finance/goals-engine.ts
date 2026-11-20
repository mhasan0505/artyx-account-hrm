/**
 * Pure Top-Down & Bottom-Up Agency Goal Builder Engine (Module 2).
 * Reverse-engineers operational sales, billable hours, and developer headcount from financial targets.
 */

import { round2 } from '@/lib/finance/accounting-math'

export interface AnnualGoalInput {
  fiscalYear: number
  targetArr: number
  targetProjectRevenue: number
  targetEbitdaPct: number
  avgProjectSize: number
  avgRetainerMrr: number
  targetUtilizationPct: number
  avgBillableRate: number
  avgWeeklyHoursPerDev?: number
}

export interface AnnualGoalActuals {
  currentArr: number
  ytdAgi: number
  currentBillableHeadcount: number
  dayOfYear?: number // 1..365
}

export interface ReverseEngineeredGoalResult {
  totalTargetRevenue: number
  targetEbitdaAmount: number
  impliedTotalCostBudget: number
  requiredNewArr: number
  requiredNewMrr: number
  requiredNewRetainersTotal: number
  requiredNewRetainersPerMonth: number
  requiredProjectsPerYear: number
  requiredProjectsPerMonth: number
  requiredMonthlyRevenueRunRate: number
  requiredAnnualBillableHours: number
  requiredMonthlyBillableHours: number
  annualBillableCapacityPerDev: number
  requiredBillableHeadcount: number
  headcountGap: number // positive = need to hire; negative = surplus capacity
  ytdTargetPacing: number
  ytdAttainmentPct: number
  pacingStatus: 'AHEAD' | 'ON_TRACK' | 'BEHIND'
}

export function reverseEngineerAnnualGoal(
  goal: AnnualGoalInput,
  actuals: AnnualGoalActuals
): ReverseEngineeredGoalResult {
  const targetArr = Math.max(0, Number(goal.targetArr) || 0)
  const targetProject = Math.max(0, Number(goal.targetProjectRevenue) || 0)
  const totalTargetRevenue = round2(targetArr + targetProject)

  const ebitdaPct = Math.min(80, Math.max(0, Number(goal.targetEbitdaPct) || 0))
  const targetEbitdaAmount = round2(totalTargetRevenue * (ebitdaPct / 100))
  const impliedTotalCostBudget = round2(totalTargetRevenue - targetEbitdaAmount)

  const requiredNewArr = round2(Math.max(0, targetArr - (actuals.currentArr || 0)))
  const requiredNewMrr = round2(requiredNewArr / 12)

  const avgRetMrr = Math.max(1, Number(goal.avgRetainerMrr) || 100000)
  const requiredNewRetainersTotal = Math.ceil(requiredNewMrr / avgRetMrr)
  const requiredNewRetainersPerMonth = round2(requiredNewRetainersTotal / 12)

  const avgProj = Math.max(1, Number(goal.avgProjectSize) || 250000)
  const requiredProjectsPerYear = Math.ceil(targetProject / avgProj)
  const requiredProjectsPerMonth = round2(requiredProjectsPerYear / 12)

  const requiredMonthlyRevenueRunRate = round2(totalTargetRevenue / 12)

  const rate = Math.max(1, Number(goal.avgBillableRate) || 3500)
  const requiredAnnualBillableHours = Math.ceil(totalTargetRevenue / rate)
  const requiredMonthlyBillableHours = Math.ceil(requiredAnnualBillableHours / 12)

  const weeklyHours =
    goal.avgWeeklyHoursPerDev && goal.avgWeeklyHoursPerDev > 0
      ? goal.avgWeeklyHoursPerDev
      : 40
  const utilFraction =
    Math.min(100, Math.max(20, Number(goal.targetUtilizationPct) || 75)) / 100
  // Assume 48 working weeks per year (accounting for national holidays & PTO)
  const annualBillableCapacityPerDev = round2(weeklyHours * 48 * utilFraction)

  const requiredBillableHeadcount =
    annualBillableCapacityPerDev > 0
      ? Math.ceil(requiredAnnualBillableHours / annualBillableCapacityPerDev)
      : 0
  const headcountGap = requiredBillableHeadcount - (actuals.currentBillableHeadcount || 0)

  const day = Math.min(365, Math.max(1, actuals.dayOfYear ?? 180))
  const ytdTargetPacing = round2(totalTargetRevenue * (day / 365))
  const ytdAttainmentPct =
    ytdTargetPacing > 0 ? round2(((actuals.ytdAgi || 0) / ytdTargetPacing) * 100) : 0

  let pacingStatus: 'AHEAD' | 'ON_TRACK' | 'BEHIND' = 'ON_TRACK'
  if (ytdAttainmentPct >= 105) pacingStatus = 'AHEAD'
  else if (ytdAttainmentPct < 88) pacingStatus = 'BEHIND'

  return {
    totalTargetRevenue,
    targetEbitdaAmount,
    impliedTotalCostBudget,
    requiredNewArr,
    requiredNewMrr,
    requiredNewRetainersTotal,
    requiredNewRetainersPerMonth,
    requiredProjectsPerYear,
    requiredProjectsPerMonth,
    requiredMonthlyRevenueRunRate,
    requiredAnnualBillableHours,
    requiredMonthlyBillableHours,
    annualBillableCapacityPerDev,
    requiredBillableHeadcount,
    headcountGap,
    ytdTargetPacing,
    ytdAttainmentPct,
    pacingStatus,
  }
}
