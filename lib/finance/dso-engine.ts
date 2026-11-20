/**
 * Pure Days Sales Outstanding (DSO) & Collection Date Projection Engine.
 * Uses historical payment lateness per client to prevent overly optimistic AR inflows.
 */

import { round2 } from '@/lib/finance/accounting-math'

const MS_PER_DAY = 1000 * 60 * 60 * 24

export interface PaidInvoiceHistoryItem {
  clientId: string
  issueDate: Date | string
  dueDate: Date | string
  paidDate: Date | string
}

export interface ClientDsoSummary {
  /** Average total days from invoice issue to payment */
  avgDsoDays: number
  /** Average days past dueDate (0 if paid on time or early) */
  avgLateDays: number
  sampleCount: number
}

/**
 * Computes per-client historical DSO and average late days past dueDate,
 * plus an agency-wide fallback average for clients without payment history.
 */
export function computeClientDsoProfile(history: PaidInvoiceHistoryItem[]): {
  byClientId: Record<string, ClientDsoSummary>
  agencyAvgDsoDays: number
  agencyAvgLateDays: number
} {
  const grouped = new Map<string, { dsoSum: number; lateSum: number; count: number }>()
  let globalDsoSum = 0
  let globalLateSum = 0
  let globalCount = 0

  for (const item of history) {
    const issue = new Date(item.issueDate).getTime()
    const due = new Date(item.dueDate).getTime()
    const paid = new Date(item.paidDate).getTime()
    if (Number.isNaN(issue) || Number.isNaN(due) || Number.isNaN(paid)) continue

    const dso = Math.max(0, Math.round((paid - issue) / MS_PER_DAY))
    const late = Math.max(0, Math.round((paid - due) / MS_PER_DAY))

    const existing = grouped.get(item.clientId) ?? { dsoSum: 0, lateSum: 0, count: 0 }
    existing.dsoSum += dso
    existing.lateSum += late
    existing.count += 1
    grouped.set(item.clientId, existing)

    globalDsoSum += dso
    globalLateSum += late
    globalCount += 1
  }

  const byClientId: Record<string, ClientDsoSummary> = {}
  for (const [clientId, agg] of grouped.entries()) {
    byClientId[clientId] = {
      avgDsoDays: round2(agg.dsoSum / agg.count),
      avgLateDays: Math.round(agg.lateSum / agg.count),
      sampleCount: agg.count,
    }
  }

  return {
    byClientId,
    agencyAvgDsoDays: globalCount > 0 ? round2(globalDsoSum / globalCount) : 15,
    agencyAvgLateDays: globalCount > 0 ? Math.round(globalLateSum / globalCount) : 5,
  }
}

/**
 * Projects realistic cash collection date for an open invoice by shifting dueDate
 * by the client's historical average late days (capped at 45 days) + optional What-If delay weeks.
 * Overdue invoices whose projected date already passed roll conservatively into +7 days from asOfDate.
 */
export function projectRealisticCollectionDate(params: {
  dueDate: Date | string
  asOfDate: Date
  clientLateDays?: number
  agencyFallbackLateDays?: number
  manualDelayWeeks?: number
}): Date {
  const due = new Date(params.dueDate)
  const lateDays = Math.min(
    45,
    Math.max(0, params.clientLateDays ?? params.agencyFallbackLateDays ?? 0)
  )
  const delayDays = Math.max(0, Math.round((params.manualDelayWeeks ?? 0) * 7))

  const projectedMs = due.getTime() + (lateDays + delayDays) * MS_PER_DAY
  const minRealisticMs = params.asOfDate.getTime() + (7 + delayDays) * MS_PER_DAY

  // If already overdue past today, don't assume instant same-day collection; land conservatively in Week 2 (+ delay)
  if (projectedMs < params.asOfDate.getTime()) {
    return new Date(minRealisticMs)
  }

  return new Date(projectedMs)
}
