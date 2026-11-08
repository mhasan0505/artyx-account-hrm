'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function getAgencyProfitAndLoss(startDate?: Date, endDate?: Date) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  // Default to current calendar year if not specified
  const now = new Date()
  const start = startDate || new Date(now.getFullYear(), 0, 1)
  const end = endDate || new Date(now.getFullYear(), 11, 31, 23, 59, 59)

  // 1. REVENUE: Invoices issued in period
  const invoices = await prisma.agencyInvoice.findMany({
    where: {
      issueDate: { gte: start, lte: end },
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    },
    include: {
      items: true,
      project: { select: { serviceCategory: true } },
    },
  })

  let softwareRevenue = 0
  let marketingRevenue = 0
  let otherRevenue = 0

  invoices.forEach(inv => {
    const total = Number(inv.totalAmount)
    const cat = (inv.project?.serviceCategory || '').toLowerCase()
    if (cat.includes('software') || cat.includes('development') || cat.includes('dev')) {
      softwareRevenue += total
    } else if (cat.includes('marketing') || cat.includes('seo') || cat.includes('media')) {
      marketingRevenue += total
    } else {
      otherRevenue += total
    }
  })

  const totalRevenue = softwareRevenue + marketingRevenue + otherRevenue

  // 2. EXPENSES: All approved expenses in period
  const expenses = await prisma.expense.findMany({
    where: {
      expenseDate: { gte: start, lte: end },
      status: 'APPROVED',
    },
  })

  // 3. PAYROLL EXPENSES: All payroll entries in period
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()

  const payrollEntries = await prisma.payrollEntry.findMany({
    where: {
      payrollPeriod: {
        year: { gte: startYear, lte: endYear },
      },
    },
  })

  const payrollTotal = payrollEntries.reduce(
    (sum, p) => sum + Number(p.netPayable),
    0
  )

  // Breakdown expenses by category
  let directContractorCosts = 0
  let clientAdSpend = 0
  let saasSubscriptions = 0
  let officeRentUtilities = 0
  let teamWelfare = 0
  let generalAdmin = 0

  expenses.forEach(exp => {
    const amt = Number(exp.amount)
    const tag = (exp.categoryTag || exp.description || '').toUpperCase()

    if (tag.includes('CONTRACTOR') || tag.includes('FREELANCE') || exp.projectId) {
      directContractorCosts += amt
    } else if (tag.includes('AD_SPEND') || tag.includes('META') || tag.includes('GOOGLE_ADS')) {
      clientAdSpend += amt
    } else if (
      tag.includes('SAAS') ||
      tag.includes('AWS') ||
      tag.includes('VERCEL') ||
      tag.includes('FIGMA') ||
      tag.includes('OPENAI') ||
      tag.includes('SUBSCRIPTION')
    ) {
      saasSubscriptions += amt
    } else if (tag.includes('RENT') || tag.includes('UTILITY') || tag.includes('ELECTRICITY') || tag.includes('INTERNET')) {
      officeRentUtilities += amt
    } else if (tag.includes('FOOD') || tag.includes('ENTERTAINMENT') || tag.includes('SNACKS')) {
      teamWelfare += amt
    } else {
      generalAdmin += amt
    }
  })

  // Direct Delivery Costs
  const totalDirectCosts = directContractorCosts + clientAdSpend

  // Gross Profit
  const grossProfit = totalRevenue - totalDirectCosts
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  // Operating Expenses
  const totalOperatingExpenses =
    payrollTotal + saasSubscriptions + officeRentUtilities + teamWelfare + generalAdmin

  // Operating Net Profit (EBITDA)
  const netProfit = grossProfit - totalOperatingExpenses
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  return {
    period: { start, end },
    revenue: {
      softwareDevelopment: softwareRevenue,
      digitalMarketing: marketingRevenue,
      otherServices: otherRevenue,
      total: totalRevenue,
    },
    directCosts: {
      contractorAndFreelance: directContractorCosts,
      clientAdSpendDisbursement: clientAdSpend,
      total: totalDirectCosts,
    },
    grossProfit,
    grossMarginPct: Number(grossMarginPct.toFixed(1)),
    operatingExpenses: {
      teamPayroll: payrollTotal,
      saasAndCloudSubscriptions: saasSubscriptions,
      officeRentAndUtilities: officeRentUtilities,
      teamWelfareAndRefreshment: teamWelfare,
      generalAdministrative: generalAdmin,
      total: totalOperatingExpenses,
    },
    netProfit,
    netMarginPct: Number(netMarginPct.toFixed(1)),
  }
}

export async function getProjectProfitability() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const projects = await prisma.agencyProject.findMany({
    include: {
      client: {
        select: {
          id: true,
          companyName: true,
          clientCode: true,
        },
      },
      invoices: {
        select: {
          totalAmount: true,
          paidAmount: true,
          status: true,
        },
      },
      expenses: {
        select: {
          amount: true,
          description: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return projects.map(proj => {
    const totalInvoiced = proj.invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
    const totalCollected = proj.invoices.reduce((s, i) => s + Number(i.paidAmount), 0)
    const directExpenses = proj.expenses.reduce((s, e) => s + Number(e.amount), 0)
    const netMargin = totalInvoiced - directExpenses
    const marginPct = totalInvoiced > 0 ? (netMargin / totalInvoiced) * 100 : 0

    return {
      id: proj.id,
      projectCode: proj.projectCode,
      name: proj.name,
      serviceCategory: proj.serviceCategory,
      clientName: proj.client.companyName,
      contractValue: Number(proj.contractValue),
      totalInvoiced,
      totalCollected,
      directExpenses,
      netMargin,
      marginPct: Number(marginPct.toFixed(1)),
      status: proj.status,
    }
  })
}
