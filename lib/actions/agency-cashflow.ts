'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  CommitmentCategory,
  CommitmentFrequency,
  Prisma,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { normalizeRole } from '@/lib/auth/route-access'
import {
  computeMonthlyCapacityHours,
  round2,
} from '@/lib/finance/accounting-math'
import { computeClientDsoProfile } from '@/lib/finance/dso-engine'
import {
  build13WeekCashFlow,
  cashFlowAssumptionsSchema,
  computeRunwayClock,
  type CashFlowAssumptions,
  type CashFlowModelInput,
} from '@/lib/finance/cashflow-engine'
import {
  DEFAULT_GUARDRAIL_THRESHOLDS,
  evaluateGuardrails,
  type GuardrailThresholds,
} from '@/lib/finance/guardrail-engine'
import { getProjectProfitability } from '@/lib/actions/agency-profit'

const CASHFLOW_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'])
const GUARDRAIL_VIEW_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'])

function assertCashflowAccess(role: string | null | undefined) {
  if (!CASHFLOW_ADMIN_ROLES.has(normalizeRole(role))) {
    throw new Error('Forbidden: Accounting or Executive access required.')
  }
}

function assertGuardrailViewAccess(role: string | null | undefined) {
  if (!GUARDRAIL_VIEW_ROLES.has(normalizeRole(role))) {
    throw new Error('Forbidden: Access denied.')
  }
}

