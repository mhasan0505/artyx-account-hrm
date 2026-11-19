import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { AgencyDashboard } from '@/components/agency-dashboard'
import { getAgencyProfitAndLoss } from '@/lib/actions/agency-profit'
import { redirect } from 'next/navigation'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  const now = new Date()
  const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  // Parallelized server telemetry queries
  const [
    clientsCount,
    retainersAgg,
    projectsCount,
    invoiceAgg,
    overdueInvoicesCount,
    bankLiquidityAgg,
    pl,
    owners,
    employeesCount,
    recentInvoicesRaw,
    recentClientsRaw,
    activeProjectsRaw,
    recentWindowInvoices,
    recentWindowExpenses,
    recentWindowPayroll,
  ] = await Promise.all([
    prisma.agencyClient.count(),
    prisma.clientRetainer.aggregate({
      where: { isActive: true },
      _sum: { monthlyFee: true },
      _count: { id: true },
    }),
    prisma.agencyProject.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.agencyInvoice.aggregate({
      where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
      _sum: {
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
      },
    }),
    prisma.agencyInvoice.count({
      where: {
        OR: [
          { status: 'OVERDUE' },
          {
            dueDate: { lt: now },
            dueAmount: { gt: 0 },
            status: { notIn: ['DRAFT', 'CANCELLED', 'PAID'] },
          },
        ],
      },
    }),
    prisma.bankAccount.aggregate({
      where: { isActive: true },
      _sum: { currentBalance: true },
    }),
    getAgencyProfitAndLoss(),
    prisma.agencyOwner.findMany({
      where: { isActive: true },
      orderBy: { equityPercentage: 'desc' },
    }),
    prisma.employee.count({ where: { isActive: true } }),
    prisma.agencyInvoice.findMany({
      orderBy: { issueDate: 'desc' },
      take: 8,
      include: {
        client: { select: { companyName: true } },
      },
    }),
    prisma.agencyClient.findMany({
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
    prisma.agencyProject.findMany({
      where: { status: { in: ['IN_PROGRESS', 'PLANNING', 'REVIEW'] } },
      take: 4,
      orderBy: { updatedAt: 'desc' },
      include: {
        client: { select: { companyName: true, clientCode: true } },
        milestones: { select: { status: true } },
        tasks: { select: { status: true } },
      },
    }),
    prisma.agencyInvoice.findMany({
      where: {
        issueDate: { gte: sixMonthsStart },
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      select: {
        issueDate: true,
        totalAmount: true,
        project: { select: { serviceCategory: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        expenseDate: { gte: sixMonthsStart },
        status: 'APPROVED',
      },
      select: {
        expenseDate: true,
        amount: true,
      },
    }),
    prisma.payrollEntry.findMany({
      where: {
        payrollPeriod: {
          year: { gte: sixMonthsStart.getFullYear() },
        },
      },
      select: {
        netPayable: true,
        payrollPeriod: { select: { month: true, year: true } },
      },
    }),
  ])

  const totalInvoiced = Number(invoiceAgg._sum.totalAmount || 0)
  const totalCollected = Number(invoiceAgg._sum.paidAmount || 0)
  const totalReceivableDue = Number(invoiceAgg._sum.dueAmount || 0)
  const actualExpenses = pl.operatingExpenses.total + pl.directCosts.total
  const bankLiquidity = Number(bankLiquidityAgg._sum.currentBalance || 0)

  const totalEquity = owners.reduce((s, o) => s + Number(o.equityPercentage), 0)
  const totalCapital = owners.reduce((s, o) => s + Number(o.currentCapitalBalance), 0)

  const recentInvoices = recentInvoicesRaw.map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    clientName: inv.client.companyName,
    totalAmount: Number(inv.totalAmount),
    dueAmount: Number(inv.dueAmount),
    status: inv.status,
    issueDate: inv.issueDate,
  }))

  const recentClients = recentClientsRaw.map(c => ({
    id: c.id,
    companyName: c.companyName,
    clientCode: c.clientCode,
    contactPerson: c.contactPerson,
    clientType: c.clientType,
    dueAmount: Number(c.outstandingBalance),
  }))

  const activeProjectsList = activeProjectsRaw.map(p => {
    const budget = Number(p.contractValue || 0)
    let progress = p.status === 'PLANNING' ? 15 : p.status === 'REVIEW' ? 88 : 50

    if (p.tasks.length > 0) {
      const done = p.tasks.filter(t => t.status === 'DONE').length
      progress = Math.round((done / p.tasks.length) * 100)
    } else if (p.milestones.length > 0) {
      const done = p.milestones.filter(m => m.status === 'COMPLETED').length
      progress = Math.round((done / p.milestones.length) * 100)
    }

    return {
      id: p.id,
      name: p.name,
      projectCode: p.projectCode,
      clientName: p.client.companyName,
      serviceCategory: p.serviceCategory || 'Software Engineering',
      status: p.status,
      budget,
      progress: Math.max(5, Math.min(100, progress)),
    }
  })

  // Build rolling 6-month bucket keys
  const monthBuckets: Array<{
    key: string
    month: string
    revenue: number
    expenses: number
    profit: number
  }> = []

  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthBuckets.push({
      key,
      month: MONTH_SHORT[d.getMonth()],
      revenue: 0,
      expenses: 0,
      profit: 0,
    })
  }

  const bucketMap = new Map(monthBuckets.map(b => [b.key, b]))

  recentWindowInvoices.forEach(inv => {
    const d = new Date(inv.issueDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = bucketMap.get(key)
    if (bucket) {
      bucket.revenue += Number(inv.totalAmount || 0)
    }
  })

  recentWindowExpenses.forEach(exp => {
    const d = new Date(exp.expenseDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = bucketMap.get(key)
    if (bucket) {
      bucket.expenses += Number(exp.amount || 0)
    }
  })

  recentWindowPayroll.forEach(entry => {
    const key = `${entry.payrollPeriod.year}-${String(entry.payrollPeriod.month).padStart(2, '0')}`
    const bucket = bucketMap.get(key)
    if (bucket) {
      bucket.expenses += Number(entry.netPayable || 0)
    }
  })

  const hasHistoricalActivity = monthBuckets.some(
    b => b.revenue > 0 || b.expenses > 0
  )

  let isTrendsProjected = false
  let trends = monthBuckets.map(b => {
    const revenue = Math.round(b.revenue)
    const expenses = Math.round(b.expenses)
    const profit = revenue - expenses
    return {
      month: b.month,
      revenue,
      expenses,
      profit,
    }
  })

  // Graceful baseline when no 6-month ledger records exist yet
  if (!hasHistoricalActivity) {
    isTrendsProjected = true
    const baseRevenue = Math.max(totalInvoiced, 480000)
    const multipliers = [
      { rev: 0.48, exp: 0.28 },
      { rev: 0.59, exp: 0.33 },
      { rev: 0.71, exp: 0.37 },
      { rev: 0.82, exp: 0.42 },
      { rev: 0.91, exp: 0.46 },
      { rev: 1.0, exp: 0.49 },
    ]
    trends = monthBuckets.map((b, idx) => {
      const m = multipliers[idx]
      const revenue = Math.round(baseRevenue * m.rev)
      const expenses = Math.round(baseRevenue * m.exp)
      return {
        month: b.month,
        revenue,
        expenses,
        profit: revenue - expenses,
      }
    })
  }

  // Real service vertical distribution from invoices (fallback if none categorized)
  const verticalTotals = new Map<string, number>()
  recentWindowInvoices.forEach(inv => {
    const cat = inv.project?.serviceCategory?.trim() || 'Custom Software & Engineering'
    verticalTotals.set(cat, (verticalTotals.get(cat) || 0) + Number(inv.totalAmount || 0))
  })

  const totalCategorized = Array.from(verticalTotals.values()).reduce((a, b) => a + b, 0)

  let categories: Array<{ name: string; value: number; percentage: number }> = []
  if (totalCategorized > 0) {
    const sorted = Array.from(verticalTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)

    categories = sorted.map(([name, value]) => ({
      name,
      value: Math.round(value),
      percentage: Math.max(1, Math.round((value / totalCategorized) * 100)),
    }))
  } else {
    const baseRev = totalInvoiced > 0 ? totalInvoiced : 480000
    categories = [
      { name: 'Custom Software & Web Apps', value: Math.round(baseRev * 0.48), percentage: 48 },
      { name: 'Performance Marketing & Retainers', value: Math.round(baseRev * 0.28), percentage: 28 },
      { name: 'UI/UX & Brand Systems', value: Math.round(baseRev * 0.14), percentage: 14 },
      { name: 'Cloud & Infrastructure', value: Math.round(baseRev * 0.1), percentage: 10 },
    ]
  }

  const collectionEfficiencyPct =
    totalInvoiced > 0
      ? Math.round((totalCollected / totalInvoiced) * 100)
      : 0

  const stats = {
    userName: session.user.name ?? undefined,
    totalClients: clientsCount,
    monthlyMRR: Number(retainersAgg._sum.monthlyFee || 0),
    activeRetainers: retainersAgg._count.id,
    activeProjects: projectsCount,
    totalInvoiced,
    totalCollected,
    totalReceivableDue,
    overdueInvoicesCount,
    totalExpenses: Math.round(actualExpenses),
    bankLiquidity,
    netOperatingProfit: pl.netProfit,
    netOperatingMarginPct: pl.netMarginPct,
    totalEquityAllocated: totalEquity,
    partnerCapitalBalance: totalCapital,
    totalTeamMembers: employeesCount,
    collectionEfficiencyPct,
    isTrendsProjected,
    trends,
    categories,
    activeProjectsList,
    recentInvoices,
    recentClients,
    owners: owners.map(o => ({
      id: o.id,
      name: o.name,
      title: o.title,
      equityPercentage: Number(o.equityPercentage),
      capitalBalance: Number(o.currentCapitalBalance),
    })),
  }

  return <AgencyDashboard stats={stats} />
}
