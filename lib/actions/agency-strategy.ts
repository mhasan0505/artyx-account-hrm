'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  OpportunityDealType,
  OpportunityStage,
  Prisma,
  RetainerEventType,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { normalizeRole } from '@/lib/auth/route-access'
import { round2 } from '@/lib/finance/accounting-math'
import { reverseEngineerAnnualGoal } from '@/lib/finance/goals-engine'
import {
  buildHybridPipelineForecast,
  computeChannelRoiAndCac,
  computeRetentionAndChurn,
} from '@/lib/finance/growth-engine'
import {
  computeAgencyValuation,
  DEFAULT_VALUATION_PROFILE,
  type ValuationProfileConfig,
} from '@/lib/finance/valuation-engine'
import {
  getAgencyProfitAndLoss,
  getProjectProfitability,
} from '@/lib/actions/agency-profit'

const STRATEGY_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
const EXECUTIVE_ONLY_ROLES = new Set(['SUPER_ADMIN', 'ADMIN'])

function assertStrategyAccess(role: string | null | undefined) {
  if (!STRATEGY_ROLES.has(normalizeRole(role))) {
    throw new Error('Forbidden: Executive or Manager access required.')
  }
}

function assertExecutiveOnlyAccess(role: string | null | undefined) {
  if (!EXECUTIVE_ONLY_ROLES.has(normalizeRole(role))) {
    throw new Error('Forbidden: Executive (Super Admin / Admin) access required.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MODULE 2: TOP-DOWN GOAL BUILDER & POD TARGETS
// ─────────────────────────────────────────────────────────────────────────────

export async function getGoalsAndPodsData(fiscalYear?: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const now = new Date()
  const year = fiscalYear || now.getFullYear()
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31, 23, 59, 59)

  const [goalRow, retainersAgg, billableHeadcount, ytdPl, projectProf, departments] =
    await Promise.all([
      prisma.agencyAnnualGoal.findUnique({
        where: { fiscalYear: year },
        include: {
          podTargets: {
            include: { department: { select: { id: true, name: true } } },
            orderBy: { targetRevenue: 'desc' },
          },
        },
      }),
      prisma.clientRetainer.aggregate({
        where: { isActive: true },
        _sum: { monthlyFee: true },
        _count: { id: true },
      }),
      prisma.employee.count({ where: { isActive: true, isBillableRole: true } }),
      getAgencyProfitAndLoss(yearStart, yearEnd, { basis: 'ACCRUAL' }),
      getProjectProfitability(),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
    ])

  const currentMrr = Number(retainersAgg._sum.monthlyFee || 0)
  const currentArr = round2(currentMrr * 12)

  const dayOfYear =
    year === now.getFullYear()
      ? Math.max(
          1,
          Math.floor((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
        )
      : year < now.getFullYear()
      ? 365
      : 1

  const goalConfig = goalRow
    ? {
        id: goalRow.id,
        fiscalYear: goalRow.fiscalYear,
        targetArr: Number(goalRow.targetArr),
        targetProjectRevenue: Number(goalRow.targetProjectRevenue),
        targetEbitdaPct: Number(goalRow.targetEbitdaPct),
        avgProjectSize: Number(goalRow.avgProjectSize),
        avgRetainerMrr: Number(goalRow.avgRetainerMrr),
        targetUtilizationPct: Number(goalRow.targetUtilizationPct),
        avgBillableRate: Number(goalRow.avgBillableRate),
        notes: goalRow.notes,
      }
    : {
        id: null,
        fiscalYear: year,
        targetArr: Math.max(round2(currentArr * 1.4), 6_000_000),
        targetProjectRevenue: Math.max(round2(ytdPl.revenue.softwareDevelopment * 1.3), 4_000_000),
        targetEbitdaPct: 25,
        avgProjectSize: 300_000,
        avgRetainerMrr: 120_000,
        targetUtilizationPct: 75,
        avgBillableRate: 3500,
        notes: null,
      }

  const reverseEngineered = reverseEngineerAnnualGoal(goalConfig, {
    currentArr,
    ytdAgi: ytdPl.revenue.agi,
    currentBillableHeadcount: billableHeadcount,
    dayOfYear,
  })

  // Roll up actual project revenue & gross margin by Pod / Service Line
  const actualsByPod = new Map<
    string,
    { actualRevenue: number; actualMargin: number; projectCount: number }
  >()

  for (const p of projectProf.projects) {
    const key = (p.departmentName || p.serviceCategory || 'General Delivery').toLowerCase()
    const row = actualsByPod.get(key) ?? {
      actualRevenue: 0,
      actualMargin: 0,
      projectCount: 0,
    }
    row.actualRevenue = round2(row.actualRevenue + p.totalInvoiced)
    row.actualMargin = round2(row.actualMargin + p.netMargin)
    row.projectCount += 1
    actualsByPod.set(key, row)
  }

  const podScorecards = (goalRow?.podTargets ?? []).map(pod => {
    const depKey = pod.department?.name?.toLowerCase()
    const svcKey = pod.serviceLine.toLowerCase()
    const match =
      (depKey ? actualsByPod.get(depKey) : undefined) ??
      actualsByPod.get(svcKey) ?? {
        actualRevenue: 0,
        actualMargin: 0,
        projectCount: 0,
      }

    const targetRev = Number(pod.targetRevenue)
    const attainmentPct =
      targetRev > 0 ? round2((match.actualRevenue / targetRev) * 100) : 0
    const actualMarginPct =
      match.actualRevenue > 0
        ? round2((match.actualMargin / match.actualRevenue) * 100)
        : 0

    return {
      id: pod.id,
      serviceLine: pod.serviceLine,
      departmentId: pod.departmentId,
      departmentName: pod.department?.name ?? null,
      targetRevenue: targetRev,
      targetGrossMarginPct: Number(pod.targetGrossMarginPct),
      headcountBudget: pod.headcountBudget,
      actualRevenue: match.actualRevenue,
      actualMarginPct,
      attainmentPct,
      projectCount: match.projectCount,
    }
  })

  return {
    fiscalYear: year,
    goalConfig,
    actuals: {
      currentMrr,
      currentArr,
      ytdAgi: ytdPl.revenue.agi,
      ytdEbitda: ytdPl.ebitda,
      ytdEbitdaMarginPct: ytdPl.ebitdaMarginPct,
      currentBillableHeadcount: billableHeadcount,
      dayOfYear,
    },
    reverseEngineered,
    podScorecards,
    departments: departments.map(d => ({ id: d.id, name: d.name })),
  }
}

const annualGoalSchema = z.object({
  fiscalYear: z.number().int().min(2024).max(2035),
  targetArr: z.number().min(0),
  targetProjectRevenue: z.number().min(0),
  targetEbitdaPct: z.number().min(0).max(80),
  avgProjectSize: z.number().positive(),
  avgRetainerMrr: z.number().positive(),
  targetUtilizationPct: z.number().min(30).max(100),
  avgBillableRate: z.number().positive(),
  notes: z.string().max(400).optional().nullable(),
})

export async function saveAgencyAnnualGoalAction(
  input: z.infer<typeof annualGoalSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const parsed = annualGoalSchema.parse(input)

  const saved = await prisma.agencyAnnualGoal.upsert({
    where: { fiscalYear: parsed.fiscalYear },
    update: {
      targetArr: new Prisma.Decimal(parsed.targetArr),
      targetProjectRevenue: new Prisma.Decimal(parsed.targetProjectRevenue),
      targetEbitdaPct: new Prisma.Decimal(parsed.targetEbitdaPct),
      avgProjectSize: new Prisma.Decimal(parsed.avgProjectSize),
      avgRetainerMrr: new Prisma.Decimal(parsed.avgRetainerMrr),
      targetUtilizationPct: new Prisma.Decimal(parsed.targetUtilizationPct),
      avgBillableRate: new Prisma.Decimal(parsed.avgBillableRate),
      notes: parsed.notes ?? null,
      updatedById: session.user.id,
    },
    create: {
      fiscalYear: parsed.fiscalYear,
      targetArr: new Prisma.Decimal(parsed.targetArr),
      targetProjectRevenue: new Prisma.Decimal(parsed.targetProjectRevenue),
      targetEbitdaPct: new Prisma.Decimal(parsed.targetEbitdaPct),
      avgProjectSize: new Prisma.Decimal(parsed.avgProjectSize),
      avgRetainerMrr: new Prisma.Decimal(parsed.avgRetainerMrr),
      targetUtilizationPct: new Prisma.Decimal(parsed.targetUtilizationPct),
      avgBillableRate: new Prisma.Decimal(parsed.avgBillableRate),
      notes: parsed.notes ?? null,
      updatedById: session.user.id,
    },
  })

  revalidatePath('/finances/goals')
  return { success: true, id: saved.id }
}

const podTargetSchema = z.object({
  fiscalYear: z.number().int().min(2024).max(2035),
  serviceLine: z.string().trim().min(2).max(100),
  departmentId: z.string().optional().nullable(),
  targetRevenue: z.number().positive(),
  targetGrossMarginPct: z.number().min(10).max(95),
  headcountBudget: z.number().int().min(1).max(200),
})

export async function upsertPodTargetAction(
  input: z.infer<typeof podTargetSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const parsed = podTargetSchema.parse(input)

  // Ensure parent fiscal year goal exists
  const goal = await prisma.agencyAnnualGoal.upsert({
    where: { fiscalYear: parsed.fiscalYear },
    update: {},
    create: {
      fiscalYear: parsed.fiscalYear,
      targetArr: new Prisma.Decimal(6_000_000),
      targetProjectRevenue: new Prisma.Decimal(4_000_000),
      updatedById: session.user.id,
    },
  })

  await prisma.podTarget.create({
    data: {
      goalId: goal.id,
      serviceLine: parsed.serviceLine,
      departmentId: parsed.departmentId || null,
      targetRevenue: new Prisma.Decimal(parsed.targetRevenue),
      targetGrossMarginPct: new Prisma.Decimal(parsed.targetGrossMarginPct),
      headcountBudget: parsed.headcountBudget,
    },
  })

  revalidatePath('/finances/goals')
  return { success: true }
}

export async function deletePodTargetAction(id: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  await prisma.podTarget.delete({ where: { id } })
  revalidatePath('/finances/goals')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MODULE 4: HYBRID PIPELINE, RETAINER COHORTS & CHANNEL ROI
// ─────────────────────────────────────────────────────────────────────────────

export async function getGrowthAnalyticsData() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  const [
    activeRetainers,
    retainerEvents,
    opportunities,
    clientsWithInvoices,
    marketingExpenses,
    ttmPl,
  ] = await Promise.all([
    prisma.clientRetainer.findMany({
      where: { isActive: true },
      include: { client: { select: { id: true, companyName: true } } },
      orderBy: { monthlyFee: 'desc' },
    }),
    prisma.retainerEvent.findMany({
      where: { effectiveDate: { gte: twelveMonthsAgo } },
      include: {
        client: { select: { companyName: true } },
        retainer: { select: { serviceName: true } },
      },
      orderBy: { effectiveDate: 'desc' },
    }),
    prisma.salesOpportunity.findMany({
      orderBy: [{ stage: 'asc' }, { expectedCloseDate: 'asc' }],
      include: {
        client: { select: { companyName: true } },
      },
    }),
    prisma.agencyClient.findMany({
      where: { createdAt: { gte: twelveMonthsAgo } },
      include: {
        invoices: {
          where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { totalAmount: true, exchangeRate: true },
        },
      },
    }),
    prisma.expense.findMany({
      where: {
        status: 'APPROVED',
        isPassThrough: false,
        expenseDate: { gte: twelveMonthsAgo },
        OR: [
          { marketingChannel: { not: null } },
          { account: { code: '5260' } },
        ],
      },
      select: {
        amount: true,
        baseAmount: true,
        exchangeRate: true,
        marketingChannel: true,
      },
    }),
    getAgencyProfitAndLoss(twelveMonthsAgo, now, { basis: 'ACCRUAL' }),
  ])

  const activeMrr = round2(
    activeRetainers.reduce((s, r) => s + Number(r.monthlyFee || 0), 0)
  )

  const pipelineForecast = buildHybridPipelineForecast({
    activeMrr,
    asOfDate: now,
    horizonMonths: 12,
    opportunities: opportunities.map(o => ({
      id: o.id,
      title: o.title,
      dealType: o.dealType,
      estimatedValue: Number(o.estimatedValue),
      monthlyValue: Number(o.monthlyValue),
      winProbabilityPct: o.winProbabilityPct,
      expectedCloseDate: o.expectedCloseDate.toISOString(),
      stage: o.stage,
    })),
  })

  const retention = computeRetentionAndChurn({
    activeMrr,
    activeRetainerClientIds: activeRetainers.map(r => r.clientId),
    eventsLast12Months: retainerEvents.map(e => ({
      clientId: e.clientId,
      eventType: e.eventType,
      mrrDelta: Number(e.mrrDelta),
      effectiveDate: e.effectiveDate.toISOString(),
    })),
  })

  const spendByChannel: Record<string, number> = {}
  for (const exp of marketingExpenses) {
    const ch = exp.marketingChannel?.trim() || 'Paid Ads & Marketing'
    const baseAmt =
      exp.baseAmount !== null && exp.baseAmount !== undefined
        ? Number(exp.baseAmount)
        : Number(exp.amount) * Number(exp.exchangeRate || 1)
    spendByChannel[ch] = round2((spendByChannel[ch] || 0) + baseAmt)
  }

  const paidKeywords = ['ads', 'meta', 'google', 'linkedin', 'paid', 'outbound', 'sponsor']
  const clientsByChannel = clientsWithInvoices.map(cl => {
    const ch = cl.acquisitionChannel?.trim() || 'Referral / Organic'
    const isPaid = paidKeywords.some(k => ch.toLowerCase().includes(k))
    const rev = cl.invoices.reduce(
      (s, i) => s + Number(i.totalAmount) * Number(i.exchangeRate || 1),
      0
    )
    return {
      channel: ch,
      isPaidChannel: isPaid,
      revenueGenerated: round2(rev),
    }
  })

  const activeClientsCount = Math.max(1, clientsWithInvoices.length || activeRetainers.length || 1)
  const avgMonthlyGrossProfitPerClient = round2(
    Math.max(0, ttmPl.grossProfit) / 12 / activeClientsCount
  )

  const channelRoi = computeChannelRoiAndCac({
    spendByChannel,
    clientsByChannel,
    avgMonthlyGrossProfitPerClient,
  })

  return {
    pipelineForecast,
    retention,
    channelRoi,
    opportunities: opportunities.map(o => ({
      id: o.id,
      title: o.title,
      prospectName: o.client?.companyName || o.prospectName,
      dealType: o.dealType,
      estimatedValue: Number(o.estimatedValue),
      monthlyValue: Number(o.monthlyValue),
      winProbabilityPct: o.winProbabilityPct,
      expectedCloseDate: o.expectedCloseDate.toISOString(),
      stage: o.stage,
      acquisitionChannel: o.acquisitionChannel,
    })),
    activeRetainers: activeRetainers.map(r => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client.companyName,
      serviceName: r.serviceName,
      monthlyFee: Number(r.monthlyFee),
    })),
    recentEvents: retainerEvents.slice(0, 12).map(e => ({
      id: e.id,
      clientName: e.client.companyName,
      serviceName: e.retainer.serviceName,
      eventType: e.eventType,
      mrrDelta: Number(e.mrrDelta),
      effectiveDate: e.effectiveDate.toISOString(),
      notes: e.notes,
    })),
  }
}

const createOpportunitySchema = z.object({
  title: z.string().trim().min(2).max(150),
  prospectName: z.string().trim().min(2).max(120),
  dealType: z.nativeEnum(OpportunityDealType),
  estimatedValue: z.number().min(0),
  monthlyValue: z.number().min(0).default(0),
  winProbabilityPct: z.number().int().min(5).max(100),
  expectedCloseDate: z.string(),
  stage: z.nativeEnum(OpportunityStage).default(OpportunityStage.PROPOSAL),
  acquisitionChannel: z.string().max(80).optional(),
})

export async function createOpportunityAction(
  input: z.infer<typeof createOpportunitySchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const parsed = createOpportunitySchema.parse(input)
  await prisma.salesOpportunity.create({
    data: {
      title: parsed.title,
      prospectName: parsed.prospectName,
      dealType: parsed.dealType,
      estimatedValue: new Prisma.Decimal(round2(parsed.estimatedValue)),
      monthlyValue: new Prisma.Decimal(round2(parsed.monthlyValue)),
      winProbabilityPct: parsed.winProbabilityPct,
      expectedCloseDate: new Date(parsed.expectedCloseDate),
      stage: parsed.stage,
      acquisitionChannel: parsed.acquisitionChannel?.trim() || null,
      createdById: session.user.id,
    },
  })

  revalidatePath('/finances/growth')
  return { success: true }
}

export async function updateOpportunityStageAction(
  id: string,
  stage: OpportunityStage,
  winProbabilityPct?: number
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const defaultProbByStage: Record<OpportunityStage, number> = {
    LEAD: 15,
    PROPOSAL: 35,
    NEGOTIATION: 70,
    WON: 100,
    LOST: 0,
  }

  await prisma.salesOpportunity.update({
    where: { id },
    data: {
      stage,
      winProbabilityPct: winProbabilityPct ?? defaultProbByStage[stage],
    },
  })

  revalidatePath('/finances/growth')
  return { success: true }
}

export async function deleteOpportunityAction(id: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  await prisma.salesOpportunity.delete({ where: { id } })
  revalidatePath('/finances/growth')
  return { success: true }
}

const retainerEventSchema = z.object({
  retainerId: z.string().min(1),
  eventType: z.nativeEnum(RetainerEventType),
  mrrDelta: z.number().positive(),
  notes: z.string().max(240).optional(),
})

export async function logRetainerEventAction(
  input: z.infer<typeof retainerEventSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertStrategyAccess(session.user.role)

  const parsed = retainerEventSchema.parse(input)
  const retainer = await prisma.clientRetainer.findUnique({
    where: { id: parsed.retainerId },
    select: { id: true, clientId: true },
  })
  if (!retainer) throw new Error('Retainer not found')

  const signedDelta =
    parsed.eventType === 'CHURN' || parsed.eventType === 'CONTRACTION'
      ? -Math.abs(parsed.mrrDelta)
      : Math.abs(parsed.mrrDelta)

  await prisma.retainerEvent.create({
    data: {
      retainerId: retainer.id,
      clientId: retainer.clientId,
      eventType: parsed.eventType,
      mrrDelta: new Prisma.Decimal(round2(signedDelta)),
      notes: parsed.notes?.trim() || null,
    },
  })

  revalidatePath('/finances/growth')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MODULE 5: VALUATION, ADD-BACK LEDGER & EXIT READINESS
// ─────────────────────────────────────────────────────────────────────────────

export async function getValuationReadinessData() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertExecutiveOnlyAccess(session.user.role)

  const now = new Date()
  const ttmStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const priorStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())

  const [ttmPl, priorPl, profileRow, retainersAgg, ttmInvoices, recentExpenses] =
    await Promise.all([
      getAgencyProfitAndLoss(ttmStart, now, { basis: 'ACCRUAL' }),
      getAgencyProfitAndLoss(priorStart, ttmStart, { basis: 'ACCRUAL' }),
      prisma.valuationProfile.findUnique({ where: { key: 'DEFAULT' } }),
      prisma.clientRetainer.aggregate({
        where: { isActive: true },
        _sum: { monthlyFee: true },
      }),
      prisma.agencyInvoice.findMany({
        where: {
          issueDate: { gte: ttmStart, lte: now },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        include: {
          items: { select: { totalPrice: true, isPassThrough: true } },
        },
      }),
      prisma.expense.findMany({
        where: {
          status: 'APPROVED',
          isPassThrough: false,
          expenseDate: { gte: ttmStart, lte: now },
        },
        include: {
          account: { select: { code: true, name: true } },
        },
        orderBy: [{ isAddBack: 'desc' }, { amount: 'desc' }],
        take: 40,
      }),
    ])

  const profile: ValuationProfileConfig = profileRow
    ? {
        baseMultiple: Number(profileRow.baseMultiple),
        recurringBonusMax: Number(profileRow.recurringBonusMax),
        concentrationPenaltyMax: Number(profileRow.concentrationPenaltyMax),
        growthBonusMax: Number(profileRow.growthBonusMax),
        founderDependencyDiscount: Number(profileRow.founderDependencyDiscount),
      }
    : DEFAULT_VALUATION_PROFILE

  // Compute top-client concentration %
  const clientAgiMap = new Map<string, number>()
  let totalAgi = 0
  for (const inv of ttmInvoices) {
    const rate = Number(inv.exchangeRate || 1)
    const passThru = inv.items
      .filter(i => i.isPassThrough)
      .reduce((s, i) => s + Number(i.totalPrice) * rate, 0)
    const invAgi = Math.max(0, round2(Number(inv.totalAmount) * rate - passThru))
    totalAgi += invAgi
    clientAgiMap.set(inv.clientId, (clientAgiMap.get(inv.clientId) || 0) + invAgi)
  }

  const maxClientAgi = Math.max(0, ...Array.from(clientAgiMap.values()))
  const topClientSharePct =
    totalAgi > 0 ? round2((maxClientAgi / totalAgi) * 100) : 0

  const activeArr = round2(Number(retainersAgg._sum.monthlyFee || 0) * 12)
  const recurringDenom = Math.max(ttmPl.revenue.agi, activeArr)
  const recurringRevenueSharePct =
    recurringDenom > 0
      ? round2(
          Math.min(
            100,
            (Math.max(ttmPl.revenue.retainerSubscriptions, activeArr) /
              recurringDenom) *
              100
          )
        )
      : 0

  const metrics = {
    ttmAgi: ttmPl.revenue.agi,
    priorTtmAgi: priorPl.revenue.agi,
    ttmEbitda: ttmPl.ebitda,
    ttmAddBacks: ttmPl.addBacks.total,
    recurringRevenueSharePct,
    topClientSharePct,
    nwc: ttmPl.workingCapital.nwc,
  }

  const valuation = computeAgencyValuation(metrics, profile)

  return {
    profile,
    metrics,
    valuation,
    expenses: recentExpenses.map(e => ({
      id: e.id,
      description: e.description,
      accountName: e.account.name,
      amountBase: round2(
        e.baseAmount !== null && e.baseAmount !== undefined
          ? Number(e.baseAmount)
          : Number(e.amount) * Number(e.exchangeRate || 1)
      ),
      expenseDate: e.expenseDate.toISOString(),
      isAddBack: e.isAddBack,
      addBackCategory: e.addBackCategory,
      addBackNote: e.addBackNote,
    })),
  }
}

const valuationProfileSchema = z.object({
  baseMultiple: z.number().min(1.5).max(8),
  recurringBonusMax: z.number().min(0).max(4),
  concentrationPenaltyMax: z.number().min(0).max(3),
  growthBonusMax: z.number().min(0).max(3),
  founderDependencyDiscount: z.number().min(0).max(2.5),
})

export async function updateValuationProfileAction(
  input: z.infer<typeof valuationProfileSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertExecutiveOnlyAccess(session.user.role)

  const parsed = valuationProfileSchema.parse(input)
  await prisma.valuationProfile.upsert({
    where: { key: 'DEFAULT' },
    update: {
      baseMultiple: new Prisma.Decimal(parsed.baseMultiple),
      recurringBonusMax: new Prisma.Decimal(parsed.recurringBonusMax),
      concentrationPenaltyMax: new Prisma.Decimal(parsed.concentrationPenaltyMax),
      growthBonusMax: new Prisma.Decimal(parsed.growthBonusMax),
      founderDependencyDiscount: new Prisma.Decimal(parsed.founderDependencyDiscount),
      updatedById: session.user.id,
    },
    create: {
      key: 'DEFAULT',
      baseMultiple: new Prisma.Decimal(parsed.baseMultiple),
      recurringBonusMax: new Prisma.Decimal(parsed.recurringBonusMax),
      concentrationPenaltyMax: new Prisma.Decimal(parsed.concentrationPenaltyMax),
      growthBonusMax: new Prisma.Decimal(parsed.growthBonusMax),
      founderDependencyDiscount: new Prisma.Decimal(parsed.founderDependencyDiscount),
      updatedById: session.user.id,
    },
  })

  revalidatePath('/finances/valuation')
  return { success: true }
}

export async function toggleExpenseAddBackAction(input: {
  expenseId: string
  isAddBack: boolean
  addBackCategory?: string
  addBackNote?: string
}) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertExecutiveOnlyAccess(session.user.role)

  await prisma.expense.update({
    where: { id: input.expenseId },
    data: {
      isAddBack: input.isAddBack,
      addBackCategory: input.isAddBack
        ? input.addBackCategory?.trim() || 'One-Time / Discretionary'
        : null,
      addBackNote: input.isAddBack ? input.addBackNote?.trim() || null : null,
    },
  })

  revalidatePath('/finances/valuation')
  revalidatePath('/finances/profit-loss')
  return { success: true }
}
