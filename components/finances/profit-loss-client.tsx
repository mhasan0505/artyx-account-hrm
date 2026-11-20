'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowUpRight,
  Lock,
  Layers,
  Scale,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'
import type {
  AccountingBasis,
  AgencyProfitAndLossResult,
} from '@/lib/actions/agency-profit'

type PeriodPreset = 'ytd' | 'qtd' | 'mtd'

const BASIS_OPTIONS: Array<{ id: AccountingBasis; label: string; hint: string }> = [
  { id: 'ACCRUAL', label: 'Accrual Basis', hint: 'Earned revenue & matched costs' },
  { id: 'CASH', label: 'Cash Basis', hint: 'Actual bank inflows & outflows' },
]

const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'mtd', label: 'MTD' },
  { id: 'qtd', label: 'QTD' },
  { id: 'ytd', label: 'YTD' },
]

function fmt(amount: number, showSign = false): string {
  const abs = Math.abs(Math.round(amount)).toLocaleString('en-US')
  if (amount < 0) return `-৳${abs}`
  if (showSign && amount > 0) return `+৳${abs}`
  return `৳${abs}`
}

export function ProfitLossClient({
  accrual,
  cash,
  activePreset,
}: {
  accrual: AgencyProfitAndLossResult
  cash: AgencyProfitAndLossResult
  activePreset: PeriodPreset
}) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const [basis, setBasis] = React.useState<AccountingBasis>('ACCRUAL')

  const pl = basis === 'ACCRUAL' ? accrual : cash
  const wc = pl.workingCapital

  const handlePresetChange = (preset: PeriodPreset) => {
    router.push(`/finances/profit-loss?range=${preset}`)
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              HYBRID ACCOUNTING ENGINE
            </span>
            <span className="opacity-35">/</span>
            <span>{basis} BASIS</span>
            <span className="opacity-35">/</span>
            <span>BDT ৳</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Agency Profit &amp; Loss Statement
          </h1>
          <p className="text-xs text-muted-foreground">
            AGI-first income statement separating Pass-Through costs, Direct Delivery Labor, Bench Capacity, FX, and Working Capital.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Accrual vs Cash Spring Switcher */}
          <div
            role="tablist"
            aria-label="Accounting basis"
            className="inline-flex items-center rounded-xl border border-foreground/[0.1] bg-muted/50 p-0.5"
          >
            {BASIS_OPTIONS.map(opt => {
              const active = basis === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setBasis(opt.id)}
                  className={cn(
                    'relative cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="pl-basis-pill"
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 460, damping: 34 }
                      }
                      className="absolute inset-0 rounded-lg bg-card shadow-2xs ring-1 ring-foreground/[0.08]"
                    />
                  ) : null}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              )
            })}
          </div>

          {/* Period Presets */}
          <div className="inline-flex items-center rounded-xl border border-foreground/[0.1] bg-muted/40 p-0.5">
            {PERIOD_PRESETS.map(p => {
              const active = activePreset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-card text-foreground shadow-2xs ring-1 ring-foreground/[0.08]'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <Link
            href="/finances/revenue-recognition"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            <Layers className="size-3.5 text-muted-foreground" />
            <span>RevRec</span>
          </Link>

          <Link
            href="/finances/project-profitability"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            <span>Project Margins</span>
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Link>
        </div>
      </header>

      {/* Top Architectural KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Agency Gross Income</span>
            <span>AGI</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {fmt(pl.revenue.agi)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gross {fmt(pl.revenue.grossBillings)} · Pass-through {fmt(pl.revenue.passThroughBillings)}
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Gross Profit</span>
            <span className="text-primary font-semibold">{pl.grossMarginPct}%</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {fmt(pl.grossProfit)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {pl.canViewLaborCosts
              ? `GMROL: ${pl.gmrol > 0 ? `${pl.gmrol}x` : '—'} return on direct labor`
              : 'After direct contractor costs'}
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Operating EBITDA</span>
            <span
              className={cn(
                'font-semibold',
                pl.ebitda >= 0 ? 'text-primary' : 'text-rose-500'
              )}
            >
              {pl.ebitdaMarginPct}%
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {fmt(pl.ebitda)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Adjusted EBITDA: <strong className="font-mono text-foreground">{fmt(pl.addBacks.adjustedEbitda)}</strong>
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Net Working Capital</span>
            <span>NWC</span>
          </div>
          <p
            className={cn(
              'mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums',
              wc.nwc >= 0 ? 'text-foreground' : 'text-rose-500'
            )}
          >
            {fmt(wc.nwc)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Current Ratio: <strong className="font-mono text-foreground">{wc.currentRatio !== null ? `${wc.currentRatio}x` : '∞'}</strong>
          </p>
        </div>
      </section>

      {/* Main Split: Formal Waterfall Statement (8 cols) + Working Capital & AR Aging (4 cols) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Formal AGI P&L Waterfall */}
        <section className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card xl:col-span-8">
          <div className="flex items-center justify-between border-b border-foreground/[0.06] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Income Statement Waterfall ({basis === 'ACCRUAL' ? 'Accrual' : 'Cash'} Basis)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(pl.period.start).toLocaleDateString()} – {new Date(pl.period.end).toLocaleDateString()}
              </p>
            </div>
            {!pl.canViewLaborCosts ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-foreground/[0.1] bg-muted/50 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                <Lock className="size-3" /> Labor split restricted
              </span>
            ) : null}
          </div>

          <div className="divide-y divide-foreground/[0.06] text-xs">
            {/* 1. REVENUE & AGI */}
            <div className="space-y-2.5 p-5 sm:px-6">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  1. Revenue &amp; Agency Gross Income (AGI)
                </span>
                <span className="font-mono tabular-nums">{fmt(pl.revenue.agi)}</span>
              </div>

              <div className="space-y-1.5 pl-3 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Gross Client Billings</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.revenue.grossBillings)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Less: Pass-Through Reimbursements (Ad Spend / APIs)</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    ({fmt(pl.revenue.passThroughBillings)})
                  </span>
                </div>
                {basis === 'ACCRUAL' && pl.revenue.deferredMovement !== 0 ? (
                  <div className="flex justify-between">
                    <span>Net Deferred Revenue Recognition Movement</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {fmt(pl.revenue.deferredMovement, true)}
                    </span>
                  </div>
                ) : null}
                <div className="my-1.5 h-px bg-foreground/[0.05]" />
                <div className="flex justify-between">
                  <span>Software &amp; Engineering Projects</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.revenue.softwareDevelopment)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Monthly Retainers &amp; Subscriptions</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.revenue.retainerSubscriptions)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Digital Marketing &amp; Growth</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.revenue.digitalMarketing)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Other Advisory &amp; Services</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.revenue.otherServices)}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. DIRECT DELIVERY COSTS (COGS) */}
            <div className="space-y-2.5 p-5 sm:px-6">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  2. Direct Delivery Costs (COGS)
                </span>
                <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  ({fmt(pl.directCosts.total)})
                </span>
              </div>

              <div className="space-y-1.5 pl-3 text-muted-foreground">
                {pl.canViewLaborCosts ? (
                  <div className="flex justify-between">
                    <span>Direct Delivery Labor (Loaded Cost × Logged Hours)</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {fmt(pl.directCosts.directDeliveryLabor)}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span>Subcontractors &amp; Project-Direct Costs</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.directCosts.contractorAndFreelance)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] opacity-75">
                  <span>Memo: Pass-Through Vendor Costs (excluded from COGS)</span>
                  <span className="font-mono tabular-nums">
                    {fmt(pl.directCosts.passThroughCosts)}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between rounded-xl bg-muted/40 px-3.5 py-2.5 font-semibold">
                <span className="text-foreground">
                  Gross Profit{' '}
                  <span className="ml-1 font-mono text-[11px] text-primary">
                    ({pl.grossMarginPct}% of AGI)
                  </span>
                </span>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {fmt(pl.grossProfit)}
                </span>
              </div>
            </div>

            {/* 3. OPERATING EXPENSES (BENCH + OVERHEAD) */}
            <div className="space-y-2.5 p-5 sm:px-6">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  3. Operating Expenses (Bench &amp; Overhead)
                </span>
                <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  ({fmt(pl.operatingExpenses.total)})
                </span>
              </div>

              <div className="space-y-1.5 pl-3 text-muted-foreground">
                <div className="flex justify-between">
                  <span>
                    {pl.canViewLaborCosts
                      ? 'Unbilled Bench & Internal Payroll Capacity'
                      : 'Team Payroll & Salaries'}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.operatingExpenses.benchAndInternalLabor)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>SaaS, Cloud &amp; Dev Tooling</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.operatingExpenses.saasAndCloudSubscriptions)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Office Rent, Utilities &amp; Connectivity</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.operatingExpenses.officeRentAndUtilities)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Team Welfare &amp; Refreshment</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.operatingExpenses.teamWelfareAndRefreshment)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>General &amp; Administrative</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.operatingExpenses.generalAdministrative)}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. EBITDA, FX, BAD DEBT & ADJUSTED EBITDA */}
            <div className="space-y-2.5 bg-muted/20 p-5 sm:px-6">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="text-foreground">
                  Operating EBITDA{' '}
                  <span className="ml-1 font-mono text-xs text-primary">
                    ({pl.ebitdaMarginPct}%)
                  </span>
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {fmt(pl.ebitda)}
                </span>
              </div>

              <div className="space-y-1.5 pl-3 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Realized FX Gain / (Loss) on International Settlements</span>
                  <span
                    className={cn(
                      'font-mono tabular-nums',
                      pl.realizedFxGainLoss > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : pl.realizedFxGainLoss < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-foreground'
                    )}
                  >
                    {fmt(pl.realizedFxGainLoss, true)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Memo: Add-Back Ledger ({pl.addBacks.count} one-time / owner items)</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(pl.addBacks.total, true)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Memo: Aging-Weighted Bad Debt Allowance</span>
                  <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    ({fmt(pl.badDebtAllowance)})
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-foreground/[0.08] bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Net Operating Profit
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    After Bad Debt Reserve: <span className="font-mono">{fmt(pl.netIncomeAfterBadDebt)}</span> · Adjusted EBITDA: <span className="font-mono text-primary font-semibold">{fmt(pl.addBacks.adjustedEbitda)}</span>
                  </p>
                </div>
                <span
                  className={cn(
                    'font-mono text-xl font-semibold tabular-nums',
                    pl.netProfit >= 0 ? 'text-primary' : 'text-rose-500'
                  )}
                >
                  {fmt(pl.netProfit)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Sidebar (4 cols): Working Capital, Deferred/WIP & AR Aging */}
        <aside className="space-y-6 xl:col-span-4">
          {/* Working Capital & Deferred/WIP Panel */}
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Working Capital Health
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Current Assets vs. Liabilities (NWC)
                </p>
              </div>
              <Scale className="size-4 text-muted-foreground" />
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Current Assets — {fmt(wc.currentAssets)}
              </p>
              <div className="space-y-1.5 pl-2 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Bank &amp; MFS Liquidity</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.cashAndBank)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Net Receivables (after bad debt)</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.netReceivables)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Unbilled Revenue (WIP)</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.unbilledWip)}
                  </span>
                </div>
              </div>

              <div className="my-2 h-px bg-foreground/[0.06]" />

              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Current Liabilities — {fmt(wc.currentLiabilities)}
              </p>
              <div className="space-y-1.5 pl-2 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Deferred Revenue (Unearned)</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.deferredRevenueLiability)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pending Expenses / AP</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.accountsPayable)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Accrued Unpaid Payroll</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmt(wc.accruedPayroll)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* AR Aging & Bad Debt Allowance Breakdown */}
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  AR Aging &amp; Bad Debt Reserve
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Open AR {fmt(wc.totalOpenReceivables)} · Reserve {fmt(wc.badDebtAllowance)}
                </p>
              </div>
              <Link
                href="/accounts-receivable"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Ledger →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {(
                [
                  { label: 'Current (Not Due)', value: wc.arAging.current, rate: '0%', tone: 'bg-primary' },
                  { label: '1–30 Days Overdue', value: wc.arAging.days1to30, rate: '2%', tone: 'bg-foreground/60' },
                  { label: '31–60 Days Overdue', value: wc.arAging.days31to60, rate: '10%', tone: 'bg-amber-500/80' },
                  { label: '61–90 Days Overdue', value: wc.arAging.days61to90, rate: '25%', tone: 'bg-orange-500/80' },
                  { label: '90+ Days Overdue', value: wc.arAging.days90Plus, rate: '60%', tone: 'bg-rose-500' },
                ] as const
              ).map((bucket, idx) => {
                const pct =
                  wc.totalOpenReceivables > 0
                    ? Math.round((bucket.value / wc.totalOpenReceivables) * 100)
                    : 0
                return (
                  <div key={bucket.label} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {bucket.label}{' '}
                        <span className="font-mono opacity-65">({bucket.rate})</span>
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        {fmt(bucket.value)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                      <motion.div
                        initial={reduce ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { duration: 0.55, delay: idx * 0.05, ease: EASE.entrance }
                        }
                        style={{ width: `${pct}%`, transformOrigin: 'left' }}
                        className={cn('h-full rounded-full', bucket.tone)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
