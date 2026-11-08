/**
 * scripts/cleanup-test-data-steps2to5.ts
 *
 * Continuation script — runs Steps 2–5 only.
 * Step 1 (delete 15 test sales) already completed successfully.
 *
 * Step 2: Reverse and delete 7 test POs.
 * Step 3: Delete 8 test customers + 27 test products.
 * Step 4: Balance sheet verification.
 * Step 5: Final row count report.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { prisma } from '../lib/db'

const TEST_PO_IDS = [
  'cmsr5wuaj0001lwu43olgblsq', // PO-MSR5WUA3  Smart Solutions BD  ৳100,000
  'cmsr5xxy50001zku41pz742si', // PO-MSR5XXXQ  RM Computer         ৳96,000
  'cmsr6axxu0001usu46n98a6rj', // PO-MSR6AXXE  NRB Solution        ৳38,000
  'cmsr6bvs70001lcu42e08blx5', // PO-MSR6BVRR  BD TECH             ৳38,000
  'cmsr6cnxm00015ou4vo5wr9u8', // PO-MSR6CNX6  AS MS               ৳38,000
  'cmsr6dj0j0001iku4u34fx7gu', // PO-MSR6DJ01  A 1 COMPUTER        ৳38,000
  'cmsr6fk5f0001wou4ff5wyrkr', // PO-MSR6FK4Q  Best Laptop Gallery ৳38,000
]

const TEST_CUSTOMER_IDS = [
  'cmsr5vx7h000150u40hol68mk',
  'cmsr5wcae000190u4pczrlms6',
  'cmsr5y0wg000nzku4klfunjn4',
  'cmsr6b1yc000jusu4lngzugbk',
  'cmsr6bziy000jlcu4bo7hveir',
  'cmsr6criy000j5ou4968v6x88',
  'cmsr6dmly000jiku4g7e2eowm',
  'cmsr6fntj000jwou44gnoha9p',
]

const TEST_PRODUCT_IDS = [
  'cmsr5vx2p000050u4ak57q3co',
  'cmsr5vx92000250u4ajow0skm',
  'cmsr5wc5b000090u4fpz5c88o',
  'cmsr5wcby000290u450bcdnph',
  'cmsr5wtyo0000lwu4t8lj3wcw',
  'cmsr6c5z6001tlcu4rqaqzh80',
  'cmsr5xxmw0000zku4pyfv3541',
  'cmsr5y0xy000ozku4bf37yt24',
  'cmsr6dquf001iiku4fx1364r3',
  'cmsr6axmd0000usu4rr0m8tzc',
  'cmsr6b1zu000kusu4ofj2rf5i',
  'cmsr6dip30000iku4r14wsj5f',
  'cmsr6b66o001iusu4qwjzs15v',
  'cmsr6b8wb001tusu44btussrv',
  'cmsr6cnm400005ou4blznrq19',
  'cmsr6crkh000k5ou4i39y7uzf',
  'cmsr6bvg00000lcu4rzaq96fi',
  'cmsr6bzkj000klcu4xbaw7oni',
  'cmsr6c3na001ilcu446rnb505',
  'cmsr6dmnu000kiku4ip28cezn',
  'cmsr6cvl4001i5ou4gempotze',
  'cmsr6cxrp001t5ou46eb60wmq',
  'cmsr6dt81001tiku4jcx167s8',
  'cmsr6fjsu0000wou4bgsn3z80',
  'cmsr6fnuz000kwou48upqi1ye',
  'cmsr6fusd001twou4ybkt6wtm',
  'cmsr6fseu001iwou4uzrbafp2',
]

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n  ${label}\n${'─'.repeat(60)}`)
}
function ok(msg: string) { console.log(`  ✅  ${msg}`) }
function warn(msg: string) { console.log(`  ⚠️   ${msg}`) }
function info(msg: string) { console.log(`  ℹ️   ${msg}`) }

// ── STEP 2 ──────────────────────────────────────────────────────────────────

async function reversePurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      supplier: { select: { id: true, name: true, outstandingBalance: true } },
      lines: {
        include: {
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

  // Guard: every StockLayer must be fully unconsumed
  const layers = po.stockLayers
  for (const layer of layers) {
    if (Number(layer.quantityRemaining) !== Number(layer.quantityReceived)) {
      throw new Error(
        `STOP: PO ${po.poNumber} — StockLayer ${layer.id} shows partial consumption ` +
        `(received=${layer.quantityReceived}, remaining=${layer.quantityRemaining}). ` +
        `Step 1 did not fully reverse stock consumption. Aborting.`
      )
    }
  }
  info(`PO ${po.poNumber}: all ${layers.length} layer(s) confirmed fully unconsumed ✓`)

  const totalInvoiced = po.purchaseInvoices.reduce((sum, inv) => sum + Number(inv.total), 0)
  const totalPaid = po.purchaseInvoices
    .flatMap(inv => inv.payments)
    .reduce((sum, p) => sum + Number(p.amount), 0)
  const netSupplierBalanceToReverse = totalInvoiced - totalPaid

  await prisma.$transaction(async tx => {
    // 1. Delete PurchaseOrderLineSerial
    for (const line of po.lines) {
      await tx.purchaseOrderLineSerial.deleteMany({ where: { poLineId: line.id } })
    }

    // 2. Delete SerialUnits created for this PO (all should be IN_STOCK by now)
    const allSerialUnitIds = po.lines.flatMap(l => l.serialUnits.map(su => su.serialUnit.id))
    if (allSerialUnitIds.length > 0) {
      const soldSerials = await tx.serialUnit.findMany({
        where: { id: { in: allSerialUnitIds }, status: 'SOLD' },
        select: { serialNumber: true },
      })
      if (soldSerials.length > 0) {
        throw new Error(
          `STOP: PO ${po.poNumber} still has SOLD serials after Step 1: ` +
          soldSerials.map(s => s.serialNumber).join(', ')
        )
      }
      await tx.serialUnit.deleteMany({ where: { id: { in: allSerialUnitIds } } })
    }

    // 3. Delete StockLedger entries for this PO
    await tx.stockLedger.deleteMany({ where: { purchaseOrderId: poId } })

    // 4. Delete StockLayer rows for this PO
    const layerIds = layers.map(l => l.id)
    if (layerIds.length > 0) {
      await tx.stockLayer.deleteMany({ where: { id: { in: layerIds } } })
    }

    // 5. Revert supplier outstanding balance
    if (netSupplierBalanceToReverse > 0) {
      await tx.supplier.update({
        where: { id: po.supplierId },
        data: { outstandingBalance: { decrement: netSupplierBalanceToReverse } },
      })
    }

    // 6. Delete invoice children, then invoice
    for (const inv of po.purchaseInvoices) {
      await tx.supplierLedger.deleteMany({ where: { invoiceId: inv.id } })
      await tx.supplierTransaction.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchasePayment.deleteMany({ where: { invoiceId: inv.id } })  // table name is PurchasePayment, field filter is invoiceId
      await tx.purchaseInvoiceEditLog.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchaseInvoice.delete({ where: { id: inv.id } })
    }

    // 7. Delete PO lines, then PO
    await tx.purchaseOrderLine.deleteMany({ where: { poId } })
    await tx.purchaseOrder.delete({ where: { id: poId } })
  })

  return {
    poNumber: po.poNumber,
    supplierName: po.supplier.name,
    supplierBalanceReversed: netSupplierBalanceToReverse,
    layersDeleted: layers.length,
    serialsDeleted: po.lines.flatMap(l => l.serialUnits).length,
    invoicesDeleted: po.purchaseInvoices.length,
  }
}

// ── STEP 4 Balance Sheet ─────────────────────────────────────────────────────

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

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧹  TEST DATA CLEANUP — Steps 2–5\n  Timestamp:', new Date().toISOString())

  // Step 1 already completed. Verify no test sales remain.
  const testSaleCount = await prisma.sale.count({
    where: { customer: { name: { contains: 'Audit Customer', mode: 'insensitive' } } },
  })
  if (testSaleCount > 0) {
    throw new Error(`${testSaleCount} test sale(s) still exist — Step 1 did not complete fully.`)
  }
  ok('Step 1 confirmed complete — 0 test sales remain.')

  // ── Step 2 ──────────────────────────────────────────────────────────────
  sep('STEP 2 of 5 — Reverse 7 test purchase orders (unconsumed-layer guard active)')
  for (const poId of TEST_PO_IDS) {
    try {
      const r = await reversePurchaseOrder(poId)
      ok(`Reversed ${r.poNumber} (${r.supplierName}) | supplier balance reversed: ৳${r.supplierBalanceReversed.toFixed(2)} | layers deleted: ${r.layersDeleted} | serials deleted: ${r.serialsDeleted} | invoices deleted: ${r.invoicesDeleted}`)
    } catch (err: any) {
      console.error(`\n  ❌  FAILED reversing PO ${poId}: ${err.message}`)
      throw err
    }
  }
  ok('All 7 test POs reversed and deleted.')

  // ── Step 3 ──────────────────────────────────────────────────────────────
  sep('STEP 3 of 5 — Delete 8 customers + 27 products')

  for (const customerId of TEST_CUSTOMER_IDS) {
    const c = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { sales: { select: { id: true } }, serviceJobs: { select: { id: true } } },
    })
    if (!c) { warn(`Customer ${customerId} not found — skipping`); continue }
    if (c.sales.length > 0) throw new Error(`Customer ${c.name} still has ${c.sales.length} sale(s) — unsafe.`)
    if (c.serviceJobs.length > 0) throw new Error(`Customer ${c.name} has ${c.serviceJobs.length} service job(s) — unsafe.`)
    await prisma.customerLedger.deleteMany({ where: { customerId } })
    await prisma.customer.delete({ where: { id: customerId } })
    ok(`Deleted customer: ${c.name}`)
  }

  for (const productId of TEST_PRODUCT_IDS) {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        saleLines: { select: { id: true } },
        purchaseOrderLines: { select: { id: true } },
        serialUnits: { select: { id: true, serialNumber: true, status: true } },
      },
    })
    if (!p) { warn(`Product ${productId} not found — skipping`); continue }
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
  ok('All 8 customers and 27 products deleted.')

  // ── Step 4 ──────────────────────────────────────────────────────────────
  sep('STEP 4 of 5 — Balance sheet verification')
  const bs = await runBalanceSheetCheck()
  console.log('\n  Balance Sheet After Cleanup:')
  console.log(`    Cash on Hand:        ৳${bs.cashOnHand.toFixed(2)}`)
  console.log(`    Bank Balances:       ৳${bs.bankBalances.toFixed(2)}`)
  console.log(`    Accounts Receivable: ৳${bs.ar.toFixed(2)}`)
  console.log(`    Inventory:           ৳${bs.inventoryValue.toFixed(2)}`)
  console.log(`    ─────────────────────────────────────`)
  console.log(`    Total Assets:        ৳${bs.totalAssets.toFixed(2)}`)
  console.log(`    Total Liabilities:   ৳${bs.totalLiabilities.toFixed(2)}`)
  console.log(`    Total Equity:        ৳${bs.totalEquity.toFixed(2)}`)
  console.log(`      (Owner's Capital:  ৳${bs.ownersCapital.toFixed(2)})`)
  console.log(`      (Retained Earn.:   ৳${bs.retainedEarnings.toFixed(2)})`)
  console.log(`    ─────────────────────────────────────`)
  console.log(`    Discrepancy:         ৳${bs.discrepancy.toFixed(2)}`)
  console.log(`    isBalanced:          ${bs.isBalanced}`)

  if (!bs.isBalanced) {
    console.error(`\n  ❌  BALANCE SHEET DISCREPANCY of ৳${bs.discrepancy.toFixed(2)} — STOPPING.`)
    console.error(`     Investigate before taking further action.`)
    process.exit(1)
  }
  ok('Balance sheet is BALANCED ✓')

  // ── Step 5 ──────────────────────────────────────────────────────────────
  sep('STEP 5 of 5 — Final row counts')
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
  console.log('\n  Remaining row counts:')
  for (const [table, count] of Object.entries(counts)) {
    console.log(`    ${table.padEnd(28)}: ${count}`)
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
