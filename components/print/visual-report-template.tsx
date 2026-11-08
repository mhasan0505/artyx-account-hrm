'use client'

import React, { forwardRef } from 'react'
import { ReportCodeBlock } from './code-block'
import { formatCellValue } from './formatters'
import { PrintManagerProps } from './types'

export interface VisualReportTemplateProps<T = any> extends PrintManagerProps<T> {
  className?: string
  hideHeaderInScreenPreview?: boolean
}

/**
 * Visual Report Template for Pipeline 2 (react-to-print).
 *
 * Implements store branding, executive KPI cards, print-optimized charts,
 * a dense multi-column table with isolated code blocks, and executive signatures.
 *
 * Enforces a strict white background strategy and page-break isolation
 * using an isolated @media print style block.
 */
export const VisualReportTemplate = forwardRef<HTMLDivElement, VisualReportTemplateProps>(
  function VisualReportTemplate(
    {
      data,
      columns,
      metadata,
      kpis = [],
      charts = [],
      embeddedLogs = [],
      mode = 'dashboard',
      className = '',
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={`bg-white text-slate-900 p-6 print:p-0 print:bg-white print:text-black min-h-screen ${className}`}
        style={{
          backgroundColor: '#ffffff',
          color: '#0f172a',
        }}
      >
        {/* Print-Specific Stylesheet Injection */}
        <style dangerouslySetInnerHTML={{
          __html: `
            @page {
              size: landscape;
              margin: 10mm;
            }

            @media print {
              html, body {
                background: #ffffff !important;
                background-color: #ffffff !important;
                color: #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              /* Universal white background override to wipe out any dark-mode classes */
              .print-container,
              .print-container * {
                background-color: #ffffff !important;
                color: #000000 !important;
                border-color: #cbd5e1 !important; /* Slate 300 */
                box-shadow: none !important;
                text-shadow: none !important;
              }

              /* Preserve code block subtle tint for legibility */
              .print-code-pill {
                background-color: #f1f5f9 !important;
                color: #0f172a !important;
                border: 1px solid #cbd5e1 !important;
              }

              /* Page break rules to prevent splitting mid-sentence */
              tr,
              .print-avoid-break {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }

              .print-header-repeat {
                display: table-header-group !important;
              }
            }
          `
        }} />

        <div className="print-container max-w-[1400px] mx-auto space-y-6">
          {/* 1. Store Branding Header (Extension of existing ReportPrintHeader) */}
          <div className="block pb-4 border-b-2 border-slate-900 print:break-inside-avoid">
            <div className="flex justify-between items-start gap-6">
              <div className="flex items-center gap-3">
                <img
                  src={metadata.companyLogo || '/artyx-logo.webp'}
                  alt={metadata.companyName || 'Artyx Digital'}
                  className="h-14 w-14 object-contain shrink-0"
                />
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-tight">
                    {metadata.companyName || 'Artyx Digital'}
                  </h2>
                  {metadata.outletName && (
                    <p className="text-xs font-semibold text-slate-700 mt-0.5">
                      Outlet: {metadata.outletName}
                    </p>
                  )}
                  {metadata.companyAddress && (
                    <p className="text-[11px] text-slate-600 leading-tight mt-0.5 max-w-sm">
                      {metadata.companyAddress}
                    </p>
                  )}
                  {(metadata.companyPhone || metadata.companyEmail) && (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {[metadata.companyPhone, metadata.companyEmail].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <h1 className="text-xl font-extrabold uppercase tracking-tight text-slate-900">
                  {metadata.title}
                </h1>
                {metadata.subtitle && (
                  <p className="text-xs text-slate-600 font-medium mt-0.5">
                    {metadata.subtitle}
                  </p>
                )}
                {metadata.dateRange && (
                  <p className="text-xs text-slate-800 font-semibold mt-1">
                    Period: <span className="font-mono">{metadata.dateRange}</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-500 mt-1">
                  Generated: {metadata.generatedAt || new Date().toLocaleString('en-GB')}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Executive KPI Cards Grid (Dashboard Mode) */}
          {mode === 'dashboard' && kpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4 print:gap-2 print-avoid-break">
              {kpis.map((kpi, idx) => (
                <div
                  key={kpi.id || idx}
                  className="bg-white border border-slate-300 rounded-lg p-3 shadow-none print:border-slate-400"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    {kpi.label}
                  </p>
                  <p className="text-xl font-bold font-mono text-slate-900 mt-1 tracking-tight">
                    {kpi.value}
                  </p>
                  {kpi.subtext && (
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      {kpi.subtext}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 3. Visual Charts (Dashboard Mode) */}
          {mode === 'dashboard' && charts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3 print-avoid-break">
              {charts.map((chart, idx) => (
                <div
                  key={chart.id || idx}
                  className="bg-white border border-slate-300 rounded-lg p-4 print:border-slate-400 print-avoid-break"
                >
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3 border-b border-slate-200 pb-1.5">
                    {chart.title}
                  </h3>
                  <div className="h-40 flex items-end justify-between gap-2 pt-2 px-1">
                    {chart.data.map((point, pIdx) => {
                      const firstSeries = chart.series[0]
                      const val = Number(point[firstSeries?.dataKey || 'value'] || 0)
                      const max = Math.max(...chart.data.map(d => Number(d[firstSeries?.dataKey || 'value'] || 0)), 1)
                      const pct = Math.min(100, Math.max(10, Math.round((val / max) * 100)))

                      return (
                        <div key={pIdx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                          <span className="text-[9px] font-mono text-slate-700">
                            {val.toLocaleString('en-US')}
                          </span>
                          <div
                            className="w-full rounded-t bg-slate-700 print:bg-slate-800 transition-all"
                            style={{ height: `${pct}%`, minHeight: '6px' }}
                          />
                          <span className="text-[8px] font-medium text-slate-600 truncate max-w-full">
                            {point.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 4. Wide Multi-Column Data Table */}
          <div className="overflow-x-auto rounded border border-slate-300 print:border-none print:shadow-none print:m-0 print:p-0">
            <table className="w-full text-left border-collapse table-auto print:table-auto text-xs print:text-[8px]">
              <thead className="print-header-repeat bg-slate-100 print:bg-slate-100 border-b border-slate-300 text-slate-800 font-semibold">
                <tr>
                  {columns.map((col, idx) => {
                    const alignClass =
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                    const isExpand =
                      col.key === 'productName' ||
                      col.key === 'item' ||
                      col.key === 'description' ||
                      col.key === 'product' ||
                      (typeof col.width === 'string' && col.width === 'full')
                    const widthClass = isExpand ? 'w-full' : 'w-px whitespace-nowrap'
                    return (
                      <th
                        key={String(col.key) || idx}
                        className={`border border-slate-300 print:border-slate-400 px-2.5 py-1.5 print:px-2 print:py-0.5 font-semibold ${alignClass} ${widthClass}`}
                        style={{ width: typeof col.width === 'number' ? `${col.width}%` : col.width !== 'full' ? col.width : undefined }}
                      >
                        {col.header}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-8 text-center text-slate-500 italic"
                    >
                      No records found for the selected criteria.
                    </td>
                  </tr>
                ) : (
                  data.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className="hover:bg-slate-50 print:bg-white print-avoid-break transition-colors"
                    >
                      {columns.map((col, colIdx) => {
                        const alignClass =
                          col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                        const vAlignClass =
                          col.valign === 'middle' ? 'align-middle' : col.valign === 'bottom' ? 'align-bottom' : '!align-top align-top'
                        const isExpand =
                          col.key === 'productName' ||
                          col.key === 'item' ||
                          col.key === 'description' ||
                          col.key === 'product' ||
                          (typeof col.width === 'string' && col.width === 'full')
                        const widthClass = isExpand ? 'w-full' : 'w-px whitespace-nowrap'
                        const formattedValue = formatCellValue(col, row, rowIdx, 'visual')

                        return (
                          <td
                            key={String(col.key) || colIdx}
                            className={`border border-slate-300 print:border-slate-400 px-2.5 py-1.5 ${vAlignClass} ${alignClass} ${widthClass}`}
                            style={{ verticalAlign: col.valign || 'top' }}
                          >
                            {col.render ? (
                              col.render((row as any)[col.key], row, rowIdx)
                            ) : col.isCode ? (
                              <ReportCodeBlock className="print-code-pill">
                                {formattedValue}
                              </ReportCodeBlock>
                            ) : (
                              <span
                                className={
                                  col.type === 'currency' || col.type === 'number'
                                    ? 'font-mono tabular-nums'
                                    : col.type === 'code'
                                    ? 'font-mono'
                                    : ''
                                }
                              >
                                {formattedValue}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 5. Embedded Transaction Logs (if provided) */}
          {embeddedLogs && embeddedLogs.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-200 print-avoid-break">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Transaction Audit & Security Tokens
              </h4>
              <div className="space-y-1">
                {embeddedLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 text-[10px] print:text-[7.5px] font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 print-code-pill"
                  >
                    <span className="font-bold text-slate-900 shrink-0">{log.token}</span>
                    <span className="text-slate-700 flex-1 truncate">{log.message}</span>
                    {log.timestamp && (
                      <span className="text-slate-500 shrink-0">{log.timestamp}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. Executive Signatures (Extension of existing ReportPrintFooter) */}
          <div className="mt-8 pt-4 border-t border-slate-300 print-avoid-break">
            <div className="grid grid-cols-2 gap-12 text-center text-xs text-slate-800">
              <div>
                <div className="border-t border-slate-900 w-48 mx-auto pt-1.5 font-semibold text-[10px] uppercase tracking-wider text-slate-900">
                  {metadata.preparedBy || 'Prepared By'}
                </div>
                <p className="text-[9px] text-slate-500 mt-0.5">Staff Signature & Date</p>
              </div>
              <div>
                <div className="border-t border-slate-900 w-48 mx-auto pt-1.5 font-semibold text-[10px] uppercase tracking-wider text-slate-900">
                  {metadata.approvedBy || 'Authorized Signature'}
                </div>
                <p className="text-[9px] text-slate-500 mt-0.5">Management Approval</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
)
