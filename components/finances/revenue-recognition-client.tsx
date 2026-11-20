'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Lock,
  Unlock,
  Play,
  Plus,
  ArrowUpRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createManualRevenueScheduleAction,
  recognizeSingleRevenueLineAction,
  runDueRevenueRecognitionAction,
  toggleAccountingPeriodLockAction,
} from '@/lib/actions/agency-accounting'

type OverviewData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-accounting').getRevenueRecognitionOverview>
>

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmt(val: number): string {
  return `৳${Math.round(val).toLocaleString('en-US')}`
}

export function RevenueRecognitionClient({ data }: { data: OverviewData }) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [runningDue, setRunningDue] = React.useState(false)
  const [busyLineId, setBusyLineId] = React.useState<string | null>(null)
  const [deferDialogOpen, setDeferDialogOpen] = React.useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState(
    data.deferrableInvoices[0]?.id ?? ''
  )
  const [method, setMethod] = React.useState<'STRAIGHT_LINE_MONTHLY' | 'MILESTONE'>(
    'STRAIGHT_LINE_MONTHLY'
  )
  const [months, setMonths] = React.useState('6')
  const [creatingSchedule, setCreatingSchedule] = React.useState(false)
  const [lockingMonthKey, setLockingMonthKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : true
  const primaryFill = isDark ? '#7FFF00' : '#3E7000'
  const deferredFill = isDark ? 'rgba(232, 237, 228, 0.25)' : 'rgba(13, 20, 10, 0.2)'
  const axisColor = isDark ? '#7D8779' : '#64748B'

  async function handleRunAllDue() {
    try {
      setRunningDue(true)
      const res = await runDueRevenueRecognitionAction()
      if (res.recognizedCount === 0) {
        toast.info('No due scheduled revenue lines to recognize right now.')
      } else {
        toast.success(
          `Recognized ${res.recognizedCount} line(s) totaling ${fmt(res.recognizedTotal)} into Earned Revenue.`
        )
        router.refresh()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to recognize revenue')
    } finally {
      setRunningDue(false)
    }
  }

  async function handleRecognizeLine(lineId: string) {
    try {
      setBusyLineId(lineId)
      await recognizeSingleRevenueLineAction(lineId)
      toast.success('Revenue line recognized & balanced journal posted.')
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to recognize line')
    } finally {
      setBusyLineId(null)
    }
  }

  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedInvoiceId) {
      toast.error('Please select an invoice to defer')
      return
    }
    try {
      setCreatingSchedule(true)
      await createManualRevenueScheduleAction({
        invoiceId: selectedInvoiceId,
        method,
        months: method === 'STRAIGHT_LINE_MONTHLY' ? Math.max(1, Number(months) || 1) : 1,
      })
      toast.success('Deferred revenue schedule created.')
      setDeferDialogOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create schedule')
    } finally {
      setCreatingSchedule(false)
    }
  }

  const recentPeriodChoices = React.useMemo(() => {
    const now = new Date()
    const list: Array<{ year: number; month: number; isLocked: boolean }> = []
    const lockMap = new Map(data.periods.map(p => [`${p.year}-${p.month}`, p.isLocked]))
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      list.push({
        year: y,
        month: m,
        isLocked: lockMap.get(`${y}-${m}`) ?? false,
      })
    }
    return list
  }, [data.periods])

  async function handleToggleLock(year: number, month: number, nextLock: boolean) {
    const key = `${year}-${month}`
    try {
      setLockingMonthKey(key)
      await toggleAccountingPeriodLockAction({ year, month, lock: nextLock })
      toast.success(
        `${MONTH_LABELS[month - 1]} ${year} ${nextLock ? 'locked' : 'unlocked'}.`
      )
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update period lock')
    } finally {
      setLockingMonthKey(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              MODULE 1 · LEDGER ENGINE
            </span>
            <span className="opacity-35">/</span>
            <span>REVENUE RECOGNITION &amp; PERIOD LOCKS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Deferred Revenue &amp; WIP Schedule
          </h1>
          <p className="text-xs text-muted-foreground">
            Move upfront project deposits and prepaid retainers from Deferred Liability into Earned Revenue as milestones complete or months pass.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={deferDialogOpen} onOpenChange={setDeferDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                disabled={data.deferrableInvoices.length === 0}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-45"
              >
                <Plus className="size-3.5" />
                <span>Defer Invoice</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  Create Deferred Revenue Schedule
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateSchedule} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Invoice</Label>
                  <Select value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Choose an invoice..." />
                    </SelectTrigger>
                    <SelectContent>
                      {data.deferrableInvoices.map(inv => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} · {inv.clientName} ({fmt(inv.amountBase)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Recognition Method</Label>
                  <Select
                    value={method}
                    onValueChange={v =>
                      setMethod(v as 'STRAIGHT_LINE_MONTHLY' | 'MILESTONE')
                    }
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRAIGHT_LINE_MONTHLY">
                        Straight-Line Monthly (Retainer / Annual Prepaid)
                      </SelectItem>
                      <SelectItem value="MILESTONE">
                        Milestone Approval (Upfront Project Deposit)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {method === 'STRAIGHT_LINE_MONTHLY' ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Amortization Term (Months)
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={36}
                      value={months}
                      onChange={e => setMonths(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDeferDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creatingSchedule}>
                    {creatingSchedule ? 'Creating...' : 'Create Schedule'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <button
            type="button"
            disabled={runningDue || data.summary.dueToRecognizeCount === 0}
            onClick={handleRunAllDue}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs transition-all hover:brightness-105 disabled:opacity-45"
          >
            <Play className="size-3.5" />
            <span>
              {runningDue
                ? 'Posting Journals...'
                : `Recognize Due (${data.summary.dueToRecognizeCount})`}
            </span>
          </button>
        </div>
      </header>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Deferred Revenue Liability
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmt(data.summary.totalDeferredLiability)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Unearned balance on books</p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Ready to Recognize Now
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-primary">
            {fmt(data.summary.dueToRecognizeAmount)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.summary.dueToRecognizeCount} scheduled line(s) eligible
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Recognized Earned Revenue
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmt(data.summary.totalRecognizedToDate)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Posted via double-entry journals</p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Unbilled Revenue (WIP)
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {fmt(data.summary.unbilledWipTotal)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.summary.unbilledMilestonesCount} completed unbilled milestone(s)
          </p>
        </div>
      </section>

      {/* Waterfall Chart + Period Locks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Recognition Waterfall
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Recognized Earned vs. Scheduled Deferred Revenue by month
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" /> Recognized
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-foreground/25" /> Scheduled
              </span>
            </div>
          </div>

          <div className="mt-5 h-[220px] w-full">
            {data.waterfall.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-foreground/10 text-xs text-muted-foreground">
                No deferred revenue schedules active yet. Defer an upfront deposit or prepaid retainer invoice to see the waterfall.
              </div>
            ) : mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.waterfall} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="rgba(148,163,184,0.12)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: axisColor, fontSize: 11, fontFamily: 'var(--font-geist-mono)' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: axisColor, fontSize: 10, fontFamily: 'var(--font-geist-mono)' }}
                    tickFormatter={v => `৳${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(val: unknown) => fmt(Number(val) || 0)}
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="recognized" name="Recognized" stackId="a" fill={primaryFill} radius={[0, 0, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="scheduled" name="Scheduled Deferred" stackId="a" fill={deferredFill} radius={[5, 5, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </section>

        {/* Accounting Period Locks */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Accounting Period Locks
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lock closed months to block retroactive journal edits
            </p>
          </div>

          <div className="mt-4 divide-y divide-foreground/[0.06]">
            {recentPeriodChoices.map(p => {
              const key = `${p.year}-${p.month}`
              const busy = lockingMonthKey === key
              return (
                <div key={key} className="flex items-center justify-between py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    {p.isLocked ? (
                      <Lock className="size-3.5 text-amber-500" />
                    ) : (
                      <Unlock className="size-3.5 text-muted-foreground/60" />
                    )}
                    <span className="font-mono font-medium text-foreground">
                      {MONTH_LABELS[p.month - 1]} {p.year}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleToggleLock(p.year, p.month, !p.isLocked)}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      p.isLocked
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-foreground/[0.1] bg-muted/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {busy ? '...' : p.isLocked ? 'Unlock' : 'Close Period'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* Schedules + Unbilled WIP */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Active Schedules */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7">
          <h2 className="text-sm font-semibold text-foreground">
            Deferred Revenue Schedules ({data.schedules.length})
          </h2>

          {data.schedules.length === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground py-8">
              No deferred revenue schedules created yet.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-foreground/[0.06]">
              {data.schedules.map(sch => (
                <div key={sch.id} className="py-4 first:pt-0 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/invoices/${sch.invoiceId}`}
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                        >
                          {sch.invoiceNumber}
                        </Link>
                        <span className="text-xs font-medium text-foreground">
                          {sch.clientName}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {sch.recognitionMethod.replace(/_/g, ' ')}
                        {sch.projectName ? ` · ${sch.projectName}` : ''}
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <p className="font-semibold text-foreground">
                        {fmt(sch.remainingDeferred)} remaining
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {fmt(sch.totalRecognized)} / {fmt(sch.totalDeferred)} earned
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 pl-3 border-l border-foreground/[0.08]">
                    {sch.lines.map(line => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between py-1 text-[11px]"
                      >
                        <span className="font-mono text-muted-foreground">
                          {MONTH_LABELS[line.periodMonth - 1]} {line.periodYear}
                          {line.milestoneTitle ? ` · ${line.milestoneTitle}` : ''}
                          {line.journalEntryNumber ? ` (${line.journalEntryNumber})` : ''}
                        </span>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-semibold tabular-nums text-foreground">
                            {fmt(line.amount)}
                          </span>
                          {line.status === 'RECOGNIZED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" /> Earned
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busyLineId === line.id}
                              onClick={() => handleRecognizeLine(line.id)}
                              className="cursor-pointer rounded-md border border-foreground/[0.12] px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/60"
                            >
                              {busyLineId === line.id ? '...' : 'Recognize'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Unbilled WIP & Recent Posted Journals */}
        <section className="space-y-6 lg:col-span-5">
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">
              Unbilled Completed Milestones (WIP)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Earned project work ready to invoice
            </p>

            {data.unbilledMilestones.length === 0 ? (
              <p className="mt-5 text-xs text-muted-foreground py-4">
                All completed milestones have been billed.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-foreground/[0.06]">
                {data.unbilledMilestones.map(m => (
                  <Link
                    key={m.id}
                    href={`/projects/${m.projectId}`}
                    className="group flex items-center justify-between py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground group-hover:text-primary">
                        {m.title}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {m.projectName} · {m.clientName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono font-semibold text-amber-600 dark:text-amber-400">
                      <span>{fmt(m.billableAmount)}</span>
                      <ArrowUpRight className="size-3" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Posted Double-Entry Journals
            </h2>
            {data.recentJournals.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No double-entry journals posted yet.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-foreground/[0.06]">
                {data.recentJournals.slice(0, 6).map(j => (
                  <div key={j.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-semibold text-foreground">
                        {j.entryNumber}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {j.description}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">
                      {fmt(j.totalDebit)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
