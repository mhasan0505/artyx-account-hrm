'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'
import { updateGuardrailConfigAction } from '@/lib/actions/agency-cashflow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type GuardrailsData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-cashflow').getGuardrailsDashboardData>
>

function fmt(val: number): string {
  return `৳${Math.round(val).toLocaleString('en-US')}`
}

export function GuardrailsClient({ data }: { data: GuardrailsData }) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [form, setForm] = React.useState({
    minBillableUtilizationPct: String(data.thresholds.minBillableUtilizationPct),
    maxClientConcentrationPct: String(data.thresholds.maxClientConcentrationPct),
    minProjectGrossMarginPct: String(data.thresholds.minProjectGrossMarginPct),
    minRunwayMonths: String(data.thresholds.minRunwayMonths),
    badDebtOverdueDays: String(data.thresholds.badDebtOverdueDays),
  })

  async function handleSaveThresholds(e: React.FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      await updateGuardrailConfigAction({
        minBillableUtilizationPct: Number(form.minBillableUtilizationPct) || 70,
        maxClientConcentrationPct: Number(form.maxClientConcentrationPct) || 20,
        minProjectGrossMarginPct: Number(form.minProjectGrossMarginPct) || 45,
        minRunwayMonths: Number(form.minRunwayMonths) || 3,
        badDebtOverdueDays: Math.round(Number(form.badDebtOverdueDays) || 90),
      })
      toast.success('Guardrail thresholds updated.')
      setEditing(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save thresholds')
    } finally {
      setSaving(false)
    }
  }

  const { evaluation, details, thresholds } = data

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              MODULE 2 · GUARDRAIL TELEMETRY
            </span>
            <span className="opacity-35">/</span>
            <span>HEALTH SCORE {evaluation.healthScore}/100</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Executive Guardrails &amp; Risk Alerts
          </h1>
          <p className="text-xs text-muted-foreground">
            Automated threshold triggers across Billable Utilization, Client Concentration, Project Margins, Cash Runway, and Aging AR.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/finances/cashflow-runway"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            <span>13-Week Runway</span>
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Link>
          {data.canEditThresholds ? (
            <button
              type="button"
              onClick={() => setEditing(v => !v)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
            >
              <SlidersHorizontal className="size-3.5" />
              <span>{editing ? 'Close Config' : 'Configure Thresholds'}</span>
            </button>
          ) : null}
        </div>
      </header>

      {/* Inline Threshold Config Panel */}
      {editing && data.canEditThresholds ? (
        <form
          onSubmit={handleSaveThresholds}
          className="rounded-2xl border border-foreground/[0.1] bg-card p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Safe-Zone Guardrail Thresholds
            </h2>
            <span className="text-[11px] text-muted-foreground">
              Breaches appear automatically on the Executive Dashboard
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Min Utilization (%)
              </Label>
              <Input
                type="number"
                value={form.minBillableUtilizationPct}
                onChange={e =>
                  setForm(f => ({ ...f, minBillableUtilizationPct: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Max Client Share (%)
              </Label>
              <Input
                type="number"
                value={form.maxClientConcentrationPct}
                onChange={e =>
                  setForm(f => ({ ...f, maxClientConcentrationPct: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Min Project Margin (%)
              </Label>
              <Input
                type="number"
                value={form.minProjectGrossMarginPct}
                onChange={e =>
                  setForm(f => ({ ...f, minProjectGrossMarginPct: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Min Runway (Months)
              </Label>
              <Input
                type="number"
                step="0.5"
                value={form.minRunwayMonths}
                onChange={e =>
                  setForm(f => ({ ...f, minRunwayMonths: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Severe Overdue (Days)
              </Label>
              <Input
                type="number"
                value={form.badDebtOverdueDays}
                onChange={e =>
                  setForm(f => ({ ...f, badDebtOverdueDays: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save Thresholds'}
            </Button>
          </div>
        </form>
      ) : null}

      {/* 5 Guardrail Cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {evaluation.alerts.map(alert => {
          const isCritical = alert.severity === 'CRITICAL'
          const isWarning = alert.severity === 'WARNING'
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className={cn(
                'group flex flex-col justify-between rounded-2xl border bg-card p-5 transition-all hover:bg-muted/30',
                isCritical
                  ? 'border-rose-500/40'
                  : isWarning
                  ? 'border-amber-500/40'
                  : 'border-foreground/[0.08]'
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {alert.label}
                  </span>
                  {isCritical ? (
                    <ShieldAlert className="size-4 text-rose-500 shrink-0" />
                  ) : isWarning ? (
                    <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="size-4 text-primary shrink-0" />
                  )}
                </div>

                <p
                  className={cn(
                    'mt-2.5 font-mono text-2xl font-semibold tracking-tight tabular-nums',
                    isCritical
                      ? 'text-rose-600 dark:text-rose-400'
                      : isWarning
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-foreground'
                  )}
                >
                  {alert.currentDisplay}
                </p>
                <p className="mt-1 text-[11px] font-medium text-foreground/90 leading-snug">
                  {alert.headline}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-foreground/[0.06] pt-2.5 font-mono text-[10px] text-muted-foreground">
                <span>Target {alert.thresholdDisplay}</span>
                <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          )
        })}
      </section>

      {/* Deep-Dive Panels: Client Concentration (7 cols) + Utilization & At-Risk Projects (5 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Client Concentration Breakdown */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Client Revenue Concentration (Trailing 12M AGI)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Safe cap: ≤ {thresholds.maxClientConcentrationPct}% per client · Total AGI {fmt(details.totalTrailingAgi)}
              </p>
            </div>
            <Link
              href="/clients"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Clients →
            </Link>
          </div>

          {details.clientConcentrationRanking.length === 0 ? (
            <p className="mt-8 text-center text-xs text-muted-foreground py-8">
              No invoiced revenue in the trailing 12 months yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3.5">
              {details.clientConcentrationRanking.map((client, idx) => {
                const breached = client.sharePct > thresholds.maxClientConcentrationPct
                return (
                  <div key={client.id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <Link
                        href={`/clients/${client.id}`}
                        className="truncate font-medium text-foreground hover:text-primary"
                      >
                        {client.name}
                      </Link>
                      <div className="flex shrink-0 items-baseline gap-2.5 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">{fmt(client.agi)}</span>
                        <span
                          className={cn(
                            'w-12 text-right font-semibold',
                            breached
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-foreground'
                          )}
                        >
                          {client.sharePct}%
                        </span>
                      </div>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                      <motion.div
                        initial={reduce ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { duration: 0.6, delay: idx * 0.05, ease: EASE.entrance }
                        }
                        style={{
                          width: `${Math.min(100, client.sharePct)}%`,
                          transformOrigin: 'left',
                        }}
                        className={cn(
                          'h-full rounded-full',
                          breached ? 'bg-amber-500' : 'bg-primary'
                        )}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Utilization Telemetry + At-Risk Active Projects */}
        <section className="space-y-6 lg:col-span-5">
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">
              30-Day Delivery Capacity
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {details.billableHeadcount} billable staff · {details.totalCapacityHours}h monthly capacity
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-muted/35 p-3">
                <span className="font-mono text-[10px] uppercase text-muted-foreground block">
                  Billable Logged
                </span>
                <span className="mt-1 block font-mono text-lg font-semibold text-foreground">
                  {details.billableHoursLogged}h
                </span>
              </div>
              <div className="rounded-xl bg-muted/35 p-3">
                <span className="font-mono text-[10px] uppercase text-muted-foreground block">
                  Unbilled / Bench
                </span>
                <span className="mt-1 block font-mono text-lg font-semibold text-foreground">
                  {Math.max(0, Math.round(details.totalCapacityHours - details.billableHoursLogged))}h
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Projects Below {thresholds.minProjectGrossMarginPct}% Margin
              </h2>
              <Link
                href="/finances/project-profitability"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                All Margins →
              </Link>
            </div>
            {details.atRiskProjects.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Zero active projects below your gross margin floor.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-foreground/[0.06]">
                {details.atRiskProjects.map(p => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="flex items-center justify-between py-2.5 text-xs hover:text-primary"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.clientName}</p>
                    </div>
                    <span className="shrink-0 font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {p.marginPct}%
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
