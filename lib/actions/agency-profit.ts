'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  AgencyAccountBucket,
  RevenueLineStatus,
  RevenueScheduleStatus,
} from '@prisma/client'
import {
  computeAGI,
  computeArAgingAndBadDebt,
  computeEHR,
  computeGMROL,
  computeLoadedHourlyCost,
  computeNetWorkingCapital,
  computeProjectOverUnderBilling,
  round2,
} from '@/lib/finance/accounting-math'
import { normalizeRole } from '@/lib/auth/route-access'

export type AccountingBasis = 'ACCRUAL' | 'CASH'

const LABOR_COST_ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'])

function canViewLaborCostBreakdown(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role)
  return LABOR_COST_ALLOWED_ROLES.has(normalized)
}

export interface AgencyProfitAndLossResult {
  basis: AccountingBasis
  canViewLaborCosts: boolean
  period: { start: Date; end: Date }
  revenue: {
    softwareDevelopment: number
    digitalMarketing: number
    retainerSubscriptions: number
    otherServices: number
    grossBillings: number
    passThroughBillings: number
    deferredMovement: number
    /** Agency Gross Income (AGI) = Earned Revenue excluding Pass-Through */
    agi: number
    /** Backward-compatible alias equal to AGI */
    total: number
  }
  directCosts: {
    directDeliveryLabor: number
    contractorAndFreelance: number
    clientAdSpendDisbursement: number
    passThroughCosts: number
    /** Agency Direct COGS (Direct Delivery Labor + Contractors; excludes Pass-Through) */
    total: number
  }
  grossProfit: number
  grossMarginPct: number
  gmrol: number
  operatingExpenses: {
    benchAndInternalLabor: number
    teamPayroll: number
    totalPayrollRaw: number
    saasAndCloudSubscriptions: number
    officeRentAndUtilities: number
    teamWelfareAndRefreshment: number
    generalAdministrative: number
    total: number
  }
  ebitda: number
  ebitdaMarginPct: number
  addBacks: {
    total: number
    count: number
    adjustedEbitda: number
    adjustedEbitdaMarginPct: number
  }
  realizedFxGainLoss: number
  badDebtAllowance: number
  netProfit: number
  netMarginPct: number
  netIncomeAfterBadDebt: number
  workingCapital: {
    cashAndBank: number
    totalOpenReceivables: number
    badDebtAllowance: number
    netReceivables: number
    unbilledWip: number
    deferredRevenueLiability: number
    accountsPayable: number
    accruedPayroll: number
    currentAssets: number
    currentLiabilities: number
    nwc: number
    currentRatio: number | null
    arAging: {
      current: number
      days1to30: number
      days31to60: number
      days61to90: number
      days90Plus: number
    }
  }
}

