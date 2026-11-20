'use client'

import * as React from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Plus,
} from 'lucide-react'
import { EASE, listItem, resolveMotion, staggerContainer } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { CreateClientModal } from '@/components/agency/client-modal'
import { AnimatedNumber } from '@/components/dashboard/animated-number'
import {
  FinancialHorizonChart,
  type MonthlyTrendPoint,
} from '@/components/dashboard/financial-horizon-chart'
import {
  CashAndVerticalsPanel,
  PartnerEquityPanel,
  type PartnerEquityItem,
  type ServiceVerticalItem,
} from '@/components/dashboard/analytics-panels'

export type AgencyDashboardStats = {
  userName?: string
  guardrailSummary?: {
    healthScore: number
    criticalCount: number
    warningCount: number
    topBreaches: Array<{
      id: string
      label: string
      severity: 'HEALTHY' | 'WARNING' | 'CRITICAL'
      headline: string
      href: string
    }>
  } | null
  totalClients: number
  monthlyMRR: number
  activeRetainers: number
  activeProjects: number
  totalInvoiced: number
  totalCollected: number
  totalReceivableDue: number
  overdueInvoicesCount?: number
  totalExpenses: number
  bankLiquidity?: number
  netOperatingProfit: number
  netOperatingMarginPct: number
  totalEquityAllocated: number
  partnerCapitalBalance: number
  totalTeamMembers: number
  collectionEfficiencyPct: number
  isTrendsProjected?: boolean
  trends: MonthlyTrendPoint[]
  categories: ServiceVerticalItem[]
  activeProjectsList: Array<{
    id: string
    name: string
    projectCode: string
    clientName: string
    serviceCategory: string
    status: string
    budget: number
    progress: number
  }>
  recentInvoices: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    totalAmount: number
    dueAmount: number
    status: string
    issueDate: Date | string
  }>
  recentClients: Array<{
    id: string
    companyName: string
    clientCode: string
    contactPerson: string
    clientType: string
    dueAmount: number
  }>
  owners: PartnerEquityItem[]
}

type InvoiceFilter = 'all' | 'paid' | 'due'

const INVOICE_FILTERS: Array<{ id: InvoiceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'paid', label: 'Settled' },
  { id: 'due', label: 'Pending' },
]

