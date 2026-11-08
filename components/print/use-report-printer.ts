'use client'

import { RefObject, useCallback, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { toast } from 'sonner'
import { generatePdfLedger, DEFAULT_ROW_COUNT_SAFEGUARD } from './pdf-ledger-generator'
import { PrintManagerProps, ReportMode } from './types'

export interface UseReportPrinterOptions<T = any> extends PrintManagerProps<T> {
  contentRef: RefObject<HTMLDivElement | null>
}

export function useReportPrinter<T = any>(options: UseReportPrinterOptions<T>) {
  const {
    data,
    columns,
    metadata,
    contentRef,
    fileName,
    orientation = 'landscape',
    embeddedLogs,
    onComplete,
  } = options

  const [activeMode, setActiveMode] = useState<ReportMode>(options.mode || 'dashboard')
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  // react-to-print hook integration (Pipeline 2)
  const handleNativePrint = useReactToPrint({
    contentRef: contentRef as any,
    documentTitle: fileName || metadata.title,
    onBeforePrint: async () => {
      setIsPrinting(true)
    },
    onAfterPrint: () => {
      setIsPrinting(false)
      toast.success('Visual print job dispatched')
      onComplete?.('print')
    },
    onPrintError: (_errLocation, error) => {
      setIsPrinting(false)
      console.error('[react-to-print error]', error)
      toast.error('Print preview failed to open. Please check browser pop-up settings.')
    },
  })

  // Trigger Visual Report Print
  const printVisualReport = useCallback(async () => {
    if (!contentRef.current) {
      toast.error('Report view is not ready for printing.')
      return
    }

    try {
      handleNativePrint()
    } catch (err: any) {
      console.error('[printVisualReport error]', err)
      toast.error(err?.message || 'Failed to initialize print dialog')
      setIsPrinting(false)
    }
  }, [contentRef, handleNativePrint])

  // Trigger Dense Ledger PDF Export (Pipeline 1)
  const exportPdfLedger = useCallback(
    async (bypassSafeguard = false) => {
      // Safeguard check for high-volume datasets
      if (!bypassSafeguard && data.length > DEFAULT_ROW_COUNT_SAFEGUARD) {
        const proceed = window.confirm(
          `This dataset contains ${data.length.toLocaleString('en-US')} rows. Generating this dense PDF may take 2-4 seconds. Do you want to proceed?`
        )
        if (!proceed) return
      }

      setIsGeneratingPdf(true)
      toast.info('Generating high-density PDF ledger...')

      try {
        // Run in next tick to allow UI loading state to paint
        await new Promise(r => setTimeout(r, 60))

        const result = await generatePdfLedger({
          data,
          columns,
          metadata,
          fileName,
          orientation,
          currencyMode: 'prefix',
          embeddedLogs,
        })

        toast.success(
          `Ledger generated (${result.pageCount} page${result.pageCount > 1 ? 's' : ''}, ${result.durationMs.toFixed(0)}ms)`
        )
        onComplete?.('pdf')
      } catch (err: any) {
        console.error('[exportPdfLedger error]', err)
        toast.error(err?.message || 'Failed to generate PDF ledger')
      } finally {
        setIsGeneratingPdf(false)
      }
    },
    [data, columns, metadata, fileName, orientation, embeddedLogs, onComplete]
  )

  return {
    activeMode,
    setActiveMode,
    isGeneratingPdf,
    isPrinting,
    printVisualReport,
    exportPdfLedger,
  }
}
