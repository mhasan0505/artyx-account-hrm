'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  build13WeekCashFlow,
  computeRunwayClock,
  DEFAULT_CASHFLOW_ASSUMPTIONS,
  type CashFlowAssumptions,
} from '@/lib/finance/cashflow-engine'
import {
  createRecurringCommitmentAction,
  deleteCashFlowScenarioAction,
  deleteRecurringCommitmentAction,
  saveCashFlowScenarioAction,
  toggleRecurringCommitmentAction,
} from '@/lib/actions/agency-cashflow'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type CashFlowPageData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-cashflow').getCashFlowRunwayData>
>

function fmt(val: number, showSign = false): string {
  const abs = Math.abs(Math.round(val)).toLocaleString('en-US')
  if (val < 0) return `-৳${abs}`
  if (showSign && val > 0) return `+৳${abs}`
  return `৳${abs}`
}

function fmtCompact(val: number): string {
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}৳${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}৳${(abs / 1_000).toFixed(0)}k`
  return `${sign}৳${Math.round(abs)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'No Zero-Cash Date'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function CashFlowRunwayClient({ data }: { data: CashFlowPageData }) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [assumptions, setAssumptions] = React.useState<CashFlowAssumptions>(
    DEFAULT_CASHFLOW_ASSUMPTIONS
  )
  const [expandedWeek, setExpandedWeek] = React.useState<number | null>(1)
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false)
  const [scenarioName, setScenarioName] = React.useState('')
  const [savingScenario, setSavingScenario] = React.useState(false)

  // Recurring commitment dialog state
  const [comDialogOpen, setComDialogOpen] = React.useState(false)
  const [comName, setComName] = React.useState('')
  const [comCategory, setComCategory] = React.useState<
    'RENT' | 'SAAS' | 'TAX_VAT' | 'OWNER_DRAWING' | 'DEBT_SERVICE' | 'MARKETING' | 'OTHER'
  >('SAAS')
  const [comAmount, setComAmount] = React.useState('')
  const [comFrequency, setComFrequency] = React.useState<'WEEKLY' | 'MONTHLY' | 'QUARTERLY'>('MONTHLY')
  const [comDueDay, setComDueDay] = React.useState('1')
  const [savingCom, setSavingCom] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : true

  const isWhatIfActive = React.useMemo(() => {
    return (
      assumptions.additionalHiresCount !== 0 ||
      assumptions.retainerMrrDelta !== 0 ||
      assumptions.monthlyAdSpendDelta !== 0 ||
      assumptions.arDelayWeeks !== 0 ||
      assumptions.oneTimeCashDelta !== 0
    )
  }, [assumptions])

  // Live 0ms client-side simulation using the exact same pure engine
  const simulated13Week = React.useMemo(
    () => build13WeekCashFlow(data.modelInput, assumptions),
    [data.modelInput, assumptions]
  )

  const simulatedRunway = React.useMemo(() => {
    const hireMonthlyDelta =
      assumptions.additionalHiresCount * assumptions.additionalHireMonthlySalary
    const newBurn = Math.max(
      0,
      data.grossMonthlyBurn + hireMonthlyDelta + assumptions.monthlyAdSpendDelta
    )
    const newRetainer = Math.max(
      0,
      data.retainerMonthlyTotal + assumptions.retainerMrrDelta
    )
    const newAvgInflow = Math.max(
      0,
      data.avgMonthlyInflow + assumptions.retainerMrrDelta
    )
    return computeRunwayClock({
      startingCash: Math.max(0, data.modelInput.startingCash + assumptions.oneTimeCashDelta),
      avgMonthlyInflow: newAvgInflow,
      retainerOnlyMonthlyInflow: newRetainer,
      grossMonthlyBurn: newBurn,
    })
  }, [data, assumptions])

  const chartData = React.useMemo(() => {
    return data.baseline13Week.weeks.map((baseWeek, idx) => {
      const simWeek = simulated13Week.weeks[idx]
      return {
        label: baseWeek.label,
        dateRange: baseWeek.dateRangeLabel,
        baselineBalance: baseWeek.closingBalance,
        simulatedBalance: simWeek.closingBalance,
        inflows: simWeek.inflows,
        outflows: simWeek.outflows,
      }
    })
  }, [data.baseline13Week.weeks, simulated13Week.weeks])

  async function handleSaveScenario(e: React.FormEvent) {
    e.preventDefault()
    if (scenarioName.trim().length < 2) {
      toast.error('Enter a scenario name')
      return
    }
    try {
      setSavingScenario(true)
      await saveCashFlowScenarioAction({
        name: scenarioName,
        assumptions,
      })
      toast.success(`Scenario "${scenarioName.trim()}" saved.`)
      setScenarioName('')
      setSaveDialogOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save scenario')
    } finally {
      setSavingScenario(false)
    }
  }

  async function handleCreateCommitment(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(comAmount)
    if (!comName.trim() || !(amt > 0)) {
      toast.error('Enter commitment name and amount > 0')
      return
    }
    try {
      setSavingCom(true)
      await createRecurringCommitmentAction({
        name: comName.trim(),
        category: comCategory,
        amount: amt,
        frequency: comFrequency,
        dueDay: Math.min(28, Math.max(1, Number(comDueDay) || 1)),
      })
      toast.success('Recurring commitment added to 13-week model.')
      setComName('')
      setComAmount('')
      setComDialogOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add commitment')
    } finally {
      setSavingCom(false)
    }
  }

  const primaryStroke = isDark ? '#7FFF00' : '#3E7000'
  const baselineStroke = isDark ? 'rgba(232, 237, 228, 0.35)' : 'rgba(13, 20, 10, 0.32)'
  const inflowFill = isDark ? 'rgba(127, 255, 0, 0.22)' : 'rgba(62, 112, 0, 0.22)'
  const outflowFill = isDark ? 'rgba(251, 113, 133, 0.26)' : 'rgba(225, 29, 72, 0.22)'
  const axisColor = isDark ? '#7D8779' : '#64748B'

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              MODULE 3 · CASH &amp; RUNWAY
            </span>
            <span className="opacity-35">/</span>
            <span>AVG DSO {data.agencyAvgDsoDays}D</span>
            <span className="opacity-35">/</span>
            <span>90-DAY HORIZON</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            13-Week Cash Flow &amp; Runway Clock
          </h1>
          <p className="text-xs text-muted-foreground">
            Live DSO-adjusted AR collections, active retainers, scheduled milestones, payroll, and interactive What-If stress testing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={comDialogOpen} onOpenChange={setComDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
              >
                <Plus className="size-3.5" />
                <span>Fixed Outflow</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  Add Recurring Cash Commitment
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateCommitment} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Input
                    required
                    placeholder="e.g. Office Rent, AWS Cloud, Quarterly Tax"
                    value={comName}
                    onChange={e => setComName(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Category</Label>
                    <Select
                      value={comCategory}
                      onValueChange={v => setComCategory(v as typeof comCategory)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RENT">Office Rent</SelectItem>
                        <SelectItem value="SAAS">SaaS &amp; Cloud</SelectItem>
                        <SelectItem value="TAX_VAT">Tax / VAT / TDS</SelectItem>
                        <SelectItem value="OWNER_DRAWING">Owner Drawing</SelectItem>
                        <SelectItem value="MARKETING">Marketing / Ads</SelectItem>
                        <SelectItem value="DEBT_SERVICE">Debt Service</SelectItem>
                        <SelectItem value="OTHER">Other Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount (৳)</Label>
                    <Input
                      required
                      type="number"
                      min={1}
                      placeholder="45000"
                      value={comAmount}
                      onChange={e => setComAmount(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Frequency</Label>
                    <Select
                      value={comFrequency}
                      onValueChange={v => setComFrequency(v as typeof comFrequency)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">Monthly</SelectItem>
                        <SelectItem value="WEEKLY">Weekly</SelectItem>
                        <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Due Day (1–28)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={comDueDay}
                      onChange={e => setComDueDay(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setComDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingCom}>
                    {savingCom ? 'Adding...' : 'Add Commitment'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {isWhatIfActive ? (
            <>
              <button
                type="button"
                onClick={() => setAssumptions(DEFAULT_CASHFLOW_ASSUMPTIONS)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                <span>Reset Sandbox</span>
              </button>
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
                  >
                    <Bookmark className="size-3.5" />
                    <span>Save Scenario</span>
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-sm bg-card border-border">
                  <DialogHeader>
                    <DialogTitle className="text-base font-semibold">
                      Save What-If Scenario
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSaveScenario} className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Scenario Title</Label>
                      <Input
                        required
                        placeholder="e.g. Hire 2 Senior Devs + Q2 Growth"
                        value={scenarioName}
                        onChange={e => setScenarioName(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={savingScenario}>
                        {savingScenario ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
        </div>
      </header>

      {/* RUNWAY CLOCK HERO STRIP */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Starting Liquidity
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmt(simulatedRunway.startingCash)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gross monthly burn: <strong className="font-mono text-foreground">{fmt(simulatedRunway.grossMonthlyBurn)}</strong>
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Current Burn Runway</span>
            {isWhatIfActive ? <span className="text-primary">Simulated</span> : null}
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-primary">
            {simulatedRunway.isCurrentCashFlowPositive
              ? 'Cash-Positive'
              : `${simulatedRunway.currentRunwayMonths} mo`}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {simulatedRunway.isCurrentCashFlowPositive
              ? 'Inflows exceed monthly burn'
              : `Zero-cash: ${formatDate(simulatedRunway.currentZeroCashDate)}`}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Worst-Case Runway (0 New Sales)
          </span>
          <p
            className={cn(
              'mt-2 font-mono text-2xl font-semibold tabular-nums',
              simulatedRunway.isRetainerCovered ||
                (simulatedRunway.worstCaseRunwayMonths ?? 99) >= 4
                ? 'text-foreground'
                : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {simulatedRunway.isRetainerCovered
              ? 'Retainer Covered'
              : `${simulatedRunway.worstCaseRunwayMonths} mo`}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {simulatedRunway.isRetainerCovered
              ? `Retainers cover ${simulatedRunway.retainerCoveragePct}% of burn`
              : `Zero-cash: ${formatDate(simulatedRunway.worstCaseZeroCashDate)}`}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            13-Week Ending Cash
          </span>
          <p
            className={cn(
              'mt-2 font-mono text-2xl font-semibold tabular-nums',
              simulated13Week.endingCash < 0 ? 'text-rose-500' : 'text-foreground'
            )}
          >
            {fmt(simulated13Week.endingCash)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Trough: <strong className="font-mono text-foreground">{fmt(simulated13Week.lowestCashBalance)}</strong> (W{simulated13Week.lowestCashWeek})
          </p>
        </div>
      </section>

      {/* Negative Cash Warning Banner (if triggered) */}
      {simulated13Week.firstNegativeWeek !== null ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <strong>Cash Crunch Alert:</strong> Projected bank balance drops below ৳0 in{' '}
            <strong className="font-mono">Week {simulated13Week.firstNegativeWeek}</strong> (lowest point{' '}
            <strong className="font-mono">{fmt(simulated13Week.lowestCashBalance)}</strong>). Accelerate AR collections or defer outflows.
          </span>
        </div>
      ) : null}

      {/* MAIN SPLIT: 13-Week Chart (8 cols) + Live What-If Sandbox (4 cols) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 xl:col-span-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                13-Week Projected Bank Balance
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Weekly cash inflows/outflows with ending balance curve
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" />
                {isWhatIfActive ? 'Simulated Balance' : 'Projected Balance'}
              </span>
              {isWhatIfActive ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 bg-foreground/40" /> Baseline
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-xs bg-rose-500/40" /> Outflows
              </span>
            </div>
          </div>

          <div className="mt-5 h-[310px] w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
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
                    tickFormatter={fmtCompact}
                  />
                  <ReferenceLine y={0} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const row = payload[0]?.payload as (typeof chartData)[number]
                      return (
                        <div className="min-w-52 rounded-xl border border-foreground/[0.1] bg-popover/95 p-3 text-xs shadow-xl backdrop-blur-md">
                          <p className="font-mono font-semibold text-foreground border-b border-foreground/[0.08] pb-1.5 mb-2">
                            {row.label} · {row.dateRange}
                          </p>
                          <div className="space-y-1 font-mono text-[11px] tabular-nums">
                            <div className="flex justify-between gap-4">
                              <span className="font-sans text-muted-foreground">Inflows</span>
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {fmt(row.inflows, true)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="font-sans text-muted-foreground">Outflows</span>
                              <span className="text-rose-600 dark:text-rose-400">
                                -{fmt(row.outflows)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-foreground/[0.08] pt-1.5">
                              <span className="font-sans font-medium text-foreground">
                                {isWhatIfActive ? 'Simulated Cash' : 'Ending Cash'}
                              </span>
                              <span className="font-bold text-primary">
                                {fmt(row.simulatedBalance)}
                              </span>
                            </div>
                            {isWhatIfActive ? (
                              <div className="flex justify-between gap-4 text-muted-foreground">
                                <span className="font-sans">Baseline Cash</span>
                                <span>{fmt(row.baselineBalance)}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="inflows" fill={inflowFill} radius={[4, 4, 0, 0]} maxBarSize={14} />
                  <Bar dataKey="outflows" fill={outflowFill} radius={[4, 4, 0, 0]} maxBarSize={14} />
                  {isWhatIfActive ? (
                    <Line
                      type="monotone"
                      dataKey="baselineBalance"
                      stroke={baselineStroke}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="simulatedBalance"
                    stroke={primaryStroke}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: primaryStroke, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: primaryStroke }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </section>

        {/* INTERACTIVE WHAT-IF SANDBOX */}
        <aside className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 xl:col-span-4 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              &ldquo;What-If&rdquo; Stress Sandbox
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Test hires, churn, or late payments before committing
            </p>
          </div>

          <div className="space-y-4 text-xs">
            {/* Lever 1: Hire / Cut Developers */}
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Headcount Change</span>
                <span className="font-mono font-semibold text-primary">
                  {assumptions.additionalHiresCount > 0 ? '+' : ''}
                  {assumptions.additionalHiresCount} dev(s)
                </span>
              </div>
              <input
                type="range"
                min={-3}
                max={6}
                step={1}
                value={assumptions.additionalHiresCount}
                onChange={e =>
                  setAssumptions(a => ({
                    ...a,
                    additionalHiresCount: Number(e.target.value),
                  }))
                }
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Avg monthly salary (৳)</span>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={assumptions.additionalHireMonthlySalary}
                  onChange={e =>
                    setAssumptions(a => ({
                      ...a,
                      additionalHireMonthlySalary: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-24 rounded-lg border border-foreground/[0.12] bg-background px-2 py-1 text-right font-mono text-xs text-foreground"
                />
              </div>
            </div>

            {/* Lever 2: Retainer Win / Loss */}
            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Retainer MRR Delta</span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    assumptions.retainerMrrDelta < 0
                      ? 'text-rose-500'
                      : assumptions.retainerMrrDelta > 0
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  {fmt(assumptions.retainerMrrDelta, true)}/mo
                </span>
              </div>
              <input
                type="range"
                min={-500000}
                max={500000}
                step={25000}
                value={assumptions.retainerMrrDelta}
                onChange={e =>
                  setAssumptions(a => ({
                    ...a,
                    retainerMrrDelta: Number(e.target.value),
                  }))
                }
                className="w-full accent-primary cursor-pointer"
              />
              {data.modelInput.activeRetainers.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const top = data.modelInput.activeRetainers[0]
                    setAssumptions(a => ({
                      ...a,
                      retainerMrrDelta: -top.monthlyFee,
                    }))
                  }}
                  className="cursor-pointer text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  Simulate losing largest retainer ({data.modelInput.activeRetainers[0].clientName}: -{fmt(data.modelInput.activeRetainers[0].monthlyFee)})
                </button>
              ) : null}
            </div>

            {/* Lever 3: AR Payment Delay */}
            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Client Payment Delay</span>
                <span className="font-mono font-semibold text-foreground">
                  +{assumptions.arDelayWeeks} week(s)
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={8}
                step={1}
                value={assumptions.arDelayWeeks}
                onChange={e =>
                  setAssumptions(a => ({
                    ...a,
                    arDelayWeeks: Number(e.target.value),
                  }))
                }
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            {/* Lever 4: Ad Spend Change */}
            <div className="space-y-1.5 border-t border-foreground/[0.06] pt-3.5">
              <div className="flex justify-between">
                <span className="font-medium text-foreground">Monthly Ad Spend Delta</span>
                <span className="font-mono font-semibold text-foreground">
                  {fmt(assumptions.monthlyAdSpendDelta, true)}/mo
                </span>
              </div>
              <input
                type="range"
                min={-150000}
                max={300000}
                step={10000}
                value={assumptions.monthlyAdSpendDelta}
                onChange={e =>
                  setAssumptions(a => ({
                    ...a,
                    monthlyAdSpendDelta: Number(e.target.value),
                  }))
                }
                className="w-full accent-primary cursor-pointer"
              />
            </div>
          </div>

          {/* Saved Scenarios Quick Loader */}
          {data.savedScenarios.length > 0 ? (
            <div className="border-t border-foreground/[0.08] pt-4 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Saved Scenarios
              </p>
              <div className="space-y-1.5">
                {data.savedScenarios.slice(0, 4).map(sc => (
                  <div
                    key={sc.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-foreground/[0.06] bg-muted/30 px-2.5 py-1.5 text-[11px]"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAssumptions(sc.assumptions)
                        toast.info(`Loaded "${sc.name}"`)
                      }}
                      className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium text-foreground hover:text-primary"
                    >
                      {sc.name}
                    </button>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {fmtCompact(sc.projectedEndingCash)}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteCashFlowScenarioAction(sc.id)
                        router.refresh()
                      }}
                      className="cursor-pointer text-muted-foreground/60 hover:text-rose-500"
                      title="Delete scenario"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* BOTTOM SPLIT: Expandable 13-Week Ledger (8 cols) + Recurring Commitments (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card lg:col-span-8">
          <div className="border-b border-foreground/[0.06] px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-foreground">
              Weekly Cash Schedule (W1 – W13)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click any week to inspect itemized AR collections, retainers, payroll &amp; outflows
            </p>
          </div>

          <div className="divide-y divide-foreground/[0.06] text-xs">
            {simulated13Week.weeks.map(week => {
              const isOpen = expandedWeek === week.weekNumber
              return (
                <div key={week.weekNumber}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedWeek(isOpen ? null : week.weekNumber)
                    }
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-muted/35 sm:px-6"
                  >
                    <div className="flex items-center gap-2.5">
                      {isOpen ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="font-mono font-semibold text-foreground w-8">
                        {week.label}
                      </span>
                      <span className="text-muted-foreground">{week.dateRangeLabel}</span>
                      <span className="hidden rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                        {week.events.length} items
                      </span>
                    </div>

                    <div className="flex items-center gap-4 font-mono tabular-nums">
                      <span className="hidden text-emerald-600 dark:text-emerald-400 sm:inline">
                        +{fmtCompact(week.inflows)}
                      </span>
                      <span className="hidden text-rose-600 dark:text-rose-400 sm:inline">
                        -{fmtCompact(week.outflows)}
                      </span>
                      <span
                        className={cn(
                          'w-24 text-right font-semibold',
                          week.closingBalance < 0 ? 'text-rose-500' : 'text-foreground'
                        )}
                      >
                        {fmt(week.closingBalance)}
                      </span>
                    </div>
                  </button>

                  {isOpen ? (
                    <div className="border-t border-foreground/[0.05] bg-muted/20 px-6 py-3 space-y-1.5">
                      {week.events.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No scheduled inflows or outflows in this week.
                        </p>
                      ) : (
                        week.events.map(ev => (
                          <div
                            key={ev.id}
                            className="flex items-center justify-between gap-3 text-[11px]"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  'size-1.5 shrink-0 rounded-full',
                                  ev.direction === 'INFLOW' ? 'bg-primary' : 'bg-rose-500'
                                )}
                              />
                              <span className="truncate text-foreground">{ev.label}</span>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 font-mono font-semibold tabular-nums',
                                ev.direction === 'INFLOW'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              )}
                            >
                              {ev.direction === 'INFLOW' ? '+' : '-'}
                              {fmt(ev.amount)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>

        {/* Recurring Fixed Commitments */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Recurring Outflows
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rent, SaaS, taxes &amp; scheduled drawings
              </p>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {data.commitments.filter(c => c.isActive).length} active
            </span>
          </div>

          {data.commitments.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-foreground/12 p-6 text-center text-xs text-muted-foreground">
              Add fixed monthly commitments (office rent, AWS/Vercel, tax remittances, owner drawings) for accurate 13-week projections.
            </div>
          ) : (
            <div className="mt-4 divide-y divide-foreground/[0.06]">
              {data.commitments.map(c => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center justify-between gap-3 py-3 text-xs',
                    !c.isActive && 'opacity-45'
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{c.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {c.category.replace(/_/g, ' ')} · {c.frequency} · Day {c.dueDay}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {fmt(c.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await toggleRecurringCommitmentAction(c.id, !c.isActive)
                        router.refresh()
                      }}
                      className="cursor-pointer rounded border border-foreground/[0.1] px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {c.isActive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteRecurringCommitmentAction(c.id)
                        router.refresh()
                      }}
                      className="cursor-pointer text-muted-foreground/60 hover:text-rose-500"
                      title="Delete commitment"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