async function buildLiveCashFlowInput(): Promise<{
  modelInput: CashFlowModelInput
  agencyAvgDsoDays: number
  retainerMonthlyTotal: number
  avgMonthlyInflow: number
  grossMonthlyBurn: number
}> {
  const now = new Date()
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const ninetyFiveDaysOut = new Date(now.getTime() + 95 * 24 * 60 * 60 * 1000)

  const [
    bankAgg,
    openInvoices,
    recentPayments,
    activeRetainers,
    upcomingMilestones,
    activeEmployees,
    recurringCommitments,
    pendingExpenses,
    recentExpensesAgg,
  ] = await Promise.all([
    prisma.bankAccount.aggregate({
      where: { isActive: true },
      _sum: { currentBalance: true },
    }),
    prisma.agencyInvoice.findMany({
      where: {
        dueAmount: { gt: 0 },
        status: { notIn: ['DRAFT', 'CANCELLED', 'PAID'] },
      },
      include: {
        client: { select: { id: true, companyName: true } },
      },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.agencyPayment.findMany({
      where: { paymentDate: { gte: new Date(now.getFullYear() - 1, now.getMonth(), 1) } },
      include: {
        invoice: { select: { issueDate: true, dueDate: true, clientId: true } },
      },
    }),
    prisma.clientRetainer.findMany({
      where: { isActive: true },
      include: {
        client: { select: { id: true, companyName: true } },
      },
      orderBy: { monthlyFee: 'desc' },
    }),
    prisma.projectMilestone.findMany({
      where: {
        isBilled: false,
        billableAmount: { gt: 0 },
        targetDate: { gte: now, lte: ninetyFiveDaysOut },
      },
      include: {
        project: {
          select: {
            name: true,
            client: { select: { companyName: true } },
          },
        },
      },
      orderBy: { targetDate: 'asc' },
    }),
    prisma.employee.findMany({
      where: { isActive: true },
      select: { basicSalary: true },
    }),
    prisma.recurringCommitment.findMany({
      where: { isActive: true },
      orderBy: { amount: 'desc' },
    }),
    prisma.expense.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        description: true,
        amount: true,
        baseAmount: true,
        exchangeRate: true,
        expenseDate: true,
      },
    }),
    prisma.expense.aggregate({
      where: {
        status: 'APPROVED',
        isPassThrough: false,
        expenseDate: { gte: ninetyDaysAgo },
      },
      _sum: { amount: true },
    }),
  ])

  const dsoProfile = computeClientDsoProfile(
    recentPayments.map(p => ({
      clientId: p.invoice.clientId,
      issueDate: p.invoice.issueDate,
      dueDate: p.invoice.dueDate,
      paidDate: p.paymentDate,
    }))
  )

  const startingCash = round2(Number(bankAgg._sum.currentBalance || 0))
  const monthlyPayrollBase = round2(
    activeEmployees.reduce((s, e) => s + Number(e.basicSalary || 0), 0)
  )
  const retainerMonthlyTotal = round2(
    activeRetainers.reduce((s, r) => s + Number(r.monthlyFee || 0), 0)
  )

  // Monthly recurring commitment run-rate
  const monthlyCommitmentsTotal = round2(
    recurringCommitments.reduce((s, c) => {
      const amt = Number(c.amount || 0)
      if (c.frequency === 'WEEKLY') return s + amt * 4.3333
      if (c.frequency === 'QUARTERLY') return s + amt / 3
      return s + amt
    }, 0)
  )

  // Trailing 90-day average monthly collections & non-payroll overhead
  const paymentsLast90 = recentPayments
    .filter(p => p.paymentDate >= ninetyDaysAgo)
    .reduce(
      (s, p) =>
        s +
        (p.baseAmount !== null && p.baseAmount !== undefined
          ? Number(p.baseAmount)
          : Number(p.amount) * Number(p.settlementRate || 1)),
      0
    )
  const avgMonthlyInflow = round2(
    Math.max(retainerMonthlyTotal, paymentsLast90 / 3)
  )
  const avgMonthlyHistoricalExpenses = round2(
    Number(recentExpensesAgg._sum.amount || 0) / 3
  )
  const grossMonthlyBurn = round2(
    monthlyPayrollBase + Math.max(monthlyCommitmentsTotal, avgMonthlyHistoricalExpenses)
  )

  const modelInput: CashFlowModelInput = {
    asOfDate: now.toISOString(),
    startingCash,
    agencyFallbackLateDays: dsoProfile.agencyAvgLateDays,
    monthlyPayrollBase,
    payrollDayOfMonth: 28,
    openReceivables: openInvoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.client.companyName,
      dueAmountBase: round2(Number(inv.dueAmount) * Number(inv.exchangeRate || 1)),
      dueDate: inv.dueDate.toISOString(),
      clientLateDays: dsoProfile.byClientId[inv.clientId]?.avgLateDays,
    })),
    activeRetainers: activeRetainers.map(r => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client.companyName,
      serviceName: r.serviceName,
      monthlyFee: Number(r.monthlyFee),
      billingDay: r.billingDay,
    })),
    upcomingMilestones: upcomingMilestones.map(m => ({
      id: m.id,
      title: m.title,
      projectName: m.project.name,
      clientName: m.project.client.companyName,
      billableAmount: Number(m.billableAmount || 0),
      targetDate: (m.targetDate ?? now).toISOString(),
    })),
    recurringCommitments: recurringCommitments.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category,
      amount: Number(c.amount),
      frequency: c.frequency,
      dueDay: c.dueDay,
    })),
    pendingPayables: pendingExpenses.map(e => ({
      id: e.id,
      description: e.description,
      amountBase: round2(
        e.baseAmount !== null && e.baseAmount !== undefined
          ? Number(e.baseAmount)
          : Number(e.amount) * Number(e.exchangeRate || 1)
      ),
      dueDate: e.expenseDate.toISOString(),
    })),
  }

  return {
    modelInput,
    agencyAvgDsoDays: dsoProfile.agencyAvgDsoDays,
    retainerMonthlyTotal,
    avgMonthlyInflow,
    grossMonthlyBurn,
  }
}

export async function getCashFlowRunwayData() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  const [live, allCommitments, savedScenarios] = await Promise.all([
    buildLiveCashFlowInput(),
    prisma.recurringCommitment.findMany({
      orderBy: [{ isActive: 'desc' }, { amount: 'desc' }],
    }),
    prisma.cashFlowScenario.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        createdBy: { select: { name: true } },
      },
    }),
  ])

  const baseline13Week = build13WeekCashFlow(live.modelInput)
  const runway = computeRunwayClock({
    startingCash: live.modelInput.startingCash,
    avgMonthlyInflow: live.avgMonthlyInflow,
    retainerOnlyMonthlyInflow: live.retainerMonthlyTotal,
    grossMonthlyBurn: live.grossMonthlyBurn,
  })

  return {
    modelInput: live.modelInput,
    baseline13Week,
    runway,
    agencyAvgDsoDays: live.agencyAvgDsoDays,
    retainerMonthlyTotal: live.retainerMonthlyTotal,
    avgMonthlyInflow: live.avgMonthlyInflow,
    grossMonthlyBurn: live.grossMonthlyBurn,
    commitments: allCommitments.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category,
      amount: Number(c.amount),
      frequency: c.frequency,
      dueDay: c.dueDay,
      isActive: c.isActive,
      notes: c.notes,
    })),
    savedScenarios: savedScenarios.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      projectedLowestCash: Number(s.projectedLowestCash),
      projectedEndingCash: Number(s.projectedEndingCash),
      assumptions: cashFlowAssumptionsSchema.parse(s.assumptionsJson),
      createdByName: s.createdBy?.name ?? 'Executive',
      createdAt: s.createdAt.toISOString(),
    })),
  }
}

const createCommitmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.nativeEnum(CommitmentCategory).default(CommitmentCategory.OTHER),
  amount: z.number().positive(),
  frequency: z.nativeEnum(CommitmentFrequency).default(CommitmentFrequency.MONTHLY),
  dueDay: z.number().int().min(1).max(28).default(1),
  notes: z.string().max(300).optional(),
})

export async function createRecurringCommitmentAction(
  input: z.infer<typeof createCommitmentSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  const parsed = createCommitmentSchema.parse(input)
  await prisma.recurringCommitment.create({
    data: {
      name: parsed.name,
      category: parsed.category,
      amount: new Prisma.Decimal(round2(parsed.amount)),
      frequency: parsed.frequency,
      dueDay: parsed.dueDay,
      notes: parsed.notes ?? null,
    },
  })

  revalidatePath('/finances/cashflow-runway')
  revalidatePath('/finances/guardrails')
  return { success: true }
}

export async function toggleRecurringCommitmentAction(id: string, isActive: boolean) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  await prisma.recurringCommitment.update({
    where: { id },
    data: { isActive },
  })
  revalidatePath('/finances/cashflow-runway')
  return { success: true }
}

export async function deleteRecurringCommitmentAction(id: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  await prisma.recurringCommitment.delete({ where: { id } })
  revalidatePath('/finances/cashflow-runway')
  return { success: true }
}

export async function saveCashFlowScenarioAction(input: {
  name: string
  description?: string
  assumptions: CashFlowAssumptions
}) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  const cleanName = input.name.trim()
  if (cleanName.length < 2) {
    throw new Error('Scenario name must be at least 2 characters.')
  }

  // Strictly validate JSON payload before write
  const validated = cashFlowAssumptionsSchema.parse(input.assumptions)
  const live = await buildLiveCashFlowInput()
  const simulated = build13WeekCashFlow(live.modelInput, validated)

  const saved = await prisma.cashFlowScenario.create({
    data: {
      name: cleanName,
      description: input.description?.trim() || null,
      hiredCount: validated.additionalHiresCount,
      hiredMonthlySalary: new Prisma.Decimal(validated.additionalHireMonthlySalary),
      retainerMrrDelta: new Prisma.Decimal(validated.retainerMrrDelta),
      monthlyAdSpendDelta: new Prisma.Decimal(validated.monthlyAdSpendDelta),
      arDelayWeeks: validated.arDelayWeeks,
      projectedLowestCash: new Prisma.Decimal(simulated.lowestCashBalance),
      projectedEndingCash: new Prisma.Decimal(simulated.endingCash),
      assumptionsJson: validated,
      createdById: session.user.id,
    },
  })

  revalidatePath('/finances/cashflow-runway')
  return { success: true, id: saved.id }
}

