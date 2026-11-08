import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function backfillStockLayers() {
  const { prisma } = await import('../lib/db')
  console.log('Starting StockLayer backfill script...')

  // 1. Get all unique product/outlet pairs from StockLedger
  const ledgerSummaries = await prisma.stockLedger.groupBy({
    by: ['productId', 'outletId'],
    _sum: { quantity: true },
  })

  // 2. Get existing StockLayer sums by product/outlet
  const layerSummaries = await prisma.stockLayer.groupBy({
    by: ['productId', 'outletId'],
    _sum: { quantityRemaining: true },
  })

  const layerMap = new Map<string, number>()
  for (const item of layerSummaries) {
    const key = `${item.productId}:${item.outletId}`
    layerMap.set(key, Number(item._sum.quantityRemaining || 0))
  }

  let createdCount = 0
  let totalGapQty = 0

  for (const item of ledgerSummaries) {
    const productId = item.productId
    const outletId = item.outletId
    const netStockFromLedger = Number(item._sum.quantity || 0)
    const key = `${productId}:${outletId}`
    const alreadyLayered = layerMap.get(key) || 0

    const gap = netStockFromLedger - alreadyLayered

    if (gap > 0) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { costPrice: true, name: true },
      })

      if (!product) continue

      const unitCost = Number(product.costPrice || 0)

      await prisma.stockLayer.create({
        data: {
          productId,
          outletId,
          quantityReceived: gap,
          quantityRemaining: gap,
          unitCost,
          receivedAt: new Date(),
        },
      })

      createdCount++
      totalGapQty += gap
      console.log(
        `Created opening StockLayer for product "${product.name}" (${productId}) at outlet ${outletId}: gap = ${gap} units @ ৳${unitCost}`
      )
    }
  }

  console.log(
    `Backfill complete: Created ${createdCount} synthetic StockLayer records totaling ${totalGapQty} units.`
  )
  await prisma.$disconnect()
}

backfillStockLayers().catch(err => {
  console.error('Error during StockLayer backfill:', err)
  process.exit(1)
})
