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

type ChallanParty = {
  name: string
  slogan?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

type ChallanLine = {
  id: string
  description: string
  code?: string | null
  quantity: NumericLike
  serials?: string[]
  isGift?: boolean
  parentLineId?: string | null
  specs?: string[]
  note?: string | null
}

interface A4ChallanProps {
  challanTitle?: string
  invoiceNumber: string
  invoiceDate: Date | string
  barcodeValue?: string
  seller: ChallanParty & { website?: string | null }
  billToLabel: string
  billTo: ChallanParty
  secondaryLabel?: string
  secondaryValue?: string | null
  lines: ChallanLine[]
  notes?: string | null
  terms?: string[]
  footerText?: string
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

export function A4Challan({
  challanTitle = 'DELIVERY CHALLAN',
  invoiceNumber,
  invoiceDate,
  barcodeValue,
  seller,
  billToLabel,
  billTo,
  secondaryLabel,
  secondaryValue,
  lines,
  notes,
  terms,
  footerText,
}: A4ChallanProps) {
  const currentYear = new Date().getFullYear()

  // Ensure hierarchical grouping: each parent line is immediately followed by its child gifts/accessories
  const organizedLines = consolidateInvoiceLines(lines || [])

  const totalQuantity = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0),
    0
  )

  const hasComment = Boolean(notes && String(notes).trim().length > 0)

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

              #a4-challan-container,
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

              .challan-root,
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

              .challan-root .challan-bottom-block {
                margin-top: auto !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-end !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }

              .challan-root,
              .challan-root * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              /* Crisp accent borders across entire printed document */
              .challan-root .border,
              .challan-root .border-b,
              .challan-root .border-t,
              .challan-root .border-l,
              .challan-root .border-r,
              .challan-root th,
              .challan-root td {
                border-color: var(--print-border-brand, #2b6fd6) !important;
              }

              /* Header Flex Row */
              .challan-root .header-wrapper {
                display: flex !important;
                flex-direction: row !important;
                width: 100% !important;
                border: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                margin-bottom: 10px !important;
                box-sizing: border-box !important;
              }

              .challan-root .section-logo {
                width: 130px !important;
                min-width: 130px !important;
                max-width: 130px !important;
                border-right: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .challan-root .section-company {
                flex: 1 1 auto !important;
                border-right: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              /* Meta table: strictly 260px fixed width */
              .challan-root table.meta-table,
              .challan-root .meta-table {
                width: 260px !important;
                min-width: 260px !important;
                max-width: 260px !important;
                table-layout: fixed !important;
                margin: 0 !important;
                border-collapse: collapse !important;
                box-sizing: border-box !important;
              }

              .challan-root .meta-table td {
                padding: 5px 8px !important;
                font-size: var(--print-text-detail-lg, 11.5px) !important;
                line-height: var(--print-leading-snug, 1.3) !important;
                vertical-align: middle !important;
                border-bottom: 1px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .challan-root .meta-table td.lbl {
                font-size: var(--print-text-detail, 11px) !important;
                font-weight: 500 !important;
              }

              .challan-root .meta-table td.val {
                border-left: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .challan-root .meta-table tr:last-child td {
                border-bottom: none !important;
              }

              .challan-root .meta-table .barcode-cell {
                border-left: none !important;
                height: 50px !important;
              }

              /* Customer strip: clean, simple, one line */
              .challan-root .customer-strip {
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
              .challan-root table.items {
                width: 100% !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                table-layout: fixed !important;
                border: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
                border-collapse: collapse !important;
                page-break-inside: auto !important;
              }

              .challan-root table.items th,
              .challan-root table.items td {
                padding: 5px 6px !important;
                font-size: var(--print-text-body, 10.5px) !important;
                line-height: var(--print-leading-normal, 1.35) !important;
                vertical-align: middle !important;
                border: 1px solid var(--print-border-brand, #2b6fd6) !important;
                box-sizing: border-box !important;
              }

              .challan-root table.items th {
                color: var(--print-brand-dark, #1e3a8a) !important;
                font-size: var(--print-text-th, 10px) !important;
                font-weight: 600 !important;
                letter-spacing: 0.05em !important;
                text-transform: uppercase !important;
                text-align: center !important;
              }

              .challan-root tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }

              .challan-root .signatures {
                margin-top: 52px !important;
              }

              .challan-root .signatures .sig {
                border-top: 1.5px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .challan-root .footer {
                border-top: 1px solid var(--print-border-brand, #2b6fd6) !important;
              }

              .challan-root .service {
                border-top: 1px dashed #2b6fd6 !important;
                border-bottom: 1px dashed #2b6fd6 !important;
                border-left: none !important;
                border-right: none !important;
              }
            }
          `,
        }}
      />

      <div
        className="challan-root sales-invoice-root a4-invoice-container print-doc-root relative mx-auto w-[210mm] min-w-[210mm] max-w-[210mm] min-h-[297mm] print:min-h-[296mm] bg-white text-[var(--print-text-primary,#242424)] p-[10mm_12mm_8mm] print:p-[8mm_10mm_6mm] print:w-[210mm] text-[var(--print-text-body,10.5px)] leading-[var(--print-leading-normal,1.35)] box-border antialiased flex flex-col"
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
            <div className="print-meta font-medium text-[var(--print-text-meta,10px)] uppercase tracking-wider text-[var(--print-text-secondary,#3F4652)] leading-tight text-center">
              {seller.slogan || 'Tech & Laptop Solutions'}
            </div>
          </div>

          {/* Company Details */}
          <div className="section-company flex-1 min-w-0 p-[10px_12px] border-r border-[var(--print-border-brand,#2b6fd6)] flex flex-col justify-center text-[var(--print-text-primary,#242424)]">
            <h2 className="print-company-name text-[var(--print-text-company,21px)] font-bold tracking-tight mb-1 text-[var(--print-brand-dark,#1e3a8a)] leading-tight">
              {seller.name}
            </h2>
            {seller.address && (
              <p className="print-detail-lg text-[var(--print-text-detail-lg,11.5px)] leading-snug mb-1 text-[var(--print-text-secondary,#3F4652)]">
                {seller.address}
              </p>
            )}
            {(() => {
              const sellerPhones = parseSellerPhones(seller.phone || '01701561365')
              if (sellerPhones.length <= 1) {
                return (
                  <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug mb-0.5 text-[var(--print-text-secondary,#3F4652)]">
                    <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Phone:</span>{' '}
                    <span className="font-medium text-black">
                      {sellerPhones[0] || '01701561365'}
                    </span>
                  </p>
                )
              }
              return (
                <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug mb-0.5 text-[var(--print-text-secondary,#3F4652)]">
                  <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Mobile:</span>{' '}
                  <span className="font-medium text-black">
                    {sellerPhones[0]}
                  </span>
                  <span className="text-[#9ca3af] mx-1.5">•</span>
                  <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Phone:</span>{' '}
                  <span className="font-medium text-[var(--print-text-primary,#242424)]">
                    {sellerPhones[1]}
                  </span>
                </p>
              )
            })()}
            <p className="print-detail text-[var(--print-text-detail,11px)] leading-snug text-[var(--print-text-secondary,#3F4652)]">
              <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Email:</span>{' '}
              <span className="font-medium text-black">
                {seller.email || 'admin@artyxdigital.com'}
              </span>
              <span className="text-[#9ca3af] mx-1.5">•</span>
              <span className="font-medium text-[var(--print-text-secondary,#3F4652)]">Web:</span>{' '}
              <span className="font-medium text-black">
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
                  <div className="flex items-center justify-center h-full max-w-full overflow-hidden">
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
                  Challan N°
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
                    {secondaryLabel ?? 'Cashier'}:
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
            {challanTitle}
          </h1>
        </div>

        {/* Customer Information (Clean One-Line Strip) */}
        <div className="customer-strip print-meta mb-3 flex items-center gap-x-4 gap-y-1 flex-wrap rounded-xs border border-[var(--print-border-light,#93c5fd)] px-3 py-1.5 text-[var(--print-text-meta,10px)] text-[var(--print-text-primary,#242424)]">
          <div className="flex items-center gap-1.5">
            <span className="print-micro font-bold uppercase tracking-wider text-[var(--print-brand,#2b6fd6)] text-[var(--print-text-micro,8.5px)]">
              {billToLabel}:
            </span>
            <span className="print-body font-bold text-[var(--print-text-primary,#242424)] text-[var(--print-text-body,10.5px)]">
              {billTo.name}
            </span>
          </div>

          {shouldDisplayCustomerPhone(billTo.name, billTo.phone) && (
            <div className="flex items-center gap-1 font-mono">
              <span className="text-[#93c5fd] font-bold">•</span>
              <span className="print-detail font-medium text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta,10px)]">Phone:</span>
              <span className="print-detail font-medium text-[var(--print-text-primary,#242424)] text-[var(--print-text-meta,10px)]">{billTo.phone}</span>
            </div>
          )}

          {billTo.address && (
            <div className="flex items-center gap-1">
              <span className="text-[#93c5fd] font-bold">•</span>
              <span className="print-detail font-medium text-[var(--print-text-secondary,#3F4652)] text-[var(--print-text-meta,10px)]">Address:</span>
              <span className="print-detail text-[var(--print-text-primary,#242424)] text-[var(--print-text-meta,10px)]">{billTo.address}</span>
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
              <th className="print-th w-[65%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Description
              </th>
              <th className="print-th w-[10%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Qty
              </th>
              <th className="print-th w-[20%] border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left font-semibold uppercase text-[var(--print-text-th,10px)] tracking-wider text-[var(--print-brand-dark,#1e3a8a)]">
                Serial / IMEI
              </th>
            </tr>
          </thead>
          <tbody>
            {organizedLines.map((line, index) => (
              <tr key={line.id} className="align-middle">
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center text-[var(--print-text-meta,10px)] font-medium text-[var(--print-text-secondary,#3F4652)]">
                  {index + 1}
                </td>
                <td className="border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left text-[var(--print-text-body,10.5px)]">
                  <div className="leading-snug inline-flex items-center gap-1.5 flex-wrap">
                    {line.parentLineId && (
                      <span className="print-meta-sm text-[#64748b] text-[var(--print-text-meta-sm,9px)] font-bold mr-0.5">↳</span>
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

                  {line.specs && line.specs.length > 0 && (
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap text-black">
                      <span className="print-micro text-[var(--print-text-micro,8.5px)] text-[var(--print-text-secondary,#3F4652)] leading-tight tracking-tight font-normal">
                        {line.specs.join(' • ')}
                      </span>
                    </div>
                  )}

                  {line.note && line.note.trim() && (
                    <div className="print-meta-sm mt-1 mb-0.5 px-1.5 py-0.5 rounded-xs border-l-2 border-[var(--print-brand,#2b6fd6)] text-[var(--print-text-meta-sm,9px)] font-medium text-[var(--print-brand-dark,#1e3a8a)] leading-snug">
                      Note: {line.note}
                    </div>
                  )}
                </td>
                <td className="print-meta border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center text-[var(--print-text-meta,10px)] tabular-nums font-medium text-[var(--print-text-primary,#242424)]">
                  {Number(line.quantity)}
                </td>
                <td className="print-meta-sm border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left text-[var(--print-text-meta-sm,9px)] font-mono text-[var(--print-text-black,#000000)] font-medium">
                  {line.serials && line.serials.length > 0 ? (
                    <div className="sn-wrap inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs border border-[var(--print-border-light,#93c5fd)]">
                      <span className="print-meta-sm tracking-tight text-[var(--print-text-black,#000000)]">
                        {line.serials.join(', ')}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[#9ca3af] font-normal">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={2}
                className="print-label border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pr-3 text-right font-semibold uppercase tracking-wider text-[var(--print-text-label,9.5px)] text-[var(--print-brand-dark,#1e3a8a)]"
              >
                Total Quantity
              </td>
              <td className="print-detail border border-[var(--print-border-brand,#2b6fd6)] p-1.5 text-center font-bold tabular-nums text-[var(--print-text-detail,11px)] text-[var(--print-brand-dark,#1e3a8a)]">
                {totalQuantity}
              </td>
              <td className="print-meta-sm border border-[var(--print-border-brand,#2b6fd6)] p-1.5 pl-2 text-left text-[var(--print-text-meta-sm,9px)] text-[var(--print-text-secondary,#3F4652)] italic">
                Verified for dispatch &amp; delivery
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Comment Section (Notes - only displayed if comments exist) */}
        {hasComment && (
          <div className="comment-section my-2 p-2 border border-[var(--print-border-light,#93c5fd)] rounded-xs text-[var(--print-text-body,10.5px)] leading-relaxed">
            <span className="comment-label print-meta font-semibold text-[var(--print-brand,#2b6fd6)] block mb-0.5 text-[var(--print-text-meta,10px)] uppercase tracking-wider">
              Comment / Dispatch Note:
            </span>
            <div className="comment-text print-body text-[var(--print-text-primary,#242424)] font-medium text-[var(--print-text-body,10.5px)]">
              {String(notes).trim()}
            </div>
          </div>
        )}

        {/* Bottom Pinned Section: Signatures & Footer */}
        <div className="challan-bottom-block mt-auto pt-2 flex flex-col justify-end">
          {/* Signatures */}
          <div className="signatures print-meta flex justify-between mt-12 mb-2 text-[var(--print-text-primary,#242424)]">
            <div className="sig w-52 border-t border-[var(--print-border-brand,#2b6fd6)] text-center pt-2 text-[var(--print-text-meta,10px)] font-medium text-[var(--print-text-secondary,#3F4652)] uppercase tracking-widest">
              Customer / Receiver Signature
            </div>
            <div className="sig w-52 border-t border-[var(--print-border-brand,#2b6fd6)] text-center pt-2 text-[var(--print-text-meta,10px)] font-medium text-[var(--print-text-secondary,#3F4652)] uppercase tracking-widest">
              Authorized / Issued By
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