function MiniSparkline({
  values,
  positive = true,
}: {
  values: number[]
  positive?: boolean
}) {
  const reduce = useReducedMotion()

  const path = React.useMemo(() => {
    if (values.length < 2) return ''
    const w = 88
    const h = 28
    const pad = 3
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / range) * (h - pad * 2)
      return [x, y] as const
    })

    return points.reduce((acc, [x, y], idx) => {
      if (idx === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`
      const [px, py] = points[idx - 1]
      const cx = ((px + x) / 2).toFixed(1)
      return `${acc} C ${cx} ${py.toFixed(1)}, ${cx} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`
    }, '')
  }, [values])

  if (!path) return null

  return (
    <svg
      viewBox="0 0 88 28"
      className={cn(
        'h-7 w-[88px] shrink-0 overflow-visible',
        positive ? 'text-primary' : 'text-rose-500'
      )}
      aria-hidden="true"
    >
      <motion.path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0.2 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 0.9, ease: EASE.entrance, delay: 0.15 }
        }
      />
    </svg>
  )
}

function getInvoiceStatusMeta(status: string, dueAmount: number) {
  const normalized = status.toUpperCase()
  if (normalized === 'PAID' || dueAmount <= 0) {
    return {
      label: 'Paid',
      dot: 'bg-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
    }
  }
  if (normalized === 'OVERDUE') {
    return {
      label: 'Overdue',
      dot: 'bg-rose-500',
      text: 'text-rose-600 dark:text-rose-400',
    }
  }
  if (normalized === 'PARTIAL' || normalized === 'PARTIALLY_PAID') {
    return {
      label: 'Partial',
      dot: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    }
  }
  return {
    label: normalized === 'DRAFT' ? 'Draft' : 'Sent',
    dot: 'bg-foreground/40',
    text: 'text-muted-foreground',
  }
}

function formatShortDate(date: Date | string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function AgencyDashboard({ stats }: { stats: AgencyDashboardStats }) {
  const reduce = useReducedMotion()
  const [invoiceFilter, setInvoiceFilter] = React.useState<InvoiceFilter>('all')

  const containerVariants = React.useMemo(
    () => resolveMotion(staggerContainer(0.055), reduce),
    [reduce]
  )
  const sectionVariants = React.useMemo(
    () => resolveMotion(listItem(10), reduce),
    [reduce]
  )

  const todayStamp = React.useMemo(() => {
    const now = new Date()
    return now
      .toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      .toUpperCase()
  }, [])

  const firstName = React.useMemo(() => {
    const raw = stats.userName?.trim()
    if (!raw) return null
    return raw.split(' ')[0]
  }, [stats.userName])

  const profitSparklineValues = React.useMemo(
    () => stats.trends.map(t => t.profit),
    [stats.trends]
  )

  const filteredInvoices = React.useMemo(() => {
    const list = stats.recentInvoices
    if (invoiceFilter === 'paid') {
      return list.filter(inv => inv.status === 'PAID' || inv.dueAmount <= 0)
    }
    if (invoiceFilter === 'due') {
      return list.filter(inv => inv.status !== 'PAID' && inv.dueAmount > 0)
    }
    return list
  }, [stats.recentInvoices, invoiceFilter])

  const totalRevenueDisplay =
    stats.totalInvoiced > 0
      ? stats.totalInvoiced
      : stats.trends.reduce((s, t) => s + t.revenue, 0)

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6"
    >
      {/* 1. MINIMAL EDITORIAL HEADER BAR */}
      <motion.header
        variants={sectionVariants}
        className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              ARTYX DIGITAL
            </span>
            <span className="opacity-35">/</span>
            <span>{todayStamp}</span>
            <span className="opacity-35">/</span>
            <span>BDT ৳</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            {firstName ? `Executive Overview, ${firstName}` : 'Executive Overview'}
          </h1>
        </div>

        {/* Clean Minimal Action Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <CreateClientModal
            trigger={
              <button
                type="button"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-all duration-150 hover:border-foreground/20 hover:bg-muted/60 active:scale-[0.98]"
              >
                <Plus className="size-3.5 text-muted-foreground" />
                <span>Client</span>
              </button>
            }
          />
          <Link
            href="/invoices/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-all duration-150 hover:border-foreground/20 hover:bg-muted/60 active:scale-[0.98]"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            <span>Invoice</span>
          </Link>
          <Link
            href="/equity/distributions"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
          >
            <span>Distribute Profit</span>
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </motion.header>

      {/* QUIET EXECUTIVE GUARDRAIL STRIP (ONLY WHEN THRESHOLD BREACHED) */}
      {stats.guardrailSummary && stats.guardrailSummary.topBreaches.length > 0 ? (
        <motion.div
          variants={sectionVariants}
          className={cn(
            'flex flex-col gap-2.5 rounded-xl border px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between',
            stats.guardrailSummary.criticalCount > 0
              ? 'border-rose-500/30 bg-rose-500/[0.06]'
              : 'border-amber-500/30 bg-amber-500/[0.06]'
          )}
        >
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <AlertTriangle
              className={cn(
                'size-3.5 shrink-0',
                stats.guardrailSummary.criticalCount > 0
                  ? 'text-rose-500'
                  : 'text-amber-500'
              )}
            />
            <span className="font-mono text-[11px] font-semibold text-foreground">
              Guardrails ({stats.guardrailSummary.criticalCount + stats.guardrailSummary.warningCount})
            </span>
            <span className="hidden text-foreground/25 sm:inline">·</span>
            <span className="truncate text-muted-foreground">
              {stats.guardrailSummary.topBreaches[0].headline}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[11px] font-medium">
            <Link
              href="/finances/cashflow-runway"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              13-Week Runway
            </Link>
            <Link
              href="/finances/guardrails"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <span>Inspect Alerts</span>
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </motion.div>
      ) : null}

      {/* 2. SIGNATURE ARCHITECTURAL CENTERPIECE: LEDGER SUMMARY + FINANCIAL HORIZON */}
      <motion.section
        variants={sectionVariants}
        className="grid grid-cols-1 overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card xl:grid-cols-12"
      >
        {/* Left Rail (4 cols): Monumental Net Position + Hairline Executive Stack */}
        <div className="flex flex-col justify-between border-b border-foreground/[0.08] xl:col-span-4 xl:border-b-0 xl:border-r">
          {/* Primary Hero Anchor Metric */}
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Net Operating Profit
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                  stats.netOperatingProfit >= 0
                    ? 'bg-primary/12 text-primary'
                    : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                )}
              >
                {stats.netOperatingMarginPct}% margin
              </span>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <AnimatedNumber
                value={stats.netOperatingProfit}
                prefix="৳"
                className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[36px] leading-none"
                prefixClassName="text-xl sm:text-2xl font-normal text-muted-foreground"
              />
              <MiniSparkline
                values={profitSparklineValues}
                positive={stats.netOperatingProfit >= 0}
              />
            </div>

            <p className="mt-2.5 text-xs text-muted-foreground">
              After payroll, direct costs &amp; operating overhead
            </p>
          </div>

          {/* Hairline-Divided Secondary Executive Metrics (No separate box clutter) */}
          <div className="divide-y divide-foreground/[0.06] border-t border-foreground/[0.06]">
            {/* Row 1: Monthly Recurring */}
            <Link
              href="/clients/retainers"
              className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/35 sm:px-6"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Monthly Recurring (MRR)
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                  {stats.activeRetainers} active retainer{stats.activeRetainers === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-right">
                <AnimatedNumber
                  value={stats.monthlyMRR}
                  prefix="৳"
                  className="font-mono text-sm font-semibold text-foreground"
                />
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
              </div>
            </Link>

            {/* Row 2: Accounts Receivable + Micro Collection Bar */}
            <Link
              href="/accounts-receivable"
              className="group block px-5 py-3.5 transition-colors hover:bg-muted/35 sm:px-6"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Accounts Receivable
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                    {stats.overdueInvoicesCount && stats.overdueInvoicesCount > 0
                      ? `${stats.overdueInvoicesCount} overdue · ${stats.collectionEfficiencyPct}% collected`
                      : `${stats.collectionEfficiencyPct}% collection efficiency`}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <AnimatedNumber
                    value={stats.totalReceivableDue}
                    prefix="৳"
                    className={cn(
                      'font-mono text-sm font-semibold',
                      stats.totalReceivableDue > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-foreground'
                    )}
                  />
                  <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
              </div>
              <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                <motion.div
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: 0.7, delay: 0.15, ease: EASE.entrance }
                  }
                  style={{
                    width: `${Math.min(100, Math.max(4, stats.collectionEfficiencyPct))}%`,
                    transformOrigin: 'left',
                  }}
                  className="h-full rounded-full bg-primary"
                />
              </div>
            </Link>

            {/* Row 3: Partner Capital Pool */}
            <Link
              href="/equity"
              className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/35 sm:px-6"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Partner Capital Pool
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                  {stats.owners.length} partners · {stats.totalEquityAllocated}% allocated
                </p>
              </div>
              <div className="flex items-center gap-2 text-right">
                <AnimatedNumber
                  value={stats.partnerCapitalBalance}
                  prefix="৳"
                  className="font-mono text-sm font-semibold text-foreground"
                />
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
              </div>
            </Link>

            {/* Row 4: Treasury / Bank Liquidity (if tracked) or Collected Cash */}
            <Link
              href="/finances/banks"
              className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/35 sm:px-6"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {stats.bankLiquidity && stats.bankLiquidity > 0
                    ? 'Bank & MFS Liquidity'
                    : 'Total Cash Collected'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                  {stats.bankLiquidity && stats.bankLiquidity > 0
                    ? `৳${stats.totalCollected.toLocaleString()} settled invoices`
                    : 'Across all paid invoices'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-right">
                <AnimatedNumber
                  value={
                    stats.bankLiquidity && stats.bankLiquidity > 0
                      ? stats.bankLiquidity
                      : stats.totalCollected
                  }
                  prefix="৳"
                  className="font-mono text-sm font-semibold text-foreground"
                />
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
              </div>
            </Link>
          </div>

          {/* Quiet Operational Telemetry Footer */}
          <div className="grid grid-cols-3 divide-x divide-foreground/[0.06] border-t border-foreground/[0.06] bg-muted/20">
            <Link
              href="/clients"
              className="px-4 py-3 text-center transition-colors hover:bg-muted/40"
            >
              <span className="block font-mono text-base font-semibold tabular-nums text-foreground">
                {stats.totalClients}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Clients
              </span>
            </Link>
            <Link
              href="/projects"
              className="px-4 py-3 text-center transition-colors hover:bg-muted/40"
            >
              <span className="block font-mono text-base font-semibold tabular-nums text-foreground">
                {stats.activeProjects}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                In Flight
              </span>
            </Link>
            <Link
              href="/hr/employees"
              className="px-4 py-3 text-center transition-colors hover:bg-muted/40"
            >
              <span className="block font-mono text-base font-semibold tabular-nums text-foreground">
                {stats.totalTeamMembers}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Team
              </span>
            </Link>
          </div>
        </div>

        {/* Right Canvas (8 cols): Interactive Financial Horizon Chart */}
        <div className="xl:col-span-8">
          <FinancialHorizonChart
            trends={stats.trends}
            totalRevenue={totalRevenueDisplay}
            totalExpenses={stats.totalExpenses}
            isProjected={stats.isTrendsProjected}
          />
        </div>
      </motion.section>

      {/* 3. ASYMMETRIC ANALYTICS BAND: CAPITAL VELOCITY + PARTNER EQUITY */}
      <motion.section
        variants={sectionVariants}
        className="grid grid-cols-1 gap-6 lg:grid-cols-12"
      >
        <div className="lg:col-span-7">
          <CashAndVerticalsPanel
            totalInvoiced={totalRevenueDisplay}
            totalCollected={stats.totalCollected}
            totalReceivableDue={stats.totalReceivableDue}
            totalExpenses={stats.totalExpenses}
            collectionEfficiencyPct={stats.collectionEfficiencyPct}
            profitMarginPct={stats.netOperatingMarginPct}
            categories={stats.categories}
          />
        </div>

        <div className="lg:col-span-5">
          <PartnerEquityPanel
            owners={stats.owners}
            totalEquityAllocated={stats.totalEquityAllocated}
            partnerCapitalBalance={stats.partnerCapitalBalance}
          />
        </div>
      </motion.section>

      {/* 4. OPERATIONS & SETTLEMENT BAND: PROJECTS (5 COLS) + INVOICES (7 COLS) */}
      <motion.section
        variants={sectionVariants}
        className="grid grid-cols-1 gap-6 lg:grid-cols-12"
      >
        {/* Active Project Pipeline */}
        <div className="flex flex-col justify-between rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-5">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Active Project Pipeline
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Milestone progress &amp; contract values
                </p>
              </div>
              <Link
                href="/projects"
                className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>All Projects</span>
                <ArrowUpRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>

            {stats.activeProjectsList.length === 0 ? (
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-foreground/12 py-12 text-center">
                <p className="text-xs font-medium text-foreground">
                  No active projects in flight
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Launch a client engagement to track milestones here.
                </p>
                <Link
                  href="/projects"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Open Projects Workspace <ArrowRight className="size-3" />
                </Link>
              </div>
            ) : (
              <div className="mt-5 divide-y divide-foreground/[0.06]">
                {stats.activeProjectsList.map((project, idx) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group block py-3.5 first:pt-0 last:pb-0 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
                            {project.name}
                          </h3>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {project.clientName} · {project.serviceCategory}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">
                        ৳{project.budget.toLocaleString()}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                        <motion.div
                          initial={reduce ? false : { scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={
                            reduce
                              ? { duration: 0 }
                              : {
                                  duration: 0.65,
                                  delay: 0.08 + idx * 0.06,
                                  ease: EASE.entrance,
                                }
                          }
                          style={{
                            width: `${project.progress}%`,
                            transformOrigin: 'left',
                          }}
                          className="h-full rounded-full bg-primary transition-opacity group-hover:opacity-90"
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                        {project.progress}%
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-foreground/[0.06] pt-3.5 text-[11px] text-muted-foreground">
            <span>{stats.activeProjects} in progress</span>
            <Link href="/finances/project-profitability" className="hover:text-foreground transition-colors">
              Project Profitability →
            </Link>
          </div>
        </div>

        {/* Recent Service Invoices Ledger */}
        <div className="flex flex-col justify-between rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Recent Invoices
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Latest billing activity &amp; settlement status
                </p>
              </div>

              {/* Filter Pill Switcher */}
              <div className="flex items-center gap-3 self-start sm:self-auto">
                <div className="inline-flex items-center rounded-lg border border-foreground/[0.08] bg-muted/50 p-0.5">
                  {INVOICE_FILTERS.map(tab => {
                    const active = invoiceFilter === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setInvoiceFilter(tab.id)}
                        className={cn(
                          'relative cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                          active
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="invoice-filter-pill"
                            transition={
                              reduce
                                ? { duration: 0 }
                                : { type: 'spring', stiffness: 460, damping: 34 }
                            }
                            className="absolute inset-0 rounded-md bg-card shadow-2xs ring-1 ring-foreground/[0.08]"
                          />
                        ) : null}
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    )
                  })}
                </div>

                <Link
                  href="/invoices"
                  className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>Ledger</span>
                  <ArrowUpRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>

            {filteredInvoices.length === 0 ? (
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-foreground/12 py-12 text-center">
                <p className="text-xs font-medium text-foreground">
                  {stats.recentInvoices.length === 0
                    ? 'No invoices issued yet'
                    : 'No invoices match this filter'}
                </p>
                {stats.recentInvoices.length === 0 ? (
                  <Link
                    href="/invoices/new"
                    className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Create First Invoice <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 divide-y divide-foreground/[0.06]">
                {filteredInvoices.slice(0, 6).map(inv => {
                  const statusMeta = getInvoiceStatusMeta(inv.status, inv.dueAmount)
                  return (
                    <Link
                      key={inv.id}
                      href={`/invoices/${inv.id}`}
                      className="group -mx-2 flex items-center justify-between gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            statusMeta.dot
                          )}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
                              {inv.invoiceNumber}
                            </span>
                            <span className="text-foreground/20">·</span>
                            <span className="truncate text-xs font-medium text-foreground/90">
                              {inv.clientName}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono">
                              {formatShortDate(inv.issueDate)}
                            </span>
                            <span className="text-foreground/20">·</span>
                            <span className={cn('font-medium', statusMeta.text)}>
                              {statusMeta.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3 text-right">
                        <div className="font-mono tabular-nums">
                          <p className="text-xs font-semibold text-foreground">
                            ৳{inv.totalAmount.toLocaleString()}
                          </p>
                          <p
                            className={cn(
                              'text-[10px]',
                              inv.dueAmount > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground/70'
                            )}
                          >
                            {inv.dueAmount > 0
                              ? `Due ৳${inv.dueAmount.toLocaleString()}`
                              : 'Settled'}
                          </p>
                        </div>
                        <ArrowUpRight className="size-3.5 text-muted-foreground/40 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-foreground/[0.06] pt-3.5 text-[11px] text-muted-foreground">
            <span>
              Showing {Math.min(6, filteredInvoices.length)} of {stats.recentInvoices.length} latest
            </span>
            <Link href="/invoices/new" className="font-medium text-primary hover:underline">
              + Issue Invoice
            </Link>
          </div>
        </div>
      </motion.section>

      {/* 5. UNIFIED CLIENT PORTFOLIO STRIP (HAIRLINE ARCHITECTURAL ROW) */}
      <motion.section
        variants={sectionVariants}
        className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card"
      >
        <div className="flex items-center justify-between border-b border-foreground/[0.06] px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Client Portfolio
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              ({stats.totalClients})
            </span>
          </div>
          <Link
            href="/clients"
            className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Directory</span>
            <ArrowUpRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        {stats.recentClients.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-muted-foreground">
            No clients registered yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y divide-foreground/[0.06] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            {stats.recentClients.slice(0, 4).map(client => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="group flex flex-col justify-between gap-3 p-5 transition-colors hover:bg-muted/35"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {client.clientCode}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground/80">
                      {client.clientType.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <h3 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                    {client.companyName}
                  </h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {client.contactPerson}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-foreground/[0.06] pt-2.5 text-[11px]">
                  <span className="text-muted-foreground">Balance</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums',
                      client.dueAmount > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        client.dueAmount > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                      )}
                    />
                    ৳{client.dueAmount.toLocaleString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.section>
    </motion.div>
  )
}
