'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'

export type MonthlyTrendPoint = {
  month: string
  revenue: number
  expenses: number
  profit: number
  marginPct?: number
}

type ChartMode = 'bars' | 'trend' | 'margin'
type SeriesKey = 'revenue' | 'profit' | 'expenses'

type FinancialHorizonChartProps = {
  trends: MonthlyTrendPoint[]
  totalRevenue: number
  totalExpenses: number
  isProjected?: boolean
}

const MODES: Array<{ id: ChartMode; label: string }> = [
  { id: 'bars', label: 'Cashflow Bars' },
  { id: 'trend', label: 'Trajectory' },
  { id: 'margin', label: 'Net Margin' },
]

function formatCompactBDT(val: number): string {
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}৳${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}৳${(abs / 1_000).toFixed(0)}k`
  return `${sign}৳${abs}`
}

export function FinancialHorizonChart({
  trends,
  totalRevenue,
  totalExpenses,
  isProjected = false,
}: FinancialHorizonChartProps) {
  const { resolvedTheme } = useTheme()
  const reduce = useReducedMotion()
  const [mounted, setMounted] = React.useState(false)
  const [mode, setMode] = React.useState<ChartMode>('bars')
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const [visibleSeries, setVisibleSeries] = React.useState<Record<SeriesKey, boolean>>({
    revenue: true,
    profit: true,
    expenses: true,
  })

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : true

  const palette = React.useMemo(
    () =>
      isDark
        ? {
            primary: '#7FFF00',
            revenue: '#E8EDE4',
            revenueSoft: 'rgba(232, 237, 228, 0.22)',
            expenses: '#FB7185',
            expensesMuted: 'rgba(251, 113, 133, 0.42)',
            grid: 'rgba(244, 246, 240, 0.06)',
            axis: '#7D8779',
            cursor: 'rgba(244, 246, 240, 0.035)',
            refLine: 'rgba(127, 255, 0, 0.28)',
          }
        : {
            primary: '#3E7000',
            revenue: '#0D140A',
            revenueSoft: 'rgba(13, 20, 10, 0.14)',
            expenses: '#E11D48',
            expensesMuted: 'rgba(225, 29, 72, 0.35)',
            grid: 'rgba(13, 20, 10, 0.06)',
            axis: '#64748B',
            cursor: 'rgba(13, 20, 10, 0.03)',
            refLine: 'rgba(62, 112, 0, 0.25)',
          },
    [isDark]
  )

  const enrichedData = React.useMemo(() => {
    return trends.map((pt, idx) => {
      const marginPct =
        pt.marginPct !== undefined
          ? pt.marginPct
          : pt.revenue > 0
          ? Number(((pt.profit / pt.revenue) * 100).toFixed(1))
          : 0
      const prev = idx > 0 ? trends[idx - 1].revenue : null
      const momDelta =
        prev && prev > 0 ? Number((((pt.revenue - prev) / prev) * 100).toFixed(1)) : null
      return {
        ...pt,
        marginPct,
        momDelta,
      }
    })
  }, [trends])

  const avgRevenue = React.useMemo(() => {
    if (!enrichedData.length) return 0
    return Math.round(
      enrichedData.reduce((acc, item) => acc + item.revenue, 0) / enrichedData.length
    )
  }, [enrichedData])

  const avgMargin = React.useMemo(() => {
    if (!enrichedData.length) return 0
    return Number(
      (
        enrichedData.reduce((acc, item) => acc + item.marginPct, 0) /
        enrichedData.length
      ).toFixed(1)
    )
  }, [enrichedData])

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries(prev => {
      const next = { ...prev, [key]: !prev[key] }
      // Prevent turning all series off
      if (!next.revenue && !next.profit && !next.expenses) return prev
      return next
    })
  }

  return (
    <div className="flex h-full flex-col justify-between p-5 sm:p-6">
      {/* Header Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Financial Horizon
            </h2>
            <span className="text-[11px] font-mono text-muted-foreground/80">
              · 6M Window
            </span>
            {isProjected ? (
              <span className="rounded-full border border-foreground/10 bg-muted/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Baseline
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'margin'
              ? `Monthly operating margin efficiency · avg ${avgMargin}%`
              : `Invoiced revenue, operating burn & net profit · avg ${formatCompactBDT(avgRevenue)}/mo`}
          </p>
        </div>

        {/* Spring-Animated Pill Mode Switcher */}
        <div
          role="tablist"
          aria-label="Chart view mode"
          className="inline-flex items-center rounded-lg border border-foreground/[0.08] bg-muted/50 p-0.5 self-start sm:self-auto"
        >
          {MODES.map(item => {
            const active = mode === item.id
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setMode(item.id)}
                className={cn(
                  'relative cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-150',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="horizon-chart-pill"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 460, damping: 34 }
                    }
                    className="absolute inset-0 rounded-md bg-card shadow-2xs ring-1 ring-foreground/[0.08]"
                  />
                ) : null}
                <span className="relative z-10">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Interactive Series Filter Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-foreground/[0.06] pb-3">
        {mode !== 'margin' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  key: 'revenue' as SeriesKey,
                  label: 'Revenue',
                  dotColor: palette.revenue,
                },
                {
                  key: 'profit' as SeriesKey,
                  label: 'Net Profit',
                  dotColor: palette.primary,
                },
                {
                  key: 'expenses' as SeriesKey,
                  label: 'Expenses',
                  dotColor: palette.expenses,
                },
              ] as const
            ).map(series => {
              const on = visibleSeries[series.key]
              return (
                <button
                  key={series.key}
                  type="button"
                  onClick={() => toggleSeries(series.key)}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all duration-150',
                    on
                      ? 'border-foreground/[0.1] bg-muted/40 text-foreground'
                      : 'border-transparent bg-transparent text-muted-foreground/45 line-through hover:text-muted-foreground'
                  )}
                >
                  <span
                    className="size-1.5 rounded-full transition-opacity"
                    style={{
                      backgroundColor: series.dotColor,
                      opacity: on ? 1 : 0.3,
                    }}
                  />
                  {series.label}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: palette.primary }}
            />
            <span>Operating Net Margin (%) per month</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] font-mono tabular-nums text-muted-foreground">
          <span>
            Billed:{' '}
            <strong className="font-semibold text-foreground">
              {formatCompactBDT(totalRevenue)}
            </strong>
          </span>
          <span className="hidden sm:inline">
            Burn:{' '}
            <strong className="font-semibold text-foreground">
              {formatCompactBDT(totalExpenses)}
            </strong>
          </span>
        </div>
      </div>

      {/* Main Chart Canvas */}
      <div className="mt-4 h-[270px] w-full">
        {!mounted ? (
          <div className="flex h-full w-full items-end gap-4 px-4 pb-6 pt-8">
            {[45, 62, 54, 78, 86, 94].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-muted/60 animate-pulse"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {mode === 'bars' ? (
              <BarChart
                data={enrichedData}
                margin={{ top: 10, right: 6, left: -14, bottom: 0 }}
                barGap={4}
                barCategoryGap="24%"
                onMouseMove={state => {
                  if (typeof state?.activeTooltipIndex === 'number') {
                    setActiveIndex(state.activeTooltipIndex)
                  }
                }}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  vertical={false}
                  stroke={palette.grid}
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                  tick={{ fill: palette.axis, fontSize: 11, fontFamily: 'var(--font-geist-mono)' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 10, fontFamily: 'var(--font-geist-mono)' }}
                  tickFormatter={formatCompactBDT}
                />
                {visibleSeries.revenue && avgRevenue > 0 ? (
                  <ReferenceLine
                    y={avgRevenue}
                    stroke={palette.refLine}
                    strokeDasharray="3 3"
                  />
                ) : null}
                <Tooltip
                  cursor={{ fill: palette.cursor, radius: 8 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as (typeof enrichedData)[number]
                    return (
                      <div className="min-w-48 rounded-xl border border-foreground/[0.1] bg-popover/95 p-3 text-xs shadow-xl backdrop-blur-md">
                        <div className="mb-2 flex items-center justify-between border-b border-foreground/[0.08] pb-1.5">
                          <span className="font-mono font-semibold text-foreground">
                            {label} 2026
                          </span>
                          {row.momDelta !== null ? (
                            <span
                              className={cn(
                                'font-mono text-[10px] font-semibold',
                                row.momDelta >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              )}
                            >
                              {row.momDelta >= 0 ? '+' : ''}
                              {row.momDelta}% MoM
                            </span>
                          ) : null}
                        </div>
                        <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                          <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5 font-sans text-muted-foreground">
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: palette.revenue }}
                              />
                              Revenue
                            </span>
                            <span className="font-semibold text-foreground">
                              ৳{row.revenue.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5 font-sans text-muted-foreground">
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: palette.expenses }}
                              />
                              Expenses
                            </span>
                            <span className="font-medium text-rose-600 dark:text-rose-400">
                              ৳{row.expenses.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-t border-foreground/[0.08] pt-1.5">
                            <span className="flex items-center gap-1.5 font-sans font-medium text-foreground">
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: palette.primary }}
                              />
                              Net Profit
                            </span>
                            <span className="font-bold text-primary">
                              ৳{row.profit.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />
                {visibleSeries.revenue ? (
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    radius={[5, 5, 1, 1]}
                    maxBarSize={22}
                    animationDuration={reduce ? 0 : 600}
                    animationEasing="ease-out"
                  >
                    {enrichedData.map((_, idx) => (
                      <Cell
                        key={`rev-${idx}`}
                        fill={palette.revenue}
                        fillOpacity={
                          activeIndex === null || activeIndex === idx ? 0.88 : 0.25
                        }
                      />
                    ))}
                  </Bar>
                ) : null}
                {visibleSeries.profit ? (
                  <Bar
                    dataKey="profit"
                    name="Net Profit"
                    radius={[5, 5, 1, 1]}
                    maxBarSize={22}
                    animationDuration={reduce ? 0 : 680}
                    animationEasing="ease-out"
                  >
                    {enrichedData.map((_, idx) => (
                      <Cell
                        key={`pft-${idx}`}
                        fill={palette.primary}
                        fillOpacity={
                          activeIndex === null || activeIndex === idx ? 0.95 : 0.28
                        }
                      />
                    ))}
                  </Bar>
                ) : null}
                {visibleSeries.expenses ? (
                  <Bar
                    dataKey="expenses"
                    name="Expenses"
                    radius={[5, 5, 1, 1]}
                    maxBarSize={16}
                    animationDuration={reduce ? 0 : 740}
                    animationEasing="ease-out"
                  >
                    {enrichedData.map((_, idx) => (
                      <Cell
                        key={`exp-${idx}`}
                        fill={palette.expensesMuted}
                        fillOpacity={
                          activeIndex === null || activeIndex === idx ? 1 : 0.3
                        }
                      />
                    ))}
                  </Bar>
                ) : null}
              </BarChart>
            ) : mode === 'trend' ? (
              <AreaChart
                data={enrichedData}
                margin={{ top: 10, right: 8, left: -14, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="horizonRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.revenue} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={palette.revenue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="horizonProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.primary} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={palette.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 4"
                  vertical={false}
                  stroke={palette.grid}
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                  tick={{ fill: palette.axis, fontSize: 11, fontFamily: 'var(--font-geist-mono)' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 10, fontFamily: 'var(--font-geist-mono)' }}
                  tickFormatter={formatCompactBDT}
                />
                <Tooltip
                  cursor={{ stroke: palette.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as (typeof enrichedData)[number]
                    return (
                      <div className="min-w-48 rounded-xl border border-foreground/[0.1] bg-popover/95 p-3 text-xs shadow-xl backdrop-blur-md">
                        <div className="mb-2 flex items-center justify-between border-b border-foreground/[0.08] pb-1.5">
                          <span className="font-mono font-semibold text-foreground">
                            {label} 2026
                          </span>
                          <span className="font-mono text-[10px] text-primary font-semibold">
                            {row.marginPct}% margin
                          </span>
                        </div>
                        <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                          <div className="flex justify-between gap-4">
                            <span className="font-sans text-muted-foreground">Revenue</span>
                            <span className="font-semibold text-foreground">
                              ৳{row.revenue.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="font-sans text-muted-foreground">Expenses</span>
                            <span className="text-rose-600 dark:text-rose-400">
                              ৳{row.expenses.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-foreground/[0.08] pt-1.5">
                            <span className="font-sans font-medium text-foreground">Net Profit</span>
                            <span className="font-bold text-primary">
                              ৳{row.profit.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />
                {visibleSeries.revenue ? (
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={palette.revenue}
                    strokeWidth={1.75}
                    fill="url(#horizonRevGrad)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: palette.revenue }}
                    animationDuration={reduce ? 0 : 650}
                  />
                ) : null}
                {visibleSeries.profit ? (
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke={palette.primary}
                    strokeWidth={2.25}
                    fill="url(#horizonProfitGrad)"
                    dot={false}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: isDark ? '#070B06' : '#FFFFFF', fill: palette.primary }}
                    animationDuration={reduce ? 0 : 720}
                  />
                ) : null}
                {visibleSeries.expenses ? (
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke={palette.expenses}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="transparent"
                    dot={false}
                    activeDot={{ r: 3.5, strokeWidth: 0, fill: palette.expenses }}
                    animationDuration={reduce ? 0 : 780}
                  />
                ) : null}
              </AreaChart>
            ) : (
              <BarChart
                data={enrichedData}
                margin={{ top: 10, right: 6, left: -14, bottom: 0 }}
                barCategoryGap="34%"
                onMouseMove={state => {
                  if (typeof state?.activeTooltipIndex === 'number') {
                    setActiveIndex(state.activeTooltipIndex)
                  }
                }}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  vertical={false}
                  stroke={palette.grid}
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                  tick={{ fill: palette.axis, fontSize: 11, fontFamily: 'var(--font-geist-mono)' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 10, fontFamily: 'var(--font-geist-mono)' }}
                  tickFormatter={val => `${val}%`}
                />
                <ReferenceLine
                  y={avgMargin}
                  stroke={palette.refLine}
                  strokeDasharray="3 3"
                />
                <Tooltip
                  cursor={{ fill: palette.cursor, radius: 8 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as (typeof enrichedData)[number]
                    return (
                      <div className="min-w-44 rounded-xl border border-foreground/[0.1] bg-popover/95 p-3 text-xs shadow-xl backdrop-blur-md">
                        <div className="mb-1.5 font-mono font-semibold text-foreground">
                          {label} · Operating Margin
                        </div>
                        <div className="flex items-baseline justify-between font-mono tabular-nums">
                          <span className="text-lg font-bold text-primary">
                            {row.marginPct}%
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            ৳{row.profit.toLocaleString()} net
                          </span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar
                  dataKey="marginPct"
                  name="Net Margin %"
                  radius={[6, 6, 2, 2]}
                  maxBarSize={36}
                  animationDuration={reduce ? 0 : 620}
                >
                  {enrichedData.map((entry, idx) => (
                    <Cell
                      key={`margin-${idx}`}
                      fill={entry.marginPct >= 0 ? palette.primary : palette.expenses}
                      fillOpacity={
                        activeIndex === null || activeIndex === idx ? 0.92 : 0.28
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
