import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'

async function backfillSalePaymentPaidAt() {
  console.log('⚡ Backfilling SalePayment.paidAt from parent Sale.createdAt...')

  try {
    const updatedCount = await prisma.$executeRaw`
      UPDATE "SalePayment" sp
      SET "paidAt" = s."createdAt"
      FROM "Sale" s
      WHERE sp."saleId" = s."id"
    `

    console.log(`✓ Backfilled ${updatedCount} SalePayment rows with parent Sale.createdAt successfully!`)
  } catch (err) {
    console.error('✖ Backfill failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

backfillSalePaymentPaidAt()