export async function deleteCashFlowScenarioAction(id: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  await prisma.cashFlowScenario.delete({ where: { id } })
  revalidatePath('/finances/cashflow-runway')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAIL ALERTS ENGINE (Module 2 Guardrails)
// ─────────────────────────────────────────────────────────────────────────────

export async function getGuardrailThresholds(): Promise<GuardrailThresholds> {
  const cfg = await prisma.guardrailConfig.findUnique({
    where: { key: 'DEFAULT' },
  })
  if (!cfg) return DEFAULT_GUARDRAIL_THRESHOLDS
  return {
    minBillableUtilizationPct: Number(cfg.minBillableUtilizationPct),
    maxClientConcentrationPct: Number(cfg.maxClientConcentrationPct),
    minProjectGrossMarginPct: Number(cfg.minProjectGrossMarginPct),
    minRunwayMonths: Number(cfg.minRunwayMonths),
    badDebtOverdueDays: cfg.badDebtOverdueDays,
  }
}

export async function getGuardrailsDashboardData() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertGuardrailViewAccess(session.user.role)

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const trailing12MonthsStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  const [
    thresholds,
    billableEmployees,
    timeLogsLast30,
    trailingInvoices,
    projectProf,
    liveCashFlow,
    openInvoices,
  ] = await Promise.all([
    getGuardrailThresholds(),
    prisma.employee.findMany({
      where: { isActive: true, isBillableRole: true },
      select: { id: true, name: true, weeklyCapacityHours: true },
    }),
    prisma.taskTimeLog.findMany({
      where: { logDate: { gte: thirtyDaysAgo } },
      select: { hours: true, isBillable: true },
    }),
    prisma.agencyInvoice.findMany({
      where: {
        issueDate: { gte: trailing12MonthsStart },
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: {
        client: { select: { id: true, companyName: true } },
        items: { select: { totalPrice: true, isPassThrough: true } },
      },
    }),
    getProjectProfitability(),
    buildLiveCashFlowInput(),
    prisma.agencyInvoice.findMany({
      where: {
        dueAmount: { gt: 0 },
        status: { notIn: ['DRAFT', 'CANCELLED', 'PAID'] },
      },
      select: { dueAmount: true, dueDate: true, exchangeRate: true },
    }),
  ])

  // 1. Billable Utilization (last 30 days)
  const totalCapacityHours = round2(
    billableEmployees.reduce(
      (s, e) => s + computeMonthlyCapacityHours(Number(e.weeklyCapacityHours)),
      0
    )
  )
  const billableHoursLogged = round2(
    timeLogsLast30
      .filter(l => l.isBillable)
      .reduce((s, l) => s + Number(l.hours || 0), 0)
  )
  const totalHoursLogged = round2(
    timeLogsLast30.reduce((s, l) => s + Number(l.hours || 0), 0)
  )
  const billableUtilizationPct =
    totalCapacityHours > 0
      ? round2(Math.min(150, (billableHoursLogged / totalCapacityHours) * 100))
      : 0

  // 2. Client Concentration (Trailing 12M AGI by Client)
  const agiByClient = new Map<string, { id: string; name: string; agi: number }>()
  let totalTrailingAgi = 0

  for (const inv of trailingInvoices) {
    const rate = Number(inv.exchangeRate || 1)
    const totalBase = Number(inv.totalAmount) * rate
    const passThru = inv.items
      .filter(it => it.isPassThrough)
      .reduce((s, it) => s + Number(it.totalPrice) * rate, 0)
    const invAgi = Math.max(0, round2(totalBase - passThru))
    if (invAgi <= 0) continue

    totalTrailingAgi += invAgi
    const existing = agiByClient.get(inv.clientId) ?? {
      id: inv.clientId,
      name: inv.client.companyName,
      agi: 0,
    }
    existing.agi = round2(existing.agi + invAgi)
    agiByClient.set(inv.clientId, existing)
  }

  const clientConcentrationRanking = Array.from(agiByClient.values())
    .sort((a, b) => b.agi - a.agi)
    .slice(0, 6)
    .map(c => ({
      ...c,
      sharePct:
        totalTrailingAgi > 0 ? round2((c.agi / totalTrailingAgi) * 100) : 0,
    }))

  const topClient = clientConcentrationRanking[0] ?? null

  // 3. Active Project Margins
  const activeProjects = projectProf.projects.filter(
    p => p.status === 'IN_PROGRESS' || p.status === 'REVIEW'
  )
  const billedActiveProjects = activeProjects.filter(p => p.totalInvoiced > 0)
  const belowMarginProjects = billedActiveProjects
    .filter(p => p.marginPct < thresholds.minProjectGrossMarginPct)
    .sort((a, b) => a.marginPct - b.marginPct)

  const lowestProject = belowMarginProjects[0] ?? null

  // 4. Runway Clock
  const runway = computeRunwayClock({
    startingCash: liveCashFlow.modelInput.startingCash,
    avgMonthlyInflow: liveCashFlow.avgMonthlyInflow,
    retainerOnlyMonthlyInflow: liveCashFlow.retainerMonthlyTotal,
    grossMonthlyBurn: liveCashFlow.grossMonthlyBurn,
  })

  // 5. Severe Overdue AR (> badDebtOverdueDays)
  const msPerDay = 1000 * 60 * 60 * 24
  let severeOverdueAmount = 0
  let severeOverdueCount = 0
  for (const inv of openInvoices) {
    const overdueDays = Math.floor(
      (now.getTime() - new Date(inv.dueDate).getTime()) / msPerDay
    )
    if (overdueDays > thresholds.badDebtOverdueDays) {
      severeOverdueCount += 1
      severeOverdueAmount = round2(
        severeOverdueAmount + Number(inv.dueAmount) * Number(inv.exchangeRate || 1)
      )
    }
  }

  const evaluation = evaluateGuardrails(
    {
      billableUtilizationPct,
      hasTimeLogs: totalHoursLogged > 0,
      topClientName: topClient?.name ?? null,
      topClientSharePct: topClient?.sharePct ?? 0,
      activeProjectsTotal: activeProjects.length,
      projectsBelowMarginCount: belowMarginProjects.length,
      lowestActiveProjectName: lowestProject?.name ?? null,
      lowestActiveProjectMarginPct: lowestProject?.marginPct ?? null,
      worstCaseRunwayMonths: runway.worstCaseRunwayMonths,
      severeOverdueAmount,
      severeOverdueCount,
    },
    thresholds
  )

  return {
    canEditThresholds: CASHFLOW_ADMIN_ROLES.has(normalizeRole(session.user.role)),
    thresholds,
    evaluation,
    details: {
      billableUtilizationPct,
      billableHoursLogged,
      totalHoursLogged,
      totalCapacityHours,
      billableHeadcount: billableEmployees.length,
      totalTrailingAgi: round2(totalTrailingAgi),
      clientConcentrationRanking,
      atRiskProjects: belowMarginProjects.map(p => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        totalInvoiced: p.totalInvoiced,
        marginPct: p.marginPct,
        ehr: p.ehr,
      })),
      runway,
      severeOverdueAmount,
      severeOverdueCount,
    },
  }
}

