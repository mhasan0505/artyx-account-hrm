'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { ReportActionsToolbar, ReportActionsToolbarProps } from '@/components/report-actions-toolbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Calendar as CalendarIcon,
  RefreshCw,
  AlertCircle,
  FileQuestion,
  Store,
} from 'lucide-react'
import { DatePresetKey, getDatePresetRange, toLocalISODate } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export interface SummaryCardItem {
  label: string
  value: string | number
  subtext?: string
  variant?: 'default' | 'success' | 'info' | 'warning' | 'danger' | 'primary'
}

export interface ReportShellProps {
  title: string
  description?: string
  // Filtering
  singleDate?: boolean
  initialFrom?: string
  initialTo?: string
  initialOutletId?: string
  isSuperAdmin?: boolean
  outlets?: Array<{ id: string; name: string }>
  onRun?: (params: { from: string; to: string; outletId?: string }) => void
  isPending?: boolean
  filterBar?: React.ReactNode
  customFilters?: React.ReactNode
  hideFilterBar?: boolean
  // States
  isEmpty?: boolean
  emptyMessage?: string
  error?: string | null
  onRetry?: () => void
  // Summary KPI Cards
  summaryCards?: SummaryCardItem[]
  // Export actions & custom header
  exportProps?: ReportActionsToolbarProps
  headerActions?: React.ReactNode
  printHeader?: React.ReactNode
  // Children / Table
  children?: React.ReactNode
  className?: string
  noContentContainer?: boolean
}

export function formatMoneyUI(amount: number | string | null | undefined): React.ReactNode {
  const val = Number(amount ?? 0)
  if (isNaN(val)) return <span className="font-mono">৳0.00</span>

  const isNegative = val < 0
  const absVal = Math.abs(val)
  const formatted = absVal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (isNegative) {
    return (
      <span className="font-mono text-rose-600 dark:text-rose-400 font-medium">
        -৳{formatted}
      </span>
    )
  }
  return <span className="font-mono font-medium">৳{formatted}</span>
}

