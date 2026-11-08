'use client'

import { Plus, Printer, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

// ============================================================================
// Types & Contracts
// ============================================================================

export interface OrderItem {
  id: string
  name: string
  code?: string
  qty: number
  price: number
  total: number
}

export interface StoreProfile {
  name: string
  tagline?: string
  address: string
  phone: string
  vatNumber?: string
  footerMessage?: string
}

export interface OrderRecord {
  orderNumber: string
  date: Date | string
  cashierName: string
  customerName?: string
  customerPhone?: string
  items: OrderItem[]
  discountAmt: number
  taxAmt: number
  paymentMethod: string
  paidAmount: number
}

export interface PosReceiptDualViewProps {
  initialStore?: StoreProfile
  initialOrder?: OrderRecord
  defaultPaperWidth?: '80mm' | '58mm'
}

// ============================================================================
// Default Sample Data (Mock Structure)
// ============================================================================

const DEFAULT_STORE: StoreProfile = {
  name: 'ARTYX DIGITAL',
  tagline: 'Agency Operations & Software Solutions',
  address: 'Level 4, House 12, Road 4, Sector 3, Uttara, Dhaka',
  phone: '+880 1800-000000',
  vatNumber: 'BIN-002948192-0101',
  footerMessage:
    'Thank you for partnering with Artyx Digital!',
}

const DEFAULT_ORDER: OrderRecord = {
  orderNumber: 'POS-2026-9042',
  date: new Date().toISOString(),
  cashierName: 'System Admin',
  customerName: 'Shakil Ahmed',
  customerPhone: '01712-345678',
  items: [
    {
      id: 'item-1',
      name: 'Logitech B100 Optical USB Mouse',
      code: 'ACC-LOG-B100',
      qty: 1,
      price: 650,
      total: 650,
    },
    {
      id: 'item-2',
      name: 'Kingston 128GB DataTraveler Exodia USB 3.2 Gen 1 Flash Drive',
      code: 'STR-KNG-128G',
      qty: 2,
      price: 850,
      total: 1700,
    },
    {
      id: 'item-3',
      name: 'SanDisk 256GB Ultra microSDXC UHS-I Memory Card 120MB/s',
      code: 'MEM-SND-256U',
      qty: 1,
      price: 1950,
      total: 1950,
    },
    {
      id: 'item-4',
      name: 'Cat6 UTP Patch Cable 3M High Speed Network Cable (Blue)',
      code: 'NET-CAT6-3M',
      qty: 3,
      price: 120,
      total: 360,
    },
  ],
  discountAmt: 100,
  taxAmt: 0,
  paymentMethod: 'Cash',
  paidAmount: 5000,
}

// ============================================================================
// Currency & Date Formatters
// ============================================================================

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateInput: Date | string): string {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ============================================================================
// Main Dual-Medium POS Component
// ============================================================================

export function PosReceiptDualView({
  initialStore = DEFAULT_STORE,
  initialOrder = DEFAULT_ORDER,
  defaultPaperWidth = '80mm',
}: PosReceiptDualViewProps) {
  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------
  const [store] = useState<StoreProfile>(initialStore)
  const [order, setOrder] = useState<OrderRecord>(initialOrder)
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(
    defaultPaperWidth
  )

  // Calculations
  const subtotal = useMemo(() => {
    return order.items.reduce((sum, item) => sum + item.total, 0)
  }, [order.items])

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - order.discountAmt + order.taxAmt)
  }, [subtotal, order.discountAmt, order.taxAmt])

  const changeDue = useMemo(() => {
    return Math.max(0, order.paidAmount - grandTotal)
  }, [order.paidAmount, grandTotal])

  // Handlers for touchscreen cashier interactions
  const handlePrint = () => {
    window.print()
  }

  const handleUpdateQty = (itemId: string, delta: number) => {
    setOrder(prev => {
      const updatedItems = prev.items
        .map(item => {
          if (item.id === itemId) {
            const newQty = Math.max(1, item.qty + delta)
            return {
              ...item,
              qty: newQty,
              total: Math.round(newQty * item.price * 100) / 100,
            }
          }
          return item
        })
        .filter(item => item.qty > 0)
      return { ...prev, items: updatedItems }
    })
  }

  const handleRemoveItem = (itemId: string) => {
    setOrder(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== itemId),
    }))
  }

  const handleAddSampleItem = () => {
    const newItem: OrderItem = {
      id: `item-${Date.now()}`,
      name: 'TP-Link TL-WN725N 150Mbps Wireless N Nano USB Adapter',
      code: 'NET-TPL-WN725N',
      qty: 1,
      price: 750,
      total: 750,
    }
    setOrder(prev => ({
      ...prev,
      items: [...prev.items, newItem],
    }))
  }

  const handleResetOrder = () => {
    setOrder(DEFAULT_ORDER)
  }

  // Active thermal container width class (72mm for 80mm roll, 48mm for 58mm roll)
  const thermalWidthClass = paperWidth === '80mm' ? 'w-[72mm]' : 'w-[48mm]'

  return (
    <>
      {/* =====================================================================
          GLOBAL PRINT STYLESHEET
          Strips browser header/footer margins and forces exact print rendering
         ===================================================================== */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: ${paperWidth === '80mm' ? '80mm auto' : '58mm auto'};
                margin: 0 !important;
              }

              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: #ffffff !important;
                background-color: #ffffff !important;
                color: #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                width: 100% !important;
                overflow: visible !important;
              }

              /* Hide all extraneous web shell elements outside the receipt */
              nav, header, aside, button, .no-print {
                display: none !important;
              }
            }
          `,
        }}
      />

      {/* =====================================================================
          1. DIGITAL SCREEN VIEW (Touch-Friendly Responsive UI)
          Visible on screen, completely hidden during physical print
         ===================================================================== */}
      <div className="print:hidden w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Top App Bar & POS Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div>
            {/* Header / Store Name: text-xl to text-2xl bold (~20px - 24px) */}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {store.name}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Order #{order.orderNumber} • Cashier: {order.cashierName}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Thermal Roll Width Selector */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  paperWidth === '80mm'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                80mm Roll
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  paperWidth === '58mm'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                58mm Roll
              </button>
            </div>

            {/* Print Trigger Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all active:scale-[0.98]"
            >
              <Printer className="w-4 h-4" />
              <span>Print Thermal Receipt</span>
            </button>
          </div>
        </div>

        {/* Cashier Grid: Items Table & Order Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Itemized Table (2 cols on large screen) */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Cart Items ({order.items.length})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddSampleItem}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Item</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-colors"
                  title="Reset sample order"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* Line Items Table: text-base (~16px) for heavy touchscreen targets */}
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-base">
                <thead>
                  <tr className="bg-slate-50/75 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4">Item Details</th>
                    <th className="py-3 px-4 text-center">Qty</th>
                    <th className="py-3 px-4 text-right">Price</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-3 text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {order.items.map(item => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          {item.name}
                        </div>
                        {item.code && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5">
                            {item.code}
                          </div>
                        )}
                      </td>
                      {/* Touch-Friendly Qty Stepper Controls */}
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800">
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(item.id, -1)}
                            className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-lg font-bold"
                          >
                            -
                          </button>
                          <span className="w-10 text-center font-mono font-bold text-base text-slate-900 dark:text-white">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(item.id, 1)}
                            className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-lg font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      {/* Prices & Quantities: text-base font-mono */}
                      <td className="py-3 px-4 text-right font-mono text-base text-slate-700 dark:text-slate-300">
                        ৳{formatMoney(item.price)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-base text-slate-900 dark:text-white">
                        ৳{formatMoney(item.total)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {order.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-12 text-center text-slate-400 text-sm"
                      >
                        No items in cart. Click &quot;Add Item&quot; to test
                        receipt layout.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Summary Panel with Big Confirmation Total */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3">
                Payment Summary
              </h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span className="font-mono font-medium text-slate-900 dark:text-white">
                    ৳{formatMoney(subtotal)}
                  </span>
                </div>

                {order.discountAmt > 0 && (
                  <div className="flex justify-between text-rose-600 font-medium">
                    <span>Discount</span>
                    <span className="font-mono">
                      -৳{formatMoney(order.discountAmt)}
                    </span>
                  </div>
                )}

                {order.taxAmt > 0 && (
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Tax / VAT</span>
                    <span className="font-mono">
                      ৳{formatMoney(order.taxAmt)}
                    </span>
                  </div>
                )}
              </div>

              {/* Total/Grand Total Display: text-3xl font-black (~30px) */}
              <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 text-center">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                  Total Payable
                </span>
                <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                  ৳{formatMoney(grandTotal)}
                </span>
              </div>

              {/* Tendered & Change Breakdown */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Payment Mode</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {order.paymentMethod}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Amount Paid</span>
                  <span className="font-mono font-medium text-slate-900 dark:text-white">
                    ৳{formatMoney(order.paidAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Change Due</span>
                  <span className="font-mono">৳{formatMoney(changeDue)}</span>
                </div>
              </div>
            </div>

            {/* Screen Actions Bottom */}
            <div className="pt-4 space-y-2">
              <button
                type="button"
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 font-bold text-base shadow-sm transition-all active:scale-[0.98]"
              >
                <Printer className="w-5 h-5" />
                <span>Print Thermal Receipt</span>
              </button>
              <p className="text-[11px] text-center text-slate-400">
                Print preview targets physical {paperWidth} roll (
                {thermalWidthClass})
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. THERMAL PAPER PRINT VIEW (Physical 80mm / 58mm Roll Target)
          hidden on screen, activated strictly during browser print (hidden print:block)
         ===================================================================== */}
      <div
        id="thermal-receipt-paper"
        className={`hidden print:block mx-auto ${thermalWidthClass} font-mono text-[11px] leading-tight text-black p-0 box-border antialiased`}
      >
        {/* Store Name / Header: Max text-[16px] font-bold, uppercase, text-center */}
        <header className="text-center pb-2 border-b border-dashed border-black">
          <h1 className="text-[16px] font-bold uppercase tracking-wide leading-none mb-1">
            {store.name}
          </h1>
          {store.tagline && (
            <p className="text-[10px] leading-tight mb-1">{store.tagline}</p>
          )}
          <p className="text-[10px] leading-tight">{store.address}</p>
          <p className="text-[10px] leading-tight">Tel: {store.phone}</p>
          {store.vatNumber && (
            <p className="text-[10px] leading-tight">{store.vatNumber}</p>
          )}
        </header>

        {/* Transaction Metadata: text-[10px] left-aligned */}
        <section className="py-2 border-b border-dashed border-black text-[10px] space-y-0.5">
          <div className="flex justify-between items-start">
            <span>Invoice: {order.orderNumber}</span>
            <span>Mode: {order.paymentMethod}</span>
          </div>
          <div className="flex justify-between items-start">
            <span>Date: {formatDate(order.date)}</span>
          </div>
          <div className="flex justify-between items-start">
            <span>Cashier: {order.cashierName}</span>
          </div>
          {order.customerName && (
            <div className="flex justify-between items-start">
              <span>Customer: {order.customerName}</span>
              {order.customerPhone &&
                order.customerPhone !== '01700000000' &&
                order.customerPhone !== '00000000000' &&
                !order.customerName?.toLowerCase().includes('walk') && (
                  <span>{order.customerPhone}</span>
                )}
            </div>
          )}
        </section>

        {/* Column Headers: flex justify-between items-start with dashed border */}
        <div className="flex justify-between items-center py-1 border-b border-dashed border-black text-[10px] font-bold uppercase">
          <span className="w-[45%] text-left">Item</span>
          <span className="w-[15%] text-center">Qty</span>
          <span className="w-[20%] text-right">Price</span>
          <span className="w-[20%] text-right">Total</span>
        </div>

        {/* Itemized Lines:
            Base font locked to text-[11px] leading-tight.
            Item name constrained (max-w-[70%] break-words) to prevent horizontal runoff.
        */}
        <div className="py-1.5 border-b border-dashed border-black space-y-1.5">
          {order.items.map(item => (
            <div key={item.id} className="text-[11px] leading-tight">
              {/* Row 1: Item Name with safe break-words constraint */}
              <div className="font-semibold break-words max-w-full">
                {item.name}
              </div>

              {/* Row 2: Qty x Unit Price = Total Column */}
              <div className="flex justify-between items-start text-[10px] text-black/90 mt-0.5">
                <span className="text-left font-mono">
                  {item.qty} x {formatMoney(item.price)}
                </span>
                <span className="text-right font-mono font-bold">
                  {formatMoney(item.total)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals Section */}
        <div className="py-2 border-b border-dashed border-black space-y-1 text-[11px]">
          <div className="flex justify-between items-start">
            <span>Subtotal:</span>
            <span className="font-mono">{formatMoney(subtotal)}</span>
          </div>

          {order.discountAmt > 0 && (
            <div className="flex justify-between items-start">
              <span>Discount:</span>
              <span className="font-mono">
                -{formatMoney(order.discountAmt)}
              </span>
            </div>
          )}

          {order.taxAmt > 0 && (
            <div className="flex justify-between items-start">
              <span>Tax / VAT:</span>
              <span className="font-mono">{formatMoney(order.taxAmt)}</span>
            </div>
          )}

          {/* Grand Total: text-[14px] font-bold or text-[16px] font-bold */}
          <div className="flex justify-between items-start text-[15px] font-bold pt-1 border-t border-dashed border-black mt-1">
            <span className="uppercase">Grand Total:</span>
            <span className="font-mono">৳{formatMoney(grandTotal)}</span>
          </div>

          {/* Payment & Change breakdown */}
          <div className="flex justify-between items-start text-[10.5px] pt-1">
            <span>Amount Paid ({order.paymentMethod}):</span>
            <span className="font-mono">{formatMoney(order.paidAmount)}</span>
          </div>

          <div className="flex justify-between items-start text-[10.5px]">
            <span>Change Due:</span>
            <span className="font-mono">৳{formatMoney(changeDue)}</span>
          </div>
        </div>

        {/* Footer Fine Print: text-[9px] text-center */}
        <footer className="pt-3 pb-1 text-center text-[9px] space-y-1 leading-normal">
          <p className="font-semibold uppercase tracking-wider">
            {store.footerMessage || 'Thank you for your purchase!'}
          </p>
          <p className="text-[8px]">
            Software powered by Artyx Digital • {formatDate(new Date())}
          </p>
          {/* Hardware Paper Cut Blank Buffer */}
          <div className="h-6" aria-hidden="true" />
        </footer>
      </div>
    </>
  )
}
