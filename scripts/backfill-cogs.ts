import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const needsSsl = /sslmode=require|sslmode=verify-full|neon\.tech|ssl=/.test(
  connectionString
)

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Starting COGS backfill script...')

  // 1. Backfill SerialUnit costPrice (fallback to Product.costPrice if missing)
  const serials = await prisma.serialUnit.findMany({
    where: { costPrice: null },
    include: { product: { select: { costPrice: true } } },
  })

  let serialsUpdated = 0
  for (const serial of serials) {
    if (serial.product?.costPrice != null) {
      await prisma.serialUnit.update({
        where: { id: serial.id },
        data: { costPrice: serial.product.costPrice },
      })
      serialsUpdated++
    }
  }
  console.log(`Updated ${serialsUpdated} SerialUnits with Product costPrice.`)

  // 2. Backfill SaleLine totalCogs
  const saleLines = await prisma.saleLine.findMany({
    where: { totalCogs: 0 },
    include: {
      product: { select: { costPrice: true } },
      serials: {
        include: {
          serialUnit: { select: { costPrice: true } },
        },
      },
    },
  })

  let linesUpdated = 0
  for (const line of saleLines) {
    let exactCogs = 0

    if (line.serials && line.serials.length > 0) {
      // Serialized product logic
      for (const s of line.serials) {
        const fallback = Number(line.product?.costPrice ?? line.unitCost ?? 0)
        exactCogs += Number(s.serialUnit?.costPrice ?? fallback)
      }
    } else {
      // Non-serialized fallback logic
      const unitCost = Number(
        line.unitCost && Number(line.unitCost) > 0
          ? line.unitCost
          : line.product?.costPrice ?? 0
      )
      exactCogs = Number(line.quantity) * unitCost
    }

    if (exactCogs > 0) {
      await prisma.saleLine.update({
        where: { id: line.id },
        data: {
          totalCogs: exactCogs,
          unitCost: exactCogs / (line.quantity || 1),
        },
      })
      linesUpdated++
    }
  }

  console.log(`Updated ${linesUpdated} SaleLines with calculated totalCogs.`)
  console.log('Backfill complete.')
}

main()
  .catch(e => {
    console.error('Error running backfill:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