export function ReportShell({
  title,
  description,
  singleDate = false,
  initialFrom,
  initialTo,
  initialOutletId = '',
  isSuperAdmin = false,
  outlets = [],
  onRun,
  isPending = false,
  filterBar,
  customFilters,
  hideFilterBar = false,
  isEmpty = false,
  emptyMessage = 'No records found for the selected criteria.',
  error = null,
  onRetry,
  summaryCards = [],
  exportProps,
  headerActions,
  printHeader,
  children,
  className,
  noContentContainer = false,
}: ReportShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const todayStr = toLocalISODate(new Date())

  // Initialize dates from URL search params if present, else fallback
  const urlFrom = searchParams.get('from')
  const urlTo = searchParams.get('to')
  const urlOutlet = searchParams.get('outletId')

  const [from, setFrom] = useState<string>(urlFrom || initialFrom || todayStr)
  const [to, setTo] = useState<string>(singleDate ? from : (urlTo || initialTo || from))
  const [outletId, setOutletId] = useState<string>(urlOutlet || initialOutletId || '')

  // Sync state if URL changes
  useEffect(() => {
    if (urlFrom && urlFrom !== from) setFrom(urlFrom)
    if (urlTo && urlTo !== to && !singleDate) setTo(urlTo)
    if (urlOutlet && urlOutlet !== outletId) setOutletId(urlOutlet)
  }, [urlFrom, urlTo, urlOutlet])

  function updateUrlParams(newFrom: string, newTo: string, newOutletId: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (newFrom) params.set('from', newFrom)
    if (!singleDate && newTo) params.set('to', newTo)
    if (newOutletId) params.set('outletId', newOutletId)
    else params.delete('outletId')

    const newQuery = params.toString()
    router.replace(`${pathname}${newQuery ? `?${newQuery}` : ''}`)
  }

  function handlePreset(key: DatePresetKey) {
    const range = getDatePresetRange(key)
    const newFrom = range.from
    const newTo = singleDate ? range.from : range.to
    setFrom(newFrom)
    setTo(newTo)
    updateUrlParams(newFrom, newTo, outletId)
    onRun?.({ from: newFrom, to: newTo, outletId: outletId || undefined })
  }

  function handleFilterSubmit() {
    updateUrlParams(from, to, outletId)
    onRun?.({ from, to: singleDate ? from : to, outletId: outletId || undefined })
  }

  const rangePresets: { key: DatePresetKey; label: string }[] = singleDate
    ? [
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
      ]
    : [
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
        { key: 'last7Days', label: '7D' },
        { key: 'last30Days', label: '30D' },
        { key: 'thisMonth', label: 'This Month' },
        { key: 'lastMonth', label: 'Last Month' },
        { key: 'thisYear', label: 'This Year' },
      ]

  return (
    <div className={cn('space-y-6 pb-12', className)}>
      {printHeader}

      {/* 1. Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <PageHeader
          title={title}
          description={description}
          className="mb-0"
        />
        {(exportProps || headerActions) && (
          <div className="flex items-center gap-2 print:hidden">
            {headerActions}
            {exportProps && (
              <ReportActionsToolbar {...exportProps} disabled={isPending || exportProps.disabled} />
            )}
          </div>
        )}
      </div>

      {/* 2. Filter Bar */}
      {hideFilterBar ? null : filterBar ? (
        filterBar
      ) : (
        <div className="rounded-xl border bg-card text-card-foreground p-4 sm:p-5 shadow-sm space-y-4 print:hidden">
          <div className="flex flex-wrap items-end gap-3.5">
            {/* Start Date */}
            <div className="w-full sm:w-44 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                {singleDate ? 'Date' : 'Start Date'}
              </Label>
              <Input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            {/* End Date */}
            {!singleDate && (
              <div className="w-full sm:w-44 space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                  End Date
                </Label>
                <Input
                  type="date"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            )}

            {/* Super Admin Outlet Selector */}
            {isSuperAdmin && outlets.length > 0 && (
              <div className="w-full sm:w-52 space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-primary" />
                  Outlet Filter
                </Label>
                <select
                  value={outletId}
                  onChange={e => setOutletId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">All Outlets</option>
                  {outlets.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {customFilters}

            {/* Run Button */}
            <Button
              onClick={handleFilterSubmit}
              disabled={isPending}
              className="w-full sm:w-auto h-9 font-medium shadow-sm"
            >
              {isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Run Report
            </Button>
          </div>

        {/* Date Range Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t text-xs">
          <span className="text-muted-foreground font-medium mr-1.5">Presets:</span>
          {rangePresets.map(preset => {
            const range = getDatePresetRange(preset.key)
            const isActive = singleDate
              ? from === range.from
              : from === range.from && to === range.to
            return (
              <Button
                key={preset.key}
                type="button"
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => handlePreset(preset.key)}
                className={cn(
                  'h-7 px-2.5 text-xs font-medium rounded-md',
                  isActive && 'bg-primary/10 text-primary font-semibold hover:bg-primary/20'
                )}
              >
                {preset.label}
              </Button>
            )
          })}
        </div>
      </div>
      )}

      {/* 3. Summary KPI Cards */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
          {summaryCards.map((card, idx) => {
            const variantClasses = {
              default: 'border-border bg-card text-card-foreground',
              success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
              info: 'border-blue-500/20 bg-blue-500/10 text-blue-950 dark:text-blue-100',
              warning: 'border-amber-500/20 bg-amber-500/10 text-amber-950 dark:text-amber-100',
              danger: 'border-rose-500/20 bg-rose-500/10 text-rose-950 dark:text-rose-100',
              primary: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-950 dark:text-indigo-100',
            }[card.variant || 'default']

            return (
              <div
                key={idx}
                className={cn('rounded-xl border p-4 shadow-sm flex flex-col justify-between', variantClasses)}
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono tracking-tight mt-1.5">
                  {card.value}
                </div>
                {card.subtext && (
                  <div className="text-xs text-muted-foreground mt-1">{card.subtext}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 4. Resilient States & Main Table Content */}
      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
          <h3 className="text-base font-semibold text-rose-950 dark:text-rose-100">
            Error Loading Report
          </h3>
          <p className="text-sm text-rose-800 dark:text-rose-200 max-w-md mx-auto">{error}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Try Again
            </Button>
          )}
        </div>
      ) : isPending ? (
        <div className="rounded-xl border bg-card p-6 space-y-4 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center space-y-3 shadow-sm">
          <FileQuestion className="w-10 h-10 text-muted-foreground mx-auto stroke-[1.5]" />
          <h3 className="text-base font-semibold text-foreground">No Records Found</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{emptyMessage}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePreset(singleDate ? 'today' : 'thisMonth')}
            className="mt-2"
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className={cn('w-full', noContentContainer ? 'space-y-6' : 'overflow-x-auto rounded-xl border bg-card shadow-sm')}>
          {children}
        </div>
      )}
    </div>
  )
}

export const stickyTheadClass =
  'sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold shadow-xs backdrop-blur-xs'

