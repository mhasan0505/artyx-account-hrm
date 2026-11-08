import { prisma } from '../lib/db'

/**
 * Reconcile StockLayer rows against actual SerialUnit locations and statuses.
 *
 * For serialized products, physical availability at an outlet is defined by SerialUnit (status: IN_STOCK).
 * When past stock transfers or sales corrupted StockLayer quantities (Bugs #7, #8, #9, #20),
 * this script identifies the drift and can automatically repair the layers.
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-stock-layers.ts          # Dry run / report only
 *   pnpm tsx scripts/reconcile-stock-layers.ts --fix    # Apply corrections
 */
async function main() {
  const isFixMode = process.argv.includes('--fix') || process.argv.includes('--apply')

  console.log('=== SERIAL UNIT VS STOCK LAYER RECONCILIATION ===')
  console.log('Mode:', isFixMode ? '🔧 APPLY REPAIR (--fix)' : '🔍 DRY RUN (read-only)')
  console.log('Timestamp:', new Date().toISOString())

  const outlets = await prisma.outlet.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })

  const serializedProducts = await prisma.product.findMany({
    where: { requiresSerial: true },
    select: {
      id: true,
      name: true,
      sku: true,
      productCode: true,
      costPrice: true,
    },
    orderBy: { name: 'asc' },
  })

  console.log(`Checking ${serializedProducts.length} serialized products across ${outlets.length} outlets...\n`)

  // Aggregate in-stock serial counts per product and outlet
  const serialCounts = await prisma.serialUnit.groupBy({
    by: ['productId', 'outletId'],
    where: { status: 'IN_STOCK' },
    _count: { id: true },
  })

  const serialMap = new Map<string, number>()
  for (const row of serialCounts) {
    serialMap.set(`${row.productId}:${row.outletId}`, row._count.id)
  }

  // Aggregate stock layer remaining quantities per product and outlet
  const layerSums = await prisma.stockLayer.groupBy({
    by: ['productId', 'outletId'],
    where: { quantityRemaining: { gt: 0 } },
    _sum: { quantityRemaining: true },
  })

  const layerMap = new Map<string, number>()
  for (const row of layerSums) {
    layerMap.set(`${row.productId}:${row.outletId}`, row._sum.quantityRemaining ?? 0)
  }

  interface Discrepancy {
    productId: string
    productName: string
    sku: string
    outletId: string
    outletCode: string
    serialCount: number
    layerQuantity: number
    deficit: number // positive means layers are missing; negative means extra layers exist
  }

  const discrepancies: Discrepancy[] = []

  for (const outlet of outlets) {
    for (const product of serializedProducts) {
      const key = `${product.id}:${outlet.id}`
      const serialCount = serialMap.get(key) ?? 0
      const layerQuantity = layerMap.get(key) ?? 0

      if (serialCount !== layerQuantity) {
        discrepancies.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku || product.productCode || 'N/A',
          outletId: outlet.id,
          outletCode: outlet.code,
          serialCount,
          layerQuantity,
          deficit: serialCount - layerQuantity,
        })
      }
    }
  }

  if (discrepancies.length === 0) {
    console.log('✅ 100% IN SYNC: All serialized products have identical SerialUnit counts and StockLayer quantityRemaining.')
    return
  }

  console.log(`⚠️ FOUND ${discrepancies.length} DISCREPANCIES:\n`)
  console.table(
    discrepancies.map(d => ({
      Outlet: d.outletCode,
      Product: d.productName,
      SKU: d.sku,
      'Serials in Stock': d.serialCount,
      'StockLayer Qty': d.layerQuantity,
      'Deficit (+needs / -excess)': d.deficit,
    }))
  )

  if (!isFixMode) {
    console.log('\n💡 To automatically reconcile these discrepancies, run:')
    console.log('   pnpm tsx scripts/reconcile-stock-layers.ts --fix\n')
    return
  }

  console.log('\nApplying reconciliation repairs...')
  let fixedCount = 0

  for (const item of discrepancies) {
    const product = serializedProducts.find(p => p.id === item.productId)!

    await prisma.$transaction(async tx => {
      if (item.deficit > 0) {
        // Missing stock layers: create a reconciliation layer so destination outlet can sell the serials
        await tx.stockLayer.create({
          data: {
            productId: item.productId,
            outletId: item.outletId,
            quantityReceived: item.deficit,
            quantityRemaining: item.deficit,
            unitCost: Number(product.costPrice || 0),
            receivedAt: new Date(),
          },
        })
        console.log(`  [CREATED LAYER] ${item.productName} at ${item.outletCode}: +${item.deficit} layer qty (cost: ${product.costPrice})`)
      } else {
        // Excess stock layers: reduce layers to match serial count
        let toDeduct = Math.abs(item.deficit)
        const openLayers = await tx.stockLayer.findMany({
          where: {
            productId: item.productId,
            outletId: item.outletId,
            quantityRemaining: { gt: 0 },
          },
          orderBy: { receivedAt: 'desc' },
        })

        for (const layer of openLayers) {
          if (toDeduct <= 0) break
          const deductFromThis = Math.min(layer.quantityRemaining, toDeduct)
          await tx.stockLayer.update({
            where: { id: layer.id },
            data: {
              quantityRemaining: layer.quantityRemaining - deductFromThis,
            },
          })
          toDeduct -= deductFromThis
        }
        console.log(`  [REDUCED LAYERS] ${item.productName} at ${item.outletCode}: -${Math.abs(item.deficit)} excess layer qty`)
      }
      fixedCount++
    })
  }

  console.log(`\n🎉 Successfully repaired ${fixedCount} product/outlet combinations!`)
}

main()
  .catch(err => {
    console.error('Reconciliation script failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
