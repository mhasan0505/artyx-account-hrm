import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

import { SerialStatus, StockMovementType, UserRole } from '@prisma/client'

async function runPhase14Verification() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { prisma } = await import('../lib/db')
  const {
    getProductLedger,
    getSerialUnitHistory,
    getFifoRecommendations,
  } = await import('../lib/actions/products')
  const { checkout } = await import('../lib/actions/sales')

  console.log('🧪 Starting Phase 14 Full End-to-End Verification Test Suite...\n')

  const outlet = await prisma.outlet.findFirst()
  if (!outlet) throw new Error('No outlet found in DB')

  const user = await prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN } })
  if (!user) throw new Error('No admin user found in DB')

  // Setup test supplier & brand
  const supplier = await prisma.supplier.create({
    data: {
      name: `Phase 14 Test Supplier ${Date.now()}`,
      email: `p14-${Date.now()}@supplier.com`,
      phone: `01700${Math.floor(100000 + Math.random() * 900000)}`,
    },
  })

  const brand = await prisma.brand.create({
    data: {
      name: `Phase 14 Brand ${Date.now()}`,
    },
  })

  const customer = await prisma.customer.create({
    data: {
      name: `Phase 14 Customer ${Date.now()}`,
      phone: `01800${Math.floor(100000 + Math.random() * 900000)}`,
    },
  })

  const testSerialNo = `SN-P14-${Date.now()}`

  try {
    // -------------------------------------------------------------
    // Test 1: Supplier & Brand Filters on getProductLedger
    // -------------------------------------------------------------
    console.log('Test 1: Supplier & Brand Filtering on getProductLedger')
    const product1 = await prisma.product.create({
      data: {
        name: `Filter Test Product ${Date.now()}`,
        productCode: `FLT-PROD-${Date.now()}`,
        costPrice: 500,
        sellingPrice: 750,
        brandId: brand.id,
        outletId: outlet.id,
      },
    })

    const ledger1 = await prisma.stockLedger.create({
      data: {
        productId: product1.id,
        outletId: outlet.id,
        supplierId: supplier.id,
        movementType: StockMovementType.PURCHASE_IN,
        quantity: 10,
        notes: 'Phase 14 Test Purchase Ledger',
      },
    })

    const resFilter = await getProductLedger({
      supplierId: supplier.id,
      brandId: brand.id,
      outletId: outlet.id,
    })

    if (!resFilter.success) {
      throw new Error(`getProductLedger failed: ${resFilter.error}`)
    }

    console.log(`  - Filter returned ${resFilter.data.rows.length} row(s)`)
    if (resFilter.data.rows.length === 0) {
      throw new Error(`Expected at least 1 row matching supplierId & brandId`)
    }
    const matchRow = resFilter.data.rows.find(r => r.id === ledger1.id)
    if (!matchRow) {
      throw new Error(`Ledger entry ${ledger1.id} not found in filtered results`)
    }
    console.log(`✓ Supplier & Brand filtering verified cleanly!\n`)

    // -------------------------------------------------------------
    // Test 2: Serial Traceability Chain (PO -> Supplier -> Sale -> Customer)
    // -------------------------------------------------------------
    console.log('Test 2: Serial Unit Traceability Chain (getSerialUnitHistory)')

    const productSerial = await prisma.product.create({
      data: {
        name: `Serial Trace Laptop ${Date.now()}`,
        productCode: `SN-LAP-${Date.now()}`,
        costPrice: 45000,
        sellingPrice: 55000,
        requiresSerial: true,
        outletId: outlet.id,
      },
    })

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-P14-${Date.now()}`,
        supplierId: supplier.id,
        outletId: outlet.id,
        status: 'RECEIVED',
        subtotal: 45000,
        total: 45000,
        createdById: user.id,
        lines: {
          create: [
            {
              productId: productSerial.id,
              quantity: 1,
              unitCost: 45000,
              total: 45000,
            },
          ],
        },
      },
      include: { lines: true },
    })

    await prisma.serialUnit.create({
      data: {
        serialNumber: testSerialNo,
        productId: productSerial.id,
        outletId: outlet.id,
        status: SerialStatus.IN_STOCK,
        poLineSerials: {
          create: [
            {
              poLineId: po.lines[0].id,
            },
          ],
        },
      },
    })

    await prisma.stockLedger.create({
      data: {
        productId: productSerial.id,
        outletId: outlet.id,
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        movementType: StockMovementType.PURCHASE_IN,
        quantity: 1,
        notes: 'Serial Test Initial Purchase',
      },
    })

    // Simulate Checkout Sale of this serial
    const checkoutRes = await checkout({
      customerId: customer.id,
      lines: [
        {
          productId: productSerial.id,
          quantity: 1,
          unitPrice: 55000,
          serialNumbers: [testSerialNo],
        },
      ],
      payments: [{ method: 'CASH', amount: 55000 }],
    })

    if (!checkoutRes.success) {
      throw new Error(`Serialized checkout failed: ${checkoutRes.error}`)
    }

    const historyRes = await getSerialUnitHistory(testSerialNo)
    if (!historyRes.success) {
      throw new Error(`getSerialUnitHistory failed: ${historyRes.error}`)
    }

    const h = historyRes.data
    console.log(`  - Serial: ${h.serialNumber} | Status: ${h.status}`)
    console.log(`  - Purchase Supplier: ${h.purchase?.supplierName} | PO: ${h.purchase?.poNumber}`)
    console.log(`  - Sale Invoice: ${h.sale?.saleNumber} | Customer: ${h.sale?.customerName}`)

    if (h.status !== 'SOLD') {
      throw new Error(`Expected serial status SOLD, got ${h.status}`)
    }
    if (h.purchase?.supplierName !== supplier.name) {
      throw new Error(`Expected supplier ${supplier.name}, got ${h.purchase?.supplierName}`)
    }
    if (h.sale?.customerName !== customer.name) {
      throw new Error(`Expected customer ${customer.name}, got ${h.sale?.customerName}`)
    }
    console.log(`✓ Serial lifecycle traceability chain verified 100%!\n`)

    // -------------------------------------------------------------
    // Test 3: FIFO Recommendations ("Sell This First")
    // -------------------------------------------------------------
    console.log('Test 3: FIFO Recommendations ("Sell This First" Layer Sourcing)')
    const productFifo = await prisma.product.create({
      data: {
        name: `FIFO Rec Product ${Date.now()}`,
        productCode: `REC-PROD-${Date.now()}`,
        costPrice: 200,
        sellingPrice: 300,
        outletId: outlet.id,
      },
    })

    const oldLayer = await prisma.stockLayer.create({
      data: {
        productId: productFifo.id,
        outletId: outlet.id,
        supplierId: supplier.id,
        quantityReceived: 5,
        quantityRemaining: 5,
        unitCost: 180,
        receivedAt: new Date(Date.now() - 86400000 * 5), // 5 days ago
      },
    })

    const newLayer = await prisma.stockLayer.create({
      data: {
        productId: productFifo.id,
        outletId: outlet.id,
        supplierId: supplier.id,
        quantityReceived: 5,
        quantityRemaining: 5,
        unitCost: 200,
        receivedAt: new Date(),
      },
    })

    const fifoRes = await getFifoRecommendations(outlet.id)
    if (!fifoRes.success) {
      throw new Error(`getFifoRecommendations failed: ${fifoRes.error}`)
    }

    const rec = fifoRes.data.find(r => r.productId === productFifo.id)
    if (!rec) {
      throw new Error(`FIFO recommendation not found for product ${productFifo.id}`)
    }

    console.log(`  - Product: ${rec.productName}`)
    console.log(`  - Oldest Layer ID: ${rec.layerId} | Age: ${rec.ageInDays} days | Unit Cost: ৳${rec.unitCost}`)

    if (rec.layerId !== oldLayer.id) {
      throw new Error(`Expected oldest layer ${oldLayer.id}, got ${rec.layerId}`)
    }
    if (rec.unitCost !== 180) {
      throw new Error(`Expected unit cost 180, got ${rec.unitCost}`)
    }
    console.log(`✓ FIFO Recommendation correctly identified oldest batch!\n`)

    // -------------------------------------------------------------
    // Test 4: End-to-End Sale COGS Layer Consumption Matching
    // -------------------------------------------------------------
    console.log('Test 4: End-to-End Sale Checkout COGS Consumption Matching')

    await prisma.stockLedger.create({
      data: {
        productId: productFifo.id,
        outletId: outlet.id,
        movementType: StockMovementType.OPENING,
        quantity: 10,
      },
    })

    const saleRes = await checkout({
      customerId: customer.id,
      lines: [
        {
          productId: productFifo.id,
          quantity: 7,
          unitPrice: 300,
        },
      ],
      payments: [{ method: 'CASH', amount: 2100 }],
    })

    if (!saleRes.success) {
      throw new Error(`FIFO Checkout failed: ${saleRes.error}`)
    }

    // Verify StockLayer states
    const updatedOldLayer = await prisma.stockLayer.findUnique({ where: { id: oldLayer.id } })
    const updatedNewLayer = await prisma.stockLayer.findUnique({ where: { id: newLayer.id } })

    if (updatedOldLayer?.quantityRemaining !== 0) {
      throw new Error(`Expected oldLayer remaining = 0, got ${updatedOldLayer?.quantityRemaining}`)
    }
    if (updatedNewLayer?.quantityRemaining !== 3) {
      throw new Error(`Expected newLayer remaining = 3, got ${updatedNewLayer?.quantityRemaining}`)
    }

    // Verify multi-row StockLedger entries created for the sale
    const saleLedgers = await prisma.stockLedger.findMany({
      where: {
        productId: productFifo.id,
        referenceId: saleRes.data.id,
        movementType: StockMovementType.SALE_OUT,
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`  - Sale recorded ${saleLedgers.length} StockLedger batch entries:`)
    for (const l of saleLedgers) {
      console.log(`      * Qty: ${l.quantity}, Layer Note: ${l.notes}`)
    }

    if (saleLedgers.length !== 2) {
      throw new Error(`Expected 2 StockLedger rows for multi-layer sale, got ${saleLedgers.length}`)
    }

    console.log(`✓ Sale COGS layer consumption verified 100%!\n`)

    console.log('✅ ALL PHASE 14 END-TO-END VERIFICATION TESTS PASSED SUCCESSFULLY!')
  } finally {
    // Cleanup test records
    await prisma.stockLedger.deleteMany({ where: { notes: { contains: 'Phase 14' } } })
    await prisma.stockLayer.deleteMany({ where: { supplierId: supplier.id } })
    await prisma.saleLineSerial.deleteMany({})
    await prisma.purchaseOrderLineSerial.deleteMany({})
    await prisma.serialUnit.deleteMany({ where: { serialNumber: testSerialNo } })
    await prisma.purchaseOrderLine.deleteMany({})
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: supplier.id } })
    await prisma.product.deleteMany({ where: { name: { contains: 'Phase 14' } } })
    await prisma.customer.delete({ where: { id: customer.id } })
    await prisma.supplier.delete({ where: { id: supplier.id } })
    await prisma.brand.delete({ where: { id: brand.id } })
    await prisma.$disconnect()
  }
}

runPhase14Verification().catch(err => {
  console.error('❌ Phase 14 verification failed:', err)
  process.exit(1)
})
