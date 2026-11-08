import { prisma } from '../lib/db'

async function main() {
  console.log('=== STOCK LAYER DRIFT CHECK ===')
  console.log('Timestamp:', new Date().toISOString())

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      productCode: true,
      requiresSerial: true,
      outletId: true,
    },
    orderBy: { name: 'asc' },
  })

  console.log(`Found ${products.length} products to check.\n`)

  const ledgerSums = await prisma.stockLedger.groupBy({
    by: ['productId', 'outletId'],
    _sum: { quantity: true },
  })

  const layerSums = await prisma.stockLayer.groupBy({
    by: ['productId', 'outletId'],
    where: { quantityRemaining: { gt: 0 } },
    _sum: { quantityRemaining: true },
  })

  const ledgerMap = new Map<string, number>()
  for (const row of ledgerSums) {
    ledgerMap.set(`${row.productId}:${row.outletId}`, row._sum.quantity ?? 0)
  }

  const layerMap = new Map<string, number>()
  for (const row of layerSums) {
    layerMap.set(`${row.productId}:${row.outletId}`, row._sum.quantityRemaining ?? 0)
  }

  // Get distinct outlet IDs
  const outlets = await prisma.outlet.findMany({
    select: { id: true, name: true, code: true },
  })

  let driftedCount = 0
  const driftList: Array<{
    productId: string
    productCode: string
    productName: string
    requiresSerial: boolean
    outletCode: string
    ledgerQty: number
    layerQty: number
    diff: number
  }> = []

  for (const outlet of outlets) {
    for (const prod of products) {
      const key = `${prod.id}:${outlet.id}`
      const ledgerQty = ledgerMap.get(key) ?? 0
      const layerQty = layerMap.get(key) ?? 0

      // Only check products that have some stock history or non-zero balance
      if (ledgerQty !== 0 || layerQty !== 0) {
        if (ledgerQty !== layerQty) {
          driftedCount++
          driftList.push({
            productId: prod.id,
            productCode: prod.productCode,
            productName: prod.name,
            requiresSerial: prod.requiresSerial,
            outletCode: outlet.code,
            ledgerQty,
            layerQty,
            diff: ledgerQty - layerQty,
          })
        }
      }
    }
  }

  if (driftList.length === 0) {
    console.log('✅ NO DRIFT DETECTED: StockLedger sums and StockLayer quantityRemaining are 100% consistent across all products and outlets.')
  } else {
    console.log(`⚠️ DRIFT DETECTED in ${driftList.length} product/outlet combinations:\n`)
    console.table(driftList)
  }

  console.log('\n--- Summary ---')
  console.log(`Total Products: ${products.length}`)
  console.log(`Total Outlets: ${outlets.length}`)
  console.log(`Drifted Items: ${driftList.length}`)
}

main()
  .catch(err => {
    console.error('Drift check failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
