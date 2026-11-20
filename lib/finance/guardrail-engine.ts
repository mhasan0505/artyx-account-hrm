/**
 * Pure Executive Guardrail Alerts Engine (Module 2 Guardrails).
 * Evaluates live operational & financial metrics against configurable safe-zone thresholds.
 */

import { round2 } from '@/lib/finance/accounting-math'

export interface GuardrailThresholds {
  minBillableUtilizationPct: number
  maxClientConcentrationPct: number
  minProjectGrossMarginPct: number
  minRunwayMonths: number
  badDebtOverdueDays: number
}

export const DEFAULT_GUARDRAIL_THRESHOLDS: GuardrailThresholds = {
  minBillableUtilizationPct: 70,
  maxClientConcentrationPct: 20,
  minProjectGrossMarginPct: 45,
  minRunwayMonths: 3,
  badDebtOverdueDays: 90,
}

export type GuardrailSeverity = 'HEALTHY' | 'WARNING' | 'CRITICAL'

export interface GuardrailAlert {
  id:
    | 'BILLABLE_UTILIZATION'
    | 'CLIENT_CONCENTRATION'
    | 'PROJECT_GROSS_MARGIN'
    | 'CASH_RUNWAY'
    | 'SEVERE_OVERDUE_AR'
  label: string
  severity: GuardrailSeverity
  currentDisplay: string
  thresholdDisplay: string
  headline: string
  detail: string
  href: string
}

export interface GuardrailMetricsInput {
  billableUtilizationPct: number
  hasTimeLogs: boolean
  topClientName: string | null
  topClientSharePct: number
  activeProjectsTotal: number
  projectsBelowMarginCount: number
  lowestActiveProjectName: string | null
  lowestActiveProjectMarginPct: number | null
  worstCaseRunwayMonths: number | null // null = retainer-covered (infinite)
  severeOverdueAmount: number
  severeOverdueCount: number
}

export interface GuardrailEvaluationResult {
  alerts: GuardrailAlert[]
  breaches: GuardrailAlert[]
  criticalCount: number
  warningCount: number
  healthScore: number // 0..100
}

