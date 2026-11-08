'use client'

import React, { useState, useTransition } from 'react'
import type {
  BankAccountStatementData,
  BankStatementFilters,
} from '@/lib/actions/bank'
import { getBankAccountStatement } from '@/lib/actions/bank'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  Landmark,
  Loader2,
  Printer,
  RefreshCcw,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import ExcelJS from 'exceljs'

interface BankStatementViewProps {
  initialData: BankAccountStatementData
}

function fmt(n: number) {
  return '৳' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDateOnly(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function BankStatementView({ initialData }: BankStatementViewProps) {
  const [data, setData] = useState<BankAccountStatementData>(initialData)
  const [isPending, startTransition] = useTransition()

  // Filter States
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'>('ALL')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(25)

  const account = data.account

  function fetchStatement(pageOverride?: number, sizeOverride?: number) {
    const targetPage = pageOverride ?? currentPage
    const targetSize = sizeOverride ?? pageSize

    startTransition(async () => {
      const filters: BankStatementFilters = {
        page: targetPage,
        pageSize: targetSize,
        from: fromDate || undefined,
        to: toDate || undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
        search: searchQuery || undefined,
      }

      const res = await getBankAccountStatement(account.id, filters)
      if (res.success && res.data) {
        setData(res.data)
        setCurrentPage(targetPage)
      } else {
        toast.error(!res.success ? res.error : 'Failed to fetch statement data')
      }
    })
  }

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCurrentPage(1)
    fetchStatement(1)
  }

  function handleResetFilters() {
    setTypeFilter('ALL')
    setFromDate('')
    setToDate('')
    setSearchQuery('')
    setCurrentPage(1)
    startTransition(async () => {
      const res = await getBankAccountStatement(account.id, {
        page: 1,
        pageSize,
      })
      if (res.success && res.data) {
        setData(res.data)
      }
    })
  }

  function handlePageChange(newPage: number) {
    if (newPage >= 1 && newPage <= data.totalPages) {
      fetchStatement(newPage)
    }
  }

  function handlePageSizeChange(newSizeStr: string) {
    const newSize = parseInt(newSizeStr, 10)
    setPageSize(newSize)
    setCurrentPage(1)
    fetchStatement(1, newSize)
  }

  // ── Excel Export ─────────────────────────────────────────────────────────────
  async function exportToExcel() {
    try {
      // Fetch full period statement (all records in filtered window)
      const fullRes = await getBankAccountStatement(account.id, {
        page: 1,
        pageSize: 10000,
        from: fromDate || undefined,
        to: toDate || undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
        search: searchQuery || undefined,
      })

      if (!fullRes.success || !fullRes.data) {
        toast.error('Failed to export statement data')
        return
      }

      const expData = fullRes.data
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Artyx Digital'
      workbook.created = new Date()

      const ws = workbook.addWorksheet('Bank Statement', {
        views: [{ showGridLines: true }],
      })

      // Title & Account Info Headers
      ws.addRow([account.accountName + ' - Account Statement'])
      ws.getRow(1).font = { bold: true, size: 16 }
      ws.addRow([`Bank / Institution: ${account.bankName} (${account.isMfs ? 'MFS' : 'Bank'})`])
      ws.addRow([`Account Number: ${account.accountNumber} | Branch: ${account.branch || 'N/A'}`])
      ws.addRow([`Outlet: ${account.outletName} | Statement Period: ${fromDate ? fmtDateOnly(fromDate) : 'Inception'} to ${toDate ? fmtDateOnly(toDate) : fmtDateOnly(new Date())}`])
      ws.addRow([`Opening Balance: ৳${expData.windowOpeningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Closing Balance: ৳${expData.summary.periodClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`])
      ws.addRow([])

      // Table Header
      const headerRow = ws.addRow([
        'SN',
        'Date & Time',
        'Type',
        'Description',
        'Reference Type',
        'Reference ID',
        'Deposit (In)',
        'Withdrawal (Out)',
        'Running Balance',
      ])
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E293B' },
        }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })

      // Opening Balance Row
      const obRow = ws.addRow([
        '—',
        fromDate ? fmtDateOnly(fromDate) : 'Start',
        'OPENING',
        'Opening Balance Brought Forward',
        '',
        '',
        '',
        '',
        expData.windowOpeningBalance,
      ])
      obRow.font = { italic: true, bold: true }

      // Data Rows
      expData.rows.forEach((r) => {
        ws.addRow([
          r.sn,
          fmtDate(r.date),
          r.typeLabel,
          r.description,
          r.referenceType || '',
          r.referenceId || '',
          r.depositAmount > 0 ? r.depositAmount : '',
          r.withdrawalAmount > 0 ? r.withdrawalAmount : '',
          r.runningBalance,
        ])
      })

      // Totals Footer Row
      const footerRow = ws.addRow([
        'TOTALS',
        '',
        '',
        'Period Totals & Closing Balance',
        '',
        '',
        expData.summary.periodTotalDeposits,
        expData.summary.periodTotalWithdrawals,
        expData.summary.periodClosingBalance,
      ])
      footerRow.font = { bold: true }
      footerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        }
      })

      // Column widths
      ws.columns = [
        { width: 8 },
        { width: 20 },
        { width: 14 },
        { width: 36 },
        { width: 22 },
        { width: 22 },
        { width: 16 },
        { width: 16 },
        { width: 18 },
      ]

      // Format number columns
      ws.getColumn(7).numFmt = '#,##0.00'
      ws.getColumn(8).numFmt = '#,##0.00'
      ws.getColumn(9).numFmt = '#,##0.00'

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Statement_${account.accountName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      toast.success('Statement exported successfully')
    } catch (err: any) {
      toast.error(err?.message || 'Export failed')
    }
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="space-y-6">
      {/* ── Top Account Banner Card ────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {account.isMfs ? (
                  <Wallet className="size-5" />
                ) : (
                  <Landmark className="size-5" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">
                    {account.accountName}
                  </h1>
                  <Badge variant={account.isMfs ? 'secondary' : 'default'}>
                    {account.isMfs ? 'MFS Account' : 'Bank Account'}
                  </Badge>
                  {account.isActive ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {account.bankName} {account.branch ? `• ${account.branch}` : ''} • A/C:{' '}
                  <span className="font-mono font-medium text-foreground">{account.accountNumber}</span>
                  {' '}• Outlet: <span className="font-medium text-foreground">{account.outletName}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Current Real-time Balance Box */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="text-right">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Current Ledger Balance
              </span>
              <div className="font-mono text-2xl font-bold text-foreground">
                {fmt(account.currentBalance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Summary Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Opening Balance
            </span>
            <div className="rounded-md bg-muted p-2 text-muted-foreground">
              <Building2 className="size-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-foreground">
            {fmt(data.windowOpeningBalance)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {fromDate ? `As of ${fmtDateOnly(fromDate)}` : 'Initial opening balance'}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Total Deposits (In)
            </span>
            <div className="rounded-md bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <ArrowDownLeft className="size-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-emerald-600">
            {fmt(data.summary.periodTotalDeposits)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Total inflow for filtered period
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Total Withdrawals (Out)
            </span>
            <div className="rounded-md bg-rose-50 p-2 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
              <ArrowUpRight className="size-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-rose-600">
            {fmt(data.summary.periodTotalWithdrawals)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Total outflow for filtered period
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Period Closing Balance
            </span>
            <div className="rounded-md bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-foreground">
            {fmt(data.summary.periodClosingBalance)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Net Change: <span className={data.summary.periodNetChange >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
              {data.summary.periodNetChange >= 0 ? '+' : ''}{fmt(data.summary.periodNetChange)}
            </span>
          </p>
        </div>
      </div>

      {/* ── Filters & Actions Bar ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm print:hidden">
        <form onSubmit={handleFilterSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            {/* From Date */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* To Date */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Transaction Type */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Txn Type</label>
              <Select
                value={typeFilter}
                onValueChange={(val: any) => setTypeFilter(val)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="DEPOSIT">Deposit (In)</SelectItem>
                  <SelectItem value="WITHDRAWAL">Withdrawal (Out)</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Search Query */}
            <div className="space-y-1 sm:col-span-2 md:col-span-1 lg:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search description, reference..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Filter className="mr-1.5 size-4" />
                )}
                Apply Filters
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                disabled={isPending}
              >
                <RefreshCcw className="mr-1.5 size-4" />
                Reset
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={exportToExcel}
                className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
              >
                <FileSpreadsheet className="mr-1.5 size-4" />
                Export Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePrint}
              >
                <Printer className="mr-1.5 size-4" />
                Print / PDF
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Printable Header (Only appears when printing) ──────────────────── */}
      <div className="hidden print:block mb-6 border-b-2 border-slate-900 pb-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo_icons.png"
              alt="Company logo"
              className="h-12 w-12 object-contain"
            />
            <div>
              <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Artyx Digital</h1>
              <p className="text-sm font-semibold text-slate-700">Bank & MFS Account Statement</p>
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>
              Account: <strong>{account.accountName}</strong> | {account.bankName} (A/C: {account.accountNumber}) | Branch: {account.branch || 'Main'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Period: {fromDate ? fmtDateOnly(fromDate) : 'Start'} to {toDate ? fmtDateOnly(toDate) : fmtDateOnly(new Date())} | Printed on: {fmtDate(new Date())}
            </p>
          </div>
        </div>
      </div>

      {/* ── Statement Ledger Table ────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead className="w-40">Date & Time</TableHead>
              <TableHead className="w-28 text-center">Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-44">Reference / Source</TableHead>
              <TableHead className="w-32 text-right">Deposit (In)</TableHead>
              <TableHead className="w-32 text-right">Withdrawal (Out)</TableHead>
              <TableHead className="w-36 text-right">Running Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Opening Balance Row (Page 1 only) */}
            {currentPage === 1 && (
              <TableRow className="bg-muted/20 font-medium italic">
                <TableCell className="text-center text-muted-foreground">—</TableCell>
                <TableCell className="text-muted-foreground">
                  {fromDate ? fmtDateOnly(fromDate) : 'Start'}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                    OPENING
                  </Badge>
                </TableCell>
                <TableCell className="font-semibold text-foreground" colSpan={2}>
                  Opening Balance Brought Forward
                </TableCell>
                <TableCell className="text-right text-muted-foreground font-mono">—</TableCell>
                <TableCell className="text-right text-muted-foreground font-mono">—</TableCell>
                <TableCell className="text-right font-mono font-bold text-foreground">
                  {fmt(data.windowOpeningBalance)}
                </TableCell>
              </TableRow>
            )}

            {/* Regular Transaction Rows */}
            {data.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-muted-foreground"
                >
                  No transactions found in this period.
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => {
                const isDeposit = row.type === 'DEPOSIT'
                const isWithdrawal = row.type === 'WITHDRAWAL'

                return (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">
                      {row.sn}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {fmtDate(row.date)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          isDeposit
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : isWithdrawal
                              ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                              : 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300'
                        }
                      >
                        <span className="flex items-center gap-1">
                          {isDeposit && <ArrowDownLeft className="size-3" />}
                          {isWithdrawal && <ArrowUpRight className="size-3" />}
                          {!isDeposit && !isWithdrawal && <ArrowLeftRight className="size-3" />}
                          {row.typeLabel}
                        </span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-foreground">
                      {row.description}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.referenceType ? (
                        <div className="flex flex-col">
                          <span className="font-semibold text-muted-foreground">
                            {row.referenceType}
                          </span>
                          {row.referenceId && (
                            <span className="font-mono text-[11px] text-muted-foreground/80 truncate max-w-[150px]">
                              {row.referenceId}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600 font-semibold">
                      {row.depositAmount > 0 ? fmt(row.depositAmount) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-rose-600 font-semibold">
                      {row.withdrawalAmount > 0 ? fmt(row.withdrawalAmount) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-foreground">
                      {fmt(row.runningBalance)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
          <TableFooter className="bg-muted/60 font-semibold">
            <TableRow>
              <TableCell colSpan={5} className="text-right uppercase text-xs tracking-wider">
                Page Totals (Page {currentPage} of {data.totalPages}):
              </TableCell>
              <TableCell className="text-right font-mono text-emerald-600">
                {fmt(data.summary.pageTotalDeposits)}
              </TableCell>
              <TableCell className="text-right font-mono text-rose-600">
                {fmt(data.summary.pageTotalWithdrawals)}
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-foreground">
                {fmt(data.summary.pageClosingBalance)}
              </TableCell>
            </TableRow>
            <TableRow className="border-t border-slate-300 dark:border-slate-700 bg-muted/90">
              <TableCell colSpan={5} className="text-right uppercase text-xs tracking-wider font-bold">
                Overall Period Totals ({data.totalCount} transactions):
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-emerald-600">
                {fmt(data.summary.periodTotalDeposits)}
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-rose-600">
                {fmt(data.summary.periodTotalWithdrawals)}
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-foreground">
                {fmt(data.summary.periodClosingBalance)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {/* ── Pagination Controls ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-t bg-card print:hidden">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {data.rows.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(currentPage * pageSize, data.totalCount)} of {data.totalCount} entries
            </span>
            <span>•</span>
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={handlePageSizeChange}
              >
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || isPending}
              className="h-8 px-2 text-xs"
            >
              <ChevronLeft className="mr-1 size-3.5" />
              Previous
            </Button>
            <span className="px-2 text-xs font-medium text-foreground">
              Page {currentPage} of {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= data.totalPages || isPending}
              className="h-8 px-2 text-xs"
            >
              Next
              <ChevronRight className="ml-1 size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
