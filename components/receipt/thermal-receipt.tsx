'use client'

import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef } from 'react'

type NumericLike = number | string | { toString(): string }

type ReceiptSale = {
  saleNumber: string
  createdAt: Date | string
  subtotal: NumericLike
  discountAmt: NumericLike
  taxAmt: NumericLike
  total: NumericLike
  changeDue: NumericLike
  notes?: string | null
  lines: Array<{
    quantity: NumericLike
    unitPrice: NumericLike
    discountPct: NumericLike
    total: NumericLike
    note?: string | null
    product: {
      name: string
      productCode?: string | null
    }
  }>
  payments: Array<{
    method: string
    amount: NumericLike
  }>
  customer?: {
    name: string
    phone?: string | null
  } | null
}

interface ThermalReceiptProps {
  sale: ReceiptSale
  outletName: string
  outletSlogan?: string | null
  outletAddress?: string
  outletPhone?: string
  autoPrint?: boolean
}

export function ThermalReceipt({
  sale,
  outletName,
  outletSlogan,
  outletAddress,
  outletPhone,
  autoPrint = false,
}: ThermalReceiptProps) {
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoPrint && printRef.current) {
      // Small delay to ensure DOM is rendered
      setTimeout(() => {
        window.print()
      }, 500)
    }
  }, [autoPrint])

  return (
    <>
      {/* Print Styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }

          body {
            margin: 0;
            padding: 0;
          }

          body * {
            visibility: hidden;
          }

          #thermal-receipt,
          #thermal-receipt * {
            visibility: visible;
          }

          #thermal-receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm;
          }

          .no-print {
            display: none !important;
          }
        }

        @media screen {
          #thermal-receipt {
            width: 80mm;
            margin: 0 auto;
            background: white;
            padding: 10mm;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          }
        }
      `,
        }}
      />

      <div
        id="thermal-receipt"
        className="thermal-receipt"
        ref={printRef}
        style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: '1.4',
          color: '#000',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <img
            src="/logo_icons.png"
            alt=""
            style={{ height: '36px', margin: '0 auto 4px', display: 'block' }}
          />
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
            {outletName}
          </div>
          {outletSlogan && (
            <div style={{ fontSize: '10px', fontStyle: 'italic', marginTop: '1px', color: '#555' }}>
              {outletSlogan}
            </div>
          )}
          {outletAddress && (
            <div style={{ fontSize: '11px', marginTop: '2px' }}>
              {outletAddress}
            </div>
          )}
          {outletPhone && (
            <div style={{ fontSize: '11px', marginTop: '2px' }}>
              Tel: {outletPhone}
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: '2px dashed #000',
            borderBottom: '2px dashed #000',
            padding: '5px 0',
            marginBottom: '10px',
          }}
        >
          <div>
            <strong>Sale #:</strong> {sale.saleNumber}
          </div>
          <div>
            <strong>Date:</strong>{' '}
            {new Date(sale.createdAt).toLocaleString('en-GB', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
          {sale.customer && (
            <>
              <div>
                <strong>Customer:</strong> {sale.customer.name}
              </div>
              {sale.customer.phone &&
                sale.customer.phone !== '01700000000' &&
                sale.customer.phone !== '00000000000' &&
                !sale.customer.name.toLowerCase().includes('walk') && (
                  <div>
                    <strong>Phone:</strong> {sale.customer.phone}
                  </div>
                )}
            </>
          )}
        </div>

        {/* Items */}
        <div style={{ marginBottom: '10px' }}>
          <table
            style={{
              width: '100%',
              fontSize: '11px',
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr
                style={{ borderBottom: '1px solid #000', fontWeight: 'bold' }}
              >
                <th style={{ textAlign: 'left', padding: '3px 0' }}>Item</th>
                <th style={{ textAlign: 'center', padding: '3px 0' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '3px 0' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '3px 0' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((line, idx) => {
                const rawSerials = (line as any).serials
                const serialEntries: Array<{ serialNumber: string; warrantyExpiry?: Date | string | null }> =
                  Array.isArray(rawSerials)
                    ? rawSerials
                        .map((s: any) => {
                          if (typeof s === 'string') return { serialNumber: s }
                          if (s?.serialUnit?.serialNumber) {
                            return {
                              serialNumber: s.serialUnit.serialNumber,
                              warrantyExpiry: s.serialUnit.warrantyExpiry,
                            }
                          }
                          if (s?.serialNumber) {
                            return {
                              serialNumber: s.serialNumber,
                              warrantyExpiry: s.warrantyExpiry,
                            }
                          }
                          return null
                        })
                        .filter(Boolean) as Array<{ serialNumber: string; warrantyExpiry?: Date | string | null }>
                    : []

                return (
                  <tr key={idx} style={{ borderBottom: '1px dotted #ccc' }}>
                    <td
                      style={{
                        textAlign: 'left',
                        padding: '3px 0',
                        fontSize: '10px',
                      }}
                    >
                      <div>
                        {line.product.name}
                        {Number((line as any).discountAmt ?? 0) > 0 ? (
                          <span style={{ color: '#666', fontSize: '9px' }}>
                            {' '}
                            (-৳{Number((line as any).discountAmt).toFixed(2)})
                          </span>
                        ) : Number(line.discountPct) > 0 ? (
                          <span style={{ color: '#666', fontSize: '9px' }}>
                            {' '}
                            (-{Number(line.discountPct)}%)
                          </span>
                        ) : null}
                      </div>
                      {(line as any).note && String((line as any).note).trim() && (
                        <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#222', marginTop: '2px', marginBottom: '2px' }}>
                          Note: {(line as any).note}
                        </div>
                      )}
                      {serialEntries.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#333', marginTop: '2px' }}>
                          <div>SN: {serialEntries.map(s => s.serialNumber).join(', ')}</div>
                          {serialEntries.some(s => s.warrantyExpiry) && (
                            <div>
                              Warranty until:{' '}
                              {serialEntries
                                .filter(s => s.warrantyExpiry)
                                .map(s =>
                                  new Date(s.warrantyExpiry!).toLocaleDateString('en-GB', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                )
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', padding: '3px 0' }}>
                      {Number(line.quantity)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '3px 0' }}>
                      ৳{Number(line.unitPrice).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '3px 0' }}>
                      ৳{Number(line.total).toFixed(2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div
          style={{
            borderTop: '2px solid #000',
            paddingTop: '5px',
            marginBottom: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <span>Subtotal:</span>
            <span>৳{Number(sale.subtotal).toFixed(2)}</span>
          </div>
          {Number(sale.discountAmt) > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#666',
              }}
            >
              <span>Discount:</span>
              <span>-৳{Number(sale.discountAmt).toFixed(2)}</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <span>Tax (VAT):</span>
            <span>৳{Number(sale.taxAmt).toFixed(2)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '16px',
              fontWeight: 'bold',
              marginTop: '5px',
              paddingTop: '5px',
              borderTop: '2px solid #000',
            }}
          >
            <span>TOTAL:</span>
            <span>৳{Number(sale.total).toFixed(2)}</span>
          </div>
          {(() => {
            const nonCreditPaid = sale.payments
              .filter(p => p.method !== 'CREDIT')
              .reduce((sum, p) => sum + Number(p.amount || 0), 0)
            const effectivePaid = Math.max(0, nonCreditPaid - Number(sale.changeDue || 0))
            const balanceDue = Math.max(0, Number(sale.total || 0) - effectivePaid)
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    marginTop: '3px',
                  }}
                >
                  <span>Paid:</span>
                  <span>৳{effectivePaid.toFixed(2)}</span>
                </div>
                {balanceDue > 0.009 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      marginTop: '2px',
                    }}
                  >
                    <span>Balance Due:</span>
                    <span>৳{balanceDue.toFixed(2)}</span>
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Payment Details */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>
            Payment:
          </div>
          {sale.payments.map((payment, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                marginLeft: '10px',
              }}
            >
              <span>{payment.method.replace(/_/g, ' ')}:</span>
              <span>৳{Number(payment.amount).toFixed(2)}</span>
            </div>
          ))}
          {Number(sale.changeDue) > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                fontWeight: 'bold',
                marginTop: '3px',
              }}
            >
              <span>Change Due:</span>
              <span>৳{Number(sale.changeDue).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* QR Code */}
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <QRCodeSVG value={sale.saleNumber} size={80} includeMargin />
          <div style={{ fontSize: '9px', marginTop: '3px' }}>
            Scan for receipt details
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: 'center',
            fontSize: '10px',
            borderTop: '2px dashed #000',
            paddingTop: '5px',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>Thank you for your purchase!</div>
          <div style={{ marginTop: '2px' }}>Visit us again soon</div>
          {sale.notes && (
            <div style={{ marginTop: '5px', fontSize: '9px', color: '#666' }}>
              Note: {sale.notes}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