const guardrailConfigSchema = z.object({
  minBillableUtilizationPct: z.number().min(20).max(100),
  maxClientConcentrationPct: z.number().min(5).max(80),
  minProjectGrossMarginPct: z.number().min(10).max(90),
  minRunwayMonths: z.number().min(1).max(24),
  badDebtOverdueDays: z.number().int().min(30).max(365),
})

export async function updateGuardrailConfigAction(
  input: z.infer<typeof guardrailConfigSchema>
) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertCashflowAccess(session.user.role)

  const parsed = guardrailConfigSchema.parse(input)

  await prisma.guardrailConfig.upsert({
    where: { key: 'DEFAULT' },
    update: {
      minBillableUtilizationPct: new Prisma.Decimal(parsed.minBillableUtilizationPct),
      maxClientConcentrationPct: new Prisma.Decimal(parsed.maxClientConcentrationPct),
      minProjectGrossMarginPct: new Prisma.Decimal(parsed.minProjectGrossMarginPct),
      minRunwayMonths: new Prisma.Decimal(parsed.minRunwayMonths),
      badDebtOverdueDays: parsed.badDebtOverdueDays,
      updatedById: session.user.id,
    },
    create: {
      key: 'DEFAULT',
      minBillableUtilizationPct: new Prisma.Decimal(parsed.minBillableUtilizationPct),
      maxClientConcentrationPct: new Prisma.Decimal(parsed.maxClientConcentrationPct),
      minProjectGrossMarginPct: new Prisma.Decimal(parsed.minProjectGrossMarginPct),
      minRunwayMonths: new Prisma.Decimal(parsed.minRunwayMonths),
      badDebtOverdueDays: parsed.badDebtOverdueDays,
      updatedById: session.user.id,
    },
  })

  revalidatePath('/finances/guardrails')
  revalidatePath('/')
  return { success: true }
}
