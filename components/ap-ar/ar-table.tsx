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
  UserCheck,
  Phone,
  Mail,
  Search,
  ArrowDownLeft,
  CalendarCheck,
  Receipt,
  Clock,
  TrendingUp,
  AlertCircle,
} from 'lucide-react'
import { ApArOverviewData } from '@/lib/actions/ap-ar'
import { VoucherRegister } from './voucher-register'

const fmt = (n: number) =>
  `৳${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const fmtDate = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'

interface Props {
  receivables: ApArOverviewData['receivables']
  vouchers?: ApArOverviewData['vouchers']
  onReceivePayment: (customerId: string, saleId?: string, defaultAmount?: number) => void
}

export function ArTable({ receivables, vouchers = [], onReceivePayment }: Props) {
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'sales' | 'vouchers' | 'all'>('sales')

  const customerVouchers = vouchers.filter(
    v => v.id.startsWith('CUST-') || v.voucherType === 'RECEIPT'
  )
  const totalReceivedVouchers = customerVouchers.reduce((s, v) => s + v.amount, 0)

  const filteredCustomers = receivables.customers.filter(
    c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Total Receivable',
            value: fmt(receivables.totalOutstanding),
            sub: `Owed by ${receivables.customersWithBalance} customer(s)`,
            icon: TrendingUp,
            tone: 'text-primary',
            iconBg: 'bg-primary/10 text-primary',
            mode: 'all' as const,
          },
          {
            label: 'Unsettled Sales',
            value: receivables.outstandingSales.length.toString(),
            sub: 'Pending payment collection',
            icon: Receipt,
            tone: 'text-foreground',
            iconBg: 'bg-muted text-muted-foreground',
            mode: 'sales' as const,
          },
          {
            label: 'Overdue',
            value: fmt(receivables.overdueAmount),
            sub: 'Past expected payment date',
            icon: AlertCircle,
            tone: 'text-destructive',
            iconBg: 'bg-destructive/10 text-destructive',
            mode: 'sales' as const,
          },
          {
            label: 'Receipt Vouchers',
            value: customerVouchers.length.toString(),
            sub: `Total: ${fmt(totalReceivedVouchers)}`,
            icon: Receipt,
            tone: 'text-emerald-600 dark:text-emerald-400',
            iconBg: 'bg-emerald-500/10 text-emerald-500',
            mode: 'vouchers' as const,
          },
        ].map(card => {
          const Icon = card.icon
          const isSelected = viewMode === card.mode
          return (
            <div
              key={card.label}
              onClick={() => setViewMode(card.mode)}
              className={`relative overflow-hidden rounded-2xl bg-card border shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer ${
                isSelected ? 'border-primary/40 ring-1 ring-primary/20' : 'border-transparent'
              }`}
            >
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{card.label}</p>
                  <div className={`p-1.5 rounded-lg ${card.iconBg}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                </div>
                <p className={`text-2xl font-extrabold font-mono tabular-nums tracking-tight ${card.tone}`}>{card.value}</p>
                <p className="text-[11px] text-muted-foreground mt-2 font-medium">{card.sub}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Section View Switcher ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-transparent rounded-2xl p-2 shadow-sm">
        <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setViewMode('sales')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'sales'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Receivables & Sales</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
              {receivables.outstandingSales.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('vouchers')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'vouchers'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Receipt Vouchers</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {customerVouchers.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('all')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'all'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>All Sections</span>
          </button>
        </div>
      </div>

      {/* ── Customers & Sales Section ── */}
      {(viewMode === 'sales' || viewMode === 'all') && (
        <>
          {/* ── Customer Table ── */}
          <div className="rounded-2xl bg-card border border-transparent shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-5 py-4 border-b border-border bg-muted/30">
              <div>
                <h3 className="text-sm font-bold text-foreground">Customer Accounts</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Review outstanding balances and collect due payments</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search customer, phone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 text-xs h-9 bg-background border-border rounded-xl focus:ring-2 focus:ring-offset-0"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted/30">
                    <TableHead className="py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Customer</TableHead>
                    <TableHead className="py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contact</TableHead>
                    <TableHead className="py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Outstanding</TableHead>
                    <TableHead className="py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-muted-foreground text-sm">
                        <UserCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No customer records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers.map(c => (
                      <TableRow key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <TableCell className="py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-muted rounded-xl border border-border shrink-0">
                              <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-foreground">{c.name}</p>
                              {c.address && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{c.address}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="space-y-1 text-xs">
                            {c.phone && (
                              <div className="flex items-center gap-1.5 font-mono text-muted-foreground font-medium">
                                <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                                {c.phone}
                              </div>
                            )}
                            {c.email && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Mail className="w-3 h-3 shrink-0" />
                                {c.email}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 text-right">
                          <span className={`text-sm font-extrabold font-mono tabular-nums ${c.outstandingBalance > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                            {fmt(c.outstandingBalance)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5 text-right">
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-sm border-0 font-semibold pressable"
                            onClick={() => onReceivePayment(c.id)}
                          >
                            <ArrowDownLeft className="w-3 h-3" />
                            Collect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ── Outstanding Sales Table ── */}
          <div className="rounded-2xl bg-card border border-transparent shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Unsettled Customer Sales</h3>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                {receivables.outstandingSales.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted/30">
                    {['Sale #', 'Customer', 'Date', 'Total', 'Paid', 'Due', ''].map(h => (
                      <TableHead key={h} className={`py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${['Total', 'Paid', 'Due', ''].includes(h) ? 'text-right' : ''}`}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables.outstandingSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                        <CalendarCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        All customer sales are fully collected!
                      </TableCell>
                    </TableRow>
                  ) : (
                    receivables.outstandingSales.map(sale => (
                      <TableRow key={sale.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <TableCell className="py-3.5 font-mono text-xs font-bold text-primary">
                          {sale.saleNumber}
                        </TableCell>
                        <TableCell className="py-3.5">
                          <p className="text-xs font-semibold text-foreground">{sale.customerName}</p>
                          {sale.customerPhone && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground font-mono">
                              <Phone className="w-3 h-3" />
                              {sale.customerPhone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-3.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fmtDate(sale.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 text-right text-xs font-mono tabular-nums font-medium text-foreground">{fmt(sale.total)}</TableCell>
                        <TableCell className="py-3.5 text-right text-xs font-mono tabular-nums font-medium text-primary">{fmt(sale.amountPaid)}</TableCell>
                        <TableCell className="py-3.5 text-right text-sm font-extrabold font-mono tabular-nums text-primary">{fmt(sale.dueAmount)}</TableCell>
                        <TableCell className="py-3.5 text-right">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-sm border-0 font-bold pressable"
                            onClick={() => onReceivePayment(sale.customerId || '', sale.id, sale.dueAmount)}
                          >
                            Collect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* ── Customer Receipt Vouchers ── */}
      {(viewMode === 'vouchers' || viewMode === 'all') && (
        <VoucherRegister
          vouchers={customerVouchers}
          title="Customer Receipt Vouchers"
          subtitle="History of receipt vouchers collected from customers"
          defaultType="ALL"
          hideSummaryStrip={true}
          hideTypeFilter={true}
        />
      )}
    </div>
  )
}
