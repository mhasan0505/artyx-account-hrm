'use client'

import * as React from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'

export type ServiceVerticalItem = {
  name: string
  value: number
  percentage: number
}

export type PartnerEquityItem = {
  id: string
  name: string
  title: string
  equityPercentage: number
  capitalBalance: number
}

type CashAndVerticalsPanelProps = {
  totalInvoiced: number
  totalCollected: number
  totalReceivableDue: number
  totalExpenses: number
  collectionEfficiencyPct: number
  profitMarginPct: number
  categories: ServiceVerticalItem[]
}

/* Minimal monochrome-plus-accent bar shades for service streams */
const STREAM_BAR_CLASSES = [
  'bg-primary',
  'bg-foreground/75',
  'bg-foreground/45',
  'bg-foreground/25',
]

const PARTNER_TONES = [
  { bar: 'bg-primary', dot: 'bg-primary' },
  { bar: 'bg-foreground/75', dot: 'bg-foreground/75' },
  { bar: 'bg-foreground/45', dot: 'bg-foreground/45' },
  { bar: 'bg-foreground/25', dot: 'bg-foreground/25' },
  { bar: 'bg-muted-foreground/50', dot: 'bg-muted-foreground/50' },
]

function MinimalArcGauge({
  value,
  label,
  sublabel,
  accent = 'primary',
}: {
  value: number
  label: string
  sublabel: string
  accent?: 'primary' | 'neutral'
}) {
  const reduce = useReducedMotion()
  const clamped = Math.max(0, Math.min(100, value))
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - clamped / 100)

  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-foreground/[0.06] bg-muted/25 px-3.5 py-3">
      <div className="relative size-[68px] shrink-0">
        <svg viewBox="0 0 76 76" className="size-full -rotate-90">
          <circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            className="text-foreground/[0.08]"
          />
          <motion.circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduce ? { strokeDashoffset } : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: 0.9, ease: EASE.entrance, delay: 0.12 }
            }
            className={
              accent === 'primary'
                ? 'text-primary'
                : 'text-foreground/80'
            }
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            {Math.round(value)}%
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
          {sublabel}
        </p>
      </div>
    </div>
  )
}

