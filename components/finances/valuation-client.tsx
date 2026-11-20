'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Download,
  RotateCcw,
  Save,
  Tag,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeAgencyValuation } from '@/lib/finance/valuation-engine'
import {
  toggleExpenseAddBackAction,
  updateValuationProfileAction,
} from '@/lib/actions/agency-strategy'
import { Button } from '@/components/ui/button'

type ValuationPageData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-strategy').getValuationReadinessData>
>

function fmt(val: number): string {
  const abs = Math.abs(Math.round(val)).toLocaleString('en-US')
  return val < 0 ? `-৳${abs}` : `৳${abs}`
}

function fmtCompact(val: number): string {
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 10_000_000) return `${sign}৳${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}৳${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}৳${(abs / 1_000).toFixed(0)}k`
  return `${sign}৳${Math.round(abs)}`
}

export function ValuationClient({ data }: { data: ValuationPageData }) {
  const router = useRouter()
  const [simRecurringPct, setSimRecurringPct] = React.useState(
    data.metrics.recurringRevenueSharePct
  )
  const [simTopClientPct, setSimTopClientPct] = React.useState(
    data.metrics.topClientSharePct
  )
  const [simBaseMultiple, setSimBaseMultiple] = React.useState(
    data.profile.baseMultiple
  )
  const [simFounderDiscount, setSimFounderDiscount] = React.useState(
    data.profile.founderDependencyDiscount
  )
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [busyExpenseId, setBusyExpenseId] = React.useState<string | null>(null)

  const isSimulating =
    simRecurringPct !== data.metrics.recurringRevenueSharePct ||
    simTopClientPct !== data.metrics.topClientSharePct ||
    simBaseMultiple !== data.profile.baseMultiple ||
    simFounderDiscount !== data.profile.founderDependencyDiscount

  const liveValuation = React.useMemo(
    () =>
      computeAgencyValuation(
        {
          ...data.metrics,
          recurringRevenueSharePct: simRecurringPct,
          topClientSharePct: simTopClientPct,
        },
        {
          ...data.profile,
          baseMultiple: simBaseMultiple,
          founderDependencyDiscount: simFounderDiscount,
        }
      ),
    [data.metrics, data.profile, simRecurringPct, simTopClientPct, simBaseMultiple, simFounderDiscount]
  )

  const taggedAddBacks = React.useMemo(
    () => data.expenses.filter(e => e.isAddBack),
    [data.expenses]
  )

  async function handleSaveProfile() {
    try {
      setSavingProfile(true)
      await updateValuationProfileAction({
        baseMultiple: simBaseMultiple,
        recurringBonusMax: data.profile.recurringBonusMax,
        concentrationPenaltyMax: data.profile.concentrationPenaltyMax,
        growthBonusMax: data.profile.growthBonusMax,
        founderDependencyDiscount: simFounderDiscount,
      })
      toast.success('Valuation multiple profile saved.')
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleToggleAddBack(expenseId: string, nextVal: boolean) {
    try {
      setBusyExpenseId(expenseId)
      await toggleExpenseAddBackAction({
        expenseId,
        isAddBack: nextVal,
        addBackCategory: nextVal ? 'Owner / One-Time Adjustment' : undefined,
      })
      toast.success(
        nextVal
          ? 'Expense tagged as EBITDA Add-Back.'
          : 'Expense removed from Add-Back ledger.'
      )
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update Add-Back')
    } finally {
      setBusyExpenseId(null)
    }
  }

  function handleExportSdeCsv() {
    const rows = [
      ['Metric / Line Item', 'Category', 'Date', 'Amount (BDT)'],
      ['Trailing 12M Agency Gross Income (AGI)', 'Summary', '', String(data.metrics.ttmAgi)],
      ['Trailing 12M Operating EBITDA', 'Summary', '', String(data.metrics.ttmEbitda)],
      ...taggedAddBacks.map(e => [
        `"${e.description.replace(/"/g, '""')}"`,
        `"${(e.addBackCategory || 'Add-Back').replace(/"/g, '""')}"`,
        new Date(e.expenseDate).toISOString().slice(0, 10),
        String(e.amountBase),
      ]),
      ['Total Add-Backs', 'Summary', '', String(data.metrics.ttmAddBacks)],
      ['Trailing 12M Adjusted EBITDA (SDE)', 'Summary', '', String(liveValuation.ttmAdjustedEbitda)],
      ['Effective Valuation Multiple', 'Valuation', '', `${liveValuation.multipleBridge.effectiveMidMultiple}x`],
      ['Estimated Enterprise Value (Mid)', 'Valuation', '', String(liveValuation.valuationMid)],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `artyx-adjusted-ebitda-sde-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const bridge = liveValuation.multipleBridge

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              MODULE 5 · EXIT READINESS &amp; M&amp;A
            </span>
            <span className="opacity-35">/</span>
            <span>READINESS {liveValuation.exitReadinessScore}/100</span>
            <span className="opacity-35">/</span>
            <span>RULE OF 40: {liveValuation.ruleOf40Score}%</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Live Valuation &amp; Add-Back Ledger
          </h1>
          <p className="text-xs text-muted-foreground">
            Transparent Trailing-12M Adjusted EBITDA valuation model with live multiple levers and buyer-ready SDE Add-Back ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSimulating ? (
            <button
              type="button"
              onClick={() => {
                setSimRecurringPct(data.metrics.recurringRevenueSharePct)
                setSimTopClientPct(data.metrics.topClientSharePct)
                setSimBaseMultiple(data.profile.baseMultiple)
                setSimFounderDiscount(data.profile.founderDependencyDiscount)
              }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              <span>Reset</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExportSdeCsv}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
          >
            <Download className="size-3.5" />
            <span>Export SDE / Adj. EBITDA CSV</span>
          </button>
        </div>
      </header>

      {/* VALUATION RANGE HERO STRIP */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Est. Enterprise Value (Mid)</span>
            <span className="text-primary font-semibold">{bridge.effectiveMidMultiple}x</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-primary">
            {fmtCompact(liveValuation.valuationMid)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Range: {fmtCompact(liveValuation.valuationLow)} – {fmtCompact(liveValuation.valuationHigh)}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            TTM Adjusted EBITDA (SDE)
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmtCompact(liveValuation.ttmAdjustedEbitda)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            EBITDA {fmtCompact(data.metrics.ttmEbitda)} + Add-Backs {fmtCompact(data.metrics.ttmAddBacks)}
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Hybrid Rule of 40</span>
            <span
              className={cn(
                'font-semibold',
                liveValuation.ruleOf40Tier === 'ELITE'
                  ? 'text-primary'
                  : liveValuation.ruleOf40Tier === 'HEALTHY'
                  ? 'text-foreground'
                  : 'text-amber-600 dark:text-amber-400'
              )}
            >
              {liveValuation.ruleOf40Tier}
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {liveValuation.ruleOf40Score}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {liveValuation.yoyAgiGrowthPct}% growth + {liveValuation.adjustedEbitdaMarginPct}% adj. margin
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Exit Readiness Score
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {liveValuation.exitReadinessScore}
            <span className="text-sm text-muted-foreground">/100</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {taggedAddBacks.length} documented add-back(s)
          </p>
        </div>
      </section>

      {/* MULTIPLE BRIDGE + INTERACTIVE VALUE LEVER SIMULATOR */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Transparent Multiple Bridge */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Transparent Multiple Bridge
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Exact build-up from baseline agency multiple to buyer-adjusted exit multiple
            </p>
          </div>

          <div className="divide-y divide-foreground/[0.06] text-xs">
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Base Hybrid Agency Multiple</span>
              <span className="font-mono font-semibold text-foreground">
                {bridge.baseMultiple.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">
                Recurring Retainer Mix Premium ({simRecurringPct}% recurring)
              </span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                +{bridge.recurringAdjustment.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">
                Client Concentration Adjustment (Top client {simTopClientPct}%)
              </span>
              <span
                className={cn(
                  'font-mono font-semibold',
                  bridge.concentrationAdjustment < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground'
                )}
              >
                {bridge.concentrationAdjustment.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">
                Rule of 40 Growth &amp; Margin Adjustment ({liveValuation.ruleOf40Score}%)
              </span>
              <span
                className={cn(
                  'font-mono font-semibold',
                  bridge.ruleOf40Adjustment > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : bridge.ruleOf40Adjustment < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground'
                )}
              >
                {bridge.ruleOf40Adjustment >= 0 ? '+' : ''}
                {bridge.ruleOf40Adjustment.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Founder Dependency Haircut</span>
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                {bridge.founderDependencyAdjustment.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between pt-3 text-sm font-semibold">
              <span className="text-foreground">Effective Mid Multiple (Range {bridge.lowMultiple}x – {bridge.highMultiple}x)</span>
              <span className="font-mono text-primary">
                {bridge.effectiveMidMultiple.toFixed(2)}x
              </span>
            </div>
          </div>

          {/* Value Creation Levers */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-2">
            {liveValuation.valueLevers.map(lever => (
              <div
                key={lever.title}
                className="rounded-xl border border-foreground/[0.06] bg-muted/25 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{lever.title}</span>
                  <span
                    className={cn(
                      'font-mono text-[10px] font-semibold',
                      lever.status === 'STRONG'
                        ? 'text-primary'
                        : lever.status === 'OPPORTUNITY'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                    )}
                  >
                    {lever.status}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                  {lever.impact}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Interactive Multiple Lever Simulator */}
        <aside className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-5 space-y-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Multiple Lever Simulator
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Model valuation expansion &amp; configure base profile
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingProfile}
              onClick={handleSaveProfile}
              className="h-8 gap-1.5 text-xs"
            >
              <Save className="size-3.5" />
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>

          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Base Market Multiple</span>
                <span className="font-mono font-semibold text-foreground">
                  {simBaseMultiple.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={7}
                step={0.25}
                value={simBaseMultiple}
                onChange={e => setSimBaseMultiple(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Simulated Recurring Share</span>
                <span className="font-mono font-semibold text-primary">
                  {simRecurringPct}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={simRecurringPct}
                onChange={e => setSimRecurringPct(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Simulated Top Client Share</span>
                <span className="font-mono font-semibold text-foreground">
                  {simTopClientPct}%
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={65}
                step={5}
                value={simTopClientPct}
                onChange={e => setSimTopClientPct(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Founder Dependency Haircut</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                  -{simFounderDiscount.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.25}
                value={simFounderDiscount}
                onChange={e => setSimFounderDiscount(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>
          </div>

          <div className="rounded-xl border border-foreground/[0.08] bg-muted/30 p-4 text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="size-3.5 text-primary" />
              <span>Valuation Delta vs. Current Baseline</span>
            </div>
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {liveValuation.valuationMid - data.valuation.valuationMid >= 0 ? '+' : ''}
              {fmt(liveValuation.valuationMid - data.valuation.valuationMid)}
            </p>
          </div>
        </aside>
      </div>

      {/* BUYER-READY ADD-BACK LEDGER */}
      <section className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card">
        <div className="flex flex-col gap-2 border-b border-foreground/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Add-Back Ledger (Trailing 12M Approved Expenses)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tag personal, discretionary, or one-time expenses (legal, rebranding, founder travel) to normalize Adjusted EBITDA / SDE.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-primary">
            Total Add-Backs: {fmt(data.metrics.ttmAddBacks)}
          </span>
        </div>

        {data.expenses.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            No approved trailing 12-month operating expenses found to review.
          </p>
        ) : (
          <div className="divide-y divide-foreground/[0.06] text-xs">
            {data.expenses.map(exp => {
              const busy = busyExpenseId === exp.id
              return (
                <div
                  key={exp.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-muted/30 sm:px-6',
                    exp.isAddBack && 'bg-primary/[0.04]'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">
                        {exp.description}
                      </span>
                      {exp.isAddBack ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                          <CheckCircle2 className="size-2.5" /> Add-Back
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {exp.accountName} · {new Date(exp.expenseDate).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {fmt(exp.amountBase)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleToggleAddBack(exp.id, !exp.isAddBack)}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        exp.isAddBack
                          ? 'border-foreground/[0.12] bg-card text-muted-foreground hover:text-foreground'
                          : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                      )}
                    >
                      <Tag className="size-3" />
                      <span>{busy ? '...' : exp.isAddBack ? 'Remove' : 'Tag Add-Back'}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