export function evaluateGuardrails(
  metrics: GuardrailMetricsInput,
  thresholds: GuardrailThresholds = DEFAULT_GUARDRAIL_THRESHOLDS
): GuardrailEvaluationResult {
  const alerts: GuardrailAlert[] = []

  // 1. Billable Utilization
  const util = round2(metrics.billableUtilizationPct)
  let utilSeverity: GuardrailSeverity = 'HEALTHY'
  if (metrics.hasTimeLogs) {
    if (util < thresholds.minBillableUtilizationPct - 15) utilSeverity = 'CRITICAL'
    else if (util < thresholds.minBillableUtilizationPct) utilSeverity = 'WARNING'
  }
  alerts.push({
    id: 'BILLABLE_UTILIZATION',
    label: 'Billable Utilization',
    severity: utilSeverity,
    currentDisplay: metrics.hasTimeLogs ? `${util}%` : 'No logs',
    thresholdDisplay: `≥ ${thresholds.minBillableUtilizationPct}%`,
    headline: !metrics.hasTimeLogs
      ? 'No billable time logs recorded in the last 30 days'
      : utilSeverity === 'HEALTHY'
      ? `Delivery utilization healthy at ${util}%`
      : `Utilization dropped to ${util}% (below ${thresholds.minBillableUtilizationPct}% floor)`,
    detail: !metrics.hasTimeLogs
      ? 'Log team hours in Project Tasks to unlock live capacity utilization and bench tracking.'
      : 'Billable hours logged over the last 30 days divided by active billable staff capacity.',
    href: '/projects',
  })

  // 2. Client Concentration
  const topShare = round2(metrics.topClientSharePct)
  let concSeverity: GuardrailSeverity = 'HEALTHY'
  if (topShare > thresholds.maxClientConcentrationPct + 15) concSeverity = 'CRITICAL'
  else if (topShare > thresholds.maxClientConcentrationPct) concSeverity = 'WARNING'

  alerts.push({
    id: 'CLIENT_CONCENTRATION',
    label: 'Client Concentration',
    severity: concSeverity,
    currentDisplay: `${topShare}%`,
    thresholdDisplay: `≤ ${thresholds.maxClientConcentrationPct}%`,
    headline:
      concSeverity === 'HEALTHY'
        ? `Top client represents ${topShare}% of revenue (diversified)`
        : `${metrics.topClientName || 'Top client'} accounts for ${topShare}% of AGI`,
    detail:
      concSeverity === 'HEALTHY'
        ? 'No single client exceeds your revenue concentration cap.'
        : `Single-client dependency above ${thresholds.maxClientConcentrationPct}% increases churn risk and depresses agency valuation multiples.`,
    href: '/clients',
  })

  // 3. Active Project Gross Margin
  let marginSeverity: GuardrailSeverity = 'HEALTHY'
  if (metrics.projectsBelowMarginCount >= 2 || (metrics.lowestActiveProjectMarginPct !== null && metrics.lowestActiveProjectMarginPct < 20)) {
    marginSeverity = 'CRITICAL'
  } else if (metrics.projectsBelowMarginCount === 1) {
    marginSeverity = 'WARNING'
  }
  alerts.push({
    id: 'PROJECT_GROSS_MARGIN',
    label: 'Project Gross Margin',
    severity: marginSeverity,
    currentDisplay:
      metrics.projectsBelowMarginCount > 0
        ? `${metrics.projectsBelowMarginCount} below floor`
        : 'All healthy',
    thresholdDisplay: `≥ ${thresholds.minProjectGrossMarginPct}%`,
    headline:
      metrics.projectsBelowMarginCount === 0
        ? `All ${metrics.activeProjectsTotal} active projects meet margin floor`
        : `${metrics.projectsBelowMarginCount} project(s) dipped below ${thresholds.minProjectGrossMarginPct}% gross margin`,
    detail:
      metrics.projectsBelowMarginCount > 0 && metrics.lowestActiveProjectName
        ? `Lowest margin: ${metrics.lowestActiveProjectName} (${metrics.lowestActiveProjectMarginPct}%). Review scope creep or unbilled revisions.`
        : 'Active project delivery costs remain well inside target gross margin.',
    href: '/finances/project-profitability',
  })

  // 4. Worst-Case Cash Runway
  let runwaySeverity: GuardrailSeverity = 'HEALTHY'
  if (metrics.worstCaseRunwayMonths !== null) {
    if (metrics.worstCaseRunwayMonths < Math.max(1, thresholds.minRunwayMonths / 2)) {
      runwaySeverity = 'CRITICAL'
    } else if (metrics.worstCaseRunwayMonths < thresholds.minRunwayMonths) {
      runwaySeverity = 'WARNING'
    }
  }
  alerts.push({
    id: 'CASH_RUNWAY',
    label: 'Worst-Case Runway',
    severity: runwaySeverity,
    currentDisplay:
      metrics.worstCaseRunwayMonths === null
        ? 'Retainer Covered'
        : `${metrics.worstCaseRunwayMonths} mo`,
    thresholdDisplay: `≥ ${thresholds.minRunwayMonths} mo`,
    headline:
      metrics.worstCaseRunwayMonths === null
        ? 'Recurring retainers fully cover monthly burn'
        : runwaySeverity === 'HEALTHY'
        ? `${metrics.worstCaseRunwayMonths} months worst-case runway`
        : `Worst-case runway down to ${metrics.worstCaseRunwayMonths} months`,
    detail:
      'Months of cash remaining assuming zero new project sales (retainer inflows vs. gross monthly burn).',
    href: '/finances/cashflow-runway',
  })

  // 5. Severe Overdue AR (> badDebtOverdueDays)
  let overdueSeverity: GuardrailSeverity = 'HEALTHY'
  if (metrics.severeOverdueCount >= 2 || metrics.severeOverdueAmount >= 200000) {
    overdueSeverity = 'CRITICAL'
  } else if (metrics.severeOverdueCount > 0) {
    overdueSeverity = 'WARNING'
  }
  alerts.push({
    id: 'SEVERE_OVERDUE_AR',
    label: `Overdue AR (>${thresholds.badDebtOverdueDays}d)`,
    severity: overdueSeverity,
    currentDisplay:
      metrics.severeOverdueCount > 0
        ? `৳${Math.round(metrics.severeOverdueAmount).toLocaleString()}`
        : '৳0',
    thresholdDisplay: `0 invoices > ${thresholds.badDebtOverdueDays}d`,
    headline:
      metrics.severeOverdueCount === 0
        ? `Zero invoices overdue beyond ${thresholds.badDebtOverdueDays} days`
        : `${metrics.severeOverdueCount} invoice(s) overdue >${thresholds.badDebtOverdueDays}d (৳${Math.round(metrics.severeOverdueAmount).toLocaleString()})`,
    detail: 'High bad-debt risk receivables requiring immediate executive escalation.',
    href: '/accounts-receivable',
  })

  const breaches = alerts.filter(a => a.severity !== 'HEALTHY')
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length
  const warningCount = alerts.filter(a => a.severity === 'WARNING').length

  const healthScore = Math.max(
    0,
    Math.min(100, 100 - criticalCount * 25 - warningCount * 12)
  )

  return {
    alerts,
    breaches,
    criticalCount,
    warningCount,
    healthScore,
  }
}
