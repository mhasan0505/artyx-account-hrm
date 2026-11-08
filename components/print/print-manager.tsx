'use client'

import React, { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrintManagerProps } from './types'
import { useReportPrinter } from './use-report-printer'
import { VisualReportTemplate } from './visual-report-template'

export interface PrintManagerComponentProps<T = any> extends PrintManagerProps<T> {
  showToolbar?: boolean
  showPreviewToggle?: boolean
  initialPreviewOpen?: boolean
  className?: string
}

/**
 * Unified Print Manager component for Point of Sale (POS) reporting.
 *
 * Provides a unified controller for:
 * 1. Pipeline 1: Dense Data List / Ledger PDF via jsPDF + autotable.
 * 2. Pipeline 2: Visual Reports, Charts, & KPIs via react-to-print.
 */
export function PrintManager<T = any>({
  data,
  columns,
  metadata,
  kpis = [],
  charts = [],
  embeddedLogs = [],
  mode: initialMode = 'dashboard',
  fileName,
  orientation = 'landscape',
  onComplete,
  showToolbar = true,
  showPreviewToggle = true,
  initialPreviewOpen = true,
  className = '',
}: PrintManagerComponentProps<T>) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(initialPreviewOpen)

  const {
    activeMode,
    setActiveMode,
    isGeneratingPdf,
    isPrinting,
    printVisualReport,
    exportPdfLedger,
  } = useReportPrinter({
    data,
    columns,
    metadata,
    kpis,
    charts,
    embeddedLogs,
    mode: initialMode,
    fileName,
    orientation,
    contentRef,
    onComplete,
  })

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 1. Control Toolbar (Screen only) */}
      {showToolbar && (
        <div className="print:hidden flex flex-wrap items-center justify-between gap-3 p-3 bg-card border border-border rounded-xl shadow-sm">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border border-border/50 text-xs">
            <button
              type="button"
              onClick={() => setActiveMode('dashboard')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                activeMode === 'dashboard'
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Visual Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('ledger')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                activeMode === 'ledger'
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Dense Ledger ({data.length} rows)
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {showPreviewToggle && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPreviewOpen(prev => !prev)}
                className="text-xs"
              >
                {isPreviewOpen ? 'Hide Preview' : 'Show Preview'}
              </Button>
            )}

            {/* Pipeline 2: Visual Print */}
            <Button
              variant="default"
              size="sm"
              onClick={printVisualReport}
              disabled={isPrinting || isGeneratingPdf}
              className="text-xs font-semibold gap-1.5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              {isPrinting ? 'Preparing Print...' : 'Print Visual Report'}
            </Button>

            {/* Pipeline 1: Dense PDF Ledger */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportPdfLedger(false)}
              disabled={isGeneratingPdf || isPrinting}
              className="text-xs font-semibold gap-1.5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {isGeneratingPdf ? 'Compiling PDF...' : 'Download PDF Ledger'}
            </Button>
          </div>
        </div>
      )}

      {/* 2. Visual Report Container & Print Target */}
      <div
        className={`${
          isPreviewOpen ? 'block' : 'hidden print:block'
        } overflow-hidden rounded-xl border border-slate-300 dark:border-slate-800 bg-white shadow-sm print:border-none print:shadow-none`}
      >
        <VisualReportTemplate
          ref={contentRef}
          data={data}
          columns={columns}
          metadata={metadata}
          kpis={kpis}
          charts={charts}
          embeddedLogs={embeddedLogs}
          mode={activeMode}
          orientation={orientation}
        />
      </div>
    </div>
  )
}
