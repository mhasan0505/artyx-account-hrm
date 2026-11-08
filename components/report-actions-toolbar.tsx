'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileText, FileSpreadsheet, FileDown, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export interface ReportActionsToolbarProps {
  onExportCsv?: () => void | Promise<void>
  onExportExcel?: () => void | Promise<void>
  onExportPdf?: () => void | Promise<void>
  onPrint?: () => void
  disabled?: boolean
  className?: string
}

/**
 * Standardized Export & Print Action Toolbar for POS Reports.
 * Provides quick access to CSV, Excel, Dense PDF Ledger, and Visual Printing.
 */
export function ReportActionsToolbar({
  onExportCsv,
  onExportExcel,
  onExportPdf,
  onPrint = () => window.print(),
  disabled = false,
  className = '',
}: ReportActionsToolbarProps) {
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  async function handleExcel() {
    if (!onExportExcel || isExportingExcel || disabled) return
    try {
      setIsExportingExcel(true)
      await onExportExcel()
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to export Excel')
    } finally {
      setIsExportingExcel(false)
    }
  }

  async function handlePdf() {
    if (!onExportPdf || isExportingPdf || disabled) return
    try {
      setIsExportingPdf(true)
      await onExportPdf()
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to export PDF')
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 print:hidden ${className}`}>
      {onExportCsv && (
        <Button
          variant="outline"
          size="sm"
          onClick={onExportCsv}
          disabled={disabled}
          className="text-xs font-medium"
        >
          <FileText className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
          Export CSV
        </Button>
      )}

      {onExportExcel && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleExcel}
          disabled={disabled || isExportingExcel}
          className="text-xs font-medium"
        >
          {isExportingExcel ? (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
          )}
          {isExportingExcel ? 'Exporting...' : 'Export Excel (.xlsx)'}
        </Button>
      )}

      {onExportPdf && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePdf}
          disabled={disabled || isExportingPdf}
          className="text-xs font-medium"
        >
          {isExportingPdf ? (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
          )}
          {isExportingPdf ? 'Generating...' : 'Download PDF Ledger'}
        </Button>
      )}

      {onPrint && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPrint}
          disabled={disabled}
          className="text-xs font-medium"
        >
          <Printer className="mr-1.5 h-3.5 w-3.5 text-slate-700 dark:text-slate-300" />
          Print Report
        </Button>
      )}
    </div>
  )
}
