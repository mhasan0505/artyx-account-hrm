'use client'

import { PageHeader } from '@/components/page-header'
import { ReportPrintHeader } from '@/components/report-print-header'
import { ReportPrintFooter } from '@/components/report-print-footer'
import { ReportActionsToolbar } from '@/components/report-actions-toolbar'
import { generatePdfLedger, type ReportColumn } from '@/components/print'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAuditReport } from '@/lib/actions/audit'
import { ReportShell, SummaryCardItem } from '@/components/reports/report-shell'
import { useState, useTransition } from 'react'
import { toLocalISODate } from '@/lib/date-utils'
import { toast } from 'sonner'

type Report = Awaited<ReturnType<typeof getAuditReport>>
type ReportData = Extract<Report, { success: true }>['data']

function formatAuditDetails(detailsStr: string) {
  if (!detailsStr || detailsStr === '{}' || detailsStr === 'null') return '—'

  try {
    const data = JSON.parse(detailsStr)
    if (!data || typeof data !== 'object') return detailsStr

    const items: React.ReactNode[] = []

    if (data.saleNumber) {
      items.push(
        <span key="saleNumber" className="inline-flex items-center gap-1 font-medium text-foreground">
          <span className="text-muted-foreground text-[11px]">Invoice:</span>
          <span className="font-mono text-primary font-semibold">{data.saleNumber}</span>
        </span>
      )
    }

    if (data.returnNumber) {
      items.push(
        <span key="returnNumber" className="inline-flex items-center gap-1 font-medium text-foreground">
          <span className="text-muted-foreground text-[11px]">Return No:</span>
          <span className="font-mono text-primary font-semibold">{data.returnNumber}</span>
        </span>
      )
    }

    if (data.newSaleNumber) {
      items.push(
        <span key="newSaleNumber" className="inline-flex items-center gap-1 font-medium text-foreground">
          <span className="text-muted-foreground text-[11px]">New Invoice:</span>
          <span className="font-mono text-primary font-semibold">{data.newSaleNumber}</span>
        </span>
      )
    }

    if (data.total !== undefined || data.amount !== undefined) {
      const val = data.total ?? data.amount
      items.push(
        <span key="amount" className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="text-muted-foreground text-[11px]">Total:</span>
          <span className="font-mono font-bold">৳{Number(val).toLocaleString()}</span>
        </span>
      )
    }

    if (data.oldPrice !== undefined && data.newPrice !== undefined) {
      items.push(
        <span key="priceChange" className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
          <span className="text-muted-foreground text-[11px]">Price:</span>
          <span className="font-mono">৳{Number(data.oldPrice).toLocaleString()} → ৳{Number(data.newPrice).toLocaleString()}</span>
        </span>
      )
    }

    if (data.discountPct !== undefined) {
      items.push(
        <span key="discount" className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium">
          <span className="text-muted-foreground text-[11px]">Discount:</span>
          <span className="font-mono">{data.discountPct}%</span>
        </span>
      )
    }

    if (data.quantity !== undefined) {
      items.push(
        <span key="quantity" className="inline-flex items-center gap-1 text-foreground">
          <span className="text-muted-foreground text-[11px]">Qty:</span>
          <span className="font-mono">{data.quantity}</span>
        </span>
      )
    }

    if (data.reason) {
      items.push(
        <span key="reason" className="text-muted-foreground italic">
          &ldquo;{data.reason}&rdquo;
        </span>
      )
    }

    if (data.notes) {
      items.push(
        <span key="notes" className="text-muted-foreground italic">
          {data.notes}
        </span>
      )
    }

    // Capture remaining unhandled keys (excluding raw IDs that have corresponding numbers)
    const handledKeys = new Set([
      'saleNumber', 'returnNumber', 'newSaleNumber', 'total', 'amount',
      'oldPrice', 'newPrice', 'discountPct', 'quantity', 'reason', 'notes',
      'returnId', 'originalSaleId', 'saleId'
    ])

    const extraKeys = Object.keys(data).filter(k => !handledKeys.has(k))
    for (const key of extraKeys) {
      const val = data[key]
      if (val === null || val === undefined) continue
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
      items.push(
        <span key={key} className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="text-[11px]">{label}:</span>
          <span className="font-medium text-foreground font-mono">
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </span>
        </span>
      )
    }

    if (items.length === 0) return '—'

    return (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {items.map((item, idx) => (
          <span key={idx} className="inline-flex items-center">
            {item}
            {idx < items.length - 1 && (
              <span className="ml-2.5 text-muted-foreground/40 select-none">•</span>
            )}
          </span>
        ))}
      </div>
    )
  } catch {
    return detailsStr
  }
}

