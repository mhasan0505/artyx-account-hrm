/**
 * Pure Growth, Hybrid Pipeline Forecaster, Retainer Cohorts (NDR/Churn) & Channel ROI Engine (Module 4).
 */

import { round2 } from '@/lib/finance/accounting-math'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface PipelineOpportunityInput {
  id: string
  title: string
  dealType: 'PROJECT' | 'RETAINER' | 'HYBRID'
  estimatedValue: number
  monthlyValue: number
  winProbabilityPct: number
  expectedCloseDate: string
  stage: 'LEAD' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST'
}

export interface MonthlyForecastPoint {
  monthKey: string
  label: string
  committedMrr: number
  weightedProjectPipeline: number
  weightedRetainerPipeline: number
  totalProjected: number
}

export interface HybridPipelineForecastResult {
  months: MonthlyForecastPoint[]
  total3Month: number
  total6Month: number
  total12Month: number
  openPipelineUnweighted: number
  openPipelineWeighted: number
}

/**
 * Combines Active MRR/ARR with Weighted Open Pipeline across 3, 6, and 12 months.
 * - PROJECT deals contribute weighted one-time value in expectedCloseMonth.
 * - RETAINER deals contribute weighted monthly MRR from expectedCloseMonth onward.
 * - HYBRID deals contribute both.
 */
export function buildHybridPipelineForecast(params: {
  activeMrr: number
  opportunities: PipelineOpportunityInput[]
  asOfDate?: Date
  horizonMonths?: number
}): HybridPipelineForecastResult {
  const asOf = params.asOfDate ?? new Date()
  const horizon = Math.min(24, Math.max(3, params.horizonMonths ?? 12))
  const openOpps = params.opportunities.filter(
    o => o.stage !== 'WON' && o.stage !== 'LOST'
  )

  let openPipelineUnweighted = 0
  let openPipelineWeighted = 0
  for (const opp of openOpps) {
    const prob = Math.min(100, Math.max(0, opp.winProbabilityPct)) / 100
    const annualizedVal =
      opp.dealType === 'RETAINER'
        ? opp.monthlyValue * 12
        : opp.dealType === 'HYBRID'
        ? opp.estimatedValue + opp.monthlyValue * 12
        : opp.estimatedValue
    openPipelineUnweighted += annualizedVal
    openPipelineWeighted += annualizedVal * prob
  }

  const months: MonthlyForecastPoint[] = []

  for (let i = 0; i < horizon; i++) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = `${MONTH_SHORT[m]} ${String(y).slice(-2)}`

    let weightedProject = 0
    let weightedRetainer = 0

    for (const opp of openOpps) {
      const close = new Date(opp.expectedCloseDate)
      if (Number.isNaN(close.getTime())) continue
      const closeIndex = (close.getFullYear() - asOf.getFullYear()) * 12 + (close.getMonth() - asOf.getMonth())
      const prob = Math.min(100, Math.max(0, opp.winProbabilityPct)) / 100

      if ((opp.dealType === 'PROJECT' || opp.dealType === 'HYBRID') && closeIndex === i) {
        weightedProject += opp.estimatedValue * prob
      }
      if ((opp.dealType === 'RETAINER' || opp.dealType === 'HYBRID') && closeIndex <= i) {
        weightedRetainer += opp.monthlyValue * prob
      }
    }

    const committedMrr = round2(Math.max(0, params.activeMrr))
    weightedProject = round2(weightedProject)
    weightedRetainer = round2(weightedRetainer)
    const totalProjected = round2(committedMrr + weightedProject + weightedRetainer)

    months.push({
      monthKey,
      label,
      committedMrr,
      weightedProjectPipeline: weightedProject,
      weightedRetainerPipeline: weightedRetainer,
      totalProjected,
    })
  }

  const sumFirst = (n: number) =>
    round2(months.slice(0, n).reduce((s, m) => s + m.totalProjected, 0))

  return {
    months,
    total3Month: sumFirst(3),
    total6Month: sumFirst(6),
    total12Month: sumFirst(12),
    openPipelineUnweighted: round2(openPipelineUnweighted),
    openPipelineWeighted: round2(openPipelineWeighted),
  }
}

export interface RetainerEventInput {
  clientId: string
  eventType: 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURN' | 'REACTIVATION'
  mrrDelta: number
  effectiveDate: string
}

export interface RetentionMetricsResult {
  activeMrr: number
  activeArr: number
  startingMrrWindow: number
  expansionMrr: number
  contractionMrr: number
  churnedMrr: number
  newMrr: number
  /** Net Dollar Retention = (Starting + Expansion - Contraction - Churn) / Starting * 100 */
  ndrPct: number
  /** Gross Dollar Retention = (Starting - Contraction - Churn) / Starting * 100 */
  gdrPct: number
  revenueChurnPct: number
  logoChurnPct: number
  activeRetainerClients: number
  churnedLogosCount: number
}

/**
 * Computes Trailing 12-Month Subscription Retention (NDR, GDR, Logo Churn, Revenue Churn).
 */
