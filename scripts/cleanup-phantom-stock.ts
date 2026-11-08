import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function cleanupPhantomStock() {
  console.log('================ EXECUTING PHASE 1: PHANTOM STOCK CLEANUP ================')
  
  const targetProductId = 'cmsps50se00200krqj9s4lhji'
  const targetLedgerIds = ['cmsrr5hw20000ucu4n81f2o1p', 'cmsrra6al0009ucu4us7ymdez']

  const result = await prisma.$transaction(async (tx) => {
    // 1. Delete ghost StockLedger entries
    const deletedLedgers = await tx.stockLedger.deleteMany({
      where: {
        id: { in: targetLedgerIds }
      }
    })

    // 2. Delete ghost StockLayer entries
    // Find layers created around the time of the failed invoice edit
    const deletedLayers = await tx.stockLayer.deleteMany({
      where: {
        productId: targetProductId,
        createdAt: {
          gte: new Date('2026-08-13T16:40:00.000Z'),
          lte: new Date('2026-08-13T17:00:00.000Z')
        }
      }
    })

    return {
      deletedLedgersCount: deletedLedgers.count,
      deletedLayersCount: deletedLayers.count
    }
  })

  console.log(`[SUCCESS] Deleted ${result.deletedLedgersCount} ghost StockLedger entries.`)
  console.log(`[SUCCESS] Deleted ${result.deletedLayersCount} ghost StockLayer entries.`)

  // Verification
  const remainingLedgers = await prisma.stockLedger.findMany({
    where: { productId: targetProductId }
  })
  const remainingSerials = await prisma.serialUnit.findMany({
    where: { productId: targetProductId }
  })
  const product = await prisma.product.findUnique({
    where: { id: targetProductId },
    select: { sku: true, name: true }
  })

  console.log('\n--- VERIFICATION POST-CLEANUP ---')
  console.log(`Product: ${product?.name} (${product?.sku})`)
  console.log(`Remaining StockLedger movements: ${remainingLedgers.length}`)
  console.log(`Remaining SerialUnit records: ${remainingSerials.length}`)
  console.log('================ CLEANUP COMPLETE ================')
}

cleanupPhantomStock()
  .catch((err) => {
    console.error('[ERROR] Failed to clean up phantom stock:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