export default function AuditReportPage() {
  const today = toLocalISODate(new Date())
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [actionFilter, setActionFilter] = useState('ALL')

  function handleRun(dates?: { from: string; to: string }) {
    const fromVal = dates?.from ?? from
    const toVal = dates?.to ?? (to || from)
    if (fromVal > toVal) {
      toast.error('From date cannot be after To date')
      return
    }
    startTransition(async () => {
      setError(null)
      const res = await getAuditReport(fromVal, toVal)
      if (!res.success) {
        setError(res.error || 'Failed to load audit report')
        toast.error(res.error)
        return
      }
      setReport(res.data)
    })
  }

  const filteredLogs = report?.logs.filter(log =>
    actionFilter === 'ALL' ? true : log.action === actionFilter
  )

  function getAuditDetailText(detailsStr: string): string {
    if (!detailsStr || detailsStr === '{}' || detailsStr === 'null') return '—'
    try {
      const data = JSON.parse(detailsStr)
      if (!data || typeof data !== 'object') return detailsStr
      const parts: string[] = []
      if (data.saleNumber) parts.push(`Invoice: ${data.saleNumber}`)
      if (data.returnNumber) parts.push(`Return: ${data.returnNumber}`)
      if (data.newSaleNumber) parts.push(`New Invoice: ${data.newSaleNumber}`)
      if (data.total !== undefined || data.amount !== undefined) parts.push(`Total: Tk ${(data.total ?? data.amount).toLocaleString()}`)
      if (data.oldPrice !== undefined && data.newPrice !== undefined) parts.push(`Price: Tk ${data.oldPrice} -> Tk ${data.newPrice}`)
      if (data.discountPct !== undefined) parts.push(`Discount: ${data.discountPct}%`)
      if (data.quantity !== undefined) parts.push(`Qty: ${data.quantity}`)
      if (data.reason) parts.push(`Reason: ${data.reason}`)
      if (data.notes) parts.push(`Notes: ${data.notes}`)
      return parts.join(' | ') || detailsStr
    } catch {
      return detailsStr
    }
  }

  function handleExportCsv() {
    if (!report || !filteredLogs) return
    const rows = [
      ['AUDIT & SECURITY REPORT'],
      [`Period: ${from} to ${to}`],
      [],
      ['ACTIVITY BY USER'],
      ['User', 'Total Actions', 'Void/Deleted', 'Returns'],
      ...report.byUser.map(u => [u.name, String(u.totalActions), String(u.voidCount), String(u.returnCount)]),
      [],
      ['AUDIT LOGS'],
      ['Timestamp', 'User', 'Action', 'Entity', 'Details'],
      ...filteredLogs.map(l => [
        l.timestamp,
        `"${l.userName.replace(/"/g, '""')}"`,
        l.action,
        l.entityType,
        `"${getAuditDetailText(l.details).replace(/"/g, '""')}"`,
      ]),
    ]
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Audit_Report_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExportExcel() {
    if (!report || !filteredLogs) return
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const wsUsers = wb.addWorksheet('Activity by User')
      wsUsers.addRow(['Audit & Security Report - User Activity']).font = { bold: true, size: 13 }
      wsUsers.addRow([`Period: ${from} to ${to}`]).font = { italic: true }
      wsUsers.addRow([])
      const hUsers = wsUsers.addRow(['User', 'Total Actions', 'Void/Deleted', 'Returns'])
      hUsers.font = { bold: true }
      report.byUser.forEach(u => {
        wsUsers.addRow([u.name, u.totalActions, u.voidCount, u.returnCount])
      })
      wsUsers.columns.forEach(col => { col.width = 20 })

      const wsLogs = wb.addWorksheet('Audit Log')
      wsLogs.addRow(['Audit Log Entries']).font = { bold: true, size: 13 }
      wsLogs.addRow([])
      const hLogs = wsLogs.addRow(['Timestamp', 'User', 'Action', 'Entity', 'Details'])
      hLogs.font = { bold: true }
      filteredLogs.forEach(l => {
        wsLogs.addRow([l.timestamp, l.userName, l.action, l.entityType, getAuditDetailText(l.details)])
      })
      wsLogs.columns = [
        { width: 22 },
        { width: 20 },
        { width: 22 },
        { width: 16 },
        { width: 50 },
      ]

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Audit_Report_${from}_to_${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Excel report exported successfully')
    } catch (e) {
      console.error(e)
      toast.error('Failed to export Excel')
    }
  }

  function handleExportPdf() {
    if (!report || !filteredLogs) return
    const columns: ReportColumn[] = [
      { header: 'Timestamp', key: 'timestamp', align: 'left', width: 'auto' },
      { header: 'User', key: 'userName', align: 'left', width: 'auto' },
      { header: 'Action', key: 'action', align: 'left', width: 'auto' },
      { header: 'Entity', key: 'entityType', align: 'left', width: 'auto' },
      { header: 'Details', key: 'details', align: 'left', width: 'wrap' },
    ]

    const data = filteredLogs.map(l => ({
      timestamp: l.timestamp,
      userName: l.userName,
      action: l.action,
      entityType: l.entityType,
      details: getAuditDetailText(l.details),
    }))

    generatePdfLedger({
      metadata: {
        companyName: 'Store POS',
        title: 'Audit & Security Report',
        subtitle: `Action Filter: ${actionFilter} | Total Logs: ${filteredLogs.length} | Voids: ${report.voidCount} | Returns: ${report.returnCount}`,
        dateRange: `${from} to ${to}`,
      },
      columns,
      data,
      fileName: `Audit_Report_${from}_to_${to}.pdf`,
      orientation: 'landscape',
    })
    toast.success('PDF Ledger generated successfully')
  }

  const summaryCards: SummaryCardItem[] = report
    ? [
        { label: 'Void/Deleted Sales', value: report.voidCount, variant: 'danger' },
        { label: 'Discount Overrides', value: report.discountOverrideCount, variant: 'warning' },
        { label: 'Total Returns', value: report.returnCount, variant: 'info' },
        { label: 'Total Actions', value: report.logs.length, variant: 'primary' },
      ]
    : []

  return (
    <ReportShell
      title="Audit & Security Report"
      description="System Logs, Voids, Overrides & Activity Tracking"
      initialFrom={from}
      initialTo={to}
      onRun={({ from: f, to: t }) => {
        setFrom(f)
        setTo(t)
        handleRun({ from: f, to: t })
      }}
      isPending={isPending}
      isEmpty={!!report && filteredLogs?.length === 0 && report.byUser.length === 0}
      emptyMessage="No audit logs recorded for this period."
      error={error}
      onRetry={() => handleRun({ from, to })}
      summaryCards={summaryCards}
      exportProps={
        report
          ? {
              onExportCsv: handleExportCsv,
              onExportExcel: handleExportExcel,
              onExportPdf: handleExportPdf,
              onPrint: () => window.print(),
            }
          : undefined
      }
      printHeader={
        <div className="hidden print:block">
          <ReportPrintHeader
            title="Audit & Security Report"
            subtitle="System Logs, Voids, Overrides & Activity Tracking"
            dateRange={`${from} to ${to}`}
          />
        </div>
      }
      noContentContainer={true}
    >
      {report && (
        <div className="space-y-6 print:space-y-4 print:w-full">

          {/* Activity by User */}
          <div>
            <h3 className="font-semibold text-sm mb-2 text-slate-800 dark:text-slate-200">Activity by User</h3>
            <div className="overflow-x-auto rounded-md border border-slate-300 dark:border-slate-700 print:border-none print:shadow-none print:p-0 print:m-0 print:rounded-none">
              <table className="w-full text-sm border-collapse border border-slate-300 dark:border-slate-700 [&_tr]:print:break-inside-avoid print:text-[8px] table-auto print:table-auto">
                <thead className="print:table-header-group">
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold print:bg-slate-100 print:text-black">
                    <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold">User</th>
                    <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-right font-semibold w-36">
                      Total Actions
                    </th>
                    <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-right font-semibold w-36">
                      Void/Deleted
                    </th>
                    <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-right font-semibold w-36">
                      Returns
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.byUser.map((user, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors align-top [&>td]:align-top" style={{ verticalAlign: 'top' }}>
                      <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 font-medium print:text-black" style={{ verticalAlign: 'top' }}>{user.name}</td>
                      <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 text-right font-mono tabular-nums" style={{ verticalAlign: 'top' }}>
                        {user.totalActions}
                      </td>
                      <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 text-right font-mono tabular-nums text-red-600 print:text-black font-semibold" style={{ verticalAlign: 'top' }}>
                        {user.voidCount}
                      </td>
                      <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 text-right font-mono tabular-nums" style={{ verticalAlign: 'top' }}>
                        {user.returnCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 print:hidden">
            <Label>Filter by Action:</Label>
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="ALL">All Actions</option>
              <option value="SALE_VOID">Void/Deleted Sales</option>
              <option value="SALE_RETURN">Returns</option>
              <option value="DISCOUNT_OVERRIDE">Discount Overrides</option>
              <option value="PRICE_OVERRIDE">Price Overrides</option>
              <option value="STOCK_ADJUSTMENT">Stock Adjustments</option>
            </select>
          </div>

          {/* Audit Log */}
          <div>
            <h3 className="font-semibold text-sm mb-2 text-slate-800 dark:text-slate-200">
              Audit Log ({filteredLogs?.length || 0} entries)
            </h3>
            <div className="overflow-x-auto rounded-md border border-slate-300 dark:border-slate-700 print:border-none print:shadow-none print:p-0 print:m-0 print:rounded-none">
              <div className="max-h-96 print:max-h-none overflow-y-auto print:overflow-visible">
                <table className="w-full text-sm border-collapse border border-slate-300 dark:border-slate-700 [&_tr]:print:break-inside-avoid print:text-[8px] table-auto print:table-auto">
                  <thead className="sticky top-0 print:static print:table-header-group">
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold print:bg-slate-100 print:text-black">
                      <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold w-px whitespace-nowrap">
                        Timestamp
                      </th>
                      <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold w-36 whitespace-nowrap">User</th>
                      <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold w-36 whitespace-nowrap">
                        Action
                      </th>
                      <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold w-28 whitespace-nowrap">
                        Entity
                      </th>
                      <th className="border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-2 print:px-2 print:py-1 text-left font-semibold w-full whitespace-normal">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!filteredLogs || filteredLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="border border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-muted-foreground"
                        >
                          No audit logs in this period
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors align-top [&>td]:align-top" style={{ verticalAlign: 'top' }}>
                          <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 font-mono text-xs text-muted-foreground print:text-black w-px whitespace-nowrap" style={{ verticalAlign: 'top' }}>
                            {log.timestamp}
                          </td>
                          <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 font-medium print:text-black w-36 whitespace-nowrap" style={{ verticalAlign: 'top' }}>{log.userName}</td>
                          <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 w-36 whitespace-nowrap" style={{ verticalAlign: 'top' }}>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium print:border-none print:bg-transparent print:p-0 print:text-black ${
                                log.action.includes('VOID') ||
                                log.action.includes('DELETE')
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                                  : log.action.includes('OVERRIDE')
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                              }`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 font-mono text-xs w-28 whitespace-nowrap" style={{ verticalAlign: 'top' }}>{log.entityType}</td>
                          <td className="align-top border border-slate-300 dark:border-slate-700 print:border-slate-400 px-3 py-1.5 print:px-2 print:py-0.5 text-xs w-full whitespace-normal break-words" style={{ verticalAlign: 'top' }}>
                            {formatAuditDetails(log.details)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground print:hidden">
            Period: {report.from} → {report.to}. This report helps detect
            employee theft, unauthorized discounts, and suspicious activity.
            <br />
            <strong>Red Flag:</strong> If a cashier has many voids/deleted
            sales, they might be pocketing cash.
          </p>

          <ReportPrintFooter />
        </div>
      )}
    </ReportShell>
  )
}
