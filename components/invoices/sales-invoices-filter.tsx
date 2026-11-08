'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Search, RotateCcw, X, Calendar, Filter, Loader2, CreditCard } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getDatePresetRange, type DatePresetKey } from '@/lib/date-utils'

interface SalesInvoicesFilterProps {
  initialSearch?: string
  initialStatus?: string
  initialFrom?: string
  initialTo?: string
  initialPaymentMethod?: string
}

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially Refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
]

const PAYMENT_METHOD_OPTIONS = [
  { value: 'ALL', label: 'All Payment Methods' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BKASH', label: 'bKash' },
  { value: 'NAGAD', label: 'Nagad' },
  { value: 'ROCKET', label: 'Rocket' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CREDIT', label: 'Store Credit' },
]

export function SalesInvoicesFilter({
  initialSearch = '',
  initialStatus = 'ALL',
  initialFrom = '',
  initialTo = '',
  initialPaymentMethod = 'ALL',
}: SalesInvoicesFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState(initialStatus)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod)

  const isFiltered = Boolean(
    search.trim() ||
      (status && status !== 'ALL') ||
      from ||
      to ||
      (paymentMethod && paymentMethod !== 'ALL')
  )

  function applyFilters(updates: {
    search?: string
    status?: string
    from?: string
    to?: string
    paymentMethod?: string
  }) {
    const params = new URLSearchParams(searchParams.toString())

    const nextSearch = updates.search !== undefined ? updates.search.trim() : search.trim()
    const nextStatus = updates.status !== undefined ? updates.status : status
    const nextFrom = updates.from !== undefined ? updates.from : from
    const nextTo = updates.to !== undefined ? updates.to : to
    const nextPaymentMethod =
      updates.paymentMethod !== undefined ? updates.paymentMethod : paymentMethod

    if (nextSearch) params.set('search', nextSearch)
    else params.delete('search')

    if (nextStatus && nextStatus !== 'ALL') params.set('status', nextStatus)
    else params.delete('status')

    if (nextFrom) params.set('from', nextFrom)
    else params.delete('from')

    if (nextTo) params.set('to', nextTo)
    else params.delete('to')

    if (nextPaymentMethod && nextPaymentMethod !== 'ALL')
      params.set('paymentMethod', nextPaymentMethod)
    else params.delete('paymentMethod')

    params.set('page', '1')

    startTransition(() => {
      const queryString = params.toString()
      router.push(queryString ? `${pathname}?${queryString}` : pathname)
    })
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    applyFilters({ search, status, from, to, paymentMethod })
  }

  function handleStatusChange(newStatus: string) {
    setStatus(newStatus)
    applyFilters({ status: newStatus })
  }

  function handlePaymentMethodChange(newMethod: string) {
    setPaymentMethod(newMethod)
    applyFilters({ paymentMethod: newMethod })
  }

  function handlePreset(preset: DatePresetKey | 'all') {
    if (preset === 'all') {
      setFrom('')
      setTo('')
      applyFilters({ from: '', to: '' })
    } else {
      const range = getDatePresetRange(preset)
      setFrom(range.from)
      setTo(range.to)
      applyFilters({ from: range.from, to: range.to })
    }
  }

  function handleReset() {
    setSearch('')
    setStatus('ALL')
    setFrom('')
    setTo('')
    setPaymentMethod('ALL')
    startTransition(() => {
      router.push(pathname)
    })
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={handleFormSubmit}
        className="p-4 rounded-xl border border-border/60 bg-card/80 backdrop-blur-xs shadow-xs space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Main search input */}
          <div className="relative md:col-span-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, customer, phone, serial, product..."
              className="pl-9 pr-8 h-9 text-sm bg-background/80"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  applyFilters({ search: '' })
                }}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status selector */}
          <div className="md:col-span-2">
            <select
              value={status}
              onChange={e => handleStatusChange(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background/80 px-3 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Payment method selector */}
          <div className="md:col-span-2">
            <select
              value={paymentMethod}
              onChange={e => handlePaymentMethodChange(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background/80 px-3 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              {PAYMENT_METHOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="md:col-span-2">
            <Input
              type="date"
              value={from}
              onChange={e => {
                setFrom(e.target.value)
              }}
              title="From Date"
              placeholder="From Date"
              className="h-9 text-sm bg-background/80"
            />
          </div>

          {/* Date to */}
          <div className="md:col-span-2">
            <Input
              type="date"
              value={to}
              onChange={e => {
                setTo(e.target.value)
              }}
              title="To Date"
              placeholder="To Date"
              className="h-9 text-sm bg-background/80"
            />
          </div>
        </div>

        {/* Date presets and action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <span className="flex items-center gap-1 font-medium mr-1 text-foreground/80">
              <Calendar className="h-3.5 w-3.5" /> Presets:
            </span>
            <button
              type="button"
              onClick={() => handlePreset('today')}
              className="px-2 py-1 rounded-md hover:bg-muted font-medium transition-colors text-foreground/80 hover:text-foreground"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handlePreset('yesterday')}
              className="px-2 py-1 rounded-md hover:bg-muted font-medium transition-colors text-foreground/80 hover:text-foreground"
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => handlePreset('last7Days')}
              className="px-2 py-1 rounded-md hover:bg-muted font-medium transition-colors text-foreground/80 hover:text-foreground"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => handlePreset('thisMonth')}
              className="px-2 py-1 rounded-md hover:bg-muted font-medium transition-colors text-foreground/80 hover:text-foreground"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => handlePreset('all')}
              className="px-2 py-1 rounded-md hover:bg-muted font-medium transition-colors text-foreground/80 hover:text-foreground"
            >
              All Time
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {isFiltered && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isPending}
                className="h-8 px-3 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reset
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-8 px-4 text-xs font-medium"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  Apply Filters
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Active filter chips */}
      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="text-xs text-muted-foreground font-medium">Active Filters:</span>

          {search.trim() && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              <Search className="h-3 w-3" />
              <span>&ldquo;{search.trim()}&rdquo;</span>
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  applyFilters({ search: '' })
                }}
                className="hover:opacity-75"
                title="Remove search"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {status && status !== 'ALL' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <span>Status: {status.replace(/_/g, ' ')}</span>
              <button
                type="button"
                onClick={() => {
                  setStatus('ALL')
                  applyFilters({ status: 'ALL' })
                }}
                className="hover:opacity-75"
                title="Remove status filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {paymentMethod && paymentMethod !== 'ALL' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <CreditCard className="h-3 w-3" />
              <span>Payment: {paymentMethod.replace(/_/g, ' ')}</span>
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('ALL')
                  applyFilters({ paymentMethod: 'ALL' })
                }}
                className="hover:opacity-75"
                title="Remove payment method filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {(from || to) && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
              <Calendar className="h-3 w-3" />
              <span>
                {from && to
                  ? `${from} to ${to}`
                  : from
                    ? `From ${from}`
                    : `Until ${to}`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFrom('')
                  setTo('')
                  applyFilters({ from: '', to: '' })
                }}
                className="hover:opacity-75"
                title="Remove date filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