export async function getAgencyProfitAndLoss(
  startDate?: Date,
  endDate?: Date,
  options?: { basis?: AccountingBasis }
): Promise<AgencyProfitAndLossResult> {
  const session = await auth()
  const basis: AccountingBasis = options?.basis ?? 'ACCRUAL'
  const now = new Date()
  const start = startDate || new Date(now.getFullYear(), 0, 1)
  const end = endDate || new Date(now.getFullYear(), 11, 31, 23, 59, 59)

  const emptyResult: AgencyProfitAndLossResult = {
    basis,
    canViewLaborCosts: false,
    period: { start, end },
    revenue: {
      softwareDevelopment: 0,
      digitalMarketing: 0,
      retainerSubscriptions: 0,
      otherServices: 0,
      grossBillings: 0,
      passThroughBillings: 0,
      deferredMovement: 0,
      agi: 0,
      total: 0,
    },
    directCosts: {
      directDeliveryLabor: 0,
      contractorAndFreelance: 0,
      clientAdSpendDisbursement: 0,
      passThroughCosts: 0,
      total: 0,
    },
    grossProfit: 0,
    grossMarginPct: 0,
    gmrol: 0,
    operatingExpenses: {
      benchAndInternalLabor: 0,
      teamPayroll: 0,
      totalPayrollRaw: 0,
      saasAndCloudSubscriptions: 0,
      officeRentAndUtilities: 0,
      teamWelfareAndRefreshment: 0,
      generalAdministrative: 0,
      total: 0,
    },
    ebitda: 0,
    ebitdaMarginPct: 0,
    addBacks: {
      total: 0,
      count: 0,
      adjustedEbitda: 0,
      adjustedEbitdaMarginPct: 0,
    },
    realizedFxGainLoss: 0,
    badDebtAllowance: 0,
    netProfit: 0,
    netMarginPct: 0,
    netIncomeAfterBadDebt: 0,
    workingCapital: {
      cashAndBank: 0,
      totalOpenReceivables: 0,
      badDebtAllowance: 0,
      netReceivables: 0,
      unbilledWip: 0,
      deferredRevenueLiability: 0,
      accountsPayable: 0,
      accruedPayroll: 0,
      currentAssets: 0,
      currentLiabilities: 0,
      nwc: 0,
      currentRatio: null,
      arAging: {
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90Plus: 0,
      },
    },
  }

  if (!session?.user) {
    return emptyResult
  }

  const canViewLaborCosts = canViewLaborCostBreakdown(session.user.role)
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const startMonth = start.getMonth() + 1
  const endMonth = end.getMonth() + 1

  const [
    invoicesInPeriod,
    paymentsInPeriod,
    recognizedLinesInPeriod,
    expensesInPeriod,
    payrollEntries,
    payrollPaymentsInPeriod,
    timeLogsInPeriod,
    employees,
    bankBalanceAgg,
    openReceivablesRaw,
    activeScheduledDeferredAgg,
    unbilledCompletedMilestones,
    openApRaw,
    unpaidPayrollAgg,
  ] = await Promise.all([
    prisma.agencyInvoice.findMany({
      where: {
        issueDate: { gte: start, lte: end },
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: {
        items: true,
        project: { select: { serviceCategory: true, billingType: true } },
        revenueSchedules: {
          where: { status: { not: RevenueScheduleStatus.CANCELLED } },
          select: { totalDeferred: true },
        },
      },
    }),
    prisma.agencyPayment.findMany({
      where: {
        paymentDate: { gte: start, lte: end },
      },
      include: {
        invoice: {
          select: {
            totalAmount: true,
            exchangeRate: true,
            project: { select: { serviceCategory: true, billingType: true } },
            items: { select: { totalPrice: true, isPassThrough: true } },
          },
        },
      },
    }),
    prisma.revenueRecognitionLine.findMany({
      where: {
        status: RevenueLineStatus.RECOGNIZED,
        recognizedAt: { gte: start, lte: end },
      },
      include: {
        schedule: {
          select: {
            retainerId: true,
            project: { select: { serviceCategory: true } },
          },
        },
      },
    }),
    prisma.expense.findMany({
      where:
        basis === 'CASH'
          ? {
              status: 'APPROVED',
              OR: [
                { paidDate: { gte: start, lte: end } },
                { paidDate: null, expenseDate: { gte: start, lte: end } },
              ],
            }
          : {
              status: 'APPROVED',
              expenseDate: { gte: start, lte: end },
            },
      include: {
        account: { select: { code: true, name: true, agencyBucket: true } },
      },
    }),
    prisma.payrollEntry.findMany({
      where: {
        payrollPeriod: {
          AND: [
            {
              OR: [
                { year: { gt: startYear } },
                { year: startYear, month: { gte: startMonth } },
              ],
            },
            {
              OR: [
                { year: { lt: endYear } },
                { year: endYear, month: { lte: endMonth } },
              ],
            },
          ],
        },
      },
      select: { netPayable: true },
    }),
    prisma.payrollPayment.findMany({
      where: {
        voidedAt: null,
        paidAt: { gte: start, lte: end },
      },
      select: { amount: true },
    }),
    prisma.taskTimeLog.findMany({
      where: {
        logDate: { gte: start, lte: end },
      },
      select: {
        userId: true,
        hours: true,
        hourlyRate: true,
      },
    }),
    prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        userId: true,
        basicSalary: true,
        weeklyCapacityHours: true,
        overheadMultiplier: true,
        loadedHourlyCost: true,
      },
    }),
    prisma.bankAccount.aggregate({
      where: { isActive: true },
      _sum: { currentBalance: true },
    }),
    prisma.agencyInvoice.findMany({
      where: {
        dueAmount: { gt: 0 },
        status: { notIn: ['DRAFT', 'CANCELLED', 'PAID'] },
      },
      select: {
        dueAmount: true,
        dueDate: true,
        exchangeRate: true,
      },
    }),
    prisma.revenueRecognitionLine.aggregate({
      where: {
        status: RevenueLineStatus.SCHEDULED,
        schedule: { status: RevenueScheduleStatus.ACTIVE },
      },
      _sum: { amount: true },
    }),
    prisma.projectMilestone.findMany({
      where: {
        status: 'COMPLETED',
        isBilled: false,
        billableAmount: { gt: 0 },
      },
      select: { billableAmount: true },
    }),
    prisma.expense.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
    }),
    prisma.payrollEntry.aggregate({
      where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
      _sum: { netPayable: true },
    }),
  ])

  // ── 1. REVENUE CALCULATION (Accrual vs. Cash, AGI-First) ────────────────────
  let grossBillings = 0
  let passThroughBillings = 0
  let softwareRevenue = 0
  let marketingRevenue = 0
  let retainerRevenue = 0
  let otherRevenue = 0
  let deferredMovement = 0

  if (basis === 'ACCRUAL') {
    for (const inv of invoicesInPeriod) {
      const rate = Number(inv.exchangeRate || 1)
      const invTotalBase = round2(Number(inv.totalAmount) * rate)
      const invPassThroughBase = round2(
        inv.items
          .filter(it => it.isPassThrough)
          .reduce((s, it) => s + Number(it.totalPrice) * rate, 0)
      )
      const invDeferredBase = round2(
        inv.revenueSchedules.reduce((s, sch) => s + Number(sch.totalDeferred), 0)
      )

      grossBillings += invTotalBase
      passThroughBillings += invPassThroughBase

      const nonPassThroughBase = Math.max(0, round2(invTotalBase - invPassThroughBase))
      const immediateEarned = Math.max(0, round2(nonPassThroughBase - invDeferredBase))
      deferredMovement -= invDeferredBase

      const cat = (inv.project?.serviceCategory || '').toLowerCase()
      const isRetainer = inv.project?.billingType === 'MONTHLY_RETAINER'

      if (isRetainer) {
        retainerRevenue += immediateEarned
      } else if (cat.includes('software') || cat.includes('development') || cat.includes('dev')) {
        softwareRevenue += immediateEarned
      } else if (cat.includes('marketing') || cat.includes('seo') || cat.includes('media')) {
        marketingRevenue += immediateEarned
      } else {
        otherRevenue += immediateEarned
      }
    }

    // Add revenue recognized from Deferred Revenue schedules in this period
    for (const line of recognizedLinesInPeriod) {
      const amt = round2(Number(line.amount))
      deferredMovement += amt
      if (line.schedule.retainerId) {
        retainerRevenue += amt
      } else {
        const cat = (line.schedule.project?.serviceCategory || '').toLowerCase()
        if (cat.includes('software') || cat.includes('development') || cat.includes('dev')) {
          softwareRevenue += amt
        } else if (cat.includes('marketing') || cat.includes('seo') || cat.includes('media')) {
          marketingRevenue += amt
        } else {
          otherRevenue += amt
        }
      }
    }
  } else {
    // CASH BASIS: actual collected payments in period (base BDT)
    for (const pay of paymentsInPeriod) {
      const rate = Number(pay.settlementRate || pay.invoice.exchangeRate || 1)
      const paidBase = round2(
        pay.baseAmount !== null && pay.baseAmount !== undefined
          ? Number(pay.baseAmount)
          : Number(pay.amount) * rate
      )
      grossBillings += paidBase

      // Proportional pass-through share of this invoice payment
      const invTotal = Number(pay.invoice.totalAmount || 0)
      const invPassThrough = pay.invoice.items
        .filter(it => it.isPassThrough)
        .reduce((s, it) => s + Number(it.totalPrice), 0)
      const passThroughRatio = invTotal > 0 ? Math.min(1, invPassThrough / invTotal) : 0
      const paidPassThrough = round2(paidBase * passThroughRatio)
      const paidAgi = round2(paidBase - paidPassThrough)

      passThroughBillings += paidPassThrough

      const cat = (pay.invoice.project?.serviceCategory || '').toLowerCase()
      const isRetainer = pay.invoice.project?.billingType === 'MONTHLY_RETAINER'
      if (isRetainer) {
        retainerRevenue += paidAgi
      } else if (cat.includes('software') || cat.includes('development') || cat.includes('dev')) {
        softwareRevenue += paidAgi
      } else if (cat.includes('marketing') || cat.includes('seo') || cat.includes('media')) {
        marketingRevenue += paidAgi
      } else {
        otherRevenue += paidAgi
      }
    }
  }

  grossBillings = round2(grossBillings)
  passThroughBillings = round2(passThroughBillings)
  softwareRevenue = round2(softwareRevenue)
  marketingRevenue = round2(marketingRevenue)
  retainerRevenue = round2(retainerRevenue)
  otherRevenue = round2(otherRevenue)
  deferredMovement = round2(deferredMovement)

  const agi = round2(softwareRevenue + marketingRevenue + retainerRevenue + otherRevenue)

  // ── 2. REALIZED FX GAIN / LOSS ──────────────────────────────────────────────
  const realizedFxGainLoss = round2(
    paymentsInPeriod.reduce((s, p) => s + Number(p.realizedFxGainLoss || 0), 0)
  )

  // ── 3. DIRECT LABOR (COGS) vs. BENCH & OVERHEAD PAYROLL ─────────────────────
  const totalPayrollRaw = round2(
    basis === 'CASH'
      ? payrollPaymentsInPeriod.reduce((s, p) => s + Number(p.amount), 0)
      : payrollEntries.reduce((s, p) => s + Number(p.netPayable), 0)
  )

  const loadedRateByUserId = new Map<string, number>()
  for (const emp of employees) {
    if (!emp.userId) continue
    loadedRateByUserId.set(
      emp.userId,
      computeLoadedHourlyCost({
        basicSalary: Number(emp.basicSalary),
        weeklyCapacityHours: Number(emp.weeklyCapacityHours),
        overheadMultiplier: Number(emp.overheadMultiplier),
        loadedHourlyCostOverride: emp.loadedHourlyCost
          ? Number(emp.loadedHourlyCost)
          : null,
      })
    )
  }

  let rawLoggedLaborCost = 0
  for (const log of timeLogsInPeriod) {
    const hrs = Number(log.hours || 0)
    if (hrs <= 0) continue
    const rate =
      loadedRateByUserId.get(log.userId) ?? Number(log.hourlyRate || 0)
    rawLoggedLaborCost += hrs * rate
  }
  rawLoggedLaborCost = round2(rawLoggedLaborCost)

  // Direct delivery labor absorbed from payroll (capped at totalPayrollRaw when payroll exists so we never double-count)
  const directDeliveryLabor =
    totalPayrollRaw > 0
      ? round2(Math.min(rawLoggedLaborCost, totalPayrollRaw))
      : rawLoggedLaborCost
  const benchAndInternalLabor = round2(Math.max(0, totalPayrollRaw - directDeliveryLabor))

  // ── 4. EXPENSES CLASSIFIED BY COA BUCKET (Fallback to Legacy Tags) ──────────
  let directContractorCosts = 0
  let passThroughCosts = 0
  let saasSubscriptions = 0
  let officeRentUtilities = 0
  let teamWelfare = 0
  let generalAdmin = 0
  let addBacksTotal = 0
  let addBacksCount = 0

  for (const exp of expensesInPeriod) {
    const amt = round2(
      exp.baseAmount !== null && exp.baseAmount !== undefined
        ? Number(exp.baseAmount)
        : Number(exp.amount) * Number(exp.exchangeRate || 1)
    )

    if (exp.isAddBack) {
      addBacksTotal += amt
      addBacksCount += 1
    }

    const bucket = exp.account?.agencyBucket
    const code = exp.account?.code || ''
    const tag = (exp.categoryTag || exp.description || '').toUpperCase()

    if (exp.isPassThrough || bucket === AgencyAccountBucket.COGS_PASS_THROUGH) {
      passThroughCosts += amt
      continue
    }

    if (
      bucket === AgencyAccountBucket.COGS_CONTRACTOR ||
      exp.projectId ||
      tag.includes('CONTRACTOR') ||
      tag.includes('FREELANCE')
    ) {
      directContractorCosts += amt
    } else if (
      code === '5245' ||
      tag.includes('SAAS') ||
      tag.includes('AWS') ||
      tag.includes('VERCEL') ||
      tag.includes('FIGMA') ||
      tag.includes('OPENAI') ||
      tag.includes('SUBSCRIPTION')
    ) {
      saasSubscriptions += amt
    } else if (
      code === '5220' ||
      code === '5230' ||
      code === '5240' ||
      tag.includes('RENT') ||
      tag.includes('UTILITY') ||
      tag.includes('ELECTRICITY') ||
      tag.includes('INTERNET')
    ) {
      officeRentUtilities += amt
    } else if (
      tag.includes('FOOD') ||
      tag.includes('ENTERTAINMENT') ||
      tag.includes('SNACKS')
    ) {
      teamWelfare += amt
    } else if (tag.includes('AD_SPEND') || tag.includes('META_AD') || tag.includes('GOOGLE_ADS')) {
      passThroughCosts += amt
    } else {
      generalAdmin += amt
    }
  }

  directContractorCosts = round2(directContractorCosts)
  passThroughCosts = round2(passThroughCosts)
  saasSubscriptions = round2(saasSubscriptions)
  officeRentUtilities = round2(officeRentUtilities)
  teamWelfare = round2(teamWelfare)
  generalAdmin = round2(generalAdmin)
  addBacksTotal = round2(addBacksTotal)

  const totalDirectCosts = round2(directDeliveryLabor + directContractorCosts)
  const grossProfit = round2(agi - totalDirectCosts)
  const grossMarginPct = agi > 0 ? round2((grossProfit / agi) * 100) : 0
  const gmrol = computeGMROL(grossProfit, directDeliveryLabor)

  const totalOperatingExpenses = round2(
    benchAndInternalLabor +
      saasSubscriptions +
      officeRentUtilities +
      teamWelfare +
      generalAdmin
  )

  const ebitda = round2(grossProfit - totalOperatingExpenses)
  const ebitdaMarginPct = agi > 0 ? round2((ebitda / agi) * 100) : 0
  const adjustedEbitda = round2(ebitda + addBacksTotal)
  const adjustedEbitdaMarginPct = agi > 0 ? round2((adjustedEbitda / agi) * 100) : 0

  // ── 5. AR AGING, BAD DEBT ALLOWANCE & NET WORKING CAPITAL (NWC) ─────────────
  const arAgingResult = computeArAgingAndBadDebt(
    openReceivablesRaw.map(r => ({
      dueAmountBase: round2(Number(r.dueAmount) * Number(r.exchangeRate || 1)),
      dueDate: r.dueDate,
    })),
    now
  )

  const cashAndBank = round2(Number(bankBalanceAgg._sum.currentBalance || 0))
  const deferredRevenueLiability = round2(
    Number(activeScheduledDeferredAgg._sum.amount || 0)
  )
  const unbilledWip = round2(
    unbilledCompletedMilestones.reduce((s, m) => s + Number(m.billableAmount || 0), 0)
  )
  const accountsPayable = round2(Number(openApRaw._sum.amount || 0))
  const accruedPayroll = round2(Number(unpaidPayrollAgg._sum.netPayable || 0))

  const nwcResult = computeNetWorkingCapital({
    cashAndBank,
    netReceivables: arAgingResult.netReceivables,
    unbilledWip,
    accountsPayable,
    deferredRevenue: deferredRevenueLiability,
    accruedPayroll,
  })

  const netProfit = round2(ebitda + realizedFxGainLoss)
  const netMarginPct = agi > 0 ? round2((netProfit / agi) * 100) : 0
  const netIncomeAfterBadDebt = round2(netProfit - arAgingResult.badDebtAllowance)

  return {
    basis,
    canViewLaborCosts,
    period: { start, end },
    revenue: {
      softwareDevelopment: softwareRevenue,
      digitalMarketing: marketingRevenue,
      retainerSubscriptions: retainerRevenue,
      otherServices: otherRevenue,
      grossBillings,
      passThroughBillings,
      deferredMovement,
      agi,
      total: agi,
    },
    directCosts: {
      directDeliveryLabor: canViewLaborCosts ? directDeliveryLabor : 0,
      contractorAndFreelance: directContractorCosts,
      clientAdSpendDisbursement: passThroughCosts,
      passThroughCosts,
      total: canViewLaborCosts ? totalDirectCosts : directContractorCosts,
    },
    grossProfit: canViewLaborCosts ? grossProfit : round2(agi - directContractorCosts),
    grossMarginPct: canViewLaborCosts
      ? grossMarginPct
      : agi > 0
      ? round2(((agi - directContractorCosts) / agi) * 100)
      : 0,
    gmrol: canViewLaborCosts ? gmrol : 0,
    operatingExpenses: {
      benchAndInternalLabor: canViewLaborCosts ? benchAndInternalLabor : totalPayrollRaw,
      teamPayroll: canViewLaborCosts ? benchAndInternalLabor : totalPayrollRaw,
      totalPayrollRaw,
      saasAndCloudSubscriptions: saasSubscriptions,
      officeRentAndUtilities: officeRentUtilities,
      teamWelfareAndRefreshment: teamWelfare,
      generalAdministrative: generalAdmin,
      total: canViewLaborCosts
        ? totalOperatingExpenses
        : round2(
            totalPayrollRaw +
              saasSubscriptions +
              officeRentUtilities +
              teamWelfare +
              generalAdmin
          ),
    },
    ebitda,
    ebitdaMarginPct,
    addBacks: {
      total: addBacksTotal,
      count: addBacksCount,
      adjustedEbitda,
      adjustedEbitdaMarginPct,
    },
    realizedFxGainLoss,
    badDebtAllowance: arAgingResult.badDebtAllowance,
    netProfit,
    netMarginPct,
    netIncomeAfterBadDebt,
    workingCapital: {
      cashAndBank,
      totalOpenReceivables: arAgingResult.totalOpenReceivable,
      badDebtAllowance: arAgingResult.badDebtAllowance,
      netReceivables: arAgingResult.netReceivables,
      unbilledWip,
      deferredRevenueLiability,
      accountsPayable,
      accruedPayroll,
      currentAssets: nwcResult.currentAssets,
      currentLiabilities: nwcResult.currentLiabilities,
      nwc: nwcResult.nwc,
      currentRatio: nwcResult.currentRatio,
      arAging: arAgingResult.buckets,
    },
  }
}