export function computeRetentionAndChurn(params: {
  activeMrr: number
  activeRetainerClientIds: string[]
  eventsLast12Months: RetainerEventInput[]
}): RetentionMetricsResult {
  const activeMrr = round2(Math.max(0, params.activeMrr))
  const activeArr = round2(activeMrr * 12)

  let newMrr = 0
  let expansionMrr = 0
  let contractionMrr = 0
  let churnedMrr = 0
  const churnedClients = new Set<string>()
  const newClients = new Set<string>()

  for (const ev of params.eventsLast12Months) {
    const absDelta = Math.abs(Number(ev.mrrDelta) || 0)
    if (ev.eventType === 'NEW' || ev.eventType === 'REACTIVATION') {
      newMrr += absDelta
      newClients.add(ev.clientId)
    } else if (ev.eventType === 'EXPANSION') {
      expansionMrr += absDelta
    } else if (ev.eventType === 'CONTRACTION') {
      contractionMrr += absDelta
    } else if (ev.eventType === 'CHURN') {
      churnedMrr += absDelta
      churnedClients.add(ev.clientId)
    }
  }

  newMrr = round2(newMrr)
  expansionMrr = round2(expansionMrr)
  contractionMrr = round2(contractionMrr)
  churnedMrr = round2(churnedMrr)

  // Reconstruct starting cohort MRR 12 months ago:
  // activeMrr = starting + new + expansion - contraction - churn
  const reconstructedStart = round2(
    activeMrr - newMrr - expansionMrr + contractionMrr + churnedMrr
  )
  const startingMrrWindow = reconstructedStart > 0 ? reconstructedStart : activeMrr

  const ndrPct =
    startingMrrWindow > 0
      ? round2(
          ((startingMrrWindow + expansionMrr - contractionMrr - churnedMrr) /
            startingMrrWindow) *
            100
        )
      : activeMrr > 0
      ? 100
      : 0

  const gdrPct =
    startingMrrWindow > 0
      ? round2(
          Math.max(
            0,
            ((startingMrrWindow - contractionMrr - churnedMrr) /
              startingMrrWindow) *
              100
          )
        )
      : activeMrr > 0
      ? 100
      : 0

  const revenueChurnPct =
    startingMrrWindow > 0
      ? round2(((contractionMrr + churnedMrr) / startingMrrWindow) * 100)
      : 0

  const activeClientCount = new Set(params.activeRetainerClientIds).size
  const startingLogos = Math.max(
    1,
    activeClientCount - newClients.size + churnedClients.size
  )
  const logoChurnPct =
    activeClientCount > 0 || churnedClients.size > 0
      ? round2((churnedClients.size / startingLogos) * 100)
      : 0

  return {
    activeMrr,
    activeArr,
    startingMrrWindow,
    expansionMrr,
    contractionMrr,
    churnedMrr,
    newMrr,
    ndrPct,
    gdrPct,
    revenueChurnPct,
    logoChurnPct,
    activeRetainerClients: activeClientCount,
    churnedLogosCount: churnedClients.size,
  }
}

export interface ChannelRoiRow {
  channel: string
  spend: number
  clientsWon: number
  revenueWon: number
  cac: number
  roiMultiple: number
}

export interface ChannelRoiSummary {
  totalAcquisitionSpend: number
  totalNewClients: number
  paidClientsWon: number
  blendedCac: number
  paidCac: number
  cacPaybackMonths: number | null
  channels: ChannelRoiRow[]
}

/**
 * Calculates Paid CAC, Blended CAC, CAC Payback Period (Months), and per-channel ROI.
 */
export function computeChannelRoiAndCac(params: {
  spendByChannel: Record<string, number>
  clientsByChannel: Array<{
    channel: string
    isPaidChannel: boolean
    revenueGenerated: number
  }>
  avgMonthlyGrossProfitPerClient: number
}): ChannelRoiSummary {
  const channelMap = new Map<
    string,
    { spend: number; clientsWon: number; revenueWon: number }
  >()

  let totalAcquisitionSpend = 0
  for (const [ch, amt] of Object.entries(params.spendByChannel)) {
    const key = ch.trim() || 'Direct / Organic'
    const cleanAmt = round2(Math.max(0, amt))
    totalAcquisitionSpend += cleanAmt
    const row = channelMap.get(key) ?? { spend: 0, clientsWon: 0, revenueWon: 0 }
    row.spend = round2(row.spend + cleanAmt)
    channelMap.set(key, row)
  }

  let totalNewClients = 0
  let paidClientsWon = 0

  for (const cl of params.clientsByChannel) {
    const key = cl.channel.trim() || 'Direct / Organic'
    totalNewClients += 1
    if (cl.isPaidChannel) paidClientsWon += 1
    const row = channelMap.get(key) ?? { spend: 0, clientsWon: 0, revenueWon: 0 }
    row.clientsWon += 1
    row.revenueWon = round2(row.revenueWon + Math.max(0, cl.revenueGenerated))
    channelMap.set(key, row)
  }

  totalAcquisitionSpend = round2(totalAcquisitionSpend)
  const blendedCac =
    totalNewClients > 0 ? round2(totalAcquisitionSpend / totalNewClients) : 0
  const paidCac =
    paidClientsWon > 0 ? round2(totalAcquisitionSpend / paidClientsWon) : blendedCac

  const cacPaybackMonths =
    blendedCac > 0 && params.avgMonthlyGrossProfitPerClient > 0
      ? round2(blendedCac / params.avgMonthlyGrossProfitPerClient)
      : null

  const channels: ChannelRoiRow[] = Array.from(channelMap.entries())
    .map(([channel, row]) => ({
      channel,
      spend: row.spend,
      clientsWon: row.clientsWon,
      revenueWon: row.revenueWon,
      cac: row.clientsWon > 0 ? round2(row.spend / row.clientsWon) : 0,
      roiMultiple: row.spend > 0 ? round2(row.revenueWon / row.spend) : 0,
    }))
    .sort((a, b) => b.revenueWon - a.revenueWon)

  return {
    totalAcquisitionSpend,
    totalNewClients,
    paidClientsWon,
    blendedCac,
    paidCac,
    cacPaybackMonths,
    channels,
  }
}
