import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, StockMovementType } from '@prisma/client'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

interface DiscrepancyRecord {
  productId: string
  productCode: string
  sku: string | null
  productName: string
  outletId: string
  outletName: string
  outletCode: string
  requiresSerial: boolean
  physicalStock: number
  ledgerStock: number
  delta: number
  status: 'MATCH' | 'DISCREPANCY'
  healed: boolean
}

async function reconcileLedger() {
  const isFixMode = process.argv.includes('--fix')

  console.log('========================================================================')
  console.log(`  STOCK LEDGER AUDIT & RECONCILIATION ENGINE (${isFixMode ? 'FIX MODE' : 'DRY RUN'})`)
  console.log('========================================================================\n')

  const [outlets, products, serialAggs, layerAggs, ledgerAggs] = await Promise.all([
    prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        productCode: true,
        sku: true,
        name: true,
        requiresSerial: true,
        outletId: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<Array<{ outletId: string; productId: string; count: number | bigint }>>`
      SELECT "outletId", "productId", COUNT(*)::int as count
      FROM "SerialUnit"
      WHERE status = 'IN_STOCK'
      GROUP BY "outletId", "productId"
    `,
    prisma.$queryRaw<Array<{ outletId: string; productId: string; remaining: number | bigint }>>`
      SELECT "outletId", "productId", SUM("quantityRemaining")::int as remaining
      FROM "StockLayer"
      WHERE "quantityRemaining" > 0
      GROUP BY "outletId", "productId"
    `,
    prisma.$queryRaw<Array<{ outletId: string; productId: string; total: number | bigint }>>`
      SELECT "outletId", "productId", SUM("quantity")::int as total
      FROM "StockLedger"
      GROUP BY "outletId", "productId"
    `,
  ])

  console.log(`Found ${outlets.length} active outlet(s) and ${products.length} active product(s).\n`)

  const serialMap = new Map<string, number>()
  for (const s of serialAggs) {
    serialMap.set(`${s.outletId}_${s.productId}`, Number(s.count || 0))
  }

  const layerMap = new Map<string, number>()
  for (const l of layerAggs) {
    layerMap.set(`${l.outletId}_${l.productId}`, Number(l.remaining || 0))
  }

  const ledgerMap = new Map<string, number>()
  for (const sl of ledgerAggs) {
    ledgerMap.set(`${sl.outletId}_${sl.productId}`, Number(sl.total || 0))
  }

  const results: DiscrepancyRecord[] = []
  let totalDiscrepancies = 0
  let totalHealed = 0

  for (const outlet of outlets) {
    for (const product of products) {
      const key = `${outlet.id}_${product.id}`

      // 1. Calculate Physical Stock
      const physicalStock = product.requiresSerial
        ? (serialMap.get(key) ?? 0)
        : (layerMap.get(key) ?? 0)

      // 2. Calculate Ledger Stock
      const ledgerStock = ledgerMap.get(key) ?? 0

      const delta = physicalStock - ledgerStock
      const hasDiscrepancy = delta !== 0
      let healed = false

      if (hasDiscrepancy) {
        totalDiscrepancies++

        if (isFixMode) {
          await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT id FROM "Product" WHERE id = ${product.id} FOR UPDATE`

            await tx.stockLedger.create({
              data: {
                productId: product.id,
                outletId: outlet.id,
                movementType:
                  delta > 0
                    ? StockMovementType.ADJUSTMENT_IN
                    : StockMovementType.ADJUSTMENT_OUT,
                quantity: delta,
                referenceType: 'ReconciliationAdjustment',
                notes: `Automated Reconciliation Alignment (Physical: ${physicalStock}, Ledger: ${ledgerStock}, Delta: ${delta > 0 ? '+' : ''}${delta})`,
              },
            })
          })
          healed = true
          totalHealed++
        }
      }

      // Only record non-zero stock or discrepancies for concise output
      if (hasDiscrepancy || physicalStock > 0 || ledgerStock > 0) {
        results.push({
          productId: product.id,
          productCode: product.productCode,
          sku: product.sku,
          productName: product.name,
          outletId: outlet.id,
          outletName: outlet.name,
          outletCode: outlet.code,
          requiresSerial: product.requiresSerial,
          physicalStock,
          ledgerStock,
          delta,
          status: hasDiscrepancy ? 'DISCREPANCY' : 'MATCH',
          healed,
        })
      }
    }
  }

  // Format table output
  console.log('-------------------------------------------------------------------------------------------------------------------------')
  console.log('| Outlet | SKU          | Product Name                 | Type   | Physical |   Ledger |   Delta |    Status | Action |')
  console.log('-------------------------------------------------------------------------------------------------------------------------')

  for (const r of results) {
    const outletCol = r.outletCode.padEnd(6).slice(0, 6)
    const skuCol = (r.sku || r.productCode).padEnd(12).slice(0, 12)
    const nameCol = r.productName.padEnd(28).slice(0, 28)
    const typeCol = (r.requiresSerial ? 'SERIAL' : 'FIFO').padEnd(6)
    const physCol = String(r.physicalStock).padStart(8)
    const ledgCol = String(r.ledgerStock).padStart(8)
    const deltaCol = (r.delta > 0 ? `+${r.delta}` : String(r.delta)).padStart(7)
    const statusCol = r.status === 'MATCH' ? '  MATCH  ' : ' MISMATCH'
    const actionCol = r.healed ? 'HEALED' : (isFixMode ? 'NONE' : (r.status === 'MATCH' ? 'OK' : 'DRY_RUN'))

    console.log(`| ${outletCol} | ${skuCol} | ${nameCol} | ${typeCol} | ${physCol} | ${ledgCol} | ${deltaCol} | ${statusCol} | ${actionCol.padEnd(6)} |`)
  }

  console.log('-------------------------------------------------------------------------------------------------------------------------\n')
  console.log(`SUMMARY:`)
  console.log(`  Total Active Outlets: ${outlets.length}`)
  console.log(`  Total Active Products: ${products.length}`)
  console.log(`  Total Evaluated Positions: ${outlets.length * products.length}`)
  console.log(`  Positions with Stock: ${results.length}`)
  console.log(`  Discrepancies Found: ${totalDiscrepancies}`)
  console.log(`  Positions Healed: ${totalHealed}`)

  if (!isFixMode && totalDiscrepancies > 0) {
    console.log(`\n  👉 Run with "--fix" to auto-create reconciliation adjustment records for all mismatches:`)
    console.log(`     npx tsx scripts/reconcile-ledger.ts --fix\n`)
  } else if (isFixMode && totalHealed > 0) {
    console.log(`\n  ✅ All ${totalHealed} discrepancies successfully reconciled and balanced!\n`)
  } else {
    console.log(`\n  ✅ All product ledger running balances are in 100% ACID alignment with physical stock!\n`)
  }
}

reconcileLedger()
  .catch(err => {
    console.error('Fatal error during ledger reconciliation:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
