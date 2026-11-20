'use client'

import * as React from 'react'
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
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  createOpportunityAction,
  deleteOpportunityAction,
  logRetainerEventAction,
  updateOpportunityStageAction,
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

type GrowthPageData = Awaited<
  ReturnType<typeof import('@/lib/actions/agency-strategy').getGrowthAnalyticsData>
>

function fmt(val: number): string {
  return `৳${Math.round(val).toLocaleString('en-US')}`
}

function fmtCompact(val: number): string {
  const abs = Math.abs(val)
  if (abs >= 1_000_000) return `৳${(val / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `৳${(val / 1_000).toFixed(0)}k`
  return `৳${Math.round(val)}`
}

export function GrowthClient({ data }: { data: GrowthPageData }) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [horizon, setHorizon] = React.useState<3 | 6 | 12>(12)

  // New Opportunity modal state
  const [oppOpen, setOppOpen] = React.useState(false)
  const [oppTitle, setOppTitle] = React.useState('')
  const [oppProspect, setOppProspect] = React.useState('')
  const [oppDealType, setOppDealType] = React.useState<'PROJECT' | 'RETAINER' | 'HYBRID'>('PROJECT')
  const [oppValue, setOppValue] = React.useState('350000')
  const [oppMonthly, setOppMonthly] = React.useState('0')
  const [oppProb, setOppProb] = React.useState('40')
  const [oppCloseDate, setOppCloseDate] = React.useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  )
  const [oppChannel, setOppChannel] = React.useState('LinkedIn Outbound')
  const [savingOpp, setSavingOpp] = React.useState(false)

  // Log Retainer Event modal state
  const [evOpen, setEvOpen] = React.useState(false)
  const [evRetainerId, setEvRetainerId] = React.useState(
    data.activeRetainers[0]?.id ?? ''
  )
  const [evType, setEvType] = React.useState<
    'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURN' | 'REACTIVATION'
  >('EXPANSION')
  const [evDelta, setEvDelta] = React.useState('25000')
  const [evNotes, setEvNotes] = React.useState('')
  const [savingEv, setSavingEv] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : true
  const chartSlice = data.pipelineForecast.months.slice(0, horizon)
  const axisColor = isDark ? '#7D8779' : '#64748B'
  const committedFill = isDark ? '#E8EDE4' : '#0D140A'
  const weightedRetFill = isDark ? '#7FFF00' : '#3E7000'
  const weightedProjFill = isDark ? 'rgba(127, 255, 0, 0.35)' : 'rgba(62, 112, 0, 0.35)'

  async function handleCreateOpp(e: React.FormEvent) {
    e.preventDefault()
    if (!oppTitle.trim() || !oppProspect.trim()) {
      toast.error('Enter deal title and prospect name')
      return
    }
    try {
      setSavingOpp(true)
      await createOpportunityAction({
        title: oppTitle.trim(),
        prospectName: oppProspect.trim(),
        dealType: oppDealType,
        estimatedValue: Number(oppValue) || 0,
        monthlyValue: oppDealType === 'PROJECT' ? 0 : Number(oppMonthly) || 0,
        winProbabilityPct: Math.min(100, Math.max(5, Number(oppProb) || 35)),
        expectedCloseDate: oppCloseDate,
        stage: 'PROPOSAL',
        acquisitionChannel: oppChannel,
      })
      toast.success('Pipeline opportunity added.')
      setOppTitle('')
      setOppProspect('')
      setOppOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create opportunity')
    } finally {
      setSavingOpp(false)
    }
  }

  async function handleLogEvent(e: React.FormEvent) {
    e.preventDefault()
    if (!evRetainerId) {
      toast.error('Select a retainer first')
      return
    }
    try {
      setSavingEv(true)
      await logRetainerEventAction({
        retainerId: evRetainerId,
        eventType: evType,
        mrrDelta: Math.max(1, Number(evDelta) || 0),
        notes: evNotes,
      })
      toast.success('Retainer cohort event logged.')
      setEvNotes('')
      setEvOpen(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to log event')
    } finally {
      setSavingEv(false)
    }
  }

  const { pipelineForecast, retention, channelRoi } = data

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" />
              MODULE 4 · GROWTH &amp; COHORTS
            </span>
            <span className="opacity-35">/</span>
            <span>NDR {retention.ndrPct}%</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Hybrid Pipeline, Retention &amp; Channel ROI
          </h1>
          <p className="text-xs text-muted-foreground">
            Weighted sales forecast (3 / 6 / 12M), subscription NDR &amp; churn telemetry, and Paid vs. Blended CAC payback.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={evOpen} onOpenChange={setEvOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                disabled={data.activeRetainers.length === 0}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-45"
              >
                <Plus className="size-3.5" />
                <span>Log MRR Event</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  Log Retainer Expansion / Churn Event
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleLogEvent} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Retainer</Label>
                  <Select value={evRetainerId} onValueChange={setEvRetainerId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Choose retainer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {data.activeRetainers.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.clientName} — {r.serviceName} ({fmt(r.monthlyFee)}/mo)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Event Type</Label>
                    <Select
                      value={evType}
                      onValueChange={v => setEvType(v as typeof evType)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EXPANSION">Expansion (+MRR)</SelectItem>
                        <SelectItem value="NEW">New Retainer (+MRR)</SelectItem>
                        <SelectItem value="CONTRACTION">Contraction (-MRR)</SelectItem>
                        <SelectItem value="CHURN">Churned (-MRR)</SelectItem>
                        <SelectItem value="REACTIVATION">Reactivation (+MRR)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">MRR Amount (৳)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={evDelta}
                      onChange={e => setEvDelta(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <Input
                    placeholder="e.g. Added AI automation scope"
                    value={evNotes}
                    onChange={e => setEvNotes(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEvOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingEv}>
                    {savingEv ? 'Logging...' : 'Log Event'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={oppOpen} onOpenChange={setOppOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
              >
                <Plus className="size-3.5" />
                <span>Add Opportunity</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  New Pipeline Opportunity
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateOpp} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Deal Title</Label>
                  <Input
                    required
                    placeholder="e.g. Custom ERP & Mobile App Build"
                    value={oppTitle}
                    onChange={e => setOppTitle(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Prospect / Client</Label>
                    <Input
                      required
                      placeholder="e.g. Horizon FinTech"
                      value={oppProspect}
                      onChange={e => setOppProspect(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Deal Type</Label>
                    <Select
                      value={oppDealType}
                      onValueChange={v => setOppDealType(v as typeof oppDealType)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PROJECT">Project (One-Time)</SelectItem>
                        <SelectItem value="RETAINER">Monthly Retainer</SelectItem>
                        <SelectItem value="HYBRID">Hybrid (Build + Retainer)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Project Fee (৳)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={oppValue}
                      onChange={e => setOppValue(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Monthly MRR (৳)</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={oppDealType === 'PROJECT'}
                      value={oppMonthly}
                      onChange={e => setOppMonthly(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Win Probability (%)</Label>
                    <Input
                      type="number"
                      min={5}
                      max={100}
                      value={oppProb}
                      onChange={e => setOppProb(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Expected Close</Label>
                    <Input
                      type="date"
                      value={oppCloseDate}
                      onChange={e => setOppCloseDate(e.target.value)}
                      className="bg-background font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Acquisition Channel</Label>
                  <Input
                    placeholder="e.g. LinkedIn Outbound, Meta Ads, Referral"
                    value={oppChannel}
                    onChange={e => setOppChannel(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOppOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingOpp}>
                    {savingOpp ? 'Adding...' : 'Add Deal'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* RETENTION & FORECAST KPI STRIP */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Net Dollar Retention</span>
            <span>NDR</span>
          </div>
          <p
            className={cn(
              'mt-2 font-mono text-2xl font-semibold tabular-nums',
              retention.ndrPct >= 100 ? 'text-primary' : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {retention.ndrPct}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            GDR {retention.gdrPct}% · Logo Churn {retention.logoChurnPct}%
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Weighted Pipeline (12M)
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {fmtCompact(pipelineForecast.total12Month)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            3M: {fmtCompact(pipelineForecast.total3Month)} · 6M: {fmtCompact(pipelineForecast.total6Month)}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blended / Paid CAC
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {channelRoi.blendedCac > 0 ? fmtCompact(channelRoi.blendedCac) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Paid CAC: {channelRoi.paidCac > 0 ? fmtCompact(channelRoi.paidCac) : '—'} · Spend {fmtCompact(channelRoi.totalAcquisitionSpend)}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            CAC Payback Period
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {channelRoi.cacPaybackMonths !== null ? `${channelRoi.cacPaybackMonths} mo` : '—'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {channelRoi.totalNewClients} new client(s) acquired (TTM)
          </p>
        </div>
      </section>

      {/* HYBRID PIPELINE FORECAST CHART */}
      <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Hybrid Revenue Forecaster ({horizon}-Month Horizon)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Committed MRR ({fmt(retention.activeMrr)}/mo) + Weighted Open Pipeline ({fmtCompact(pipelineForecast.openPipelineWeighted)} weighted of {fmtCompact(pipelineForecast.openPipelineUnweighted)})
            </p>
          </div>
          <div className="inline-flex items-center rounded-lg border border-foreground/[0.1] bg-muted/50 p-0.5 self-start sm:self-auto">
            {([3, 6, 12] as const).map(h => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-medium',
                  horizon === h
                    ? 'bg-card text-foreground shadow-2xs ring-1 ring-foreground/[0.08]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {h}M
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 h-[260px] w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSlice} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
                <Tooltip
                  formatter={(v: unknown) => fmt(Number(v) || 0)}
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="committedMrr" name="Committed MRR" stackId="a" fill={committedFill} maxBarSize={28} />
                <Bar dataKey="weightedRetainerPipeline" name="Weighted Retainer Pipeline" stackId="a" fill={weightedRetFill} maxBarSize={28} />
                <Bar dataKey="weightedProjectPipeline" name="Weighted Project Pipeline" stackId="a" fill={weightedProjFill} radius={[5, 5, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </section>

      {/* BOTTOM SPLIT: Open Sales Pipeline (7 cols) + Channel ROI & Retention Events (5 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Sales Opportunities ({data.opportunities.length})
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              Weighted = Value × Win %
            </span>
          </div>

          {data.opportunities.length === 0 ? (
            <p className="mt-8 text-center text-xs text-muted-foreground py-8">
              No sales opportunities logged yet. Add open proposals to project 3, 6, and 12-month revenue.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-foreground/[0.06] text-xs">
              {data.opportunities.map(opp => {
                const weighted = Math.round(
                  (opp.dealType === 'RETAINER'
                    ? opp.monthlyValue * 12
                    : opp.estimatedValue + opp.monthlyValue * 12) *
                    (opp.winProbabilityPct / 100)
                )
                return (
                  <div key={opp.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{opp.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {opp.prospectName} · {opp.dealType} · {opp.winProbabilityPct}% win · Close{' '}
                        {new Date(opp.expectedCloseDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="text-right font-mono tabular-nums">
                        <p className="font-semibold text-foreground">{fmtCompact(weighted)}</p>
                        <p className="text-[10px] text-muted-foreground">weighted</p>
                      </div>
                      <select
                        value={opp.stage}
                        onChange={async e => {
                          await updateOpportunityStageAction(
                            opp.id,
                            e.target.value as typeof opp.stage
                          )
                          router.refresh()
                        }}
                        className="rounded-lg border border-foreground/[0.12] bg-background px-2 py-1 font-mono text-[10px] text-foreground cursor-pointer"
                      >
                        <option value="LEAD">LEAD</option>
                        <option value="PROPOSAL">PROPOSAL</option>
                        <option value="NEGOTIATION">NEGOTIATION</option>
                        <option value="WON">WON</option>
                        <option value="LOST">LOST</option>
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteOpportunityAction(opp.id)
                          router.refresh()
                        }}
                        className="cursor-pointer text-muted-foreground/50 hover:text-rose-500"
                        title="Delete opportunity"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-6 lg:col-span-5">
          {/* Channel ROI Table */}
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">
              Channel ROI Breakdown
            </h2>
            {channelRoi.channels.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Tag client acquisition channels and marketing expenses to calculate channel ROI.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-foreground/[0.06] text-xs">
                {channelRoi.channels.map(ch => (
                  <div key={ch.channel} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{ch.channel}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {ch.clientsWon} won · Spend {fmtCompact(ch.spend)}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="font-semibold text-foreground">{fmtCompact(ch.revenueWon)}</p>
                      <p className="text-[10px] text-primary">
                        {ch.roiMultiple > 0 ? `${ch.roiMultiple}x ROI` : 'Organic'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Cohort Retention Events */}
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground">
              Recent MRR Cohort Events
            </h2>
            {data.recentEvents.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No retainer expansion/churn events logged in the last 12 months.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-foreground/[0.06] text-xs">
                {data.recentEvents.slice(0, 6).map(ev => (
                  <div key={ev.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{ev.clientName}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {ev.eventType} · {new Date(ev.effectiveDate).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'font-mono font-semibold tabular-nums',
                        ev.mrrDelta >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      )}
                    >
                      {ev.mrrDelta >= 0 ? '+' : ''}
                      {fmt(ev.mrrDelta)}
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
