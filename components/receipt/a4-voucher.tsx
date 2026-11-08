'use client'

import React from 'react'

export type VoucherType =
  | 'PAYMENT'
  | 'RECEIPT'
  | 'CONTRA'
  | 'EXPENSE'
  | 'ADJUSTMENT'
  | string

export interface VoucherLine {
  reference?: string | null
  method: string
  details: string
  amount: number
}

export interface A4VoucherProps {
  voucherType: VoucherType
  voucherNumber: string
  date: Date | string
  partyName: string
  partyPhone?: string | null
  partyEmail?: string | null
  partyAddress?: string | null
  accountName?: string
  method?: string
  amount: number
  description?: string
  reference?: string | null
  invoiceRef?: string | null
  createdByName?: string | null
  invoiceTotal?: number | null
  remainingBalance?: number | null
  lines?: VoucherLine[]
  seller?: {
    name?: string
    slogan?: string
    address?: string
    phone?: string
    email?: string
    website?: string
  }
}

const fmtNumber = (n: number) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const formatDate = (val: Date | string) => {
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function numberToWordsUnder1000(value: number): string {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ]

  if (value < 20) return ones[value]
  if (value < 100) {
    return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ''}`.trim()
  }

  return `${ones[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${numberToWordsUnder1000(value % 100)}` : ''}`.trim()
}

export function numberToWords(value: number): string {
  if (!Number.isFinite(value) || value === 0) return 'Zero'

  const scales = [
    { value: 10000000, label: 'Crore' },
    { value: 100000, label: 'Lakh' },
    { value: 1000, label: 'Thousand' },
  ]

  let remainder = Math.floor(value)
  const parts: string[] = []

  for (const scale of scales) {
    if (remainder >= scale.value) {
      const chunk = Math.floor(remainder / scale.value)
      parts.push(`${numberToWordsUnder1000(chunk)} ${scale.label}`)
      remainder %= scale.value
    }
  }

  if (remainder > 0) {
    parts.push(numberToWordsUnder1000(remainder))
  }

  return parts.join(' ').trim()
}

export function buildAmountInWords(amount: number): string {
  const numericTotal = Math.max(0, amount)
  const taka = Math.floor(numericTotal)
  const poisha = Math.round((numericTotal - taka) * 100)
  const takaPart = `${numberToWords(taka)} Taka`
  const poishaPart = poisha > 0 ? ` And ${numberToWords(poisha)} Poisha` : ''

  return `${takaPart}${poishaPart} Only`
}

export function A4Voucher({
  voucherType,
  voucherNumber,
  date,
  partyName,
  partyPhone,
  partyEmail,
  partyAddress,
  accountName,
  method = 'CASH',
  amount,
  description,
  reference,
  invoiceRef,
  createdByName,
  invoiceTotal,
  remainingBalance,
  lines,
  seller,
}: A4VoucherProps) {
  // Existing company defaults
  const sellerName = seller?.name || 'Artyx Digital'
  const sellerSlogan = seller?.slogan || 'Build. Launch. Grow.'
  const sellerAddress =
    seller?.address ||
    'Level 4, House 12, Road 4, Sector 3, Uttara, Dhaka-1230.'
  const sellerPhone = seller?.phone || '+880 1800-000000'
  const sellerEmail = seller?.email || 'admin@artyxdigital.com'
  const sellerWebsite = seller?.website || 'https://artyxdigital.com'

  const mobileNumber = sellerPhone.includes('•')
    ? sellerPhone.split('•')[0].replace('Mobile:', '').trim()
    : '+880 1800-000000'
  const phoneNumber = sellerPhone.includes('Phone:')
    ? sellerPhone.split('Phone:')[1].trim()
    : '+880-1920424323'

  // Voucher type configurations
  const normalizedType = (voucherType || 'PAYMENT').toUpperCase()

  let voucherTitle = 'PAYMENT VOUCHER'
  let partyLabel = 'Company Name'
  let wordsLabel = 'AMOUNT PAID IN WORDS'
  let preparedByLabel = 'Prepared / Issued By'

  if (normalizedType === 'RECEIPT') {
    voucherTitle = 'PAYMENT RECEIPT VOUCHER'
    partyLabel = 'Customer / Client'
    wordsLabel = 'AMOUNT RECEIVED IN WORDS'
    preparedByLabel = 'Received / Collected By'
  } else if (normalizedType === 'CONTRA') {
    voucherTitle = 'CONTRA VOUCHER (FUND TRANSFER)'
    partyLabel = 'Transfer Details'
    wordsLabel = 'AMOUNT TRANSFERRED IN WORDS'
    preparedByLabel = 'Transferred By'
  } else if (normalizedType === 'EXPENSE') {
    voucherTitle = 'EXPENSE PAYMENT VOUCHER'
    partyLabel = 'Payee / Category'
    wordsLabel = 'AMOUNT PAID IN WORDS'
    preparedByLabel = 'Prepared / Claimed By'
  } else if (normalizedType === 'ADJUSTMENT') {
    voucherTitle = 'JOURNAL / ADJUSTMENT VOUCHER'
    partyLabel = 'Party / Account'
    wordsLabel = 'ADJUSTMENT AMOUNT IN WORDS'
    preparedByLabel = 'Adjusted By'
  }

  // Build transaction lines if not explicitly passed
  const transactionLines: VoucherLine[] =
    lines && lines.length > 0
      ? lines
      : [
          {
            reference: invoiceRef || reference || '—',
            method: method || 'Payment',
            details:
              description ||
              (accountName ? `Account: ${accountName}` : 'Settlement of account transactions'),
            amount: amount,
          },
        ]

  const totalAmount = transactionLines.reduce((sum, l) => sum + (l.amount || 0), 0)
  const amountInWords = buildAmountInWords(totalAmount)

  return (
    <div
      className="sales-invoice-root a4-voucher-root voucher-page-container relative mx-auto w-[210mm] min-w-[210mm] max-w-[210mm] min-h-[297mm] print:min-h-[296mm] bg-white text-slate-900 p-[12mm_15mm] print:p-[10mm_12mm] text-[11px] leading-relaxed box-border antialiased flex flex-col justify-between border border-slate-200 print:border-none shadow-none font-sans"
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        textRendering: 'optimizeLegibility',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page {
              size: A4 portrait;
              margin: 8mm 10mm;
            }

            @media print {
              html, body {
                background: #fff !important;
                background-color: #fff !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              .no-print {
                display: none !important;
              }

              .voucher-page-container {
                box-shadow: none !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 210mm !important;
                min-width: 210mm !important;
                max-width: 210mm !important;
                min-height: 296mm !important;
                background: #fff !important;
                color: #000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              .voucher-page-container * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              .voucher-page-container table.items-table th {
                background-color: #f8fafc !important;
                color: #0f172a !important;
                border: 1px solid #cbd5e1 !important;
              }

              .voucher-page-container table.items-table td {
                border: 1px solid #e2e8f0 !important;
              }
            }
          `,
        }}
      />

      {/* Top Section */}
      <div>
        {/* 1. Official Company Header Box */}
        <div className="header-wrapper flex border border-slate-300 mb-4 bg-white">
          {/* Left: Logo & Slogan */}
          <div className="section-logo w-[125px] min-w-[125px] max-w-[125px] border-r border-slate-300 p-2.5 flex flex-col items-center justify-center text-center shrink-0">
            <img
              src="/logo_icons.png"
              alt={sellerName}
              className="max-w-[95px] max-h-[64px] object-contain mb-1"
            />
            <div className="font-bold text-[8.5px] uppercase tracking-wider text-slate-600 leading-tight text-center">
              {sellerSlogan}
            </div>
          </div>

          {/* Right: Company Info */}
          <div className="section-company flex-1 min-w-0 p-[10px_16px] flex flex-col justify-center">
            <h1 className="text-[19px] font-extrabold tracking-tight text-slate-900 uppercase leading-none mb-1.5">
              {sellerName}
            </h1>
            <p className="text-[11px] leading-tight text-slate-600 mb-1.5">
              {sellerAddress}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-slate-700 leading-tight">
              <div>
                <span className="font-semibold text-slate-900">Mobile:</span> {mobileNumber}
              </div>
              <span className="text-slate-300">•</span>
              <div>
                <span className="font-semibold text-slate-900">Phone:</span> {phoneNumber}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-slate-700 leading-tight mt-0.5">
              <div>
                <span className="font-semibold text-slate-900">Email:</span> {sellerEmail}
              </div>
              <span className="text-slate-300">•</span>
              <div>
                <span className="font-semibold text-slate-900">Web:</span> {sellerWebsite}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Document Title Banner */}
        <div className="voucher-banner text-center my-4 py-1.5 border-y border-slate-200">
          <h2 className="text-[14px] font-extrabold tracking-[1.5px] uppercase text-slate-900 inline-block">
            {voucherTitle}
          </h2>
        </div>

        {/* 3. Meta Information Grid */}
        <div className="meta-section grid grid-cols-2 gap-6 mb-5 text-[11.5px] leading-snug">
          {/* Left: Party Details */}
          <div className="space-y-1">
            <div className="flex items-baseline">
              <span className="font-semibold text-slate-500 w-[115px] shrink-0">{partyLabel}:</span>
              <span className="font-bold text-slate-900 text-[12px]">{partyName}</span>
            </div>
            {partyPhone && (
              <div className="flex items-baseline">
                <span className="font-medium text-slate-500 w-[115px] shrink-0">Contact No:</span>
                <span className="font-mono text-slate-800">{partyPhone}</span>
              </div>
            )}
            {partyAddress && (
              <div className="flex items-baseline">
                <span className="font-medium text-slate-500 w-[115px] shrink-0">Billing Address:</span>
                <span className="text-slate-700">{partyAddress}</span>
              </div>
            )}
            {partyEmail && (
              <div className="flex items-baseline">
                <span className="font-medium text-slate-500 w-[115px] shrink-0">Email Address:</span>
                <span className="text-slate-700">{partyEmail}</span>
              </div>
            )}
          </div>

          {/* Right: Voucher Meta */}
          <div className="flex flex-col items-end text-right space-y-1">
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="font-medium text-slate-500">Voucher No:</span>
              <span className="font-mono font-bold text-slate-900 text-[12px] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                {voucherNumber}
              </span>
            </div>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="font-medium text-slate-500">Date:</span>
              <span className="font-medium text-slate-800">{formatDate(date)}</span>
            </div>
            {accountName && (
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="font-medium text-slate-500">Account:</span>
                <span className="font-medium text-slate-700">{accountName}</span>
              </div>
            )}
          </div>
        </div>

        {/* 4. Transaction Table - Minimal Clean Header */}
        <div className="table-container mb-4">
          <table className="items-table w-full border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100/80 text-slate-900">
                <th className="border border-slate-300 p-2 text-center text-[10px] font-bold uppercase tracking-wider w-[22%]">
                  INVOICE / REFERENCE NO.
                </th>
                <th className="border border-slate-300 p-2 text-center text-[10px] font-bold uppercase tracking-wider w-[24%]">
                  PAYMENT METHOD
                </th>
                <th className="border border-slate-300 p-2 text-center text-[10px] font-bold uppercase tracking-wider w-[36%]">
                  TRANSACTION DETAILS
                </th>
                <th className="border border-slate-300 p-2 text-center text-[10px] font-bold uppercase tracking-wider w-[18%]">
                  AMOUNT (BDT)
                </th>
              </tr>
            </thead>
            <tbody>
              {transactionLines.map((line, idx) => (
                <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50/50">
                  <td className="border border-slate-300 p-2.5 text-[11px] font-bold font-mono text-slate-900">
                    {line.reference || invoiceRef || '—'}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-[11px] font-medium text-slate-800">
                    {line.method}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-[11px] text-slate-700">
                    {line.details}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-right font-mono font-bold text-[11.5px] whitespace-nowrap text-slate-900">
                    <span className="float-left font-sans font-normal text-slate-400">৳</span>
                    <span>{fmtNumber(line.amount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 5. Amount in Words */}
        <div className="words-section my-4 p-2.5 bg-slate-50/60 border border-slate-200/80 rounded-md">
          <div className="words-label text-[9.5px] font-bold tracking-wider uppercase mb-0.5 text-slate-500">
            {wordsLabel}
          </div>
          <div className="words-content text-[11.5px] font-medium italic text-slate-800 leading-snug">
            {amountInWords}
          </div>
        </div>

        {/* 6. Summary Breakdown Table */}
        <div className="summary-container flex justify-end my-4">
          <table className="summary-table w-[340px] text-[11.5px] border-collapse">
            <tbody>
              {invoiceTotal ? (
                <tr className="border-b border-slate-200">
                  <td className="py-1 text-left font-medium text-slate-500">Total Invoice Amount:</td>
                  <td className="py-1 text-right font-mono font-bold text-[12px] text-slate-800">
                    ৳ {fmtNumber(invoiceTotal)}
                  </td>
                </tr>
              ) : null}
              <tr className="border-b border-slate-300">
                <td className="py-1.5 text-left font-bold text-slate-900">
                  {normalizedType === 'RECEIPT' ? 'Total Received / Cleared:' : 'Total Amount Paid:'}
                </td>
                <td className="py-1.5 text-right font-mono font-bold text-[12.5px] text-slate-900">
                  ৳ {fmtNumber(totalAmount)}
                </td>
              </tr>
              {remainingBalance !== undefined && remainingBalance !== null ? (
                <tr>
                  <td className="pt-1.5 text-left font-medium text-slate-500">Outstanding Balance:</td>
                  <td className="pt-1.5 text-right font-mono font-bold text-[12px] text-slate-800">
                    ৳ {fmtNumber(remainingBalance)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Signatures Area (Anchored to Bottom of A4) */}
      <div className="signature-area mt-auto pt-10 pb-2 flex justify-between items-end">
        <div className="sig-block text-center w-[200px]">
          <div className="sig-title text-[11px] font-semibold text-slate-800 border-t border-slate-300 pt-1.5">
            {preparedByLabel}
          </div>
          <div className="sig-org text-[10px] text-slate-500 mt-0.5">
            {createdByName || 'Accounts Department'}
          </div>
        </div>

        <div className="sig-block text-center w-[220px]">
          <div className="sig-title text-[11px] font-semibold text-slate-800 border-t border-slate-300 pt-1.5">
            Authorized Representative
          </div>
          <div className="sig-org text-[10px] text-slate-500 mt-0.5">
            Artyx Digital
          </div>
        </div>
      </div>
    </div>
  )
}

