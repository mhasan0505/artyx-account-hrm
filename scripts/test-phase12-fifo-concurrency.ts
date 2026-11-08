import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

import { UserRole } from '@prisma/client'

async function runPhase12Tests() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { prisma } = await import('../lib/db')
  const { consumeStockLayers, createStockTransfer, confirmStockTransfer } = await import(
    '../lib/actions/products'
  )

  console.log('🧪 Starting Phase 12 FIFO Layer Consumption, Concurrency, and Transfer Tests...\n')

  const outletA = await prisma.outlet.findFirst()
  if (!outletA) throw new Error('No outlet found in DB')

  // Find or create Outlet B for transfer testing
  let outletB = await prisma.outlet.findFirst({
    where: { id: { not: outletA.id } },
  })
  if (!outletB) {
    outletB = await prisma.outlet.create({
      data: {
        name: 'Transfer Test Outlet B',
        code: `OUT-B-${Date.now()}`,
      },
    })
  }

  const testProduct = await prisma.product.create({
    data: {
      name: `FIFO Test Product ${Date.now()}`,
      productCode: `FIFO-PROD-${Date.now()}`,
      costPrice: 100,
      sellingPrice: 150,
      requiresSerial: false,
      outletId: outletA.id,
    },
  })

  try {
    // 1. Create two distinct layers for the test product at Outlet A:
    // Layer 1: 5 units @ ৳100
    // Layer 2: 5 units @ ৳200
    const layer1 = await prisma.stockLayer.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityReceived: 5,
        quantityRemaining: 5,
        unitCost: 100,
        receivedAt: new Date(Date.now() - 10000), // 10s ago
      },
    })

    const layer2 = await prisma.stockLayer.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityReceived: 5,
        quantityRemaining: 5,
        unitCost: 200,
        receivedAt: new Date(),
      },
    })

    console.log('Test Setup:')
    console.log(`  - Product: ${testProduct.name}`)
    console.log(`  - Layer 1 (${layer1.id}): 5 units @ ৳100 at Outlet A`)
    console.log(`  - Layer 2 (${layer2.id}): 5 units @ ৳200 at Outlet A\n`)

    // Test 1: Multi-layer consumption (7 units -> 5 from Layer 1, 2 from Layer 2)
    console.log('Test 1: Multi-layer FIFO consumption (7 units)')
    const batches = await prisma.$transaction(async tx => {
      return consumeStockLayers(tx, {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityNeeded: 7,
      })
    })

    console.log(`✓ Consumed ${batches.length} layer batches:`)
    for (const b of batches) {
      console.log(`  - Layer ${b.layerId}: ${b.quantityConsumed} units @ ৳${b.unitCost} (Total: ৳${b.totalCost})`)
    }

    if (batches.length !== 2) {
      throw new Error(`Expected 2 consumed batches, got ${batches.length}`)
    }

    // Check layer remaining quantities in DB
    const updatedLayer1 = await prisma.stockLayer.findUnique({ where: { id: layer1.id } })
    const updatedLayer2 = await prisma.stockLayer.findUnique({ where: { id: layer2.id } })

    if (updatedLayer1?.quantityRemaining !== 0) {
      throw new Error(`Expected Layer 1 remaining = 0, got ${updatedLayer1?.quantityRemaining}`)
    }
    if (updatedLayer2?.quantityRemaining !== 3) {
      throw new Error(`Expected Layer 2 remaining = 3, got ${updatedLayer2?.quantityRemaining}`)
    }
    console.log('✓ Database StockLayer remaining quantities updated correctly (Layer 1: 0, Layer 2: 3).\n')

    // Test 2: Row-locking Concurrency Test
    console.log('Test 2: Row-locking Concurrency Test (2 concurrent calls requesting 2 units each from remaining 3 units)')
    const promise1 = prisma.$transaction(async tx => {
      return consumeStockLayers(tx, {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityNeeded: 2,
      })
    })

    const promise2 = prisma.$transaction(async tx => {
      return consumeStockLayers(tx, {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityNeeded: 2,
      })
    })

    const results = await Promise.allSettled([promise1, promise2])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')

    console.log(`  - Transactions succeeded: ${fulfilled.length}`)
    console.log(`  - Transactions rejected: ${rejected.length}`)

    if (fulfilled.length !== 1 || rejected.length !== 1) {
      throw new Error(`Concurrency assertion failed: expected exactly 1 success and 1 rejection`)
    }

    const finalLayer2 = await prisma.stockLayer.findUnique({ where: { id: layer2.id } })
    if (finalLayer2?.quantityRemaining !== 1) {
      throw new Error(`Expected final Layer 2 remaining = 1, got ${finalLayer2?.quantityRemaining}`)
    }
    console.log('✓ FOR UPDATE row-locking prevented layer overdraw! Remaining stock is 1 unit.\n')

    // Test 3: Multi-Layer Transfer Test (Outlet A -> Outlet B)
    console.log('Test 3: Multi-Layer Stock Transfer Test (Outlet A -> Outlet B)')
    
    // Replenish Outlet A with 2 layers for transfer test:
    // Layer A3: 2 units @ ৳100
    // Layer A4: 3 units @ ৳150
    const layerA3 = await prisma.stockLayer.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityReceived: 2,
        quantityRemaining: 2,
        unitCost: 100,
        receivedAt: new Date(Date.now() - 5000),
      },
    })
    await prisma.stockLedger.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        movementType: 'OPENING',
        quantity: 2,
        notes: 'Test Layer A3',
      },
    })

    const layerA4 = await prisma.stockLayer.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        quantityReceived: 3,
        quantityRemaining: 3,
        unitCost: 150,
        receivedAt: new Date(),
      },
    })
    await prisma.stockLedger.create({
      data: {
        productId: testProduct.id,
        outletId: outletA.id,
        movementType: 'OPENING',
        quantity: 3,
        notes: 'Test Layer A4',
      },
    })

    console.log(`  - Created Layer A3: 2 units @ ৳100 at Outlet A`)
    console.log(`  - Created Layer A4: 3 units @ ৳150 at Outlet A`)

    // Create transfer of 4 units from Outlet A to Outlet B
    const createTransferRes = await createStockTransfer({
      fromOutletId: outletA.id,
      toOutletId: outletB.id,
      lines: [{ productId: testProduct.id, quantity: 4 }],
      notes: 'Test Multi-Layer Transfer',
    })

    if (!createTransferRes.success) {
      throw new Error(`createStockTransfer failed: ${createTransferRes.error}`)
    }
    const transferId = createTransferRes.data.id
    console.log(`  - Initiated Transfer ${transferId} for 4 units from Outlet A -> Outlet B`)

    // Confirm transfer at Outlet B
    const confirmTransferRes = await confirmStockTransfer(transferId)
    if (!confirmTransferRes.success) {
      throw new Error(`confirmStockTransfer failed: ${confirmTransferRes.error}`)
    }
    console.log(`  - Confirmed Transfer ${transferId} at Outlet B`)

    // Verify Outlet A depleted layers: Layer A3 should be 0, Layer A4 should be 2 remaining
    const updatedA3 = await prisma.stockLayer.findUnique({ where: { id: layerA3.id } })
    const updatedA4 = await prisma.stockLayer.findUnique({ where: { id: layerA4.id } })

    if (updatedA3?.quantityRemaining !== 0) {
      throw new Error(`Expected Layer A3 remaining = 0, got ${updatedA3?.quantityRemaining}`)
    }
    if (updatedA4?.quantityRemaining !== 2) {
      throw new Error(`Expected Layer A4 remaining = 2, got ${updatedA4?.quantityRemaining}`)
    }

    // Verify Outlet B received StockLayer records
    const outletBLayers = await prisma.stockLayer.findMany({
      where: { productId: testProduct.id, outletId: outletB.id },
    })

    const totalOutletBQty = outletBLayers.reduce((s, l) => s + l.quantityRemaining, 0)
    console.log(`  - Outlet B received ${outletBLayers.length} layer(s) totaling ${totalOutletBQty} units`)

    if (totalOutletBQty !== 4) {
      throw new Error(`Expected Outlet B total remaining = 4, got ${totalOutletBQty}`)
    }

    console.log('✓ Multi-layer inter-outlet transfer verified cleanly!\n')

    console.log('✅ All Phase 12 FIFO Layer Consumption, Concurrency, and Transfer tests passed successfully!')
  } finally {
    // Cleanup test data
    await prisma.stockLayer.deleteMany({ where: { productId: testProduct.id } })
    await prisma.stockLedger.deleteMany({ where: { productId: testProduct.id } })
    await prisma.stockTransferLine.deleteMany({ where: { productId: testProduct.id } })
    await prisma.product.delete({ where: { id: testProduct.id } })
    await prisma.$disconnect()
  }
}

runPhase12Tests().catch(err => {
  console.error('❌ Phase 12 test execution failed:', err)
  process.exit(1)
})
