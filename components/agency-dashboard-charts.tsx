'use client'

import * as React from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Coins,
} from 'lucide-react'

export type MonthlyTrendData = {
  month: string
  revenue: number
  expenses: number
  profit: number
}

export type CategoryStreamData = {
  name: string
  value: number
  color: string
  percentage: number
}

type AgencyDashboardChartsProps = {
  trends: MonthlyTrendData[]
  categories: CategoryStreamData[]
  totalRevenue: number
  collectionEfficiencyPct: number
  profitMarginPct: number
}

export function AgencyDashboardCharts({
  trends,
  categories,
  totalRevenue,
  collectionEfficiencyPct,
  profitMarginPct,
}: AgencyDashboardChartsProps) {
  const [mounted, setMounted] = React.useState(false)
  const [chartType, setChartType] = React.useState<'area' | 'bar'>('area')

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-[380px] rounded-2xl border border-border bg-card/60 animate-pulse flex items-center justify-center text-xs text-muted-foreground">
          Loading Financial Trajectory...
        </div>
        <div className="lg:col-span-1 h-[380px] rounded-2xl border border-border bg-card/60 animate-pulse flex items-center justify-center text-xs text-muted-foreground">
          Loading Revenue Breakdown...
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Chart 1: Financial Trajectory & Profitability */}
      <Card className="bg-card border-border/80 text-card-foreground lg:col-span-2 artyx-card rounded-2xl shadow-xs overflow-hidden flex flex-col justify-between">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-3 border-b border-border/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
                Financial Trajectory & Profitability
              </CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              6-Month overview of Invoiced Revenue vs. Operating Expenses vs. Net Profit (BDT)
            </p>
          </div>

          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-muted/60 p-1 rounded-xl border border-border">
            <Button
              type="button"
              variant={chartType === 'area' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChartType('area')}
              className={`h-7 px-2.5 text-xs font-semibold rounded-lg transition-all ${
                chartType === 'area'
                  ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TrendingUp className="size-3 mr-1" />
              Smooth Spline
            </Button>
            <Button
              type="button"
              variant={chartType === 'bar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChartType('bar')}
              className={`h-7 px-2.5 text-xs font-semibold rounded-lg transition-all ${
                chartType === 'bar'
                  ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="size-3 mr-1" />
              Bar Columns
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-4 pb-2 px-2 sm:px-4 flex-1">
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={trends} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="artyxLimeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7FFF00" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#3E7000" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="artyxProfitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="artyxExpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/60" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    className="text-muted-foreground font-mono"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'currentColor', fontSize: 10 }}
                    tickFormatter={val => `৳${(val / 1000).toFixed(0)}k`}
                    className="text-muted-foreground font-mono"
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const rev = Number(payload.find(p => p.dataKey === 'revenue')?.value || 0)
                        const exp = Number(payload.find(p => p.dataKey === 'expenses')?.value || 0)
                        const pft = Number(payload.find(p => p.dataKey === 'profit')?.value || 0)
                        return (
                          <div className="bg-popover border border-border shadow-xl rounded-xl p-3 text-xs space-y-1.5 min-w-44">
                            <p className="font-bold text-foreground border-b border-border pb-1 font-mono">{label} Telemetry</p>
                            <div className="flex justify-between items-center text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <span className="size-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
                                Revenue:
                              </span>
                              <span className="font-mono font-bold text-foreground">৳{rev.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <span className="size-2 rounded-full bg-rose-500" />
                                Overhead:
                              </span>
                              <span className="font-mono font-semibold text-rose-500">৳{exp.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-border">
                              <span className="flex items-center gap-1.5 text-foreground font-medium">
                                <span className="size-2 rounded-full bg-emerald-500" />
                                Net Profit:
                              </span>
                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">৳{pft.toLocaleString()}</span>
                            </div>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3E7000"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#artyxLimeGrad)"
                    name="Invoiced Revenue"
                    className="dark:stroke-[#7FFF00]"
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="#10B981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#artyxProfitGrad)"
                    name="Net Profit"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke="#F43F5E"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fillOpacity={1}
                    fill="url(#artyxExpGrad)"
                    name="Operating Expenses"
                  />
                </AreaChart>
              ) : (
                <BarChart data={trends} margin={{ top: 10, right: 15, left: -10, bottom: 0 }} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/60" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    className="text-muted-foreground font-mono"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'currentColor', fontSize: 10 }}
                    tickFormatter={val => `৳${(val / 1000).toFixed(0)}k`}
                    className="text-muted-foreground font-mono"
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border border-border shadow-xl rounded-xl p-3 text-xs space-y-1 min-w-44">
                            <p className="font-bold text-foreground border-b border-border pb-1 font-mono">{label} Comparison</p>
                            {payload.map((p: any) => (
                              <div key={p.dataKey} className="flex justify-between items-center py-0.5">
                                <span className="flex items-center gap-1.5 text-muted-foreground capitalize">
                                  <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                                  {p.name}:
                                </span>
                                <span className="font-mono font-bold text-foreground">৳{Number(p.value).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Bar dataKey="revenue" name="Revenue" fill="#3E7000" radius={[6, 6, 0, 0]} className="dark:fill-[#7FFF00]" />
                  <Bar dataKey="profit" name="Net Profit" fill="#10B981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenses" name="Overhead" fill="#F43F5E" radius={[6, 6, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Quick Legend & Summary Stats */}
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/80 text-center text-xs">
            <div className="p-2 rounded-xl bg-muted/40">
              <span className="text-[10px] text-muted-foreground font-mono uppercase block">Total Billing</span>
              <span className="text-xs font-bold text-foreground font-mono">৳{totalRevenue.toLocaleString()}</span>
            </div>
            <div className="p-2 rounded-xl bg-muted/40">
              <span className="text-[10px] text-muted-foreground font-mono uppercase block">Collections</span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">{collectionEfficiencyPct}%</span>
            </div>
            <div className="p-2 rounded-xl bg-muted/40">
              <span className="text-[10px] text-muted-foreground font-mono uppercase block">Profit Margin</span>
              <span className="text-xs font-bold text-[#3E7000] dark:text-[#7FFF00] font-mono">{profitMarginPct}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart 2: Revenue Distribution by Service Stream */}
      <Card className="bg-card border-border/80 text-card-foreground lg:col-span-1 artyx-card rounded-2xl shadow-xs flex flex-col justify-between overflow-hidden">
        <CardHeader className="pb-2 border-b border-border/70">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <PieIcon className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
              Revenue by Service
            </CardTitle>
            <Badge variant="outline" className="text-[10px] font-mono font-bold border-border text-muted-foreground">
              FY 2026
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contribution across agency service verticals
          </p>
        </CardHeader>

        <CardContent className="pt-4 flex-1 flex flex-col justify-between space-y-4">
          {/* Donut Chart with Centered KPI */}
          <div className="relative h-44 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {categories.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as CategoryStreamData
                      return (
                        <div className="bg-popover border border-border shadow-xl rounded-xl p-2.5 text-xs min-w-36">
                          <p className="font-bold text-foreground flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ backgroundColor: data.color }} />
                            {data.name}
                          </p>
                          <p className="font-mono font-bold text-primary mt-1">৳{data.value.toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{data.percentage}% of Agency Total</p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Total Pill */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] uppercase font-mono text-muted-foreground font-bold">Total Invoiced</span>
              <span className="text-sm font-extrabold font-mono text-foreground tracking-tight">
                ৳{(totalRevenue / 1000).toFixed(0)}k
              </span>
            </div>
          </div>

          {/* Stream Breakdown Bars */}
          <div className="space-y-2.5 pt-1">
            {categories.map(cat => (
              <div key={cat.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-foreground flex items-center gap-1.5 truncate max-w-[170px]">
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </span>
                  <span className="font-mono text-muted-foreground font-semibold text-[11px]">
                    ৳{cat.value.toLocaleString()} ({cat.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
