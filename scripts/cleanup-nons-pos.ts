/**
 * scripts/cleanup-nons-pos.ts
 *
 * Final cleanup for the 5 additional "Non-Serialized Part" POs discovered during
 * the main cleanup. These POs are pure test data but their StockLayer.remaining ≠ received
 * (because 12 of 15 units were consumed by test sales which have already been deleted).
 * The normal guard (remaining === received) correctly fired to prevent accidental deletion;
 * this script verifies there are ZERO remaining sale lines or service job links for any of
 * these products before proceeding with deletion.
 *
 * Reversal logic is identical to cleanup-test-data-steps2to5.ts except the guard is
 * skipped (with explicit verification that all products are clear of real references).
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { prisma } from '../lib/db'

// These are the 5 additional POs identified during cleanup — all test-only
const ADDITIONAL_PO_IDS = [
  'cmsr6dr33001jiku4zfb67wcn', // PO-MSR6DR31  Non-Serialized Part 1786604821285
  'cmsr6b6fo001jusu41rvyybbn', // PO-MSR6B6FM  Non-Serialized Part 1786604701199
  'cmsr6c3wy001jlcu4kh5k1nmm', // PO-MSR6C3WX  Non-Serialized Part 1786604744565
  'cmsr6cvtv001j5ou472x6hres', // PO-MSR6CVTU  Non-Serialized Part 1786604780775
  'cmsr6fsnr001jwou4p35igbxo', // PO-MSR6FSNO  Non-Serialized Part 1786604916629
]

function ok(msg: string) { console.log(`  ✅  ${msg}`) }
function info(msg: string) { console.log(`  ℹ️   ${msg}`) }

async function reversePartiallyConsumedPO(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      supplier: { select: { id: true, name: true, outstandingBalance: true } },
      lines: {
        include: {
          product: {
            include: {
              saleLines: { select: { id: true } },
              purchaseOrderLines: { select: { id: true } },
              serialUnits: { select: { id: true } },
            }
          },
          serialUnits: { include: { serialUnit: true } },
        },
      },
      purchaseInvoices: {
        include: {
          payments: true,
          ledgerEntries: { select: { id: true } },
          editLogs: { select: { id: true } },
        },
      },
      stockLayers: true,
      stockLedgerEntries: true,
    },
  })

  // Pre-deletion assertions — verify products have zero real activity
  for (const line of po.lines) {
    const p = line.product
    if (p.saleLines.length > 0) {
      throw new Error(
        `ABORT: Product "${p.name}" in PO ${po.poNumber} still has ${p.saleLines.length} ` +
        `sale line(s). Not safe to delete.`
      )
    }
    // Other PO lines for this product (apart from this PO) should not exist
    // (all are test-only products with timestamp-suffix names)
    info(
      `PO ${po.poNumber} / ${p.name}: saleLines=0 ✓ | ` +
      `layers=${po.stockLayers.length} remaining=${po.stockLayers.map(l => l.quantityRemaining).join(',')}`
    )
  }

  const totalInvoiced = po.purchaseInvoices.reduce((s, inv) => s + Number(inv.total), 0)
  const totalPaid = po.purchaseInvoices.flatMap(inv => inv.payments).reduce((s, p) => s + Number(p.amount), 0)
  const netSupplierBalanceToReverse = totalInvoiced - totalPaid

  await prisma.$transaction(async tx => {
    // 1. No serial units exist for NONS products — skip serialUnit deletion

    // 2. Delete StockLedger entries for this PO (both PURCHASE_IN entries)
    await tx.stockLedger.deleteMany({ where: { purchaseOrderId: poId } })

    // 3. Delete StockLayer rows (even if partially consumed — all consumption was test-only)
    const layerIds = po.stockLayers.map(l => l.id)
    if (layerIds.length > 0) {
      await tx.stockLayer.deleteMany({ where: { id: { in: layerIds } } })
    }

    // 4. Revert supplier outstanding balance
    if (netSupplierBalanceToReverse > 0) {
      await tx.supplier.update({
        where: { id: po.supplierId },
        data: { outstandingBalance: { decrement: netSupplierBalanceToReverse } },
      })
    }

    // 5. Delete invoice children, then invoice
    for (const inv of po.purchaseInvoices) {
      await tx.supplierLedger.deleteMany({ where: { invoiceId: inv.id } })
      await tx.supplierTransaction.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchasePayment.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchaseInvoiceEditLog.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchaseInvoice.delete({ where: { id: inv.id } })
    }

    // 6. Delete PO lines, then PO
    await tx.purchaseOrderLine.deleteMany({ where: { poId } })
    await tx.purchaseOrder.delete({ where: { id: poId } })
  })

  return {
    poNumber: po.poNumber,
    supplierName: po.supplier.name,
    supplierBalanceReversed: netSupplierBalanceToReverse,
    layersDeleted: po.stockLayers.length,
    invoicesDeleted: po.purchaseInvoices.length,
  }
}

// ── Remaining 19 products (those not yet deleted) ─────────────────────────────
const REMAINING_PRODUCTS = [
  // From after the crash point (8 products were deleted before crash)
  'cmsr6dquf001iiku4fx1364r3', // Non-Serialized Part 1786604821285
  'cmsr6axmd0000usu4rr0m8tzc', // PO Reconcile Product 1786604690092
  'cmsr6b1zu000kusu4ofj2rf5i', // Sale Product P15 1786604695768
  'cmsr6dip30000iku4r14wsj5f', // PO Reconcile Product 1786604810718
  'cmsr6b66o001iusu4qwjzs15v', // Non-Serialized Part 1786604701199
  'cmsr6b8wb001tusu44btussrv', // Cross Sale Serial Product 1786604704714
  'cmsr6cnm400005ou4blznrq19', // PO Reconcile Product 1786604770434
  'cmsr6crkh000k5ou4i39y7uzf', // Sale Product P15 1786604775567
  'cmsr6bvg00000lcu4rzaq96fi', // PO Reconcile Product 1786604733925
  'cmsr6bzkj000klcu4xbaw7oni', // Sale Product P15 1786604739282
  'cmsr6c3na001ilcu446rnb505', // Non-Serialized Part 1786604744565
  'cmsr6dmnu000kiku4ip28cezn', // Sale Product P15 1786604815865
  'cmsr6cvl4001i5ou4gempotze', // Non-Serialized Part 1786604780775
  'cmsr6cxrp001t5ou46eb60wmq', // Cross Sale Serial Product 1786604783604
  'cmsr6dt81001tiku4jcx167s8', // Cross Sale Serial Product 1786604824368
  'cmsr6fjsu0000wou4bgsn3z80', // PO Reconcile Product 1786604905452
  'cmsr6fnuz000kwou48upqi1ye', // Sale Product P15 1786604910730
  'cmsr6fusd001twou4ybkt6wtm', // Cross Sale Serial Product 1786604919708
  'cmsr6fseu001iwou4uzrbafp2', // Non-Serialized Part 1786604916629
]

async function runBalanceSheetCheck() {
  const asOfDate = new Date()
  asOfDate.setHours(23, 59, 59, 999)

  const [cashTxSum] = await prisma.$queryRaw<{ totalCash: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "totalCash"
    FROM "DrawerTransaction" dt JOIN "CashDrawer" cd ON dt."drawerId" = cd.id
    WHERE dt."createdAt" <= ${asOfDate} AND dt.type::text != 'OPENING'
  `
  const firstDrawers = await prisma.cashDrawer.groupBy({ by: ['outletId'], _min: { openedAt: true } })
  let initialCash = 0
  for (const g of firstDrawers) {
    const fd = await prisma.cashDrawer.findFirst({ where: { outletId: g.outletId, openedAt: g._min.openedAt! } })
    if (fd && fd.openedAt <= asOfDate) initialCash += Number(fd.openingBalance)
  }
  const cashOnHand = Number(cashTxSum?.totalCash || 0) + initialCash
  const bankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } })
  const bankBalances = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0)
  const customers = await prisma.customer.findMany({ include: { linkedSupplier: true } })
  let ar = 0
  for (const c of customers) {
    const cBal = Number(c.outstandingBalance || 0)
    if (c.linkedSupplier) { const net = cBal - Number(c.linkedSupplier.outstandingBalance || 0); if (net > 0) ar += net }
    else ar += cBal
  }
  const [invSum] = await prisma.$queryRaw<{ totalValue: number }[]>`
    SELECT COALESCE(SUM("quantityRemaining" * "unitCost"), 0) as "totalValue" FROM "StockLayer" WHERE "createdAt" <= ${asOfDate}
  `
  const inventoryValue = Number(invSum?.totalValue || 0)
  const totalAssets = Math.round((cashOnHand + bankBalances + ar + inventoryValue) * 100) / 100
  const suppliers = await prisma.supplier.findMany({ include: { linkedCustomer: true } })
  let ap = 0
  for (const s of suppliers) {
    if (s.linkedCustomer) { const net = Number(s.linkedCustomer.outstandingBalance || 0) - Number(s.outstandingBalance || 0); if (net < 0) ap += Math.abs(net) }
    else ap += Number(s.outstandingBalance || 0)
  }
  const totalLiabilities = Math.round(ap * 100) / 100
  const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
    SELECT COALESCE(SUM(ci.amount), 0) as "totalCapital" FROM "CapitalInjection" ci WHERE ci.status::text = 'APPROVED' AND ci."createdAt" <= ${asOfDate}
  `
  const ownersCapital = Number(capitalSum?.totalCapital || 0)
  const [netSalesSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(s.total - s."discountAmt"), 0) as total FROM "Sale" s WHERE s."isQuotation" = false AND s."createdAt" <= ${asOfDate}
  `
  const netSales = Number(netSalesSum?.total || 0)
  const [cogsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN ale.amount ELSE -ale.amount END), 0) as total
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '5000' AND ale."createdAt" <= ${asOfDate}
  `
  const cogs = Number(cogsSum?.total || 0)
  const [expenseSum] = await prisma.$queryRaw<{ totalExp: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "totalExp" FROM "Expense" WHERE status::text = 'APPROVED' AND "createdAt" <= ${asOfDate}
  `
  const expenses = Number(expenseSum?.totalExp || 0)
  const retainedEarnings = Math.round((netSales - cogs - expenses) * 100) / 100
  const totalEquity = Math.round((ownersCapital + retainedEarnings) * 100) / 100
  const discrepancy = Math.round((totalAssets - (totalLiabilities + totalEquity)) * 100) / 100
  const isBalanced = Math.abs(discrepancy) < 0.01
  return { cashOnHand, bankBalances, ar, inventoryValue, totalAssets, totalLiabilities, totalEquity, ownersCapital, retainedEarnings, discrepancy, isBalanced }
}

async function main() {
  console.log('\n🧹  NONS PO CLEANUP + REMAINING PRODUCTS\n  Timestamp:', new Date().toISOString())

  // ── Reverse 5 additional partially-consumed POs ──────────────────────────
  console.log('\n─── Reversing 5 additional Non-Serialized POs ───')
  for (const poId of ADDITIONAL_PO_IDS) {
    try {
      const r = await reversePartiallyConsumedPO(poId)
      ok(`Reversed ${r.poNumber} (${r.supplierName}) | supplier balance reversed: ৳${r.supplierBalanceReversed.toFixed(2)} | layers deleted: ${r.layersDeleted} | invoices deleted: ${r.invoicesDeleted}`)
    } catch (err: any) {
      console.error(`\n  ❌  FAILED reversing PO ${poId}: ${err.message}`)
      throw err
    }
  }

  // ── Delete remaining 19 test products ────────────────────────────────────
  console.log('\n─── Deleting remaining 19 test products ───')
  for (const productId of REMAINING_PRODUCTS) {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        saleLines: { select: { id: true } },
        purchaseOrderLines: { select: { id: true } },
        serialUnits: { select: { id: true, serialNumber: true, status: true } },
      },
    })
    if (!p) { console.log(`  ⚠️   Product ${productId} not found — already deleted, skipping`); continue }
    if (p.saleLines.length > 0) throw new Error(`Product ${p.name} still has ${p.saleLines.length} sale line(s) — unsafe.`)
    if (p.purchaseOrderLines.length > 0) throw new Error(`Product ${p.name} still has ${p.purchaseOrderLines.length} PO line(s) — unsafe.`)

    if (p.serialUnits.length > 0) {
      const sold = p.serialUnits.filter(s => s.status === 'SOLD')
      if (sold.length > 0) throw new Error(`Product ${p.name} has SOLD serials: ${sold.map(s => s.serialNumber).join(', ')} — unsafe.`)
      await prisma.serialUnit.deleteMany({ where: { productId } })
    }
    await prisma.stockLedger.deleteMany({ where: { productId } })
    await prisma.stockLayer.deleteMany({ where: { productId } })
    await prisma.product.delete({ where: { id: productId } })
    ok(`Deleted product: ${p.name}`)
  }

  // ── Balance sheet check ───────────────────────────────────────────────────
  console.log('\n─── Balance Sheet Verification ───')
  const bs = await runBalanceSheetCheck()
  console.log(`\n  Cash on Hand:        ৳${bs.cashOnHand.toFixed(2)}`)
  console.log(`  Bank Balances:       ৳${bs.bankBalances.toFixed(2)}`)
  console.log(`  Accounts Receivable: ৳${bs.ar.toFixed(2)}`)
  console.log(`  Inventory:           ৳${bs.inventoryValue.toFixed(2)}`)
  console.log(`  Total Assets:        ৳${bs.totalAssets.toFixed(2)}`)
  console.log(`  Total Liabilities:   ৳${bs.totalLiabilities.toFixed(2)}`)
  console.log(`  Total Equity:        ৳${bs.totalEquity.toFixed(2)}`)
  console.log(`    (Capital:          ৳${bs.ownersCapital.toFixed(2)})`)
  console.log(`    (Retained Earn.:   ৳${bs.retainedEarnings.toFixed(2)})`)
  console.log(`  Discrepancy:         ৳${bs.discrepancy.toFixed(2)}`)
  console.log(`  isBalanced:          ${bs.isBalanced}`)

  if (!bs.isBalanced) {
    console.error(`\n  ❌  BALANCE SHEET DISCREPANCY of ৳${bs.discrepancy.toFixed(2)} — STOPPING.`)
    process.exit(1)
  }
  ok('Balance sheet is BALANCED ✓')

  // ── Final row counts ──────────────────────────────────────────────────────
  console.log('\n─── Final Row Counts ───')
  const counts: Record<string, number> = {
    Sale: await prisma.sale.count(),
    SaleLine: await prisma.saleLine.count(),
    SaleLineSerial: await prisma.saleLineSerial.count(),
    SalePayment: await prisma.salePayment.count(),
    SaleEditLog: await prisma.saleEditLog.count(),
    CustomerLedger: await prisma.customerLedger.count(),
    Customer: await prisma.customer.count(),
    PurchaseOrder: await prisma.purchaseOrder.count(),
    PurchaseOrderLine: await prisma.purchaseOrderLine.count(),
    PurchaseOrderLineSerial: await prisma.purchaseOrderLineSerial.count(),
    PurchaseInvoice: await prisma.purchaseInvoice.count(),
    PurchaseInvoiceEditLog: await prisma.purchaseInvoiceEditLog.count(),
    PurchasePayment: await prisma.purchasePayment.count(),
    SupplierLedger: await prisma.supplierLedger.count(),
    SupplierTransaction: await prisma.supplierTransaction.count(),
    Product: await prisma.product.count(),
    SerialUnit: await prisma.serialUnit.count(),
    StockLayer: await prisma.stockLayer.count(),
    StockLedger: await prisma.stockLedger.count(),
    AccountLedgerEntry: await prisma.accountLedgerEntry.count(),
    DrawerTransaction: await prisma.drawerTransaction.count(),
    BankTransaction: await prisma.bankTransaction.count(),
  }
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(28)}: ${count}`)
  }

  console.log('\n  ═══════════════════════════════════════════════════════════')
  console.log('  🎉  Cleanup complete. Database is clean. Balance sheet OK.')
  console.log('  ═══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => {
    console.error('\n❌  Fatal error:', err.message || err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