export function CashAndVerticalsPanel({
  totalInvoiced,
  totalCollected,
  totalReceivableDue,
  totalExpenses,
  collectionEfficiencyPct,
  profitMarginPct,
  categories,
}: CashAndVerticalsPanelProps) {
  const reduce = useReducedMotion()
  const [hoveredFlow, setHoveredFlow] = React.useState<string | null>(null)
  const [hoveredStream, setHoveredStream] = React.useState<string | null>(null)

  const flowSegments = React.useMemo(() => {
    const collected = Math.max(0, totalCollected)
    const pending = Math.max(0, totalReceivableDue)
    const burn = Math.max(0, totalExpenses)
    const sum = collected + pending + burn

    if (sum <= 0) {
      return [
        { key: 'collected', label: 'Collected Cash', amount: 0, pct: 55, barClass: 'bg-primary' },
        { key: 'pending', label: 'Receivables', amount: 0, pct: 20, barClass: 'bg-amber-500/80' },
        { key: 'burn', label: 'Operating Burn', amount: 0, pct: 25, barClass: 'bg-foreground/30' },
      ]
    }

    return [
      {
        key: 'collected',
        label: 'Collected Cash',
        amount: collected,
        pct: Math.max(4, Math.round((collected / sum) * 100)),
        barClass: 'bg-primary',
      },
      {
        key: 'pending',
        label: 'Receivables',
        amount: pending,
        pct: pending > 0 ? Math.max(4, Math.round((pending / sum) * 100)) : 0,
        barClass: 'bg-amber-500/85',
      },
      {
        key: 'burn',
        label: 'Operating Burn',
        amount: burn,
        pct: burn > 0 ? Math.max(4, Math.round((burn / sum) * 100)) : 0,
        barClass: 'bg-foreground/30',
      },
    ].filter(s => s.pct > 0)
  }, [totalCollected, totalReceivableDue, totalExpenses])

  const maxCategoryPct = React.useMemo(
    () => Math.max(...categories.map(c => c.percentage), 1),
    [categories]
  )

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
      {/* Top: Capital Flow Proportional Bar */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Capital Flow & Service Mix
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cash velocity distribution across revenue verticals
            </p>
          </div>
          <Link
            href="/finances/profit-loss"
            className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>P&amp;L Statement</span>
            <ArrowUpRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        {/* Segmented Composition Bar */}
        <div className="mt-5 space-y-3">
          <div className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full bg-muted/50 p-0.5">
            {flowSegments.map((seg, idx) => {
              const dimmed = hoveredFlow !== null && hoveredFlow !== seg.key
              return (
                <motion.div
                  key={seg.key}
                  onMouseEnter={() => setHoveredFlow(seg.key)}
                  onMouseLeave={() => setHoveredFlow(null)}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1, opacity: dimmed ? 0.25 : 1 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          scaleX: { duration: 0.6, delay: idx * 0.07, ease: EASE.entrance },
                          opacity: { duration: 0.16 },
                        }
                  }
                  style={{ width: `${seg.pct}%`, transformOrigin: 'left' }}
                  className={cn(
                    'h-full cursor-pointer rounded-full transition-colors',
                    seg.barClass
                  )}
                  title={`${seg.label}: ৳${seg.amount.toLocaleString()}`}
                />
              )
            })}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {flowSegments.map(seg => {
              const active = hoveredFlow === seg.key
              const dimmed = hoveredFlow !== null && !active
              return (
                <div
                  key={seg.key}
                  onMouseEnter={() => setHoveredFlow(seg.key)}
                  onMouseLeave={() => setHoveredFlow(null)}
                  className={cn(
                    'cursor-pointer rounded-lg border px-2.5 py-2 transition-all duration-150',
                    active
                      ? 'border-foreground/15 bg-muted/60'
                      : 'border-transparent bg-muted/20 hover:bg-muted/40',
                    dimmed && 'opacity-45'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', seg.barClass)} />
                    <span className="truncate text-[11px] text-muted-foreground">
                      {seg.label}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-foreground">
                    ৳{seg.amount.toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Hairline Divider */}
      <div className="my-5 h-px w-full bg-foreground/[0.06]" />

      {/* Bottom: Service Verticals Horizontal Bars + Dual Minimal Arc Gauges */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-center">
        <div className="space-y-3 md:col-span-7">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Service Verticals</span>
            <span>
              Total ৳{(totalInvoiced / 1000).toFixed(0)}k
            </span>
          </div>

          <div className="space-y-2.5">
            {categories.map((cat, idx) => {
              const active = hoveredStream === cat.name
              const dimmed = hoveredStream !== null && !active
              const relativeWidth = Math.max(8, Math.round((cat.percentage / maxCategoryPct) * 100))
              const barTone = STREAM_BAR_CLASSES[idx % STREAM_BAR_CLASSES.length]

              return (
                <div
                  key={cat.name}
                  onMouseEnter={() => setHoveredStream(cat.name)}
                  onMouseLeave={() => setHoveredStream(null)}
                  className={cn(
                    'cursor-default space-y-1.5 transition-opacity duration-150',
                    dimmed && 'opacity-40'
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-foreground">
                      {cat.name}
                    </span>
                    <div className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
                      <span className="text-muted-foreground">
                        ৳{cat.value.toLocaleString()}
                      </span>
                      <span className="w-8 text-right font-semibold text-foreground">
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
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
                        width: `${relativeWidth}%`,
                        transformOrigin: 'left',
                      }}
                      className={cn('h-full rounded-full', barTone)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Dual Efficiency Arcs */}
        <div className="grid grid-cols-2 gap-2.5 md:col-span-5 md:grid-cols-1">
          <MinimalArcGauge
            value={collectionEfficiencyPct}
            label="Collection Rate"
            sublabel="Settled vs total billed"
            accent="primary"
          />
          <MinimalArcGauge
            value={Math.max(0, profitMarginPct)}
            label="Operating Margin"
            sublabel="Net EBITDA ratio"
            accent="neutral"
          />
        </div>
      </div>
    </div>
  )
}

export function PartnerEquityPanel({
  owners,
  totalEquityAllocated,
  partnerCapitalBalance,
}: {
  owners: PartnerEquityItem[]
  totalEquityAllocated: number
  partnerCapitalBalance: number
}) {
  const reduce = useReducedMotion()
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)

  const getInitials = (name: string) =>
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('')

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-foreground/[0.08] bg-card p-5 sm:p-6">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Partner Equity Ledger
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ownership allocation &amp; capital accounts
            </p>
          </div>
          <Link
            href="/equity"
            className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Cap Table</span>
            <ArrowUpRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        {/* Interactive Ownership Ribbon */}
        <div className="mt-5 space-y-2">
          <div className="flex items-baseline justify-between text-[11px] font-mono">
            <span className="text-muted-foreground">Pool Balance</span>
            <span className="font-semibold tabular-nums text-foreground">
              ৳{partnerCapitalBalance.toLocaleString()} · {totalEquityAllocated}%
            </span>
          </div>

          <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-muted/50 p-0.5">
            {owners.length === 0 ? (
              <div className="h-full w-full rounded-full bg-foreground/[0.08]" />
            ) : (
              owners.map((owner, idx) => {
                const tone = PARTNER_TONES[idx % PARTNER_TONES.length]
                const dimmed = hoveredId !== null && hoveredId !== owner.id
                return (
                  <motion.div
                    key={owner.id}
                    onMouseEnter={() => setHoveredId(owner.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1, opacity: dimmed ? 0.25 : 1 }}
                    transition={
                      reduce
                        ? { duration: 0 }
                        : {
                            scaleX: {
                              duration: 0.65,
                              delay: 0.08 + idx * 0.06,
                              ease: EASE.entrance,
                            },
                            opacity: { duration: 0.16 },
                          }
                    }
                    style={{
                      width: `${owner.equityPercentage}%`,
                      transformOrigin: 'left',
                    }}
                    className={cn('h-full cursor-pointer rounded-full', tone.bar)}
                    title={`${owner.name} (${owner.equityPercentage}%)`}
                  />
                )
              })
            )}
          </div>
        </div>

        {/* Hairline Partner Ledger List */}
        <div className="mt-5 divide-y divide-foreground/[0.06]">
          {owners.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-xs text-muted-foreground">No active partners configured.</p>
              <Link
                href="/equity"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Configure Ownership <ArrowUpRight className="size-3" />
              </Link>
            </div>
          ) : (
            owners.map((owner, idx) => {
              const tone = PARTNER_TONES[idx % PARTNER_TONES.length]
              const active = hoveredId === owner.id
              const dimmed = hoveredId !== null && !active

              return (
                <Link
                  key={owner.id}
                  href={`/equity/${owner.id}`}
                  onMouseEnter={() => setHoveredId(owner.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    'flex items-center justify-between gap-3 py-3 transition-all duration-150',
                    active && 'translate-x-0.5',
                    dimmed && 'opacity-45'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-foreground/[0.08] bg-muted/50 text-[11px] font-mono font-semibold text-foreground">
                      {getInitials(owner.name)}
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card',
                          tone.dot
                        )}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {owner.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {owner.title}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right font-mono tabular-nums">
                    <p className="text-xs font-semibold text-foreground">
                      {owner.equityPercentage}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      ৳{owner.capitalBalance.toLocaleString()}
                    </p>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="mt-4 flex items-center justify-between border-t border-foreground/[0.06] pt-3.5 text-[11px]">
        <span className="text-muted-foreground">
          {owners.length} active partner{owners.length === 1 ? '' : 's'}
        </span>
        <Link
          href="/equity/distributions"
          className="font-medium text-primary hover:underline"
        >
          Run Profit Distribution →
        </Link>
      </div>
    </div>
  )
}
