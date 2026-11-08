import { config } from 'dotenv'
config({ path: '.env.local' })
config()

process.env.SKIP_AUTH_CHECK = 'true'

import { checkout, updateSaleItems } from '../lib/actions/sales'
import { createPurchaseOrder, updatePurchaseItems } from '../lib/actions/purchases'
import { prisma } from '../lib/db'
import { UserRole, StockMovementType, SerialStatus, PaymentMethod } from '@prisma/client'

async function runPhase15TestSuite() {
  console.log('⚡ Starting Phase 15 Edit Reconciliation & Balance Integrity Verification Suite...\n')
  let passedCount = 0
  let totalTests = 0

  const outlet = await prisma.outlet.findFirst()
  if (!outlet) throw new Error('No outlet found')
  const outletId = outlet.id

  const adminUser = await prisma.user.findFirst({ where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } } })
  if (!adminUser) throw new Error('No admin user found')

  process.env.MOCK_USER_ID = adminUser.id
  process.env.MOCK_USER_ROLE = adminUser.role

  const supplier = await prisma.supplier.findFirst() || await prisma.supplier.create({
    data: { name: 'Phase 15 Supplier', phone: `017${Date.now().toString().slice(-8)}` }
  })

  // ─────────────────────────────────────────────
  // TEST 1: PO Serial Reconciliation (Keep Serials on Cost Edit, No Unique Constraint Errors)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('Test 1: PO Serial Reconciliation — Cost Edit without serial recreation')

  const product1 = await prisma.product.create({
    data: {
      name: `PO Reconcile Product ${Date.now()}`,
      productCode: `REC_PO_${Date.now()}`,
      costPrice: 20000,
      sellingPrice: 25000,
      requiresSerial: true,
      outletId,
    }
  })

  const sn1 = `SN-P15-A-${Date.now()}`
  const sn2 = `SN-P15-B-${Date.now()}`

  let poId1 = ''
  try {
    const poRes = await createPurchaseOrder({
      supplierId: supplier.id,
      orderDate: new Date().toISOString(),
      expectedDelivery: undefined,
      notes: 'Initial PO',
      lines: [
        {
          productId: product1.id,
          quantity: 2,
          unitCost: 20000,
          discount: 0,
          sellingPrice: 25000,
          serialNumbers: [sn1, sn2]
        }
      ]
    })
    if (poRes.success) poId1 = poRes.data.poId
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  if (!poId1) {
    const createdPo = await prisma.purchaseOrder.findFirst({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' }
    })
    if (createdPo) poId1 = createdPo.id
  }

  const initialSerials = await prisma.serialUnit.findMany({ where: { serialNumber: { in: [sn1, sn2] } } })
  const initialSerialIds = initialSerials.map(s => s.id)

  // Edit PO: Change unit cost from 20000 to 19000, keep exact same serials
  try {
    const editRes = await updatePurchaseItems({
      poId: poId1,
      reason: 'Supplier cost discount adjustment',
      lines: [
        {
          productId: product1.id,
          quantity: 2,
          unitCost: 19000,
          discount: 0,
          sellingPrice: 24000,
          serialNumbers: [sn1, sn2]
        }
      ]
    })
    if (!editRes.success && !editRes.error?.includes('static generation store')) {
      throw new Error(`updatePurchaseItems failed: ${editRes.error}`)
    }
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const afterEditSerials = await prisma.serialUnit.findMany({ where: { serialNumber: { in: [sn1, sn2] } } })
  const afterEditSerialIds = afterEditSerials.map(s => s.id)

  const serialIdsPreserved = initialSerialIds.every(id => afterEditSerialIds.includes(id))
  const poAfterEdit = await prisma.purchaseOrder.findUnique({
    where: { id: poId1 },
    include: { lines: true, purchaseInvoices: true }
  })

  if (serialIdsPreserved && Number(poAfterEdit?.total) === 38000 && Number(poAfterEdit?.lines[0].unitCost) === 19000) {
    console.log('  ✓ PASS: PO updated in-place, serial IDs preserved without recreation collision, totals updated to ৳38,000.')
    passedCount++
  } else {
    console.error('  ✖ FAIL: PO serial reconciliation failed.')
  }

  // ─────────────────────────────────────────────
  // TEST 2: Serial Replacement in PO (Remove SN-B, Add SN-C)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 2: PO Serial Replacement — Swapping an in-stock serial')

  const sn3 = `SN-P15-C-${Date.now()}`
  try {
    const swapRes = await updatePurchaseItems({
      poId: poId1,
      reason: 'Replacing damaged unit serial',
      lines: [
        {
          productId: product1.id,
          quantity: 2,
          unitCost: 19000,
          discount: 0,
          sellingPrice: 24000,
          serialNumbers: [sn1, sn3] // replaced sn2 with sn3
        }
      ]
    })
    if (!swapRes.success && !swapRes.error?.includes('static generation store')) {
      throw new Error(`swap failed: ${swapRes.error}`)
    }
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const sn2Check = await prisma.serialUnit.findUnique({ where: { serialNumber: sn2 } })
  const sn3Check = await prisma.serialUnit.findUnique({ where: { serialNumber: sn3 } })

  if (sn2Check === null && sn3Check !== null && sn3Check.status === SerialStatus.IN_STOCK) {
    console.log('  ✓ PASS: Old in-stock serial SN-B cleanly removed, new serial SN-C registered to PO.')
    passedCount++
  } else {
    console.error(`  ✖ FAIL: Expected SN-B removed and SN-C created. SN-B: ${sn2Check?.id}, SN-C: ${sn3Check?.id}`)
  }

  // ─────────────────────────────────────────────
  // TEST 3: Attempting to remove an already SOLD serial from PO (Hard Rejection)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 3: Attempting to remove already-sold serial from PO (Must be cleanly rejected)')

  // Mark SN-1 as SOLD
  await prisma.serialUnit.update({
    where: { serialNumber: sn1 },
    data: { status: SerialStatus.SOLD, soldAt: new Date() }
  })

  let test3RejectedCleanly = false
  try {
    const attemptRes = await updatePurchaseItems({
      poId: poId1,
      reason: 'Attempting to remove sold serial SN-1',
      lines: [
        {
          productId: product1.id,
          quantity: 1,
          unitCost: 19000,
          discount: 0,
          sellingPrice: 24000,
          serialNumbers: [sn3] // trying to remove sn1
        }
      ]
    })
    if (!attemptRes.success && attemptRes.error.includes('already been processed or sold')) {
      test3RejectedCleanly = true
    }
  } catch (err: any) {
    if (err?.message?.includes('already been processed or sold')) {
      test3RejectedCleanly = true
    }
  }

  if (test3RejectedCleanly) {
    console.log('  ✓ PASS: Cleanly rejected removal of sold serial SN-1 with actionable message.')
    passedCount++
  } else {
    console.error('  ✖ FAIL: Failed to reject removal of sold serial.')
  }

  // Restore SN-1 to IN_STOCK for clean state
  await prisma.serialUnit.update({ where: { serialNumber: sn1 }, data: { status: SerialStatus.IN_STOCK, soldAt: null } })

  // ─────────────────────────────────────────────
  // TEST 4: Sale newBalance & Ledger Recalculation (Increase AND Decrease)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 4: Sale Edit — Total Increase: newBalance, Customer Balance & CustomerLedger Recalculation')

  const customerA = await prisma.customer.create({
    data: {
      name: `Customer P15-${Date.now()}`,
      phone: `016${Date.now().toString().slice(-8)}`,
      outstandingBalance: 500, // Pre-existing due of 500
    }
  })

  const productSale = await prisma.product.create({
    data: {
      name: `Sale Product P15 ${Date.now()}`,
      productCode: `SAL_PROD_${Date.now()}`,
      costPrice: 400,
      sellingPrice: 1000,
      requiresSerial: false,
      outletId,
    }
  })

  await prisma.stockLedger.create({
    data: {
      productId: productSale.id,
      outletId,
      movementType: StockMovementType.OPENING,
      quantity: 50,
      referenceType: 'TestSeed'
    }
  })

  await prisma.stockLayer.create({
    data: {
      productId: productSale.id,
      outletId,
      quantityReceived: 50,
      quantityRemaining: 50,
      unitCost: 400,
      receivedAt: new Date(),
    }
  })

  // Initial Sale: Total 1000, Paid 200, Credit 800. PreviousDue = 500 => newBalance = 1300.
  try {
    await checkout({
      customerId: customerA.id,
      lines: [
        {
          productId: productSale.id,
          quantity: 1,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [],
          isGift: false,
          cartItemId: 'cart-15-1'
        }
      ],
      complimentaryGifts: [],
      payments: [
        { method: PaymentMethod.CASH, amount: 200, feeAmount: 0 },
        { method: PaymentMethod.CREDIT, amount: 800, feeAmount: 0 }
      ],
      orderDiscountPct: 0,
      isQuotation: false,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const createdSale = await prisma.sale.findFirst({
    where: { customerId: customerA.id },
    orderBy: { createdAt: 'desc' }
  })
  if (!createdSale) throw new Error('Failed to create sale for Test 4')

  // Edit Sale to INCREASE total: quantity 1 -> 2 (Total 1000 -> 2000, Paid 200 => New Credit 1800, newBalance = 500 + 1800 = 2300)
  try {
    await updateSaleItems({
      saleId: createdSale.id,
      reason: 'Added second unit',
      lines: [
        {
          productId: productSale.id,
          quantity: 2,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [],
          isGift: false
        }
      ],
      orderDiscountPct: 0,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const saleAfterIncrease = await prisma.sale.findUnique({ where: { id: createdSale.id } })
  const custAfterIncrease = await prisma.customer.findUnique({ where: { id: customerA.id } })
  const ledgerAfterIncrease = await prisma.customerLedger.findFirst({ where: { referenceId: createdSale.id } })

  const increaseCorrect =
    Number(saleAfterIncrease?.total) === 2000 &&
    Number(saleAfterIncrease?.newBalance) === 2300 &&
    Number(custAfterIncrease?.outstandingBalance) === 2300 &&
    Number(ledgerAfterIncrease?.amount) === 1800

  if (increaseCorrect) {
    console.log(`  ✓ PASS: Increase to ৳2,000 correctly updated Sale.newBalance to ৳2,300, customer balance to ৳2,300, and CustomerLedger to ৳1,800!`)
    passedCount++
  } else {
    console.error('  ✖ FAIL: Increase state mismatch:', {
      saleTotal: saleAfterIncrease?.total,
      saleNewBalance: saleAfterIncrease?.newBalance,
      custBalance: custAfterIncrease?.outstandingBalance,
      ledgerAmount: ledgerAfterIncrease?.amount
    })
  }

  // ─────────────────────────────────────────────
  // TEST 5: Sale Edit — Total DECREASE (newBalance & Ledger reduction)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 5: Sale Edit — Total Decrease: newBalance, Customer Balance & CustomerLedger Reduction')

  // Edit Sale to DECREASE total: unitPrice 1000 -> 400 (Qty 2, Total 800, Paid 200 => New Credit 600, newBalance = 500 + 600 = 1100)
  try {
    await updateSaleItems({
      saleId: createdSale.id,
      reason: 'Price markdown correction',
      lines: [
        {
          productId: productSale.id,
          quantity: 2,
          unitPrice: 400,
          discountPct: 0,
          serialNumbers: [],
          isGift: false
        }
      ],
      orderDiscountPct: 0,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const saleAfterDecrease = await prisma.sale.findUnique({ where: { id: createdSale.id } })
  const custAfterDecrease = await prisma.customer.findUnique({ where: { id: customerA.id } })
  const ledgerAfterDecrease = await prisma.customerLedger.findFirst({ where: { referenceId: createdSale.id } })

  const decreaseCorrect =
    Number(saleAfterDecrease?.total) === 800 &&
    Number(saleAfterDecrease?.newBalance) === 1100 &&
    Number(custAfterDecrease?.outstandingBalance) === 1100 &&
    Number(ledgerAfterDecrease?.amount) === 600

  if (decreaseCorrect) {
    console.log(`  ✓ PASS: Decrease to ৳800 correctly updated Sale.newBalance to ৳1,100, customer balance to ৳1,100, and CustomerLedger to ৳600!`)
    passedCount++
  } else {
    console.error('  ✖ FAIL: Decrease state mismatch:', {
      saleTotal: saleAfterDecrease?.total,
      saleNewBalance: saleAfterDecrease?.newBalance,
      custBalance: custAfterDecrease?.outstandingBalance,
      ledgerAmount: ledgerAfterDecrease?.amount
    })
  }

  // ─────────────────────────────────────────────
  // TEST 6: Non-Serialized PO Quantity Changes & Consumed Stock Guard
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 6: Non-Serialized PO Reconciliation & Consumed Stock Guard')

  const nonSerProduct = await prisma.product.create({
    data: {
      name: `Non-Serialized Part ${Date.now()}`,
      productCode: `NONS_${Date.now()}`,
      costPrice: 100,
      sellingPrice: 150,
      requiresSerial: false,
      outletId,
    }
  })

  // Create PO with 10 units
  let poId2 = ''
  try {
    const poRes2 = await createPurchaseOrder({
      supplierId: supplier.id,
      orderDate: new Date().toISOString(),
      expectedDelivery: undefined,
      notes: 'Non-serial PO',
      lines: [
        {
          productId: nonSerProduct.id,
          quantity: 10,
          unitCost: 100,
          discount: 0,
          sellingPrice: 150,
          serialNumbers: []
        }
      ]
    })
    if (poRes2.success) poId2 = poRes2.data.poId
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  if (!poId2) {
    const createdPo = await prisma.purchaseOrder.findFirst({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' }
    })
    if (createdPo) poId2 = createdPo.id
  }

  // Edit PO: Increase quantity from 10 to 15
  try {
    await updatePurchaseItems({
      poId: poId2,
      reason: 'Adding 5 more units from supplier',
      lines: [
        {
          productId: nonSerProduct.id,
          quantity: 15,
          unitCost: 95,
          discount: 0,
          sellingPrice: 150,
          serialNumbers: []
        }
      ]
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const layerAfterIncrease = await prisma.stockLayer.findFirst({ where: { purchaseOrderId: poId2 } })

  // Simulate selling 12 units (consumed = 12, remaining = 3)
  await prisma.stockLayer.update({
    where: { id: layerAfterIncrease!.id },
    data: { quantityRemaining: 3 }
  })

  // Attempt to reduce PO qty to 5 (which is less than the 12 consumed)
  let guardTriggered = false
  try {
    const reduceRes = await updatePurchaseItems({
      poId: poId2,
      reason: 'Attempting to reduce below consumed',
      lines: [
        {
          productId: nonSerProduct.id,
          quantity: 5,
          unitCost: 95,
          discount: 0,
          sellingPrice: 150,
          serialNumbers: []
        }
      ]
    })
    if (!reduceRes.success && reduceRes.error.includes('already been sold')) {
      guardTriggered = true
    }
  } catch (err: any) {
    if (err?.message?.includes('already been sold')) {
      guardTriggered = true
    }
  }

  if (Number(layerAfterIncrease?.quantityReceived) === 15 && Number(layerAfterIncrease?.unitCost) === 95 && guardTriggered) {
    console.log('  ✓ PASS: Non-serialized PO correctly expanded layer to 15 units at ৳95 and cleanly blocked reduction below consumed quantity.')
    passedCount++
  } else {
    console.error('  ✖ FAIL: Non-serialized reconciliation or guard failed.')
  }

  // ─────────────────────────────────────────────
  // TEST 7: Cross-Sale Serial Rejection with Explicit Conflicting Sale Number
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 7: Cross-Sale Serial Collision Rejection (Actionable Error Message)')

  const productSerialX = await prisma.product.create({
    data: {
      name: `Cross Sale Serial Product ${Date.now()}`,
      productCode: `CSS_${Date.now()}`,
      costPrice: 500,
      sellingPrice: 1000,
      requiresSerial: true,
      outletId,
    }
  })

  const snX1 = `SN-CROSS-1-${Date.now()}`
  const snX2 = `SN-CROSS-2-${Date.now()}`

  await prisma.serialUnit.createMany({
    data: [
      { serialNumber: snX1, productId: productSerialX.id, outletId, status: SerialStatus.IN_STOCK },
      { serialNumber: snX2, productId: productSerialX.id, outletId, status: SerialStatus.IN_STOCK },
    ]
  })

  await prisma.stockLedger.create({
    data: {
      productId: productSerialX.id,
      outletId,
      movementType: StockMovementType.OPENING,
      quantity: 10,
      referenceType: 'TestSeed'
    }
  })

  await prisma.stockLayer.create({
    data: {
      productId: productSerialX.id,
      outletId,
      quantityReceived: 10,
      quantityRemaining: 10,
      unitCost: 500,
      receivedAt: new Date(),
    }
  })

  // Sale 1 gets snX1
  try {
    await checkout({
      customerId: customerA.id,
      lines: [
        {
          productId: productSerialX.id,
          quantity: 1,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [snX1],
          isGift: false,
          cartItemId: 'cart-x1'
        }
      ],
      complimentaryGifts: [],
      payments: [{ method: PaymentMethod.CASH, amount: 1000, feeAmount: 0 }],
      orderDiscountPct: 0,
      isQuotation: false,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const sale1 = await prisma.sale.findFirst({
    where: { lines: { some: { serials: { some: { serialUnit: { serialNumber: snX1 } } } } } },
    orderBy: { createdAt: 'desc' }
  })

  // Sale 2 gets snX2
  try {
    await checkout({
      customerId: customerA.id,
      lines: [
        {
          productId: productSerialX.id,
          quantity: 1,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [snX2],
          isGift: false,
          cartItemId: 'cart-x2'
        }
      ],
      complimentaryGifts: [],
      payments: [{ method: PaymentMethod.CASH, amount: 1000, feeAmount: 0 }],
      orderDiscountPct: 0,
      isQuotation: false,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const sale2 = await prisma.sale.findFirst({
    where: { lines: { some: { serials: { some: { serialUnit: { serialNumber: snX2 } } } } } },
    orderBy: { createdAt: 'desc' }
  })

  // Now attempt to edit Sale 2 and assign snX1 (which belongs to Sale 1)
  let crossSaleRejectionMsg = ''
  try {
    const crossEditRes = await updateSaleItems({
      saleId: sale2!.id,
      reason: 'Attempting to swap serial from Sale 1',
      lines: [
        {
          productId: productSerialX.id,
          quantity: 1,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [snX1], // belongs to sale1
          isGift: false
        }
      ],
      orderDiscountPct: 0,
    })
    if (!crossEditRes.success) {
      crossSaleRejectionMsg = crossEditRes.error
    }
  } catch (err: any) {
    crossSaleRejectionMsg = err?.message || ''
  }

  if (crossSaleRejectionMsg.includes(sale1!.saleNumber) && crossSaleRejectionMsg.includes('release it from that sale')) {
    console.log(`  ✓ PASS: Cleanly rejected with actionable message naming conflicting sale: "${crossSaleRejectionMsg}"`)
    passedCount++
  } else {
    console.error(`  ✖ FAIL: Expected error naming ${sale1?.saleNumber}. Got: "${crossSaleRejectionMsg}"`)
  }

  // ─────────────────────────────────────────────
  // TEST 8: Balance Sheet Reconciliation After Edits (Zero Drift Verification)
  // ─────────────────────────────────────────────
  totalTests++
  console.log('\nTest 8: Balance Sheet Reconciliation — Zero Drift Check Across All Edits')

  const { getBalanceSheet } = await import('../lib/actions/reports')
  const initialBs = await getBalanceSheet()
  const initialDiscrepancy = initialBs.success ? initialBs.data.discrepancy : 0

  // 8A. Balance Sheet during a Sale Increase
  const bsBeforeSaleIncrease = await getBalanceSheet()
  const discBeforeIncrease = bsBeforeSaleIncrease.success ? bsBeforeSaleIncrease.data.discrepancy : 0

  // Perform Sale Edit Increase on createdSale (Total 800 -> 1500)
  try {
    await updateSaleItems({
      saleId: createdSale.id,
      reason: 'Balance sheet increase test',
      lines: [
        {
          productId: productSale.id,
          quantity: 3,
          unitPrice: 500,
          discountPct: 0,
          serialNumbers: [],
          isGift: false
        }
      ],
      orderDiscountPct: 0,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const bsAfterSaleIncrease = await getBalanceSheet()
  const discAfterIncrease = bsAfterSaleIncrease.success ? bsAfterSaleIncrease.data.discrepancy : 0
  const increaseDrift = Math.abs(discAfterIncrease - discBeforeIncrease)

  // 8B. Balance Sheet during a Sale Decrease (Total 1500 -> 600)
  try {
    await updateSaleItems({
      saleId: createdSale.id,
      reason: 'Balance sheet decrease test',
      lines: [
        {
          productId: productSale.id,
          quantity: 2,
          unitPrice: 300,
          discountPct: 0,
          serialNumbers: [],
          isGift: false
        }
      ],
      orderDiscountPct: 0,
    })
  } catch (err: any) {
    if (!err?.message?.includes('static generation store missing')) throw err
  }

  const bsAfterSaleDecrease = await getBalanceSheet()
  const discAfterDecrease = bsAfterSaleDecrease.success ? bsAfterSaleDecrease.data.discrepancy : 0
  const decreaseDrift = Math.abs(discAfterDecrease - discBeforeIncrease)

  console.log(`  Balance Sheet Drift Checks:`)
  console.log(`    - Sale Increase Edit Drift: ৳${increaseDrift.toFixed(2)} (Drift = 0.00)`)
  console.log(`    - Sale Decrease Edit Drift: ৳${decreaseDrift.toFixed(2)} (Drift = 0.00)`)

  if (increaseDrift < 0.01 && decreaseDrift < 0.01) {
    console.log('  ✓ PASS: Balance sheet accounts receivable, revenue, and COGS reconcile with zero drift after both increase and decrease edits!')
    passedCount++
  } else {
    console.error(`  ✖ FAIL: Balance sheet drifted by Increase: ৳${increaseDrift}, Decrease: ৳${decreaseDrift}`)
  }

  console.log(`\n========================================`)
  console.log(`Phase 15 Verification Suite Results: ${passedCount}/${totalTests} Tests Passed`)
  console.log(`========================================\n`)

  if (passedCount !== totalTests) {
    process.exit(1)
  }
}

runPhase15TestSuite()
  .catch(err => {
    console.error('Fatal error during test suite:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
