import { describe, expect, it } from 'vitest'
import { reverseEngineerAnnualGoal } from '@/lib/finance/goals-engine'
import {
  buildHybridPipelineForecast,
  computeChannelRoiAndCac,
  computeRetentionAndChurn,
} from '@/lib/finance/growth-engine'
import {
  computeAgencyValuation,
  DEFAULT_VALUATION_PROFILE,
} from '@/lib/finance/valuation-engine'

describe('Phase 3 — Goals, Hybrid Pipeline, Cohorts & Valuation', () => {
  describe('Top-Down Goal Builder Reverse Engineering', () => {
    it('reverse-engineers required sales, billable hours, and headcount gap accurately', () => {
      const res = reverseEngineerAnnualGoal(
        {
          fiscalYear: 2026,
          targetArr: 12_000_000,
          targetProjectRevenue: 6_000_000,
          targetEbitdaPct: 25,
          avgProjectSize: 500_000,
          avgRetainerMrr: 200_000,
          targetUtilizationPct: 75,
          avgBillableRate: 3000,
          avgWeeklyHoursPerDev: 40,
        },
        {
          currentArr: 4_800_000,
          ytdAgi: 9_500_000,
          currentBillableHeadcount: 3,
          dayOfYear: 182,
        }
      )

      expect(res.totalTargetRevenue).toBe(18_000_000)
      expect(res.targetEbitdaAmount).toBe(4_500_000)
      expect(res.requiredProjectsPerYear).toBe(12)
      expect(res.requiredProjectsPerMonth).toBe(1)
      expect(res.requiredNewArr).toBe(7_200_000)
      expect(res.requiredNewRetainersTotal).toBe(3)
      expect(res.requiredAnnualBillableHours).toBe(6000)
      expect(res.annualBillableCapacityPerDev).toBe(1440) // 40 * 48 * 0.75
      expect(res.requiredBillableHeadcount).toBe(5) // ceil(6000/1440)
      expect(res.headcountGap).toBe(2)
      expect(res.pacingStatus).toBe('AHEAD')
    })
  })

  describe('Hybrid Pipeline Forecaster & Retention Cohorts', () => {
    it('combines committed MRR with weighted project and retainer opportunities over 3/6/12M', () => {
      const forecast = buildHybridPipelineForecast({
        activeMrr: 500_000,
        asOfDate: new Date('2026-11-01T00:00:00Z'),
        horizonMonths: 12,
        opportunities: [
          {
            id: 'o1',
            title: 'Web Platform',
            dealType: 'PROJECT',
            estimatedValue: 400_000,
            monthlyValue: 0,
            winProbabilityPct: 50, // weighted 200k in Month 1 (Nov)
            expectedCloseDate: '2026-11-15T00:00:00Z',
            stage: 'NEGOTIATION',
          },
          {
            id: 'o2',
            title: 'AI Growth Retainer',
            dealType: 'RETAINER',
            estimatedValue: 0,
            monthlyValue: 100_000,
            winProbabilityPct: 50, // weighted 50k/mo starting Month 2 (Dec)
            expectedCloseDate: '2026-12-10T00:00:00Z',
            stage: 'PROPOSAL',
          },
          {
            id: 'o3',
            title: 'Lost Deal',
            dealType: 'PROJECT',
            estimatedValue: 900_000,
            monthlyValue: 0,
            winProbabilityPct: 100,
            expectedCloseDate: '2026-11-20T00:00:00Z',
            stage: 'LOST', // excluded
          },
        ],
      })

      expect(forecast.months).toHaveLength(12)
      expect(forecast.months[0].totalProjected).toBe(700_000) // 500k + 200k
      expect(forecast.months[1].totalProjected).toBe(550_000) // 500k + 50k
      expect(forecast.total3Month).toBe(1_800_000) // 700k + 550k + 550k
    })

    it('calculates NDR > 100% when expansion outpaces churn', () => {
      const ret = computeRetentionAndChurn({
        activeMrr: 1_100_000,
        activeRetainerClientIds: ['c1', 'c2', 'c3', 'c4'],
        eventsLast12Months: [
          { clientId: 'c1', eventType: 'EXPANSION', mrrDelta: 200_000, effectiveDate: '2026-06-01' },
          { clientId: 'c5', eventType: 'CHURN', mrrDelta: -100_000, effectiveDate: '2026-08-01' },
        ],
      })

      expect(ret.startingMrrWindow).toBe(1_000_000)
      expect(ret.ndrPct).toBe(110)
      expect(ret.gdrPct).toBe(90)
      expect(ret.revenueChurnPct).toBe(10)
      expect(ret.churnedLogosCount).toBe(1)
    })

    it('computes Paid CAC, Blended CAC, and Payback Months', () => {
      const roi = computeChannelRoiAndCac({
        spendByChannel: {
          'Meta Ads': 150_000,
          'LinkedIn Outbound': 50_000,
        },
        clientsByChannel: [
          { channel: 'Meta Ads', isPaidChannel: true, revenueGenerated: 600_000 },
          { channel: 'LinkedIn Outbound', isPaidChannel: true, revenueGenerated: 400_000 },
          { channel: 'Referral / Organic', isPaidChannel: false, revenueGenerated: 500_000 },
          { channel: 'Referral / Organic', isPaidChannel: false, revenueGenerated: 500_000 },
        ],
        avgMonthlyGrossProfitPerClient: 25_000,
      })

      expect(roi.totalAcquisitionSpend).toBe(200_000)
      expect(roi.blendedCac).toBe(50_000) // 200k / 4
      expect(roi.paidCac).toBe(100_000)   // 200k / 2
      expect(roi.cacPaybackMonths).toBe(2) // 50k / 25k
    })
  })

  describe('Live Valuation Estimator & Hybrid Rule of 40', () => {
    it('expands multiple for high recurring mix + Rule of 40 and discounts concentration risk', () => {
      const strongAgency = computeAgencyValuation(
        {
          ttmAgi: 20_000_000,
          priorTtmAgi: 15_000_000, // +33.33% growth
          ttmEbitda: 4_500_000,
          ttmAddBacks: 500_000,    // 5M Adj EBITDA (25% margin) -> Rule of 40 = 58.33%
          recurringRevenueSharePct: 75,
          topClientSharePct: 12,   // diversified, 0 penalty
          nwc: 2_000_000,
        },
        DEFAULT_VALUATION_PROFILE
      )

      expect(strongAgency.ttmAdjustedEbitda).toBe(5_000_000)
      expect(strongAgency.ruleOf40Tier).toBe('ELITE')
      expect(strongAgency.multipleBridge.recurringAdjustment).toBe(2)
      expect(strongAgency.multipleBridge.concentrationAdjustment).toBe(0)
      expect(strongAgency.multipleBridge.effectiveMidMultiple).toBeGreaterThan(6)
      expect(strongAgency.valuationMid).toBe(
        strongAgency.ttmAdjustedEbitda * strongAgency.multipleBridge.effectiveMidMultiple
      )

      const concentratedAgency = computeAgencyValuation(
        {
          ttmAgi: 20_000_000,
          priorTtmAgi: 20_000_000, // 0% growth
          ttmEbitda: 3_000_000,
          ttmAddBacks: 0,
          recurringRevenueSharePct: 10,
          topClientSharePct: 50,   // max concentration penalty
          nwc: 100_000,
        },
        DEFAULT_VALUATION_PROFILE
      )

      expect(concentratedAgency.multipleBridge.concentrationAdjustment).toBe(-1.25)
      expect(concentratedAgency.multipleBridge.effectiveMidMultiple).toBeLessThan(
        strongAgency.multipleBridge.effectiveMidMultiple
      )
    })
  })
})
