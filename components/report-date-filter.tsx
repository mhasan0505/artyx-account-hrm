'use client'

import React, { useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, Calendar as CalendarIcon, AlertCircle } from 'lucide-react'
import { DatePresetKey, getDatePresetRange } from '@/lib/date-utils'

export interface ReportDateFilterProps {
  fromDate: string
  toDate?: string
  maxDays?: number
  onFromDateChange: (val: string) => void
  onToDateChange?: (val: string) => void
  onRun: (dates?: { from: string; to: string }) => void
  isPending?: boolean
  singleDate?: boolean
  syncUrl?: boolean
  fromLabel?: string
  toLabel?: string
  runButtonText?: string
  className?: string
  children?: React.ReactNode
}

export function ReportDateFilter({
  fromDate,
  toDate,
  maxDays,
  onFromDateChange,
  onToDateChange,
  onRun,
  isPending = false,
  singleDate = false,
  syncUrl = true,
  fromLabel = singleDate ? 'Date' : 'Start Date',
  toLabel = 'End Date',
  runButtonText = 'Run Report',
  className = '',
  children,
}: ReportDateFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const effectiveToDate = singleDate ? fromDate : (toDate || fromDate)
  const isInverted = !singleDate && Boolean(fromDate && toDate && fromDate > toDate)

  const diffDays =
    !singleDate && fromDate && toDate
      ? Math.ceil(
          (new Date(`${toDate}T00:00:00`).getTime() - new Date(`${fromDate}T00:00:00`).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : 1
  const isExceeded = Boolean(maxDays && diffDays > maxDays && !isInverted)

  // Sync from URL search params on mount if present
  useEffect(() => {
    if (!syncUrl || !searchParams) return
    const urlFrom = searchParams.get('from')
    const urlTo = searchParams.get('to')
    let shouldRun = false
    let targetFrom = fromDate
    let targetTo = toDate

    if (urlFrom && urlFrom !== fromDate) {
      onFromDateChange(urlFrom)
      targetFrom = urlFrom
      shouldRun = true
    }
    if (!singleDate && urlTo && onToDateChange && urlTo !== toDate) {
      onToDateChange(urlTo)
      targetTo = urlTo
      shouldRun = true
    }
    if (shouldRun) {
      onRun({ from: targetFrom, to: singleDate ? targetFrom : (targetTo || targetFrom) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateUrl(f: string, t?: string) {
    if (!syncUrl || !router || !searchParams) return
    const params = new URLSearchParams(searchParams.toString())
    if (f) params.set('from', f)
    if (!singleDate && t) params.set('to', t)
    const newQuery = params.toString()
    router.replace(`${pathname}${newQuery ? `?${newQuery}` : ''}`, { scroll: false })
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
        ...(maxDays && maxDays <= 31 ? [] : [{ key: 'thisYear' as DatePresetKey, label: 'This Year' }]),
      ]

  function handlePresetClick(key: DatePresetKey) {
    const range = getDatePresetRange(key)
    onFromDateChange(range.from)
    const targetTo = singleDate ? range.from : range.to
    if (!singleDate && onToDateChange) {
      onToDateChange(range.to)
    }
    updateUrl(range.from, targetTo)
    onRun({ from: range.from, to: targetTo })
  }

  function checkIsPresetActive(key: DatePresetKey) {
    const range = getDatePresetRange(key)
    if (singleDate) {
      return fromDate === range.from
    }
    return fromDate === range.from && (toDate || fromDate) === range.to
  }

  return (
    <div className={`rounded-xl border bg-card text-card-foreground p-4 sm:p-5 shadow-sm space-y-4 print:hidden ${className}`}>
      <div className="flex flex-wrap items-end gap-3.5">
        {/* From Date / Single Date */}
        <div className="w-full sm:w-44 space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-primary" />
            {fromLabel}
          </Label>
          <Input
            type="date"
            value={fromDate}
            onChange={e => onFromDateChange(e.target.value)}
            className="font-mono text-sm"
          />
        </div>

        {/* To Date (if not single date) */}
        {!singleDate && (
          <div className="w-full sm:w-44 space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5 text-primary" />
              {toLabel}
            </Label>
            <Input
              type="date"
              value={toDate ?? ''}
              onChange={e => onToDateChange && onToDateChange(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        )}

        {/* Extra Children (e.g. Outlet selector, Category / Action filters) */}
        {children}

        {/* Run Button */}
        <Button
          onClick={() => {
            updateUrl(fromDate, effectiveToDate)
            onRun({ from: fromDate, to: effectiveToDate })
          }}
          disabled={isPending || isInverted || isExceeded}
          className="font-medium"
        >
          {isPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Running…
            </>
          ) : (
            runButtonText
          )}
        </Button>
      </div>

      {/* Inversion Notice */}
      {isInverted && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20 animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>From date ({fromDate}) cannot be after To date ({toDate}). Please adjust the dates before running the report.</span>
        </div>
      )}

      {/* Exceeded Max Range Notice */}
      {isExceeded && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium border border-amber-500/20 animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Date range cannot exceed {maxDays} days (selected range is {diffDays} days). Please select a date range within {maxDays} days.</span>
        </div>
      )}

      {/* Quick Presets Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/50">
        <span className="text-xs font-medium text-muted-foreground mr-1">Presets:</span>
        {rangePresets.map(preset => {
          const isActive = checkIsPresetActive(preset.key)
          return (
            <Button
              key={preset.key}
              type="button"
              variant={isActive ? 'secondary' : 'outline'}
              size="sm"
              disabled={isPending}
              onClick={() => handlePresetClick(preset.key)}
              className={`text-xs h-7 px-2.5 transition-all ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold border-primary/30 shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {preset.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
