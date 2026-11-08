import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function runProofReport() {
  const { prisma } = await import('../lib/db')

  console.log('===============================================================')
  console.log('   LIVE DATABASE BACKFILL RECONCILIATION REPORT')
  console.log('===============================================================\n')

  const products = await prisma.product.findMany({
    where: {
      stockLedger: { some: {} },
      stockLayers: { some: {} },
    },
    take: 5,
    select: {
      id: true,
      name: true,
      productCode: true,
      sku: true,
      outletId: true,
      createdAt: true,
    },
  })

  console.log(`Auditing ${products.length} real inventory products from production database:\n`)

  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const ledgerAgg = await prisma.stockLedger.aggregate({
      where: { productId: p.id, outletId: p.outletId },
      _sum: { quantity: true },
    })

    const layerAgg = await prisma.stockLayer.aggregate({
      where: { productId: p.id, outletId: p.outletId },
      _sum: { quantityRemaining: true },
    })

    const activeLayers = await prisma.stockLayer.findMany({
      where: { productId: p.id, outletId: p.outletId },
      select: {
        id: true,
        quantityReceived: true,
        quantityRemaining: true,
        unitCost: true,
        receivedAt: true,
      },
    })

    const ledgerNet = Number(ledgerAgg._sum.quantity || 0)
    const layerNet = Number(layerAgg._sum.quantityRemaining || 0)
    const diff = ledgerNet - layerNet

    console.log(`[Product #${i + 1}] ${p.name}`)
    console.log(`  - Product ID: ${p.id}`)
    console.log(`  - Product Code / SKU: ${p.productCode}${p.sku ? ' / ' + p.sku : ''}`)
    console.log(`  - Outlet ID: ${p.outletId}`)
    console.log(`  - StockLedger Total Net Stock: ${ledgerNet} units`)
    console.log(`  - StockLayer Total Remaining Stock: ${layerNet} units`)
    console.log(`  - Discrepancy (Ledger Net - Layer Net): ${diff}`)
    console.log(`  - Status: ${diff === 0 ? '✅ 100% PERFECT RECONCILIATION' : '❌ DISCREPANCY DETECTED'}`)
    console.log(`  - Active Layers Breakdown (${activeLayers.length} layer(s)):`)
    for (const l of activeLayers) {
      console.log(`      * Layer ${l.id}: Recv = ${l.quantityReceived}, Remaining = ${l.quantityRemaining}, Unit Cost = ৳${l.unitCost}, RecvAt = ${l.receivedAt.toISOString()}`)
    }
    console.log('---------------------------------------------------------------\n')
  }

  await prisma.$disconnect()
}

runProofReport().catch(err => {
  console.error('Report execution failed:', err)
  process.exit(1)
})
