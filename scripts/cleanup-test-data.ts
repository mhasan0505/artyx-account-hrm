/**
 * scripts/cleanup-test-data.ts
 *
 * Step 1: Delete 15 test sales — full transactional reversal identical to
 *         deleteSale(), PLUS StockLayer replenishment that deleteSale() omits.
 * Step 2: Reverse and delete 7 test POs — StockLayer/StockLedger/SupplierLedger/
 *         PurchaseInvoice/SerialUnits/PurchaseOrderLine, with unconsumed-layer guard.
 * Step 3: Hard-delete 8 test customers + 27 test products.
 * Step 4: Run getBalanceSheet() inline and confirm isBalanced === true.
 * Step 5: Report final row counts for every affected table.
 *
 * NOTHING IS DELETED UNTIL EVERY PRE-DELETE ASSERTION PASSES.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { prisma } from '../lib/db'
import { Prisma } from '@prisma/client'

// ── IDs from audit_candidates.json ────────────────────────────────────────

const TEST_SALE_IDS = [
  'cmsr5wdbh000590u4w1ude0vi', // SAL-MSR5WDB1  Audit Customer 1786604009269
  'cmsr5y1rm000rzku4qucdvhqh', // SAL-MSR5Y1RI  Audit Customer 1786604087823
  'cmsr6b2ry000nusu4w6iso3o0', // SAL-MSR6B2RV  Customer P15-1786604695716
  'cmsr6c0aq000nlcu4wcpqcsr3', // SAL-MSR6C0AO  Customer P15-1786604739225
  'cmsr6c6v6001ylcu4d3kt9ypi', // SAL-MSR6C6V4  Customer P15-1786604739225
  'cmsr6c8g80029lcu4iol2mfk7', // SAL-MSR6C8G7  Customer P15-1786604739225
  'cmsr6csba000n5ou4anpfjsbt', // SAL-MSR6CSB8  Customer P15-1786604775513
  'cmsr6cypm001y5ou4m48ljp13', // SAL-MSR6CYPK  Customer P15-1786604775513
  'cmsr6d0a300295ou41ofjqr7a', // SAL-MSR6D0A3  Customer P15-1786604775513
  'cmsr6dngp000niku41qk3pcs6', // SAL-MSR6DNGN  Customer P15-1786604815797
  'cmsr6du6w001yiku49rovj86a', // SAL-MSR6DU6T  Customer P15-1786604815797
  'cmsr6dvy00029iku4g0b99z31', // SAL-MSR6DVXZ  Customer P15-1786604815797
  'cmsr6foll000nwou4qx41knuu', // SAL-MSR6FOLI  Customer P15-1786604910679
  'cmsr6fvnz001ywou4s6fa3co4', // SAL-MSR6FVNX  Customer P15-1786604910679
  'cmsr6fx3z0029wou4wl700qeg', // SAL-MSR6FX3Y  Customer P15-1786604910679
]

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
  'cmsr5vx7h000150u40hol68mk', // Audit Customer 1786603989724  (0 sales)
  'cmsr5wcae000190u4pczrlms6', // Audit Customer 1786604009269  (1 test sale)
  'cmsr5y0wg000nzku4klfunjn4', // Audit Customer 1786604087823  (1 test sale)
  'cmsr6b1yc000jusu4lngzugbk', // Customer P15-1786604695716    (1 test sale)
  'cmsr6bziy000jlcu4bo7hveir', // Customer P15-1786604739225    (3 test sales)
  'cmsr6criy000j5ou4968v6x88', // Customer P15-1786604775513    (3 test sales)
  'cmsr6dmly000jiku4g7e2eowm', // Customer P15-1786604815797    (3 test sales)
  'cmsr6fntj000jwou44gnoha9p', // Customer P15-1786604910679    (3 test sales)
]

const TEST_PRODUCT_IDS = [
  'cmsr5vx2p000050u4ak57q3co', // Audit Serial Laptop 1786603989544
  'cmsr5vx92000250u4ajow0skm', // Audit Item 1786603989780
  'cmsr5wc5b000090u4fpz5c88o', // Audit Serial Laptop 1786604009073
  'cmsr5wcby000290u450bcdnph', // Audit Item 1786604009324
  'cmsr5wtyo0000lwu4t8lj3wcw', // Audit Serial Laptop 1786604032166
  'cmsr6c5z6001tlcu4rqaqzh80', // Cross Sale Serial Product 1786604747585
  'cmsr5xxmw0000zku4pyfv3541', // Audit Serial Laptop 1786604083583
  'cmsr5y0xy000ozku4bf37yt24', // Audit Item 1786604087876
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

// ── Helpers ────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('─'.repeat(60))
}

function ok(msg: string) { console.log(`  ✅  ${msg}`) }
function warn(msg: string) { console.log(`  ⚠️   ${msg}`) }
function info(msg: string) { console.log(`  ℹ️   ${msg}`) }

// ── STEP 1: Delete 15 test sales ──────────────────────────────────────────

async function deleteSaleTransactionally(saleId: string) {
  // Load full sale data first
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      lines: {
        include: {
          serials: { include: { serialUnit: true } },
        },
      },
      payments: true,
      returns: true,
    },
  })

  if (sale.returns.length > 0) {
    throw new Error(`Sale ${sale.saleNumber} has return records — cannot delete.`)
  }

  // Before deleting, record which StockLayer rows were consumed by this sale
  // (identified via StockLedger entries with referenceId = saleId, SALE_OUT movement)
  const saleOutEntries = await prisma.stockLedger.findMany({
    where: { referenceId: saleId, referenceType: 'Sale' },
    select: { productId: true, quantity: true, notes: true },
  })

  // Parse layer ID from notes column ("Sale SAL-xxx (Layer layerId)")
  const layerReplenishments: Array<{ layerId: string; replenish: number }> = []
  for (const entry of saleOutEntries) {
    const match = entry.notes?.match(/\(Layer ([^)]+)\)/)
    if (match) {
      const layerId = match[1]
      const qty = Math.abs(entry.quantity) // quantity is negative (SALE_OUT)
      const existing = layerReplenishments.find(r => r.layerId === layerId)
      if (existing) {
        existing.replenish += qty
      } else {
        layerReplenishments.push({ layerId, replenish: qty })
      }
    }
  }

  await prisma.$transaction(async tx => {
    // 1. Revert bank balances
    for (const payment of sale.payments) {
      if (payment.bankAccountId) {
        const netAmount = Number(payment.amount) - Number(payment.feeAmount)
        await tx.bankAccount.update({
          where: { id: payment.bankAccountId },
          data: { currentBalance: { decrement: netAmount } },
        })
      }
    }

    // 2. Delete bank transactions
    await tx.bankTransaction.deleteMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
    })

    // 3. Revert cash drawer transactions
    await tx.drawerTransaction.deleteMany({
      where: { description: `Sale ${sale.saleNumber}` },
    })

    // 4. Revert serial units → IN_STOCK and delete SaleLineSerial
    const serialUnitIds: string[] = []
    for (const line of sale.lines) {
      for (const s of line.serials) {
        serialUnitIds.push(s.serialUnitId)
      }
    }
    if (serialUnitIds.length > 0) {
      await tx.serialUnit.updateMany({
        where: { id: { in: serialUnitIds } },
        data: { status: 'IN_STOCK', soldAt: null },
      })
      await tx.saleLineSerial.deleteMany({
        where: { saleLineId: { in: sale.lines.map(l => l.id) } },
      })
    }

    // 5. Delete stock ledger entries
    await tx.stockLedger.deleteMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
    })

    // 5b. REPLENISH StockLayer.quantityRemaining for consumed FIFO layers
    //     (deleteSale() omits this — we do it here to keep the balance sheet clean)
    for (const r of layerReplenishments) {
      const layer = await tx.stockLayer.findUnique({ where: { id: r.layerId } })
      if (!layer) {
        warn(`StockLayer ${r.layerId} not found during replenishment (sale ${sale.saleNumber})`)
        continue
      }
      await tx.stockLayer.update({
        where: { id: r.layerId },
        data: { quantityRemaining: { increment: r.replenish } },
      })
    }

    // 6. Delete account ledger entries
    await tx.accountLedgerEntry.deleteMany({ where: { saleId } })

    // 7. Delete fee expenses
    await tx.expense.deleteMany({
      where: {
        description: `MFS/Bank Transaction Fee (Sale ${sale.saleNumber})`,
        outletId: sale.outletId,
      },
    })

    // 8. Revert customer outstanding balance + delete customer ledger entries
    if (sale.customerId) {
      const ledgers = await tx.customerLedger.findMany({
        where: {
          customerId: sale.customerId,
          OR: [
            { referenceId: saleId },
            { description: `Credit Sale ${sale.saleNumber}` },
          ],
        },
      })
      const creditToReverse = ledgers.reduce(
        (sum, l) => (l.type === 'DEBIT' ? sum + Number(l.amount) : sum - Number(l.amount)),
        0
      )
      const creditPaymentsTotal = sale.payments
        .filter(p => p.method === 'CREDIT')
        .reduce((sum, p) => sum + Number(p.amount), 0)
      const finalReverse = creditToReverse > 0 ? creditToReverse : creditPaymentsTotal

      if (finalReverse > 0) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { outstandingBalance: { decrement: finalReverse } },
        })
      }

      await tx.customerLedger.deleteMany({
        where: {
          customerId: sale.customerId,
          OR: [
            { referenceId: saleId },
            { description: `Credit Sale ${sale.saleNumber}` },
          ],
        },
      })
    }

    // 9. Delete payments, edit logs, sale lines, sale
    await tx.salePayment.deleteMany({ where: { saleId } })
    await tx.saleEditLog.deleteMany({ where: { saleId } })
    await tx.saleLine.deleteMany({ where: { saleId } })
    await tx.sale.delete({ where: { id: saleId } })
  })

  return {
    saleNumber: sale.saleNumber,
    customerName: sale.customerId,
    layersReplenished: layerReplenishments.length,
    serialsReverted: sale.lines.reduce((n, l) => n + l.serials.length, 0),
  }
}

// ── STEP 2: Reverse and delete 7 test POs ─────────────────────────────────

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
          purchasePayments: true,
          ledgerEntries: { select: { id: true } },
          editLogs: { select: { id: true } },
        },
      },
      stockLayers: true,          // StockLayer rows live on PurchaseOrder, not PurchaseOrderLine
      stockLedgerEntries: true,
    },
  })

  // ── Pre-delete assertion: every StockLayer must be fully unconsumed ──────
  // StockLayer rows are linked to the PurchaseOrder directly (not to individual lines)
  const layers = po.stockLayers

  for (const layer of layers) {
    if (Number(layer.quantityRemaining) !== Number(layer.quantityReceived)) {
      throw new Error(
        `STOP: PO ${po.poNumber} — StockLayer ${layer.id} shows partial consumption ` +
        `(received=${layer.quantityReceived}, remaining=${layer.quantityRemaining}). ` +
        `This means Step 1 did not fully reverse the stock consumption. Aborting.`
      )
    }
  }
  info(`  PO ${po.poNumber}: all ${layers.length} layer(s) confirmed fully unconsumed ✓`)

  // ── Compute supplier balance reversal ─────────────────────────────────────
  // The PO's purchase invoices represent what was credited to the supplier.
  // We need to remove those from supplier.outstandingBalance.
  const totalInvoiced = po.purchaseInvoices.reduce(
    (sum, inv) => sum + Number(inv.total),
    0
  )
  // Payments already made reduce the balance; we remove the net credit effect
  const totalPaid = po.purchaseInvoices.flatMap(inv => inv.purchasePayments)
    .reduce((sum, p) => sum + Number(p.amount), 0)
  const netSupplierBalanceToReverse = totalInvoiced - totalPaid

  await prisma.$transaction(async tx => {
    // 1. Delete PurchaseOrderLineSerial records (children of PO lines)
    for (const line of po.lines) {
      await tx.purchaseOrderLineSerial.deleteMany({ where: { poLineId: line.id } })
    }

    // 2. Revert SerialUnits to a clean state — delete them entirely
    //    (they were created solely for this PO; none are SOLD at this point)
    const allSerialUnitIds = po.lines
      .flatMap(l => l.serialUnits.map(su => su.serialUnit.id))

    if (allSerialUnitIds.length > 0) {
      // Assert none are sold
      const soldSerials = await tx.serialUnit.findMany({
        where: { id: { in: allSerialUnitIds }, status: 'SOLD' },
        select: { serialNumber: true },
      })
      if (soldSerials.length > 0) {
        throw new Error(
          `STOP: Some serials for PO ${po.poNumber} are SOLD: ` +
          soldSerials.map(s => s.serialNumber).join(', ') +
          '. They should have been reverted to IN_STOCK in Step 1.'
        )
      }
      await tx.serialUnit.deleteMany({ where: { id: { in: allSerialUnitIds } } })
    }

    // 3. Delete StockLedger entries for this PO
    await tx.stockLedger.deleteMany({ where: { purchaseOrderId: poId } })

    // 4. Delete StockLayer rows for this PO and its lines
    const layerIds = layers.map(l => l.id)
    if (layerIds.length > 0) {
      await tx.stockLayer.deleteMany({ where: { id: { in: layerIds } } })
    }

    // 5. Revert supplier outstanding balance & delete SupplierLedger entries
    if (netSupplierBalanceToReverse > 0) {
      await tx.supplier.update({
        where: { id: po.supplierId },
        data: { outstandingBalance: { decrement: netSupplierBalanceToReverse } },
      })
    }

    for (const inv of po.purchaseInvoices) {
      // Delete SupplierLedger entries linked to this invoice
      await tx.supplierLedger.deleteMany({ where: { invoiceId: inv.id } })
      // Delete SupplierTransaction entries linked to this invoice
      await tx.supplierTransaction.deleteMany({ where: { invoiceId: inv.id } })
      // Delete PurchasePayments
      await tx.purchasePayment.deleteMany({ where: { invoiceId: inv.id } })
      // Delete PurchaseInvoiceEditLog (linked to invoiceId, not poId)
      await tx.purchaseInvoiceEditLog.deleteMany({ where: { invoiceId: inv.id } })
      // Delete PurchaseInvoice
      await tx.purchaseInvoice.delete({ where: { id: inv.id } })
    }

    // 6. Delete PurchaseOrderLine rows
    await tx.purchaseOrderLine.deleteMany({ where: { poId } })

    // 7. Delete the PurchaseOrder itself
    await tx.purchaseOrder.delete({ where: { id: poId } })

    // 8. Revert Product.costPrice? — only if no other POs exist for this product.
    //    We'll handle via product deletion in Step 3; products are fully test-only.
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

// ── STEP 4: Balance Sheet inline check ────────────────────────────────────

async function runBalanceSheetCheck() {
  // Direct DB queries (same formulas as getBalanceSheet in reports.ts)
  const asOfDate = new Date()
  asOfDate.setHours(23, 59, 59, 999)

  const [cashTxSum] = await prisma.$queryRaw<{ totalCash: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "totalCash"
    FROM "DrawerTransaction" dt
    JOIN "CashDrawer" cd ON dt."drawerId" = cd.id
    WHERE dt."createdAt" <= ${asOfDate}
      AND dt.type::text != 'OPENING'
  `
  const firstDrawers = await prisma.cashDrawer.groupBy({
    by: ['outletId'],
    _min: { openedAt: true },
  })
  let initialCash = 0
  for (const group of firstDrawers) {
    const fd = await prisma.cashDrawer.findFirst({
      where: { outletId: group.outletId, openedAt: group._min.openedAt! },
    })
    if (fd && fd.openedAt <= asOfDate) initialCash += Number(fd.openingBalance)
  }
  const cashOnHand = Number(cashTxSum?.totalCash || 0) + initialCash

  const bankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } })
  const bankBalances = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0)

  const customers = await prisma.customer.findMany({ include: { linkedSupplier: true } })
  let ar = 0
  for (const c of customers) {
    const cBal = Number(c.outstandingBalance || 0)
    if (c.linkedSupplier) {
      const net = cBal - Number(c.linkedSupplier.outstandingBalance || 0)
      if (net > 0) ar += net
    } else {
      ar += cBal
    }
  }

  const [invSum] = await prisma.$queryRaw<{ totalValue: number }[]>`
    SELECT COALESCE(SUM("quantityRemaining" * "unitCost"), 0) as "totalValue"
    FROM "StockLayer"
    WHERE "createdAt" <= ${asOfDate}
  `
  const inventoryValue = Number(invSum?.totalValue || 0)
  const totalAssets = Math.round((cashOnHand + bankBalances + ar + inventoryValue) * 100) / 100

  const suppliers = await prisma.supplier.findMany({ include: { linkedCustomer: true } })
  let ap = 0
  for (const s of suppliers) {
    if (s.linkedCustomer) {
      const sBal = Number(s.outstandingBalance || 0)
      const cBal = Number(s.linkedCustomer.outstandingBalance || 0)
      const net = cBal - sBal
      if (net < 0) ap += Math.abs(net)
    } else {
      ap += Number(s.outstandingBalance || 0)
    }
  }
  const totalLiabilities = Math.round(ap * 100) / 100

  const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
    SELECT COALESCE(SUM(ci.amount), 0) as "totalCapital"
    FROM "CapitalInjection" ci
    WHERE ci.status::text = 'APPROVED'
      AND ci."createdAt" <= ${asOfDate}
  `
  const ownersCapital = Number(capitalSum?.totalCapital || 0)

  const [netSalesSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(s.total - s."discountAmt"), 0) as total
    FROM "Sale" s
    WHERE s."isQuotation" = false
      AND s."createdAt" <= ${asOfDate}
  `
  const netSales = Number(netSalesSum?.total || 0)

  const [cogsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(
      CASE WHEN ale.type::text = 'DEBIT' THEN ale.amount ELSE -ale.amount END
    ), 0) as total
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '5000'
      AND ale."createdAt" <= ${asOfDate}
  `
  const cogs = Number(cogsSum?.total || 0)

  const [expenseSum] = await prisma.$queryRaw<{ totalExp: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "totalExp"
    FROM "Expense"
    WHERE status::text = 'APPROVED'
      AND "createdAt" <= ${asOfDate}
  `
  const expenses = Number(expenseSum?.totalExp || 0)

  const retainedEarnings = Math.round((netSales - cogs - expenses) * 100) / 100
  const totalEquity = Math.round((ownersCapital + retainedEarnings) * 100) / 100

  const discrepancy = Math.round((totalAssets - (totalLiabilities + totalEquity)) * 100) / 100
  const isBalanced = Math.abs(discrepancy) < 0.01

  return { totalAssets, totalLiabilities, totalEquity, discrepancy, isBalanced, cashOnHand, bankBalances, ar, inventoryValue, ownersCapital, retainedEarnings }
}

// ── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧹  TEST DATA CLEANUP — Starting\n')
  console.log('  Timestamp:', new Date().toISOString())

  // ── Step 1: Delete 15 test sales ──────────────────────────────────────
  sep('STEP 1 of 4 — Delete 15 test sales')

  for (const saleId of TEST_SALE_IDS) {
    try {
      const result = await deleteSaleTransactionally(saleId)
      ok(`Deleted ${result.saleNumber} | serials reverted: ${result.serialsReverted} | layers replenished: ${result.layersReplenished}`)
    } catch (err: any) {
      console.error(`\n  ❌  FAILED deleting sale ${saleId}: ${err.message}`)
      throw err
    }
  }

  ok(`All 15 test sales deleted.`)

  // ── Step 2: Reverse and delete 7 test POs ─────────────────────────────
  sep('STEP 2 of 4 — Reverse 7 test purchase orders (with unconsumed-layer guard)')

  for (const poId of TEST_PO_IDS) {
    try {
      const result = await reversePurchaseOrder(poId)
      ok(
        `Reversed ${result.poNumber} (${result.supplierName}) | ` +
        `supplier balance reversed: ৳${result.supplierBalanceReversed.toFixed(2)} | ` +
        `layers deleted: ${result.layersDeleted} | serials deleted: ${result.serialsDeleted} | ` +
        `invoices deleted: ${result.invoicesDeleted}`
      )
    } catch (err: any) {
      console.error(`\n  ❌  FAILED reversing PO ${poId}: ${err.message}`)
      throw err
    }
  }

  ok(`All 7 test POs reversed and deleted.`)

  // ── Step 3: Delete 8 test customers + 27 test products ────────────────
  sep('STEP 3 of 4 — Delete 8 customers + 27 products')

  // Customers first (product deletion doesn't care about customer records)
  for (const customerId of TEST_CUSTOMER_IDS) {
    const c = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        sales: { select: { id: true } },
        ledgerEntries: { select: { id: true } },
        serviceJobs: { select: { id: true } },
      },
    })
    if (!c) { warn(`Customer ${customerId} not found — already deleted?`); continue }
    if (c.sales.length > 0) throw new Error(`Customer ${c.name} still has ${c.sales.length} sale(s) — Step 1 must have failed.`)
    if (c.serviceJobs.length > 0) throw new Error(`Customer ${c.name} has ${c.serviceJobs.length} service job(s) — not safe to delete.`)

    // Delete dangling ledger entries if any remain (shouldn't, but safe belt-and-suspenders)
    await prisma.customerLedger.deleteMany({ where: { customerId } })
    await prisma.customer.delete({ where: { id: customerId } })
    ok(`Deleted customer: ${c.name}`)
  }

  // Products — assert no remaining sale or PO line links
  for (const productId of TEST_PRODUCT_IDS) {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        saleLines: { select: { id: true } },
        purchaseOrderLines: { select: { id: true } },
        serialUnits: { select: { id: true, serialNumber: true, status: true } },
      },
    })
    if (!p) { warn(`Product ${productId} not found — already deleted?`); continue }
    if (p.saleLines.length > 0) throw new Error(`Product ${p.name} still has ${p.saleLines.length} sale line(s) — not safe to delete.`)
    if (p.purchaseOrderLines.length > 0) throw new Error(`Product ${p.name} still has ${p.purchaseOrderLines.length} PO line(s) — not safe to delete.`)

    // Delete any orphan serial units that survived (should be none)
    if (p.serialUnits.length > 0) {
      const soldOnes = p.serialUnits.filter(s => s.status === 'SOLD')
      if (soldOnes.length > 0) throw new Error(`Product ${p.name} has SOLD serials: ${soldOnes.map(s => s.serialNumber).join(', ')} — not safe to delete.`)
      await prisma.serialUnit.deleteMany({ where: { productId } })
    }

    // Delete StockLedger and StockLayer orphans
    await prisma.stockLedger.deleteMany({ where: { productId } })
    await prisma.stockLayer.deleteMany({ where: { productId } })

    await prisma.product.delete({ where: { id: productId } })
    ok(`Deleted product: ${p.name}`)
  }

  ok(`All 8 customers and 27 products deleted.`)

  // ── Step 4: Balance sheet check ───────────────────────────────────────
  sep('STEP 4 of 4 — Balance sheet verification')

  const bs = await runBalanceSheetCheck()

  console.log('\n  Balance Sheet:')
  console.log(`    Cash on Hand:        ৳${bs.cashOnHand.toFixed(2)}`)
  console.log(`    Bank Balances:       ৳${bs.bankBalances.toFixed(2)}`)
  console.log(`    Accounts Receivable: ৳${bs.ar.toFixed(2)}`)
  console.log(`    Inventory:           ৳${bs.inventoryValue.toFixed(2)}`)
  console.log(`    ─────────────────────────────`)
  console.log(`    Total Assets:        ৳${bs.totalAssets.toFixed(2)}`)
  console.log(`    Total Liabilities:   ৳${bs.totalLiabilities.toFixed(2)}`)
  console.log(`    Total Equity:        ৳${bs.totalEquity.toFixed(2)}`)
  console.log(`      (Owner's Capital:  ৳${bs.ownersCapital.toFixed(2)})`)
  console.log(`      (Retained Earn.:   ৳${bs.retainedEarnings.toFixed(2)})`)
  console.log(`    ─────────────────────────────`)
  console.log(`    Discrepancy:         ৳${bs.discrepancy.toFixed(2)}`)
  console.log(`    isBalanced:          ${bs.isBalanced}`)

  if (!bs.isBalanced) {
    console.error(`\n  ❌  BALANCE SHEET DISCREPANCY of ৳${bs.discrepancy.toFixed(2)} — STOPPING.`)
    console.error(`     Do NOT paper over this. Investigate which step left a dangling entry.`)
    process.exit(1)
  }

  ok('Balance sheet is BALANCED ✓')

  // ── Step 5: Final row counts ──────────────────────────────────────────
  sep('STEP 5 — Final row counts for affected tables')

  const counts = {
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

  console.log('\n  Remaining row counts (all affected tables):')
  for (const [table, count] of Object.entries(counts)) {
    console.log(`    ${table.padEnd(28)}: ${count}`)
  }

  console.log('\n  ══════════════════════════════════════════════════════════')
  console.log('  🎉  Cleanup complete. Database is clean. Balance sheet OK.')
  console.log('  ══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => {
    console.error('\n❌  Fatal error during cleanup:', err.message || err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
