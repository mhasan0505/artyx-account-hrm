"use server"

import { requireRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { DRAWER_TX_TYPE } from '@/lib/constants/transaction-types'
import { resolveDrawerSessionForDate } from '@/lib/actions/drawer-session-utils'
import { PaymentMethod, UserRole } from '@prisma/client'

export interface ZReportCategoryItem {
  type: string
  label: string
  amount: number
  count: number
}

export interface ZReportTenderItem {
  method: PaymentMethod
  label: string
  amount: number
  count: number
}

export interface ZReportData {
  date: string
  outletId: string
  outletName: string
  drawerId: string | null
  drawerStatus: 'OPEN' | 'CLOSED' | 'NO_DRAWER'
  openedAt: string | null
  closedAt: string | null
  openedByName: string | null

  // 1. Opening Float (read directly from CashDrawer.openingBalance, 0 preserved)
  openingFloat: number

  // 2. Cash In Breakdown & Total
  cashInList: ZReportCategoryItem[]
  totalCashIn: number

  // 3. Cash Out Breakdown & Total
  cashOutList: ZReportCategoryItem[]
  totalCashOut: number

  // 4. Expected Closing Cash = Opening Float + Total Cash In - Total Cash Out
  expectedClosingCash: number

  // 5. Actual Counted & Variance
  isReconciled: boolean // true if CLOSED
  actualCounted: number | null // null if OPEN
  variance: number | null // null if OPEN

  // 6. Tender Breakdown
  tenderBreakdown: ZReportTenderItem[]
  totalTendered: number

  // Cross-check metrics
  totalCashSalesFromTender: number
  totalCashSalesFromDrawer: number
  tenderDiscrepancy: number
}

const INFLOW_CATEGORY_MAP: Record<string, string> = {
  [DRAWER_TX_TYPE.SALE]: 'Cash Sales',
  'Sale': 'Cash Sales',
  [DRAWER_TX_TYPE.SERVICE_PAYMENT]: 'Service Job Receipts',
  'ServiceInvoice': 'Service Job Receipts',
  [DRAWER_TX_TYPE.CUSTOMER_PAYMENT]: 'Customer Due Collections (AR)',
  'CUSTOMER_COLLECTION': 'Customer Due Collections (AR)',
  [DRAWER_TX_TYPE.B2B_SALE]: 'B2B Cash Sales',
  'SUPPLIER_SALE': 'B2B Cash Sales',
  [DRAWER_TX_TYPE.B2B_PAYMENT]: 'B2B Invoice Collections',
  'SUPPLIER_SALE_PAYMENT': 'B2B Invoice Collections',
  [DRAWER_TX_TYPE.PURCHASE_REFUND]: 'Supplier Return Refunds',
  'PurchaseReturn': 'Supplier Return Refunds',
  [DRAWER_TX_TYPE.B2B_PURCHASE_REFUND]: 'B2B Supplier Return Refunds',
  'SUPPLIER_PURCHASE_REFUND': 'B2B Supplier Return Refunds',
  [DRAWER_TX_TYPE.CASH_IN]: 'Contra Transfers In (Bank to Drawer)',
  'TRANSFER': 'Contra Transfers In (Bank to Drawer)',
}

const OUTFLOW_CATEGORY_MAP: Record<string, string> = {
  [DRAWER_TX_TYPE.EXPENSE]: 'Operating Expenses',
  'Expense': 'Operating Expenses',
  [DRAWER_TX_TYPE.SUPPLIER_PAYMENT]: 'Supplier Payments (AP)',
  'PurchaseInvoice': 'Supplier Payments (AP)',
  [DRAWER_TX_TYPE.B2B_PURCHASE]: 'B2B Purchases',
  'SUPPLIER_PURCHASE': 'B2B Purchases',
  [DRAWER_TX_TYPE.B2B_PURCHASE_PAYMENT]: 'B2B Invoice Payments',
  'SUPPLIER_INVOICE_PAYMENT': 'B2B Invoice Payments',
  [DRAWER_TX_TYPE.PAYROLL]: 'Staff Salary Payments',
  'PAYROLL_PAYMENT': 'Staff Salary Payments',
  [DRAWER_TX_TYPE.ADVANCE]: 'Employee Salary Advances',
  'EMPLOYEE_ADVANCE': 'Employee Salary Advances',
  [DRAWER_TX_TYPE.FIXED_ASSET_PURCHASE]: 'Fixed Asset Purchases',
  'FIXED_ASSET': 'Fixed Asset Purchases',
  [DRAWER_TX_TYPE.REFUND]: 'Customer Sale Refunds',
  'SaleReturn': 'Customer Sale Refunds',
  [DRAWER_TX_TYPE.SERVICE_REFUND]: 'Service Job Refunds',
  [DRAWER_TX_TYPE.B2B_SALE_REFUND]: 'B2B Sale Refunds',
  'SUPPLIER_SALE_REFUND': 'B2B Sale Refunds',
  [DRAWER_TX_TYPE.CASH_OUT]: 'Contra Transfers Out (Drawer to Bank)',
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Cash',
  [PaymentMethod.CARD]: 'Debit/Credit Card',
  [PaymentMethod.BKASH]: 'bKash',
  [PaymentMethod.NAGAD]: 'Nagad',
  [PaymentMethod.ROCKET]: 'Rocket',
  [PaymentMethod.BANK_TRANSFER]: 'Bank Transfer',
  [PaymentMethod.CREDIT]: 'Customer Credit / Due',
  [PaymentMethod.CHEQUE]: 'Cheque',
}

export async function getZReport(dateStr: string, outletId?: string) {
  try {
    // CASHIER is allowed: they use Z-report at shift close.
    // TECHNICIAN and HR are explicitly excluded.
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.ACCOUNTANT,
      UserRole.CASHIER
    )
    let effectiveOutletId = outletId || user.outletId || null

    if (outletId) {
      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && user.outletId !== outletId) {
        return fail('Unauthorized outlet access')
      }
      effectiveOutletId = outletId
    } else if (!effectiveOutletId && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
      const firstOutlet = await prisma.outlet.findFirst({ select: { id: true } })
      effectiveOutletId = firstOutlet?.id || null
    }

    if (!effectiveOutletId) {
      return fail('User is not assigned to an outlet')
    }

    const [outlet, session] = await Promise.all([
      prisma.outlet.findUnique({
        where: { id: effectiveOutletId },
        select: { id: true, name: true, code: true },
      }),
      resolveDrawerSessionForDate(effectiveOutletId, dateStr),
    ])

    if (!outlet) {
      return fail('Outlet not found')
    }

    const { drawer, openingBalance, start, end } = session
    const openingFloat = openingBalance

    // 1. Drawer Status & Reconciliation Info
    let drawerStatus: 'OPEN' | 'CLOSED' | 'NO_DRAWER' = 'NO_DRAWER'
    let isReconciled = false
    let actualCounted: number | null = null
    let variance: number | null = null
    let openedAt: string | null = null
    let closedAt: string | null = null
    let openedByName: string | null = null

    if (drawer) {
      drawerStatus = drawer.status === 'CLOSED' ? 'CLOSED' : 'OPEN'
      isReconciled = drawer.status === 'CLOSED'
      actualCounted = drawer.status === 'CLOSED' && drawer.physicalCount !== null ? Number(drawer.physicalCount) : null
      variance = drawer.status === 'CLOSED' && drawer.variance !== null ? Number(drawer.variance) : null
      openedAt = drawer.openedAt ? drawer.openedAt.toISOString() : null
      closedAt = drawer.closedAt ? drawer.closedAt.toISOString() : null
      openedByName = drawer.openedBy?.name ?? null
    }

    // 2. Unconditional Drawer Inflow / Outflow Totals (Guarantees Total Completeness)
    let totalCashIn = 0
    let totalCashOut = 0
    const cashInList: ZReportCategoryItem[] = []
    const cashOutList: ZReportCategoryItem[] = []
    let totalCashSalesFromDrawer = 0

    if (drawer) {
      const [inflowAgg, outflowAgg, txRows] = await Promise.all([
        prisma.drawerTransaction.aggregate({
          where: {
            drawerId: drawer.id,
            type: { not: 'OPENING' },
            amount: { gt: 0 },
            createdAt: { gte: start, lte: end },
          },
          _sum: { amount: true },
        }),
        prisma.drawerTransaction.aggregate({
          where: {
            drawerId: drawer.id,
            type: { not: 'OPENING' },
            amount: { lt: 0 },
            createdAt: { gte: start, lte: end },
          },
          _sum: { amount: true },
        }),
        prisma.drawerTransaction.findMany({
          where: {
            drawerId: drawer.id,
            type: { not: 'OPENING' },
            createdAt: { gte: start, lte: end },
          },
          select: {
            type: true,
            amount: true,
            description: true,
            referenceType: true,
          },
        }),
      ])

      totalCashIn = Number(inflowAgg._sum.amount || 0)
      totalCashOut = Math.abs(Number(outflowAgg._sum.amount || 0))

      // 3. Classified Breakdown Layered On Top (with "Other" Catch-All)
      const inCategoryMap = new Map<string, { label: string; amount: number; count: number }>()
      const outCategoryMap = new Map<string, { label: string; amount: number; count: number }>()

      for (const tx of txRows) {
        const rawAmt = Number(tx.amount)

        if (rawAmt > 0) {
          const label = INFLOW_CATEGORY_MAP[tx.type] || (tx.referenceType && INFLOW_CATEGORY_MAP[tx.referenceType]) || 'Other Inflows'
          const existing = inCategoryMap.get(label) ?? { label, amount: 0, count: 0 }
          existing.amount += rawAmt
          existing.count += 1
          inCategoryMap.set(label, existing)

          if (label === 'Cash Sales') {
            totalCashSalesFromDrawer += rawAmt
          }
        } else if (rawAmt < 0) {
          const absAmt = Math.abs(rawAmt)
          const label = OUTFLOW_CATEGORY_MAP[tx.type] || (tx.referenceType && OUTFLOW_CATEGORY_MAP[tx.referenceType]) || 'Other Outflows'
          const existing = outCategoryMap.get(label) ?? { label, amount: 0, count: 0 }
          existing.amount += absAmt
          existing.count += 1
          outCategoryMap.set(label, existing)
        }
      }

      for (const [key, item] of inCategoryMap.entries()) {
        cashInList.push({
          type: key,
          label: item.label,
          amount: Math.round((item.amount + Number.EPSILON) * 100) / 100,
          count: item.count,
        })
      }

      for (const [key, item] of outCategoryMap.entries()) {
        cashOutList.push({
          type: key,
          label: item.label,
          amount: Math.round((item.amount + Number.EPSILON) * 100) / 100,
          count: item.count,
        })
      }

      // Sort categories descending by amount
      cashInList.sort((a, b) => b.amount - a.amount)
      cashOutList.sort((a, b) => b.amount - a.amount)

      // Guarantee display sum perfectly matches unconditional total
      const classifiedInSum = cashInList.reduce((s, i) => s + i.amount, 0)
      const inDiff = Math.round((totalCashIn - classifiedInSum) * 100) / 100
      if (Math.abs(inDiff) >= 0.01) {
        const other = cashInList.find(c => c.label === 'Other Inflows')
        if (other) {
          other.amount += inDiff
        } else {
          cashInList.push({ type: 'OTHER', label: 'Other Inflows', amount: inDiff, count: 1 })
        }
      }

      const classifiedOutSum = cashOutList.reduce((s, i) => s + i.amount, 0)
      const outDiff = Math.round((totalCashOut - classifiedOutSum) * 100) / 100
      if (Math.abs(outDiff) >= 0.01) {
        const other = cashOutList.find(c => c.label === 'Other Outflows')
        if (other) {
          other.amount += outDiff
        } else {
          cashOutList.push({ type: 'OTHER', label: 'Other Outflows', amount: outDiff, count: 1 })
        }
      }
    }

    // 4. Expected Closing Cash Formula
    const expectedClosingCash = Math.round((openingFloat + totalCashIn - totalCashOut + Number.EPSILON) * 100) / 100

    // 5. Tender Breakdown from SalePayment (Scoped to valid completed/refunded sales & active drawer session window)
    const paymentWindowStart =
      drawer?.openedAt && drawer.openedAt > start ? drawer.openedAt : start
    const paymentWindowEnd =
      drawer?.closedAt && drawer.closedAt < end ? drawer.closedAt : end

    const [salePayments, servicePayments] = await Promise.all([
      prisma.salePayment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { id: true },
        where: {
          sale: {
            outletId: effectiveOutletId,
            isQuotation: false,
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
          },
          paidAt: { gte: paymentWindowStart, lte: paymentWindowEnd },
        },
      }),
      prisma.servicePayment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { id: true },
        where: {
          invoice: {
            job: { outletId: effectiveOutletId },
          },
          paidAt: { gte: paymentWindowStart, lte: paymentWindowEnd },
        },
      }),
    ])

    const tenderMap = new Map<PaymentMethod, { amount: number; count: number }>()
    for (const sp of salePayments) {
      const amt = Number(sp._sum.amount || 0)
      const cnt = Number(sp._count.id || 0)
      const existing = tenderMap.get(sp.method) ?? { amount: 0, count: 0 }
      existing.amount += amt
      existing.count += cnt
      tenderMap.set(sp.method, existing)
    }

    for (const srv of servicePayments) {
      const amt = Number(srv._sum.amount || 0)
      const cnt = Number(srv._count.id || 0)
      const existing = tenderMap.get(srv.method) ?? { amount: 0, count: 0 }
      existing.amount += amt
      existing.count += cnt
      tenderMap.set(srv.method, existing)
    }

    const tenderBreakdown: ZReportTenderItem[] = []
    let totalTendered = 0
    let totalCashSalesFromTender = 0

    const methodOrder: PaymentMethod[] = [
      PaymentMethod.CASH,
      PaymentMethod.CARD,
      PaymentMethod.BKASH,
      PaymentMethod.NAGAD,
      PaymentMethod.ROCKET,
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.CREDIT,
      PaymentMethod.CHEQUE,
    ]

    for (const method of methodOrder) {
      const entry = tenderMap.get(method) ?? { amount: 0, count: 0 }
      const amt = Math.round((entry.amount + Number.EPSILON) * 100) / 100
      tenderBreakdown.push({
        method,
        label: METHOD_LABELS[method] || method,
        amount: amt,
        count: entry.count,
      })
      totalTendered += amt
      if (method === PaymentMethod.CASH) {
        totalCashSalesFromTender += amt
      }
    }

    totalTendered = Math.round((totalTendered + Number.EPSILON) * 100) / 100
    totalCashSalesFromTender = Math.round((totalCashSalesFromTender + Number.EPSILON) * 100) / 100
    totalCashSalesFromDrawer = Math.round((totalCashSalesFromDrawer + Number.EPSILON) * 100) / 100
    const tenderDiscrepancy = Math.round((totalCashSalesFromTender - totalCashSalesFromDrawer + Number.EPSILON) * 100) / 100

    const data: ZReportData = {
      date: dateStr,
      outletId: outlet.id,
      outletName: outlet.name,
      drawerId: drawer?.id || null,
      drawerStatus,
      openedAt,
      closedAt,
      openedByName,
      openingFloat,
      cashInList,
      totalCashIn,
      cashOutList,
      totalCashOut,
      expectedClosingCash,
      isReconciled,
      actualCounted,
      variance,
      tenderBreakdown,
      totalTendered,
      totalCashSalesFromTender,
      totalCashSalesFromDrawer,
      tenderDiscrepancy,
    }

    return ok(data)
  } catch (error: any) {
    return fail(error.message || 'Failed to generate Z-Report')
  }
}
