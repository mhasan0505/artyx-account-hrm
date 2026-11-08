'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Printer,
  Phone,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  Receipt,
  FileText,
} from 'lucide-react'
import { ApArOverviewData } from '@/lib/actions/ap-ar'
import { VoucherPrintModal } from './voucher-print-modal'

const fmt = (n: number) =>
  `৳${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

interface Props {
  vouchers: ApArOverviewData['vouchers']
  title?: string
  subtitle?: string
  defaultType?: FilterType
  allowedTypes?: FilterType[]
  hideSummaryStrip?: boolean
  hideTypeFilter?: boolean
}

type FilterType = 'ALL' | 'PAYMENT' | 'RECEIPT' | 'CONTRA'

const FILTER_OPTIONS: { value: FilterType; label: string; color: string }[] = [
  { value: 'ALL', label: 'All', color: '' },
  { value: 'PAYMENT', label: 'Payment', color: 'rose' },
  { value: 'RECEIPT', label: 'Receipt', color: 'emerald' },
  { value: 'CONTRA', label: 'Contra', color: 'blue' },
]

const VOUCHER_STYLES: Record<string, { badge: string; amount: string; icon: React.FC<{ className?: string }> }> = {
  PAYMENT: {
    badge: 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40',
    amount: 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200/50 dark:border-rose-800/30',
    icon: ArrowUpRight,
  },
  RECEIPT: {
    badge: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40',
    amount: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-800/30',
    icon: ArrowDownLeft,
  },
  CONTRA: {
    badge: 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/40',
    amount: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200/50 dark:border-blue-800/30',
    icon: ArrowRightLeft,
  },
}

export function VoucherRegister({
  vouchers,
  title = 'Voucher Register',
  subtitle = 'Payment, Receipt & Contra financial log',
  defaultType = 'ALL',
  allowedTypes,
  hideSummaryStrip = false,
  hideTypeFilter = false,
}: Props) {
  const [typeFilter, setTypeFilter] = useState<FilterType>(defaultType)
  const [search, setSearch] = useState('')
  const [selectedVoucher, setSelectedVoucher] = useState<ApArOverviewData['vouchers'][0] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // Filter vouchers by allowedTypes if specified
  const scopedVouchers = allowedTypes && allowedTypes.length > 0
    ? vouchers.filter(v => allowedTypes.includes(v.voucherType as FilterType))
    : vouchers

  const filteredVouchers = scopedVouchers.filter(v => {
    const matchesType = typeFilter === 'ALL' || v.voucherType === typeFilter
    const matchesSearch =
      v.voucherNumber.toLowerCase().includes(search.toLowerCase()) ||
      v.partyName.toLowerCase().includes(search.toLowerCase()) ||
      (v.reference && v.reference.toLowerCase().includes(search.toLowerCase())) ||
      (v.partyPhone && v.partyPhone.includes(search))
    return matchesType && matchesSearch
  })

  // Summary counts
  const counts = { PAYMENT: 0, RECEIPT: 0, CONTRA: 0 }
  scopedVouchers.forEach(v => {
    if (v.voucherType in counts) counts[v.voucherType as keyof typeof counts]++
  })

  const visibleFilterOptions = FILTER_OPTIONS.filter(
    f => f.value === 'ALL' || !allowedTypes || allowedTypes.includes(f.value)
  )
  const shouldShowTypeFilter = !hideTypeFilter && visibleFilterOptions.length > 2

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      {!hideSummaryStrip && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { type: 'PAYMENT', label: 'Payment Vouchers', tone: 'text-destructive', iconBg: 'bg-destructive/10' },
            { type: 'RECEIPT', label: 'Receipt Vouchers', tone: 'text-primary', iconBg: 'bg-primary/10' },
            { type: 'CONTRA', label: 'Contra Vouchers', tone: 'text-primary/80', iconBg: 'bg-muted' },
          ].map(item => (
            <div
              key={item.type}
              className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-4 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-default"
            >
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{item.label}</p>
              <p className={`text-3xl font-extrabold font-mono tabular-nums ${item.tone}`}>{counts[item.type as keyof typeof counts]}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main table card */}
      <div className="rounded-2xl bg-card border border-transparent shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">{title}</h3>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                    {filteredVouchers.length}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{subtitle}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
              {/* Filter Pills */}
              {shouldShowTypeFilter && (
                <div className="flex items-center gap-1 bg-muted p-1 rounded-xl">
                  {visibleFilterOptions.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setTypeFilter(f.value)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-150 ${
                        typeFilter === f.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Search */}
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search voucher, party..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 text-xs h-9 bg-background border-border rounded-xl focus:ring-2 focus:ring-offset-0"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/20">
                {['Voucher #', 'Date', 'Type', 'Party', 'Invoice / Sale #', 'Account / Method', 'Amount', ''].map(h => (
                  <TableHead
                    key={h}
                    className={`py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${h === 'Amount' || h === '' ? 'text-right' : ''}`}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVouchers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                    <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No vouchers found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredVouchers.map(v => {
                  const style = VOUCHER_STYLES[v.voucherType] || VOUCHER_STYLES.CONTRA
                  const Icon = style.icon
                  return (
                    <TableRow
                      key={v.id}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="py-3.5 font-mono text-xs font-bold text-primary">
                        {v.voucherNumber}
                      </TableCell>
                      <TableCell className="py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(v.date)}
                      </TableCell>
                      <TableCell className="py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${style.badge}`}>
                          <Icon className="w-3 h-3" />
                          {v.voucherType}
                        </span>
                      </TableCell>
                      <TableCell className="py-3.5">
                        <p className="text-sm font-bold text-foreground">{v.partyName}</p>
                        {v.partyPhone && (
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground font-mono">
                            <Phone className="w-3 h-3" />
                            {v.partyPhone}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 text-xs">
                        {v.invoiceRef ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 font-mono">
                            <FileText className="w-3 h-3" />
                            {v.invoiceRef}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 text-xs">
                        <p className="font-semibold text-foreground">{v.accountName}</p>
                        <p className="text-muted-foreground font-mono text-[10px] mt-0.5">{v.method}</p>
                      </TableCell>
                      <TableCell className="py-3.5 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-xl text-sm font-extrabold font-mono tabular-nums ${style.amount}`}>
                          {fmt(v.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="py-3.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl font-semibold transition-all duration-200"
                          onClick={() => {
                            setSelectedVoucher(v)
                            setModalOpen(true)
                          }}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <VoucherPrintModal
        voucher={selectedVoucher}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  )
}
