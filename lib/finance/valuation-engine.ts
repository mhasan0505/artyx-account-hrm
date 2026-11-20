/**
 * Pure Agency Valuation, Dynamic Multiple Bridge & Hybrid Rule of 40 Engine (Module 5).
 * Designed to be transparent and configurable — showing founders the exact levers driving value.
 */

import { round2 } from '@/lib/finance/accounting-math'

export interface ValuationProfileConfig {
  baseMultiple: number             // e.g. 4.0x
  recurringBonusMax: number        // e.g. +2.0x at >= 75% recurring AGI
  concentrationPenaltyMax: number  // e.g. -1.25x when top client >= 45% of AGI
  growthBonusMax: number           // e.g. +1.0x when Rule of 40 >= 45%
  founderDependencyDiscount: number // e.g. -0.5x editable founder dependency haircut
}

export const DEFAULT_VALUATION_PROFILE: ValuationProfileConfig = {
  baseMultiple: 4.0,
  recurringBonusMax: 2.0,
  concentrationPenaltyMax: 1.25,
  growthBonusMax: 1.0,
  founderDependencyDiscount: 0.5,
}

export interface ValuationMetricsInput {
  ttmAgi: number
  priorTtmAgi: number
  ttmEbitda: number
  ttmAddBacks: number
  recurringRevenueSharePct: number  // 0..100
  topClientSharePct: number         // 0..100
  nwc: number
}

export interface ValuationResult {
  ttmAdjustedEbitda: number
  adjustedEbitdaMarginPct: number
  yoyAgiGrowthPct: number
  ruleOf40Score: number
  ruleOf40Tier: 'ELITE' | 'HEALTHY' | 'OPTIMIZE'
  multipleBridge: {
    baseMultiple: number
    recurringAdjustment: number
    concentrationAdjustment: number
    ruleOf40Adjustment: number
    founderDependencyAdjustment: number
    effectiveMidMultiple: number
    lowMultiple: number
    highMultiple: number
  }
  valuationLow: number
  valuationMid: number
  valuationHigh: number
  exitReadinessScore: number // 0..100
  valueLevers: Array<{
    title: string
    impact: string
    status: 'STRONG' | 'OPPORTUNITY' | 'RISK'
  }>
}

