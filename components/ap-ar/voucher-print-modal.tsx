'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Loader2, Printer, Receipt, X } from 'lucide-react'
import { ApArOverviewData } from '@/lib/actions/ap-ar'
import { A4Voucher } from '@/components/receipt/a4-voucher'
import { downloadElementAsPdf } from '@/lib/pdf/direct-pdf-download'
import { toast } from 'sonner'

interface VoucherData {
  id?: string
  voucherNumber: string
  voucherType: string
  date: Date | string
  partyName: string
  partyPhone?: string | null
  partyEmail?: string | null
  partyAddress?: string | null
  accountName?: string
  method?: string
  amount: number
  reference?: string | null
  description?: string
  createdByName?: string | null
  invoiceRef?: string | null
  invoiceTotal?: number | null
  remainingBalance?: number | null
  lines?: Array<{
    reference?: string | null
    method: string
    details: string
    amount: number
  }>
  seller?: {
    name?: string
    slogan?: string
    address?: string
    phone?: string
    email?: string
    website?: string
  }
}

interface Props {
  voucher: (ApArOverviewData['vouchers'][0] & { partyAddress?: string | null }) | VoucherData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VoucherPrintModal({ voucher, open, onOpenChange }: Props) {
  const [isDownloading, setIsDownloading] = useState(false)

  if (!voucher) return null

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPdf = async () => {
    const printArea = document.getElementById('voucher-print-area')
    if (!printArea) {
      toast.error('Voucher content is not ready for export')
      return
    }

    try {
      setIsDownloading(true)
      const sanitizedNumber = (voucher.voucherNumber || 'Document')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .trim()
      const fileName = `Voucher_${sanitizedNumber}`

      const result = await downloadElementAsPdf({
        element: printArea,
        fileName,
      })

      if (result.success) {
        toast.success('Voucher PDF downloaded successfully')
      } else {
        toast.error(result.error || 'Failed to download PDF voucher')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error downloading PDF voucher')
    } finally {
      setIsDownloading(false)
    }
  }

  const voucherTypeLabel = (voucher.voucherType || 'PAYMENT').replace(/_/g, ' ').toUpperCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-[880px] p-0 overflow-hidden min-w-0 max-h-[94vh] flex flex-col bg-slate-100 print:bg-white print:p-0 print:border-none print:shadow-none print:max-w-none [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Voucher Preview - {voucher.voucherNumber}</DialogTitle>

        {/* Modal Toolbar - Hidden during print */}
        <div className="no-print flex items-center justify-between px-4 sm:px-5 py-2.5 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-7 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Receipt className="size-4" />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase font-extrabold tracking-wider text-slate-500">
                {voucherTypeLabel}
              </span>
              <span className="text-[11px] font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                #{voucher.voucherNumber}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Download PDF Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="h-8 text-xs font-semibold px-3 gap-1.5 border-slate-300 hover:bg-slate-50 text-slate-800 transition-colors"
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
              ) : (
                <Download className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>{isDownloading ? 'Generating...' : 'Download PDF'}</span>
            </Button>

            {/* Print Button */}
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8 px-3.5 font-semibold shadow-xs gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </Button>

            {/* Divider */}
            <div className="h-4 w-px bg-slate-200 mx-1" />

            {/* Clean Close Button in Right Position */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>

        {/* Scrollable Printable Area on Screen */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6 print:p-0 print:overflow-visible flex justify-center bg-slate-100/70">
          <div id="voucher-print-area" className="w-[210mm] max-w-full">
            <A4Voucher
              voucherType={voucher.voucherType}
              voucherNumber={voucher.voucherNumber}
              date={voucher.date}
              partyName={voucher.partyName}
              partyPhone={voucher.partyPhone}
              partyEmail={voucher.partyEmail}
              partyAddress={(voucher as any).partyAddress}
              accountName={voucher.accountName}
              method={voucher.method}
              amount={voucher.amount}
              reference={voucher.reference}
              description={voucher.description}
              createdByName={voucher.createdByName}
              invoiceRef={voucher.invoiceRef}
              invoiceTotal={(voucher as any).invoiceTotal}
              remainingBalance={(voucher as any).remainingBalance}
              lines={(voucher as any).lines}
              seller={(voucher as any).seller}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
