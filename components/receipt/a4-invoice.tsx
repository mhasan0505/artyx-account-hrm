'use client'

function parseSellerPhones(phone: string | null | undefined): string[] {
  if (!phone) return []
  return Array.from(
    new Set(
      phone
        .split(/[,/|]/)
        .map((p) => p.trim())
        .filter(Boolean)
    )
  )
}

import Image from 'next/image'
import Barcode from 'react-barcode'
import {
  consolidateInvoiceLines,
  shouldDisplayCustomerPhone,
} from './line-consolidation'

type NumericLike = number | string | { toString(): string }

type InvoiceParty = {
  name: string
  slogan?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

type InvoiceLine = {
  id: string
  description: string
  code?: string | null
  quantity: NumericLike
  unitPrice: NumericLike
  discount?: NumericLike
  total: NumericLike
  serials?: string[]
  isGift?: boolean
  note?: string | null
  parentLineId?: string | null
  specs?: string[]
}

type InvoicePayment = {
  label: string
  amount: NumericLike
  reference?: string | null
  paidAt?: Date | string
}

interface A4InvoiceProps {
  invoiceType:
    | 'SALES INVOICE'
    | 'PURCHASE INVOICE'
    | 'DEBIT NOTE'
    | 'PURCHASE RETURN'
    | (string & {})
  invoiceNumber: string
  invoiceDate: Date | string
  barcodeValue?: string
  seller: InvoiceParty & { website?: string | null }
  billToLabel: string
  billTo: InvoiceParty
  secondaryLabel?: string
  secondaryValue?: string | null
  lines: InvoiceLine[]
  subtotal: NumericLike
  discountTotal?: NumericLike
  previousDue?: NumericLike
  newBalance?: NumericLike
  isB2BLinked?: boolean
  currentBill?: NumericLike
  paidAmount?: NumericLike
  balanceDue?: NumericLike
  totalDue?: NumericLike
  grandTotal: NumericLike
  amountInWords?: string
  notes?: string | null
  payments?: InvoicePayment[]
  terms?: string[]
  footerText?: string
}

function toNumber(value: NumericLike | undefined) {
  if (value === undefined) return 0
  return Number(value)
}

function formatMoney(value: NumericLike | undefined) {
  return toNumber(value).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(value: Date | string) {
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  const isUtcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0

  if (isUtcMidnight) {
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
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

function numberToWords(value: number): string {
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

function buildAmountInWords(total: NumericLike): string {
  const numericTotal = toNumber(total)
  const taka = Math.floor(numericTotal)
  const poisha = Math.round((numericTotal - taka) * 100)
  const takaPart = `${numberToWords(taka)} Taka`
  const poishaPart = poisha > 0 ? ` And ${numberToWords(poisha)} Poisha` : ''

  return `${takaPart}${poishaPart} Only`
}

function SalesInvoiceLayout(props: A4InvoiceProps) {
  const {
    invoiceType,
    invoiceNumber,
    invoiceDate,
    barcodeValue,
    seller,
    billTo,
    secondaryLabel = 'Sold by',
    secondaryValue,
    lines,
    subtotal,
    paidAmount,
    balanceDue,
    grandTotal,
    amountInWords,
    notes,
    payments,
    terms,
    previousDue,
    newBalance,
    isB2BLinked,
    footerText,
  } = props

  const resolvedWords = amountInWords ?? buildAmountInWords(grandTotal)

  const paymentInfoString = (() => {
    if (payments && payments.length > 0) {
      return payments.map(p => `${p.label} ${formatMoney(p.amount)}`).join(' | ')
    }
    if (toNumber(paidAmount) > 0) {
      return `Cash ${formatMoney(paidAmount)}`
    }
    return 'Cash 0.00'
  })()

  const currentYear = new Date().getFullYear()

  const organizedLines = consolidateInvoiceLines(lines || [])

  const hasDue =
    toNumber(previousDue) > 0.009 ||
    toNumber(balanceDue) > 0.009 ||
    toNumber(newBalance) > 0.009 ||
    (Boolean(isB2BLinked) &&
      Math.abs(toNumber(newBalance ?? previousDue)) > 0.009)

  const hasComment = Boolean(
    notes &&
    String(notes).trim().length > 0 &&
    String(notes).trim() !== '-' &&
    String(notes).trim().toLowerCase() !== 'null' &&
    String(notes).trim().toLowerCase() !== 'undefined' &&
    String(notes).trim().toLowerCase() !== 'none'
  )

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page {
              size: A4 portrait;
              margin: 0 !important;
            }

            @media print {
              html,
              body {
                background: #fff !important;
                background-color: #fff !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 210mm !important;
                height: auto !important;
                overflow: visible !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              .no-print,
              .print\\:hidden,
              aside,
              header,
              nav,
              button {
                display: none !important;
              }

              /* Unconstrain all parent app shells */
              [data-slot="sidebar-wrapper"],
              [data-slot="sidebar-inset"],
              main {
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                width: 100% !important;
                max-width: 100% !important;
                box-shadow: none !important;
                background: #fff !important;
              }

              #a4-invoice-container {
                width: 210mm !important;
                max-width: 210mm !important;
                min-height: 296mm !important;
                margin: 0 auto !important;
                padding: 0 !important;
                background: #fff !important;
                display: flex !important;
                flex-direction: column !important;
              }

              .sales-invoice-root {
                box-shadow: none !important;
                border: none !important;
                margin: 0 !important;
                width: 210mm !important;
                max-width: 210mm !important;
                min-height: 296mm !important;
                display: flex !important;
                flex-direction: column !important;
                padding: 8mm 10mm 6mm !important;
                font-family: var(--print-font-sans, 'Segoe UI', Tahoma, -apple-system, BlinkMacSystemFont, Arial, sans-serif) !important;
                font-size: var(--print-text-body, 10.5px) !important;
                line-height: var(--print-leading-normal, 1.35) !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                box-sizing: border-box !important;
                background: #fff !important;
                color: var(--print-text-primary, #242424) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              .sales-invoice-root .invoice-bottom-block {
                margin-top: auto !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-end !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }

              /* Crisp solid borders across entire printed document */
              .sales-invoice-root,
              .sales-invoice-root * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              /* Crisp accent borders across entire printed document */
              .sales-invoice-root .border,
              .sales-invoice-root .border-b,
              .sales-invoice-root .border-t,
              .sales-invoice-root .border-l,
              .sales-invoice-root .border-r,
              .sales-invoice-root th,
              .sales-invoice-root td {
                border-color: var(--print-border-brand, #2b6fd6) !important;
              }

              /* Header Flex Row */
              .sales-invoice-root .header-wrapper {
                display: flex !important;
                flex-direction: row !important;
                width: 100% !important;
                border: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                margin-bottom: 10px !important;
                box-sizing: border-box !important;
              }

              .sales-invoice-root .section-logo {
                width: 130px !important;
                min-width: 130px !important;
                max-width: 130px !important;
                border-right: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .sales-invoice-root .section-company {
                flex: 1 1 auto !important;
                border-right: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              /* Meta table: strictly 260px fixed width */
              .sales-invoice-root table.meta-table,
              .sales-invoice-root .meta-table {
                width: 260px !important;
                min-width: 260px !important;
                max-width: 260px !important;
                table-layout: fixed !important;
                margin: 0 !important;
                border-collapse: collapse !important;
                box-sizing: border-box !important;
              }

              .sales-invoice-root .meta-table td {
                padding: 5px 8px !important;
                font-size: var(--print-text-detail-lg, 11.5px) !important;
                line-height: var(--print-leading-snug, 1.3) !important;
                vertical-align: middle !important;
                border-bottom: 1px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .sales-invoice-root .meta-table td.lbl {
                font-size: var(--print-text-detail, 11px) !important;
                font-weight: 500 !important;
              }

              .sales-invoice-root .meta-table td.val {
                border-left: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .sales-invoice-root .meta-table tr:last-child td {
                border-bottom: none !important;
              }

              .sales-invoice-root .meta-table .barcode-cell {
                border-left: none !important;
                height: 50px !important;
              }

              /* Customer strip: clean, simple, one line */
              .sales-invoice-root .customer-strip {
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                width: 100% !important;
                margin-top: 0 !important;
                margin-bottom: 10px !important;
                padding: 4px 10px !important;
                border: 1px solid var(--print-border-light, #93c5fd) !important;
                box-sizing: border-box !important;
                font-size: var(--print-text-meta, 10px) !important;
                line-height: var(--print-leading-normal, 1.35) !important;
              }

              /* Items table: strictly 100% fixed */
              .sales-invoice-root table.items {
                width: 100% !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                table-layout: fixed !important;
                border: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                border-collapse: collapse !important;
                page-break-inside: auto !important;
              }

              .sales-invoice-root table.items th,
              .sales-invoice-root table.items td {
                padding: 5px 6px !important;
                font-size: var(--print-text-body, 10.5px) !important;
                line-height: var(--print-leading-normal, 1.35) !important;
                vertical-align: middle !important;
                border: 1px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .sales-invoice-root table.items td.payment-summary-cell {
                border-top: none !important;
                border-bottom: none !important;
                border-left: none !important;
                border-right: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                vertical-align: middle !important;
                text-align: center !important;
                font-size: var(--print-text-meta, 10px) !important;
              }

              .sales-invoice-root table.items th {
                color: var(--print-brand-dark, #1e3a8a) !important;
                font-size: var(--print-text-th, 10px) !important;
                font-weight: 600 !important;
                letter-spacing: 0.05em !important;
                text-transform: uppercase !important;
                text-align: center !important;
              }

              .sales-invoice-root table.items td.grand-total-val {
                font-size: var(--print-text-total, 12px) !important;
                font-weight: 700 !important;
              }

              .sales-invoice-root tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }

              .sales-invoice-root .signatures {
                margin-top: 40px !important;
              }

              .sales-invoice-root .signatures .sig {
                border-top: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .sales-invoice-root .footer {
                border-top: 1px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .sales-invoice-root .service {
                border-top: 1px dashed var(--print-border-brand, #2b6fd6) !important;
                border-bottom: 1px dashed var(--print-border-brand, #2b6fd6) !important;
                border-left: none !important;
                border-right: none !important;
              }
            }
          `,
        }}
      />

      <div
        className="sales-invoice-root a4-invoice-container print-doc-root relative mx-auto w-[210mm] min-w-[210mm] max-w-[210mm] min-h-[297mm] print:min-h-[296mm] bg-white text-[var(--print-text-primary,#242424)] p-[10mm_12mm_8mm] print:p-[8mm_10mm_6mm] print:w-[210mm] text-[var(--print-text-body,10.5px)] leading-[var(--print-leading-normal,1.35)] box-border antialiased flex flex-col"
        style={{
          fontFamily:
            "'Segoe UI', Tahoma, -apple-system, BlinkMacSystemFont, Arial, sans-serif",
          textRendering: 'optimizeLegibility',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {/* Header Wrapper */}
        <div className="header-wrapper flex border border-[var(--print-border-brand,#2b6fd6)] mb-2.5 text-[var(--print-text-primary,#242424)]">
          {/* Logo Section */}
          <div className="section-logo w-[130px] min-w-[130px] max-w-[130px] border-r border-[var(--print-border-brand,#2b6fd6)] p-2 flex flex-col items-center justify-center text-center shrink-0">
            <Image
              src="/logo_icons.png"
              alt={seller.name}
              width={96}
              height={64}
              className="max-w-[100px] max-h-[70px] object-contain mb-1"
              priority
            />
            <div className="print-meta font-semibold text-[var(--print-text-meta,10px)] uppercase tracking-wider text-[var(--print-text-secondary,#3F4652)] leading-tight text-center">
              {seller.slogan || 'Tech & Laptop Solutions'}
            </div>
          </div>

          {/* Company Details */}
          <div className="section-company flex-1 min-w-0 p-[10px_12px] border-r border-[var(--print-border-brand,#2b6fd6)] flex flex-col justify-center text-[var(--print-text-primary,#242424)]">
            <h2 className="print-company-name text-[var(--print-text-company,21px)] font-bold tracking-tight mb-1 text-[var(--print-brand-dark,#1e3a8a)] leading-tight">
              {seller.name}
            </h2>
            {seller.address && (
              <p className="print-detail-lg text-[var(--print-text-detail-lg,11.5px)] leading-snug mb-1 text-[var(--print-text-secondary,#3F4652)] font-normal">
                {seller.address}
              </p>
            )}
            {(() => {
              const sellerPhones = parseSellerPhones(seller.phone || '01701561365')
              if (sellerPhones.length <= 1) {
                return (
                  <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug mb-0.5 text-[var(--print-text-secondary,#3F4652)]">
                    <span className="font-semibold text-[var(--print-text-secondary,#3F4652)]">Phone:</span>{' '}
                    <span className="font-medium text-[var(--print-text-primary,#242424)]">
                      {sellerPhones[0] || '01701561365'}
                    </span>
                  </p>
                )
              }
              return (
                <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug mb-0.5 text-[var(--print-text-secondary,#3F4652)]">
                  <span className="font-semibold text-[var(--print-text-secondary,#3F4652)]">Mobile:</span>{' '}
                  <span className="font-medium text-[var(--print-text-primary,#242424)]">
                    {sellerPhones[0]}
                  </span>
                  <span className="text-[var(--print-text-secondary,#3F4652)]/50 mx-1.5">•</span>
                  <span className="font-semibold text-[var(--print-text-secondary,#3F4652)]">Phone:</span>{' '}
                  <span className="font-medium text-[var(--print-text-primary,#242424)]">
                    {sellerPhones[1]}
                  </span>
                </p>
              )
            })()}
            <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug text-[var(--print-text-secondary,#3F4652)]">
              <span className="font-semibold text-[var(--print-text-secondary,#3F4652)]">Email:</span>{' '}
              <span className="font-medium text-[var(--print-text-primary,#242424)]">
                {seller.email || 'admin@artyxdigital.com'}
              </span>
              <span className="text-[var(--print-text-secondary,#3F4652)]/50 mx-1.5">•</span>
              <span className="font-semibold text-[var(--print-text-secondary,#3F4652)]">Web:</span>{' '}
              <span className="font-medium text-[var(--print-text-primary,#242424)]">
                {seller.website || 'https://artyxdigital.com'}
              </span>
            </p>
          </div>

          {/* Meta Table */}
          <table className="meta-table w-[260px] min-w-[260px] max-w-[260px] border-collapse shrink-0 text-[var(--print-text-primary,#242424)] table-fixed">
            <tbody>
              <tr>
                <td
                  colSpan={2}
                  className="barcode-cell border-b border-[var(--print-border-brand,#2b6fd6)] p-1 h-[50px] text-center align-middle"
                >
                  <div className="flex items-center justify-center h-full max-w-full overflow-hidden text-[var(--print-text-black,#000000)]">
                    <Barcode
                      value={barcodeValue ?? invoiceNumber}
                      format="CODE128"
                      width={1.2}
                      height={36}
                      margin={0}
                      displayValue={false}
                    />
                  </div>
                </td>
              </tr>
              <tr>
                <td className="lbl print-detail w-[40%] border-b border-[var(--print-border-brand,#2b6fd6)] p-[5px_8px] text-[var(--print-text-detail,11px)] font-medium text-[var(--print-text-secondary,#3F4652)] align-middle">
                  Invoice N°
                </td>
                <td className="val print-detail-lg w-[60%] border-b border-l border-[var(--print-border-brand,#2b6fd6)] p-[5px_8px] text-[var(--print-text-detail-lg,11.5px)] font-bold text-[var(--print-brand-dark,#1e3a8a)] text-right align-middle tracking-tight font-mono">
                  {invoiceNumber}
                </td>
              </tr>
              <tr>
                <td className="lbl print-detail w-[40%] border-b border-[var(--print-border-brand,#2b6fd6)] p-[5px_8px] text-[var(--print-text-detail,11px)] font-medium text-[var(--print-text-secondary,#3F4652)] align-middle">
                  Date:
                </td>
                <td className="val print-detail w-[60%] border-b border-l border-[var(--print-border-brand,#2b6fd6)] p-[5px_8px] text-[var(--print-text-detail,11px)] font-medium text-[var(--print-text-primary,#242424)] text-right align-middle">
                  {formatDate(invoiceDate)}
                </td>
              </tr>
              {secondaryValue && (
                <tr>
                  <td className="lbl print-detail w-[40%] p-[5px_8px] text-[var(--print-text-detail,11px)] font-medium text-[var(--print-text-secondary,#3F4652)] align-middle">
                    {secondaryLabel}:
                  </td>
                  <td className="val print-detail w-[60%] border-l border-[var(--print-border-brand,#2b6fd6)] p-[5px_8px] text-[var(--print-text-detail,11px)] font-medium text-[var(--print-text-primary,#242424)] text-right align-middle">
                    {secondaryValue}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Title Bar */}
        <div className="title-bar text-center my-3 border-t border-b border-[var(--print-border-brand,#2b6fd6)] py-1.5">
          <h1 className="print-doc-title text-[var(--print-text-title,13px)] tracking-[0.25em] font-bold m-0 uppercase text-[var(--print-brand-dark,#1e3a8a)]">
            {invoiceType}
          </h1>
        </div>

        {/* Customer Information (Clean One-Line Strip) */}
        <div className="customer-strip print-meta mb-3 flex items-center gap-x-4 gap-y-1 flex-wrap rounded-xs border border-[var(--print-border-light,#93c5fd)] px-3 py-1.5 text-[var(--print-text-meta,10px)] text-[var(--print-text-primary,#242424)]">
          <div className="flex items-center gap-1.5">
            <span className="print-micro font-semibold uppercase tracking-wider text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-micro,8.5px)]">
              Customer:
            </span>
            <span className="print-body font-bold text-[var(--print-text-primary,#242424)] text-[var(--print-text-body,10.5px)]">
              {billTo.name}
            </span>
          </div>

          {shouldDisplayCustomerPhone(billTo.name, billTo.phone) && (
            <div className="flex items-center gap-1 font-mono">
              <span className="text-[var(--print-border-light,#93c5fd)] font-bold">•</span>
              <span className="print-detail font-medium text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta,10px)]">Phone:</span>
              <span className="print-detail font-medium text-[var(--print-text-primary,#242424)] text-[var(--print-text-meta,10px)]">{billTo.phone}</span>
            </div>
          )}

          {billTo.address && (
            <div className="flex items-center gap-1">
              <span className="text-[var(--print-border-light,#93c5fd)] font-bold">•</span>
              <span className="print-detail font-medium text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta,10px)]">Address:</span>
              <span className="print-detail font-normal text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta,10px)]">{billTo.address}</span>
            </div>
          )}
        </div>

        {/* Product Items Table */}
        <table className="items w-full border-collapse table-fixed border border-[var(--print-border-brand,#2b6fd6)] text-[var(--print-text-primary,#242424)]">
          <thead>
            <tr>
              <th className="print-th w-[5%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                N°
              </th>
              <th className="print-th w-[50%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Description
              </th>
              <th className="print-th w-[12%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Price
              </th>
              <th className="print-th w-[10%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Qty
              </th>
              <th className="print-th w-[9%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Dis
              </th>
              <th className="print-th w-[14%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {organizedLines.map((line, index) => (
              <tr key={line.id} className="align-middle">
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center text-[var(--print-text-meta,10px)] font-normal text-[var(--print-text-secondary,#3F4652)]">
                  {index + 1}
                </td>
                <td className="border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left text-[var(--print-text-body,10.5px)]">
                  <div className="leading-snug inline-flex items-center gap-1.5 flex-wrap">
                    {line.parentLineId && (
                      <span className="print-meta-sm text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta-sm,9px)] font-bold mr-0.5">↳</span>
                    )}
                    <span className="print-body font-medium text-[var(--print-text-primary,#242424)]">
                      {line.description}
                    </span>
                    {line.isGift && (
                      <span className="print-badge inline-block rounded-xs px-1.5 py-0 text-[var(--print-text-badge,7.5px)] font-bold uppercase text-[#065f46] border border-[#6ee7b7] align-middle shrink-0">
                        GIFT
                      </span>
                    )}
                  </div>

                  {!line.isGift && ((line.specs && line.specs.length > 0) || (line.serials && line.serials.length > 0)) && (
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      {line.specs && line.specs.length > 0 && (
                        <span className="print-micro text-[var(--print-text-micro,8.5px)] text-[var(--print-text-secondary,#3F4652)] leading-tight tracking-tight font-normal">
                          {line.specs.join(' • ')}
                        </span>
                      )}
                      {line.serials && line.serials.length > 0 && (
                        <div className="sn-wrap inline-flex items-center gap-1 font-mono text-[var(--print-text-meta-sm,9px)] px-1.5 py-0.5 rounded-xs border border-[var(--print-border-light,#93c5fd)] font-medium text-[var(--print-text-black,#000000)]">
                          <span className="print-badge text-[var(--print-brand,#2b6fd6)] font-semibold tracking-wider text-[var(--print-text-badge,7.5px)] uppercase">
                            SN:
                          </span>
                          <span className="print-meta-sm tracking-tight text-[var(--print-text-black,#000000)] font-semibold">
                            {line.serials.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {line.note && line.note.trim() && (
                    <div className="print-meta-sm mt-1 mb-0.5 px-1.5 py-0.5 rounded-xs border-l-2 border-[var(--print-brand,#2b6fd6)] text-[var(--print-text-meta-sm,9px)] font-normal italic text-[var(--print-text-secondary,#3F4652)] leading-snug">
                      Note: {line.note}
                    </div>
                  )}
                </td>
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right text-[var(--print-text-meta,10px)] tabular-nums font-normal text-[var(--print-text-primary,#242424)]">
                  {line.isGift ? '৳0.00' : formatMoney(line.unitPrice)}
                </td>
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center text-[var(--print-text-meta,10px)] tabular-nums font-medium text-[var(--print-text-primary,#242424)]">
                  {toNumber(line.quantity)}
                </td>
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right text-[var(--print-text-meta,10px)] tabular-nums text-[var(--print-text-secondary,#3F4652)]">
                  {toNumber(line.discount) > 0
                    ? formatMoney(line.discount)
                    : '-'}
                </td>
                <td className="print-body border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold text-[var(--print-text-body,10.5px)] tabular-nums text-[var(--print-text-primary,#242424)]">
                  {line.isGift ? '৳0.00' : formatMoney(line.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={2}
                rowSpan={
                  1 +
                  (toNumber(props.discountTotal) > 0 ? 1 : 0) +
                  1 +
                  1 +
                  (toNumber(balanceDue) > 0.009 ? 1 : 0)
                }
                className="payment-summary-cell print-meta p-2 text-center align-middle font-medium text-[var(--print-text-meta,10px)] text-[var(--print-text-secondary,#3F4652)] border-r border-[var(--print-border-brand,#2b6fd6)]"
              >
                {paymentInfoString}
              </td>
              <td
                colSpan={3}
                className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-semibold uppercase tracking-wider text-[var(--print-text-label,9.5px)] text-[var(--print-text-secondary,#3F4652)]"
              >
                Sub Total
              </td>
              <td className="print-body border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold tabular-nums text-[var(--print-text-body,10.5px)] text-[var(--print-text-primary,#242424)]">
                {formatMoney(subtotal)}
              </td>
            </tr>
            {toNumber(props.discountTotal) > 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-semibold uppercase tracking-wider text-[var(--print-text-label,9.5px)] text-[var(--print-text-secondary,#3F4652)]"
                >
                  Discount
                </td>
                <td className="print-body border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold tabular-nums text-[var(--print-text-body,10.5px)] text-[#b91c1c]">
                  -{formatMoney(props.discountTotal)}
                </td>
              </tr>
            )}
            <tr>
              <td
                colSpan={3}
                className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-bold uppercase tracking-wider text-[var(--print-text-meta,10px)] text-[var(--print-brand-dark,#1e3a8a)]"
              >
                Grand Total
              </td>
              <td className="grand-total-val print-amount-grand border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-bold tabular-nums text-[var(--print-text-total,12px)] text-[var(--print-brand-dark,#1e3a8a)]">
                {formatMoney(grandTotal)}
              </td>
            </tr>
            <tr>
              <td
                colSpan={3}
                className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-semibold uppercase tracking-wider text-[var(--print-text-label,9.5px)] text-[var(--print-text-secondary,#3F4652)]"
              >
                Paid Amount
              </td>
              <td className="print-body border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-semibold tabular-nums text-[var(--print-text-body,10.5px)] text-[#065f46]">
                {formatMoney(paidAmount)}
              </td>
            </tr>
            {toNumber(balanceDue) > 0.009 && (
              <tr>
                <td
                  colSpan={3}
                  className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-semibold uppercase tracking-wider text-[var(--print-text-label,9.5px)] text-[var(--print-text-secondary,#3F4652)]"
                >
                  Outstanding
                </td>
                <td className="print-detail border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-right font-bold tabular-nums text-[var(--print-text-detail,11px)] text-[var(--print-text-primary,#242424)]">
                  {formatMoney(balanceDue)}
                </td>
              </tr>
            )}
            <tr>
              <td
                colSpan={6}
                className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-2 text-left text-[var(--print-text-label,9.5px)] leading-snug"
              >
                <span className="print-label font-semibold text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-label,9.5px)] uppercase tracking-wide">
                  Amount in words:{' '}
                </span>
                <span className="print-label font-semibold text-[var(--print-brand-dark,#1e3a8a)] tracking-wide font-mono text-[var(--print-text-label,9.5px)]">
                  {resolvedWords.toUpperCase()}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Account Running Balance Summary (only if there is outstanding / running due) */}
        {hasDue && (
          <div className="mt-3 rounded-xs border border-[var(--print-border-brand,#2b6fd6)] p-2 text-[var(--print-text-meta,10px)]">
            <div className="flex items-center justify-between border-b border-[var(--print-border-brand,#2b6fd6)] pb-1 font-bold text-[var(--print-brand-dark,#1e3a8a)] text-[var(--print-text-label,9.5px)] uppercase tracking-wider">
              <span>Account Running Balance Summary</span>
              {isB2BLinked && (
                <span className="print-badge rounded-xs px-1.5 py-0.5 text-[var(--print-text-badge,7.5px)] font-semibold text-[var(--print-brand-dark,#1e3a8a)] border border-[var(--print-border-light,#93c5fd)]">
                  Net B2B Balance
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2.5 text-center">
              <div className="rounded-xs border border-[var(--print-border-light,#93c5fd)] p-1.5">
                <span className="print-micro block text-[var(--print-text-micro,8.5px)] font-semibold text-[var(--print-text-secondary,#3F4652)] uppercase tracking-wider">
                  Previous Due
                </span>
                <span className="print-detail mt-0.5 block font-bold text-[var(--print-text-primary,#242424)] text-[var(--print-text-detail,11px)] tabular-nums">
                  <span className="font-sans font-semibold mr-0.5">৳</span>
                  <span className="font-mono">
                    {formatMoney(previousDue ?? 0)}
                  </span>
                </span>
              </div>
              <div className="rounded-xs border border-[var(--print-border-light,#93c5fd)] p-1.5">
                <span className="print-micro block text-[var(--print-text-micro,8.5px)] font-semibold text-[var(--print-text-secondary,#3F4652)] uppercase tracking-wider">
                  This Invoice
                </span>
                <span className="print-detail mt-0.5 block font-bold text-[var(--print-text-primary,#242424)] text-[var(--print-text-detail,11px)] tabular-nums">
                  <span className="font-sans font-semibold mr-0.5">৳</span>
                  <span className="font-mono">{formatMoney(grandTotal)}</span>
                </span>
              </div>
              <div className="rounded-xs border border-[var(--print-border-brand,#2b6fd6)] p-1.5">
                <span className="print-micro block text-[var(--print-text-micro,8.5px)] font-semibold text-[var(--print-brand-dark,#1e3a8a)] uppercase tracking-wider">
                  New Balance
                </span>
                <span className="print-detail mt-0.5 block font-bold text-[var(--print-brand-dark,#1e3a8a)] text-[var(--print-text-detail,11px)] tabular-nums">
                  <span className="font-sans font-semibold mr-0.5">৳</span>
                  <span className="font-mono">
                    {formatMoney(
                      newBalance ?? toNumber(previousDue) + toNumber(grandTotal)
                    )}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Comment Section (Notes - only displayed if comments exist) */}
        {hasComment && (
          <div className="comment-section my-2 p-2 border border-[var(--print-border-light,#93c5fd)] rounded-xs text-[var(--print-text-body,10.5px)] leading-relaxed">
            <span className="comment-label print-meta font-semibold text-[var(--print-brand,#2b6fd6)] block mb-0.5 text-[var(--print-text-meta,10px)] uppercase tracking-wider">
              Comment / Notes:
            </span>
            <div className="comment-text print-body text-[var(--print-text-primary,#242424)] font-medium text-[var(--print-text-body,10.5px)]">
              {String(notes).trim()}
            </div>
          </div>
        )}

        {/* Pinned Bottom Section: Terms & Conditions, Service Center, Signatures, Footer */}
        <div className="invoice-bottom-block mt-auto pt-2 flex flex-col justify-end">
          {/* Terms & Conditions */}
          <div className="terms text-[var(--print-text-body,10.5px)] leading-relaxed">
            <h4 className="print-section-heading font-bold text-[var(--print-text-section,10.5px)] mb-1 text-[var(--print-brand-dark,#1e3a8a)] uppercase tracking-wider">
              Terms &amp; Conditions
            </h4>
            <ul className="print-body list-disc pl-5 space-y-0.5 text-[var(--print-text-secondary,#3F4652)] font-normal text-[var(--print-text-body,10.5px)]">
              {terms && terms.length > 0 ? (
                terms.map((term, i) => {
                  const colonIdx = term.indexOf(':')
                  if (colonIdx > 0 && colonIdx < 35) {
                    const label = term.slice(0, colonIdx + 1)
                    const rest = term.slice(colonIdx + 1)
                    return (
                      <li key={i}>
                        <span className="font-semibold text-[var(--print-text-primary,#242424)]">{label}</span>
                        {rest}
                      </li>
                    )
                  }
                  return <li key={i}>{term}</li>
                })
              ) : (
                <>
                  <li>
                    <span className="font-semibold text-[var(--print-text-primary,#242424)]">Laptop Condition:</span>{' '}
                    Used
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--print-text-primary,#242424)]">
                      Parts Replacement Guarantee:
                    </span>{' '}
                    30 days (excluding display and keyboard), with up to 2 hours
                    battery backup
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--print-text-primary,#242424)]">
                      Service Warranty:
                    </span>{' '}
                    5 years (service only, no parts/ display/keyboard)
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--print-text-primary,#242424)]">Warranty:</span> No
                    warranty will be provided in cases of physical damage,
                    breakage, burn damage, liquid damage, or if the warranty
                    sticker is removed.
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--print-text-primary,#242424)]">Policy:</span> Sold
                    goods are non-refundable
                  </li>
                </>
              )}
            </ul>
          </div>

          {/* Service Center Info */}
          <div className="service print-body my-1.5 py-1.5 border-t border-b border-dashed border-[var(--print-border-brand,#2b6fd6)] text-[var(--print-text-body,10.5px)] text-[var(--print-text-secondary,#3F4652)]">
            <span className="font-bold text-[var(--print-text-primary,#242424)]">Service Center:</span>{' '}
            <span className="font-semibold text-[var(--print-text-primary,#242424)]">
              {seller.phone || '01916593289'}
            </span>
            <span className="text-[var(--print-text-secondary,#3F4652)]/50 mx-2">•</span>
            <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Inspection:</span>{' '}
            <span className="text-[var(--print-text-primary,#242424)]">Minimum 1 working day</span>
            <span className="text-[var(--print-text-secondary,#3F4652)]/50 mx-2">•</span>
            <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Repair:</span>{' '}
            <span className="text-[var(--print-text-primary,#242424)]">
              Time required may vary based on the issue.
            </span>
          </div>

          {/* Signatures */}
          <div className="signatures print-meta flex justify-between mt-12 mb-2 text-[var(--print-text-primary,#242424)]">
            <div className="sig w-52 border-t border-[var(--print-border-brand,#2b6fd6)] text-center pt-2 text-[var(--print-text-meta,10px)] font-medium text-[var(--print-text-secondary,#3F4652)] uppercase tracking-widest">
              Customer Signature
            </div>
            <div className="sig w-52 border-t border-[var(--print-border-brand,#2b6fd6)] text-center pt-2 text-[var(--print-text-meta,10px)] font-medium text-[var(--print-text-secondary,#3F4652)] uppercase tracking-widest">
              Authorized Signature
            </div>
          </div>

          {/* Footer */}
          <div className="footer print-meta border-t border-[var(--print-border-brand,#2b6fd6)] pt-1 text-center text-[var(--print-text-meta,10px)] font-medium tracking-widest uppercase text-[var(--print-text-secondary,#3F4652)] mb-0.5">
            {footerText || `${seller.name} © ${currentYear}`}
          </div>
        </div>
      </div>
    </>
  )
}

export function A4Invoice(props: A4InvoiceProps) {
  // Unified, high-polish layout across all invoice types (Sales, Purchase, Service, etc.)
  return <SalesInvoiceLayout {...props} />
}
