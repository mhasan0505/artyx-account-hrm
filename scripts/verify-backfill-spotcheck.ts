import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function spotCheck() {
  const { prisma } = await import('../lib/db')
  console.log('🔍 Running Spot-Check Verification on StockLayer Backfill...\n')

  // Find products that have entries in both StockLedger and StockLayer
  const productsWithStock = await prisma.product.findMany({
    where: {
      stockLedger: { some: {} },
      stockLayers: { some: {} },
    },
    take: 5,
    select: {
      id: true,
      name: true,
      productCode: true,
      costPrice: true,
      outletId: true,
    },
  })

  if (productsWithStock.length === 0) {
    console.log('No products found with both ledger entries and stock layers.')
    return
  }

  for (const product of productsWithStock) {
    const ledgerSum = await prisma.stockLedger.aggregate({
      where: { productId: product.id, outletId: product.outletId },
      _sum: { quantity: true },
    })

    const layerSum = await prisma.stockLayer.aggregate({
      where: { productId: product.id, outletId: product.outletId },
      _sum: { quantityRemaining: true },
    })

    const netStock = Number(ledgerSum._sum.quantity || 0)
    const layeredStock = Number(layerSum._sum.quantityRemaining || 0)

    console.log(`Product: "${product.name}" (${product.productCode})`)
    console.log(`  - Outlet ID: ${product.outletId}`)
    console.log(`  - Net Stock (StockLedger SUM): ${netStock}`)
    console.log(`  - Layered Stock (StockLayer SUM): ${layeredStock}`)
    console.log(`  - Reconciled (Difference): ${netStock - layeredStock}`)
    console.log(`  - Status: ${netStock === layeredStock ? '✅ PERFECT MATCH' : '⚠️ MISMATCH'}\n`)
  }

  await prisma.$disconnect()
}

spotCheck().catch(err => {
  console.error('Error during spot check:', err)
  process.exit(1)
})
