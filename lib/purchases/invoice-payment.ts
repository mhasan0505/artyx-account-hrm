import { InvoiceStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  localDateOf,
  localDayStart,
  runOutletRollover,
} from '@/lib/finance/drawer-rollover'
import { round2 } from './landed-cost'

export const NO_OPEN_DRAWER_FOR_PURCHASE_ERROR =
  'No open cash drawer found for this outlet. Please open a cash drawer first.'

/**
 * Pre-transaction lazy rollover for purchase and AP cash paths.
 * Must be called BEFORE opening the purchase/payment `$transaction` so that
 * `Outlet FOR UPDATE` (acquired inside `runOutletRollover`) never executes while
 * holding `PurchaseOrder`, `Supplier`, or `PurchaseInvoice` locks.
 *
 * Policy:
 * - If an `OPEN` drawer exists from a prior local day (`openedAt < todayStart`),
 *   rolls it over into today's new `OPEN` drawer before the write transaction starts.
 * - If no `OPEN` drawer exists (i.e. the drawer is `CLOSED`), does NOT auto-reopen it;
 *   the subsequent `requireOpenDrawerForPurchase(tx, outletId)` inside the transaction
 *   rejects with `NO_OPEN_DRAWER_FOR_PURCHASE_ERROR`.
 */
export async function rolloverStaleOpenDrawerForPurchase(
  outletId: string | null | undefined,
  now: Date = new Date()
): Promise<void> {
  if (!outletId) return
  const todayStart = localDayStart(localDateOf(now))
  const staleOpenDrawers = await prisma.cashDrawer.findMany({
    where: {
      outletId,
      status: 'OPEN',
      openedAt: { lt: todayStart },
    },
    select: { id: true, openedAt: true },
    take: 1,
  })
  if (!Array.isArray(staleOpenDrawers) || staleOpenDrawers.length === 0) {
    return
  }
  await runOutletRollover(outletId, 'LAZY', now)
}

/**
 * Unified cash-drawer enforcement for all purchase and AP cash paths:
 * 1. Call `await requireOpenDrawerForPurchase.rolloverBeforeTx(outletId)` BEFORE `$transaction`
 *    to roll over any stale prior-day `OPEN` drawer without holding PO/Supplier/Invoice locks.
 * 2. Call `const openDrawer = await requireOpenDrawerForPurchase(tx, outletId)` INSIDE `$transaction`
 *    to strictly find an `OPEN` drawer (`findFirst({ where: { outletId, status: 'OPEN' } })`)
 *    and lock it (`SELECT id FROM "CashDrawer" WHERE id = ... FOR UPDATE`), or throw
 *    `NO_OPEN_DRAWER_FOR_PURCHASE_ERROR`.
 */
export async function requireOpenDrawerForPurchase(
  tx: Prisma.TransactionClient,
  outletId: string | null | undefined
) {
  if (!outletId) {
    throw new Error(NO_OPEN_DRAWER_FOR_PURCHASE_ERROR)
  }
  const openDrawer = await tx.cashDrawer.findFirst({
    where: { outletId, status: 'OPEN' },
  })
  if (!openDrawer) {
    throw new Error(NO_OPEN_DRAWER_FOR_PURCHASE_ERROR)
  }
  await tx.$executeRaw`SELECT id FROM "CashDrawer" WHERE id = ${openDrawer.id} FOR UPDATE`
  return openDrawer
}

requireOpenDrawerForPurchase.rolloverBeforeTx = rolloverStaleOpenDrawerForPurchase

export interface ApplyInvoicePaymentParams {
  invoiceId: string
  deltaAmountPaid?: number
  newTotal?: number
  newSubtotal?: number
  notes?: string
}

export interface ApplyInvoicePaymentResult {
  invoiceId: string
  previousAmountPaid: number
  newAmountPaid: number
  previousTotal: number
  newTotal: number
  status: InvoiceStatus
  isCredit: boolean
}

/**
 * Single authoritative helper to update PurchaseInvoice totals, amountPaid, and status.
 * Must be executed inside a Prisma transaction under an exclusive row lock (`FOR UPDATE`).
 *
 * Rules:
 * 1. Invoice status is ALWAYS determined by amountPaid vs total:
 *    - if amountPaid >= total (and total >= 0): PAID
 *    - else if amountPaid > 0: PARTIALLY_PAID
 *    - else: SENT (NEVER DRAFT)
 * 2. If a return reduces total below amountPaid, amountPaid is preserved (never capped).
 *    The invoice stays PAID, and the difference (amountPaid - total > 0) is valid supplier credit.
 * 3. amountPaid cannot be reduced below 0.
 */
export async function applyInvoicePayment(
  tx: Prisma.TransactionClient,
  params: ApplyInvoicePaymentParams
): Promise<ApplyInvoicePaymentResult> {
  const { invoiceId, deltaAmountPaid = 0, newTotal, newSubtotal, notes } = params

  // 1. Lock invoice row FOR UPDATE
  const locked = await tx.$queryRaw<{ id: string; total: any; subtotal: any; amountPaid: any; status: string; notes: string | null }[]>`
    SELECT id, total, subtotal, "amountPaid", status, notes
    FROM "PurchaseInvoice"
    WHERE id = ${invoiceId}
    FOR UPDATE
  `
  if (!locked || locked.length === 0) {
    throw new Error(`PurchaseInvoice with ID "${invoiceId}" not found`)
  }

  const invoice = locked[0]
  const previousTotal = round2(Number(invoice.total || 0))
  const finalTotal = newTotal !== undefined ? round2(newTotal) : previousTotal
  const finalSubtotal = newSubtotal !== undefined ? round2(newSubtotal) : (invoice.subtotal !== null ? round2(Number(invoice.subtotal)) : finalTotal)

  const previousAmountPaid = round2(Number(invoice.amountPaid || 0))
  const calculatedPaid = round2(previousAmountPaid + deltaAmountPaid)
  if (calculatedPaid < 0) {
    throw new Error(
      `Cannot apply payment delta of ৳${deltaAmountPaid.toFixed(2)} to invoice ${invoiceId}: resulting amountPaid (৳${calculatedPaid.toFixed(2)}) cannot be negative.`
    )
  }
  const finalAmountPaid = calculatedPaid

  // Status computation (NEVER DRAFT)
  let newStatus: InvoiceStatus
  if (finalTotal <= 0) {
    newStatus = InvoiceStatus.PAID
  } else if (finalAmountPaid >= finalTotal) {
    newStatus = InvoiceStatus.PAID
  } else if (finalAmountPaid > 0) {
    newStatus = InvoiceStatus.PARTIALLY_PAID
  } else {
    newStatus = InvoiceStatus.SENT
  }

  const isCredit = finalAmountPaid > finalTotal

  await tx.purchaseInvoice.update({
    where: { id: invoiceId },
    data: {
      total: finalTotal,
      subtotal: finalSubtotal,
      amountPaid: finalAmountPaid,
      status: newStatus,
      ...(notes !== undefined ? { notes } : {}),
    },
  })

  return {
    invoiceId,
    previousAmountPaid,
    newAmountPaid: finalAmountPaid,
    previousTotal,
    newTotal: finalTotal,
    status: newStatus,
    isCredit,
  }
}
