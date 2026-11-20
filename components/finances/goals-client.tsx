'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, Save, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'
import { reverseEngineerAnnualGoal } from '@/lib/finance/goals-engine'
import {
  deletePodTargetAction,
  saveAgencyAnnualGoalAction,
  upsertPodTargetAction,
} from '@/lib/actions/agency-strategy'
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

type GoalsPageData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-strategy').getGoalsAndPodsData>
>

function fmt(val: number): string {
  return `৳${Math.round(val).toLocaleString('en-US')}`
}

function fmtCompact(val: number): string {
  const abs = Math.abs(val)
  if (abs >= 10_000_000) return `৳${(val / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `৳${(val / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `৳${(val / 1_000).toFixed(0)}k`
  return `৳${Math.round(val)}`
}

export function GoalsClient({ data }: { data: GoalsPageData }) {
  const router = useRouter()
  const reduce = useReducedMotion()

  const [form, setForm] = React.useState({
    targetArr: data.goalConfig.targetArr,
    targetProjectRevenue: data.goalConfig.targetProjectRevenue,
    targetEbitdaPct: data.goalConfig.targetEbitdaPct,
    avgProjectSize: data.goalConfig.avgProjectSize,
    avgRetainerMrr: data.goalConfig.avgRetainerMrr,
    targetUtilizationPct: data.goalConfig.targetUtilizationPct,
    avgBillableRate: data.goalConfig.avgBillableRate,
  })
  const [savingGoal, setSavingGoal] = React.useState(false)

  // Pod target dialog state
  const [podOpen, setPodOpen] = React.useState(false)
  const [podServiceLine, setPodServiceLine] = React.useState('')
  const [podDeptId, setPodDeptId] = React.useState<string>('NONE')
  const [podRevenue, setPodRevenue] = React.useState('2500000')
  const [podMargin, setPodMargin] = React.useState('55')
  const [podHeadcount, setPodHeadcount] = React.useState('4')
  const [savingPod, setSavingPod] = React.useState(false)

  // Live 0ms reverse engineering as sliders/inputs change
  const liveCalc = React.useMemo(
    () =>
      reverseEngineerAnnualGoal(
        {
          fiscalYear: data.fiscalYear,
          ...form,
        },
        {
          currentArr: data.actuals.currentArr,
          ytdAgi: data.actuals.ytdAgi,
          currentBillableHeadcount: data.actuals.currentBillableHeadcount,
          dayOfYear: data.actuals.dayOfYear,
        }
      ),
    [form, data.fiscalYear, data.actuals]
  )

  async function handleSaveGoal(e: React.FormEvent) {
    e.preventDefault()
    try {
      setSavingGoal(true)
      await saveAgencyAnnualGoalAction({
        fiscalYear: data.fiscalYear,
        ...form,
      })
      toast.success(`FY ${data.fiscalYear} targets saved.`)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save targets')
    } finally {
      setSavingGoal(false)
    }
  }

  async function handleCreatePod(e: React.FormEvent) {
    e.preventDefault()
    if (podServiceLine.trim().length < 2) {
      toast.error('Enter a pod / service line name')
      return
    }
    try {
      setSavingPod(true)
      await upsertPodTargetAction({
        fiscalYear: data.fiscalYear,
        serviceLine: podServiceLine.trim(),
        departmentId: podDeptId === 'NONE' ? null : podDeptId,
        targetRevenue: Math.max(1, Number(podRevenue) || 0),
        targetGrossMarginPct: Math.min(95, Math.max(10, Number(podMargin) || 55)),
        headcountBudget: Math.max(1, Math.round(Number(podHeadcount) || 3)),
      })
      toast.success('Pod target added.')
      setPodServiceLine('')
      setPodOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add pod target')
    } finally {
      setSavingPod(false)
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
              MODULE 2 · GOAL ARCHITECTURE
            </span>
            <span className="opacity-35">/</span>
            <span>FY {data.fiscalYear}</span>
            <span className="opacity-35">/</span>
            <span>PACING {liveCalc.ytdAttainmentPct}%</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Top-Down Goal Builder &amp; Pod Targets
          </h1>
          <p className="text-xs text-muted-foreground">
            Set annual ARR, Project Revenue, and EBITDA targets to reverse-engineer monthly sales, billable hours, and delivery headcount.
          </p>
        </div>

        <Dialog open={podOpen} onOpenChange={setPodOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
            >
              <Plus className="size-3.5" />
              <span>Add Delivery Pod Target</span>
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">
                Add Department / Pod Target
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreatePod} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pod / Service Line</Label>
                <Input
                  required
                  placeholder="e.g. Custom Software Engineering, AI Retainers"
                  value={podServiceLine}
                  onChange={e => setPodServiceLine(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Link Department (Optional)
                </Label>
                <Select value={podDeptId} onValueChange={setPodDeptId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Match by Service Category</SelectItem>
                    {data.departments.map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Target Rev (৳)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={podRevenue}
                    onChange={e => setPodRevenue(e.target.value)}
                    className="bg-background font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Margin %</Label>
                  <Input
                    type="number"
                    min={10}
                    max={95}
                    value={podMargin}
                    onChange={e => setPodMargin(e.target.value)}
                    className="bg-background font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Headcount</Label>
                  <Input
                    type="number"
                    min={1}
                    value={podHeadcount}
                    onChange={e => setPodHeadcount(e.target.value)}
                    className="bg-background font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setPodOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={savingPod}>
                  {savingPod ? 'Saving...' : 'Add Pod'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {/* REVERSE-ENGINEERED OPERATIONAL OUTPUT STRIP */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Total Annual Target</span>
            <span className="text-primary font-semibold">{form.targetEbitdaPct}% EBITDA</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmtCompact(liveCalc.totalTargetRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Target Profit: <strong className="font-mono text-foreground">{fmtCompact(liveCalc.targetEbitdaAmount)}</strong>
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Required Sales Pace
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmtCompact(liveCalc.requiredMonthlyRevenueRunRate)}/mo
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {liveCalc.requiredProjectsPerMonth} projects/mo · +{liveCalc.requiredNewRetainersTotal} new retainers
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Billable Hours Needed
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {liveCalc.requiredMonthlyBillableHours.toLocaleString()}h/mo
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {liveCalc.requiredAnnualBillableHours.toLocaleString()}h/yr @ {fmt(form.avgBillableRate)}/hr
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Engineering Capacity Gap
          </span>
          <p
            className={cn(
              'mt-2 font-mono text-2xl font-semibold tabular-nums',
              liveCalc.headcountGap > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary'
            )}
          >
            {liveCalc.headcountGap > 0
              ? `Hire +${liveCalc.headcountGap}`
              : liveCalc.headcountGap === 0
              ? 'On Target'
              : `${Math.abs(liveCalc.headcountGap)} Surplus`}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Need {liveCalc.requiredBillableHeadcount} billable devs · Have {data.actuals.currentBillableHeadcount}
          </p>
        </div>
      </section>

      {/* MAIN SPLIT: Interactive Top-Down Builder (5 cols) + Pod Targets Matrix (7 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSaveGoal}
          className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-5 space-y-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Financial Target Levers (FY {data.fiscalYear})
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Adjust targets to recalculate hiring &amp; sales volume live
              </p>
            </div>
            <Button type="submit" size="sm" disabled={savingGoal} className="h-8 gap-1.5 text-xs">
              <Save className="size-3.5" />
              {savingGoal ? 'Saving...' : 'Save Goal'}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Target ARR (৳)</Label>
              <Input
                type="number"
                step={100000}
                value={form.targetArr}
                onChange={e => setForm(f => ({ ...f, targetArr: Number(e.target.value) || 0 }))}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Target Project Rev (৳)</Label>
              <Input
                type="number"
                step={100000}
                value={form.targetProjectRevenue}
                onChange={e =>
                  setForm(f => ({ ...f, targetProjectRevenue: Number(e.target.value) || 0 }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Target EBITDA (%)</Label>
              <Input
                type="number"
                min={0}
                max={80}
                value={form.targetEbitdaPct}
                onChange={e =>
                  setForm(f => ({ ...f, targetEbitdaPct: Number(e.target.value) || 0 }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Target Utilization (%)</Label>
              <Input
                type="number"
                min={30}
                max={100}
                value={form.targetUtilizationPct}
                onChange={e =>
                  setForm(f => ({ ...f, targetUtilizationPct: Number(e.target.value) || 70 }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Avg Project Deal (৳)</Label>
              <Input
                type="number"
                step={25000}
                value={form.avgProjectSize}
                onChange={e =>
                  setForm(f => ({ ...f, avgProjectSize: Number(e.target.value) || 100000 }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Avg Retainer MRR (৳)</Label>
              <Input
                type="number"
                step={10000}
                value={form.avgRetainerMrr}
                onChange={e =>
                  setForm(f => ({ ...f, avgRetainerMrr: Number(e.target.value) || 50000 }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">
                Target Blended Billable Rate (৳ / hour)
              </Label>
              <Input
                type="number"
                step={250}
                value={form.avgBillableRate}
                onChange={e =>
                  setForm(f => ({ ...f, avgBillableRate: Number(e.target.value) || 1500 }))
                }
                className="bg-background font-mono"
              />
            </div>
          </div>

          <div className="rounded-xl border border-foreground/[0.06] bg-muted/30 p-3.5 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Active ARR</span>
              <span className="font-mono font-semibold text-foreground">
                {fmt(data.actuals.currentArr)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">YTD Actual AGI vs Linear Pace</span>
              <span className="font-mono font-semibold text-foreground">
                {fmtCompact(data.actuals.ytdAgi)} / {fmtCompact(liveCalc.ytdTargetPacing)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Implied Annual Cost Ceiling</span>
              <span className="font-mono font-semibold text-foreground">
                {fmtCompact(liveCalc.impliedTotalCostBudget)}
              </span>
            </div>
          </div>
        </form>

        {/* Department / Delivery Pod Targets Matrix */}
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Delivery Pod &amp; Service Line Targets
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Track revenue attainment and gross margin by team pod
              </p>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {data.podScorecards.length} pod(s)
            </span>
          </div>

          {data.podScorecards.length === 0 ? (
            <div className="mt-8 rounded-xl border border-dashed border-foreground/12 p-10 text-center text-xs text-muted-foreground">
              No delivery pod targets defined yet. Add pods like &ldquo;Web Engineering&rdquo;, &ldquo;AI Retainers&rdquo;, or &ldquo;Performance Marketing&rdquo; to spot which teams drive profit.
            </div>
          ) : (
            <div className="mt-5 divide-y divide-foreground/[0.06]">
              {data.podScorecards.map((pod, idx) => {
                const marginOk = pod.actualMarginPct >= pod.targetGrossMarginPct
                return (
                  <div key={pod.id} className="py-4 first:pt-0 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {pod.serviceLine}
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                          {pod.departmentName ? `${pod.departmentName} · ` : ''}
                          {pod.headcountBudget} headcount budget · {pod.projectCount} projects
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right font-mono text-xs tabular-nums">
                          <p className="font-semibold text-foreground">
                            {fmtCompact(pod.actualRevenue)} / {fmtCompact(pod.targetRevenue)}
                          </p>
                          <p
                            className={cn(
                              'text-[10px]',
                              pod.actualRevenue === 0
                                ? 'text-muted-foreground'
                                : marginOk
                                ? 'text-primary'
                                : 'text-amber-600 dark:text-amber-400'
                            )}
                          >
                            Margin {pod.actualMarginPct}% (Target {pod.targetGrossMarginPct}%)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await deletePodTargetAction(pod.id)
                            router.refresh()
                          }}
                          className="cursor-pointer text-muted-foreground/50 hover:text-rose-500"
                          title="Delete pod target"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                        <motion.div
                          initial={reduce ? false : { scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { duration: 0.6, delay: idx * 0.05, ease: EASE.entrance }
                          }
                          style={{
                            width: `${Math.min(100, pod.attainmentPct)}%`,
                            transformOrigin: 'left',
                          }}
                          className="h-full rounded-full bg-primary"
                        />
                      </div>
                      <span className="w-12 text-right font-mono text-[11px] font-semibold text-foreground">
                        {pod.attainmentPct}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
