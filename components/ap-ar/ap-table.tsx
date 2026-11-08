'use client'

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
  Building2,
  Phone,
  Mail,
  MapPin,
  Search,
  CreditCard,
  AlertCircle,
  Clock,
  CalendarCheck,
  TrendingDown,
  FileText,
  Receipt,
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
  payables: ApArOverviewData['payables']
  vouchers?: ApArOverviewData['vouchers']
  onRecordPayment: (supplierId: string, invoiceId?: string, defaultAmount?: number) => void
}

export function ApTable({ payables, vouchers = [], onRecordPayment }: Props) {
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'invoices' | 'vouchers' | 'all'>('invoices')

  const supplierVouchers = vouchers.filter(
    v => v.id.startsWith('SUP-') || v.voucherType === 'PAYMENT'
  )
  const totalPaidVouchers = supplierVouchers.reduce((s, v) => s + v.amount, 0)

  const filteredSuppliers = payables.suppliers.filter(
    s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.phone?.includes(search) ||
      s.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          {
            label: 'Total Payable',
            value: fmt(payables.totalOutstanding),
            sub: `Owed to ${payables.suppliersWithBalance} supplier(s)`,
            icon: TrendingDown,
            tone: 'text-primary',
            iconBg: 'bg-primary/10 text-primary',
            mode: 'all' as const,
          },
          {
            label: 'Overdue',
            value: fmt(payables.overdueAmount),
            sub: 'Past invoice due date',
            icon: AlertCircle,
            tone: 'text-destructive',
            iconBg: 'bg-destructive/10 text-destructive',
            mode: 'invoices' as const,
          },
          {
            label: 'Due This Week',
            value: fmt(payables.dueThisWeek),
            sub: 'Within next 7 days',
            icon: Clock,
            tone: 'text-foreground',
            iconBg: 'bg-muted text-muted-foreground',
            mode: 'invoices' as const,
          },
          {
            label: 'Open Invoices',
            value: payables.outstandingInvoices.length.toString(),
            sub: 'Unsettled or partial',
            icon: CalendarCheck,
            tone: 'text-primary/80',
            iconBg: 'bg-primary/10 text-primary/80',
            mode: 'invoices' as const,
          },
          {
            label: 'Payment Vouchers',
            value: supplierVouchers.length.toString(),
            sub: `Total: ${fmt(totalPaidVouchers)}`,
            icon: Receipt,
            tone: 'text-rose-600 dark:text-rose-400',
            iconBg: 'bg-rose-500/10 text-rose-500',
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
            onClick={() => setViewMode('invoices')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'invoices'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Dues & Invoices</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
              {payables.outstandingInvoices.length}
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
            <span>Payment Vouchers</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400">
              {supplierVouchers.length}
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

      {/* ── Supplier & Invoices Section ── */}
      {(viewMode === 'invoices' || viewMode === 'all') && (
        <>
          {/* ── Supplier Table ── */}
          <div className="rounded-2xl bg-card border border-transparent shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-5 py-4 border-b border-border bg-muted/30">
              <div>
                <h3 className="text-sm font-bold text-foreground">Supplier Accounts</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Review balances and contact info to make payments</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search supplier, phone..."
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
                    <TableHead className="py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Supplier</TableHead>
                    <TableHead className="py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contact</TableHead>
                    <TableHead className="py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Invoices</TableHead>
                    <TableHead className="py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Balance</TableHead>
                    <TableHead className="py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                        <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No supplier records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSuppliers.map(sup => (
                      <TableRow key={sup.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <TableCell className="py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-muted rounded-xl border border-border shrink-0">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-foreground">{sup.name}</p>
                              {sup.address && (
                                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[200px]">{sup.address}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="space-y-1 text-xs">
                            {sup.phone && (
                              <div className="flex items-center gap-1.5 font-mono text-muted-foreground font-medium">
                                <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                                {sup.phone}
                              </div>
                            )}
                            {sup.email && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Mail className="w-3 h-3 shrink-0" />
                                {sup.email}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Badge className="bg-muted text-muted-foreground border-border text-[10px] font-bold rounded-full">
                              {sup.openInvoicesCount} open
                            </Badge>
                            {sup.overdueInvoicesCount > 0 && (
                              <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-bold rounded-full animate-pulse">
                                {sup.overdueInvoicesCount} overdue
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 text-right">
                          <span className={`text-sm font-extrabold font-mono tabular-nums ${sup.outstandingBalance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {fmt(sup.outstandingBalance)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5 text-right">
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-sm border-0 font-semibold pressable"
                            onClick={() => onRecordPayment(sup.id)}
                          >
                            <CreditCard className="w-3 h-3" />
                            Pay
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ── Outstanding Invoices Table ── */}
          <div className="rounded-2xl bg-card border border-transparent shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">
                Unsettled Purchase Invoices
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                {payables.outstandingInvoices.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted/30">
                    {['Invoice #', 'Supplier', 'Issued', 'Due Date', 'Total', 'Paid', 'Due', ''].map(h => (
                      <TableHead key={h} className={`py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${['Total', 'Paid', 'Due', ''].includes(h) ? 'text-right' : ''}`}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.outstandingInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                        <CalendarCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        All purchase invoices are fully settled!
                      </TableCell>
                    </TableRow>
                  ) : (
                    payables.outstandingInvoices.map(inv => {
                      const isOverdue = inv.dueDate && new Date(inv.dueDate) < new Date()
                      return (
                        <TableRow key={inv.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <TableCell className="py-3.5 font-mono text-xs font-bold text-primary">
                            {inv.invoiceNumber}
                          </TableCell>
                          <TableCell className="py-3.5 text-xs font-semibold text-foreground">{inv.supplierName}</TableCell>
                          <TableCell className="py-3.5 text-xs text-muted-foreground">{fmtDate(inv.createdAt)}</TableCell>
                          <TableCell className="py-3.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              isOverdue
                                ? 'bg-destructive/10 text-destructive border-destructive/20'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}>
                              {fmtDate(inv.dueDate)}
                            </span>
                          </TableCell>
                          <TableCell className="py-3.5 text-right text-xs font-mono tabular-nums font-medium text-foreground">{fmt(inv.total)}</TableCell>
                          <TableCell className="py-3.5 text-right text-xs font-mono tabular-nums font-medium text-primary">{fmt(inv.amountPaid)}</TableCell>
                          <TableCell className="py-3.5 text-right text-sm font-extrabold font-mono tabular-nums text-destructive">{fmt(inv.dueAmount)}</TableCell>
                          <TableCell className="py-3.5 text-right">
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-sm border-0 font-bold pressable"
                              onClick={() => onRecordPayment(inv.supplierId, inv.id, inv.dueAmount)}
                            >
                              Settle
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
        </>
      )}

      {/* ── Supplier Payment Vouchers ── */}
      {(viewMode === 'vouchers' || viewMode === 'all') && (
        <VoucherRegister
          vouchers={supplierVouchers}
          title="Supplier Payment Vouchers"
          subtitle="History of payment vouchers issued to suppliers"
          defaultType="ALL"
          hideSummaryStrip={true}
          hideTypeFilter={true}
        />
      )}
    </div>
  )
}