export function computeAgencyValuation(
  metrics: ValuationMetricsInput,
  profile: ValuationProfileConfig = DEFAULT_VALUATION_PROFILE
): ValuationResult {
  const ttmAgi = Math.max(0, round2(metrics.ttmAgi))
  const priorAgi = Math.max(0, round2(metrics.priorTtmAgi))
  const ttmAdjustedEbitda = round2((metrics.ttmEbitda || 0) + (metrics.ttmAddBacks || 0))
  const adjustedEbitdaMarginPct =
    ttmAgi > 0 ? round2((ttmAdjustedEbitda / ttmAgi) * 100) : 0

  const yoyAgiGrowthPct =
    priorAgi > 0
      ? round2(((ttmAgi - priorAgi) / priorAgi) * 100)
      : ttmAgi > 0
      ? 20
      : 0

  // Hybrid Rule of 40 = YoY AGI Growth % + Adjusted EBITDA Margin %
  const ruleOf40Score = round2(yoyAgiGrowthPct + adjustedEbitdaMarginPct)
  const ruleOf40Tier: 'ELITE' | 'HEALTHY' | 'OPTIMIZE' =
    ruleOf40Score >= 40 ? 'ELITE' : ruleOf40Score >= 25 ? 'HEALTHY' : 'OPTIMIZE'

  // 1. Recurring Revenue Bonus (scales linearly from 15% recurring up to 75% recurring)
  const recPct = Math.min(100, Math.max(0, metrics.recurringRevenueSharePct))
  const recProgress = Math.min(1, Math.max(0, (recPct - 15) / 60))
  const recurringAdjustment = round2(recProgress * profile.recurringBonusMax)

  // 2. Client Concentration Penalty (0 penalty <= 20%, scales up to max penalty at >= 50%)
  const topPct = Math.min(100, Math.max(0, metrics.topClientSharePct))
  const concProgress = Math.min(1, Math.max(0, (topPct - 20) / 30))
  const concentrationAdjustment = round2(-concProgress * profile.concentrationPenaltyMax)

  // 3. Rule of 40 Growth & Margin Adjustment
  let ruleOf40Adjustment = 0
  if (ruleOf40Score >= 40) {
    const bonusScale = Math.min(1, (ruleOf40Score - 30) / 25)
    ruleOf40Adjustment = round2(bonusScale * profile.growthBonusMax)
  } else if (ruleOf40Score < 20) {
    ruleOf40Adjustment = -0.5
  }

  // 4. Founder Dependency Discount
  const founderDependencyAdjustment = round2(
    -Math.max(0, profile.founderDependencyDiscount)
  )

  const rawMid =
    profile.baseMultiple +
    recurringAdjustment +
    concentrationAdjustment +
    ruleOf40Adjustment +
    founderDependencyAdjustment

  const effectiveMidMultiple = round2(Math.min(10, Math.max(1.5, rawMid)))
  const lowMultiple = round2(Math.max(1.0, effectiveMidMultiple - 0.75))
  const highMultiple = round2(effectiveMidMultiple + 0.75)

  const valuationBase = Math.max(0, ttmAdjustedEbitda)
  const valuationLow = round2(valuationBase * lowMultiple)
  const valuationMid = round2(valuationBase * effectiveMidMultiple)
  const valuationHigh = round2(valuationBase * highMultiple)

  // Exit Readiness Composite Score (0..100)
  let readiness = 40
  if (recPct >= 50) readiness += 20
  else if (recPct >= 25) readiness += 10
  if (topPct <= 20) readiness += 15
  else if (topPct > 35) readiness -= 10
  if (ruleOf40Score >= 40) readiness += 15
  else if (ruleOf40Score >= 25) readiness += 8
  if (metrics.nwc > 0) readiness += 10
  if (profile.founderDependencyDiscount <= 0.25) readiness += 5
  const exitReadinessScore = Math.max(10, Math.min(100, Math.round(readiness)))

  const valueLevers: ValuationResult['valueLevers'] = [
    {
      title: 'Recurring Retainer Mix',
      impact:
        recPct >= 50
          ? `Strong ${recPct}% recurring AGI adding +${recurringAdjustment}x to multiple.`
          : `Raising recurring share from ${recPct}% to 60% unlocks up to +${round2(profile.recurringBonusMax * 0.75 - recurringAdjustment)}x multiple expansion.`,
      status: recPct >= 50 ? 'STRONG' : 'OPPORTUNITY',
    },
    {
      title: 'Client Concentration Risk',
      impact:
        topPct <= 20
          ? `Diversified book (top client ${topPct}% ≤ 20% cap) — zero M&A haircut.`
          : `Top client is ${topPct}% of AGI, applying a ${concentrationAdjustment}x buyer concentration discount.`,
      status: topPct <= 20 ? 'STRONG' : 'RISK',
    },
    {
      title: 'Hybrid Rule of 40',
      impact: `Scoring ${ruleOf40Score}% (${yoyAgiGrowthPct}% growth + ${adjustedEbitdaMarginPct}% adj. EBITDA margin). Target ≥ 40% for premium multiples.`,
      status: ruleOf40Tier === 'ELITE' ? 'STRONG' : ruleOf40Tier === 'HEALTHY' ? 'OPPORTUNITY' : 'RISK',
    },
    {
      title: 'Founder Dependency & Documentation',
      impact:
        profile.founderDependencyDiscount > 0
          ? `Currently applying -${profile.founderDependencyDiscount}x discount. Transitioning delivery leads & clean add-back books removes this drag.`
          : 'Minimal founder dependency discount applied.',
      status: profile.founderDependencyDiscount <= 0.25 ? 'STRONG' : 'OPPORTUNITY',
    },
  ]

  return {
    ttmAdjustedEbitda,
    adjustedEbitdaMarginPct,
    yoyAgiGrowthPct,
    ruleOf40Score,
    ruleOf40Tier,
    multipleBridge: {
      baseMultiple: profile.baseMultiple,
      recurringAdjustment,
      concentrationAdjustment,
      ruleOf40Adjustment,
      founderDependencyAdjustment,
      effectiveMidMultiple,
      lowMultiple,
      highMultiple,
    },
    valuationLow,
    valuationMid,
    valuationHigh,
    exitReadinessScore,
    valueLevers,
  }
}