export async function getProjectProfitability() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const canViewLabor = canViewLaborCostBreakdown(session.user.role)

  const [projects, employees] = await Promise.all([
    prisma.agencyProject.findMany({
      include: {
        client: {
          select: {
            id: true,
            companyName: true,
            clientCode: true,
          },
        },
        department: {
          select: { id: true, name: true },
        },
        invoices: {
          where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
          include: {
            items: { select: { totalPrice: true, isPassThrough: true } },
          },
        },
        expenses: {
          where: { status: 'APPROVED' },
          select: {
            amount: true,
            baseAmount: true,
            exchangeRate: true,
            isPassThrough: true,
          },
        },
        milestones: {
          select: {
            status: true,
            isBilled: true,
            billableAmount: true,
          },
        },
        revenueSchedules: {
          where: { status: { not: RevenueScheduleStatus.CANCELLED } },
          select: {
            totalDeferred: true,
            totalRecognized: true,
          },
        },
        tasks: {
          select: {
            timeLogs: {
              select: {
                userId: true,
                hours: true,
                hourlyRate: true,
                isBillable: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    canViewLabor
      ? prisma.employee.findMany({
          where: { isActive: true },
          select: {
            userId: true,
            basicSalary: true,
            weeklyCapacityHours: true,
            overheadMultiplier: true,
            loadedHourlyCost: true,
          },
        })
      : Promise.resolve([]),
  ])

  const rateByUserId = new Map<string, number>()
  for (const emp of employees) {
    if (!emp.userId) continue
    rateByUserId.set(
      emp.userId,
      computeLoadedHourlyCost({
        basicSalary: Number(emp.basicSalary),
        weeklyCapacityHours: Number(emp.weeklyCapacityHours),
        overheadMultiplier: Number(emp.overheadMultiplier),
        loadedHourlyCostOverride: emp.loadedHourlyCost
          ? Number(emp.loadedHourlyCost)
          : null,
      })
    )
  }

  return {
    canViewLaborCosts: canViewLabor,
    projects: projects.map(proj => {
      let grossInvoiced = 0
      let passThroughInvoiced = 0
      let totalCollected = 0

      for (const inv of proj.invoices) {
        const rate = Number(inv.exchangeRate || 1)
        grossInvoiced += Number(inv.totalAmount) * rate
        totalCollected += Number(inv.paidAmount) * rate
        passThroughInvoiced += inv.items
          .filter(it => it.isPassThrough)
          .reduce((s, it) => s + Number(it.totalPrice) * rate, 0)
      }

      const agiInvoiced = computeAGI(grossInvoiced, passThroughInvoiced).agi

      const directVendorExpenses = round2(
        proj.expenses
          .filter(e => !e.isPassThrough)
          .reduce(
            (s, e) =>
              s +
              (e.baseAmount !== null && e.baseAmount !== undefined
                ? Number(e.baseAmount)
                : Number(e.amount) * Number(e.exchangeRate || 1)),
            0
          )
      )

      let totalLoggedHours = 0
      let billableHours = 0
      let directLaborCost = 0

      for (const task of proj.tasks) {
        for (const log of task.timeLogs) {
          const hrs = Number(log.hours || 0)
          totalLoggedHours += hrs
          if (log.isBillable) billableHours += hrs
          if (canViewLabor) {
            const rate =
              rateByUserId.get(log.userId) ?? Number(log.hourlyRate || 0)
            directLaborCost += hrs * rate
          }
        }
      }

      totalLoggedHours = round2(totalLoggedHours)
      billableHours = round2(billableHours)
      directLaborCost = round2(directLaborCost)

      // Over / Under billing
      const totalDeferredScheduled = proj.revenueSchedules.reduce(
        (s, sch) => s + Number(sch.totalDeferred),
        0
      )
      const totalRecognizedScheduled = proj.revenueSchedules.reduce(
        (s, sch) => s + Number(sch.totalRecognized),
        0
      )
      const unscheduledAgi = Math.max(0, agiInvoiced - totalDeferredScheduled)
      const recognizedAgi = round2(unscheduledAgi + totalRecognizedScheduled)
      const unbilledWipValue = round2(
        proj.milestones
          .filter(m => m.status === 'COMPLETED' && !m.isBilled)
          .reduce((s, m) => s + Number(m.billableAmount || 0), 0)
      )

      const billingPosition = computeProjectOverUnderBilling({
        invoicedAgi: agiInvoiced,
        recognizedAgi,
        unbilledWipValue,
      })

      const effectiveRevenue = agiInvoiced > 0 ? agiInvoiced : Number(proj.contractValue)
      const ehr = computeEHR(effectiveRevenue, totalLoggedHours)

      const totalDirectCosts = canViewLabor
        ? round2(directVendorExpenses + directLaborCost)
        : directVendorExpenses
      const netMargin = round2(agiInvoiced - totalDirectCosts)
      const marginPct = agiInvoiced > 0 ? round2((netMargin / agiInvoiced) * 100) : 0
      const gmrol = canViewLabor ? computeGMROL(netMargin, directLaborCost) : null

      return {
        id: proj.id,
        projectCode: proj.projectCode,
        name: proj.name,
        serviceCategory: proj.serviceCategory,
        departmentName: proj.department?.name ?? null,
        clientName: proj.client.companyName,
        contractValue: Number(proj.contractValue),
        grossInvoiced: round2(grossInvoiced),
        passThroughInvoiced: round2(passThroughInvoiced),
        totalInvoiced: agiInvoiced,
        totalCollected: round2(totalCollected),
        directExpenses: directVendorExpenses,
        directLaborCost: canViewLabor ? directLaborCost : null,
        totalDirectCosts,
        totalLoggedHours,
        billableHours,
        ehr,
        gmrol,
        billingPosition,
        netMargin,
        marginPct,
        isBelowMarginGuardrail: agiInvoiced > 0 && marginPct < 45,
        status: proj.status,
      }
    }),
  }
}
