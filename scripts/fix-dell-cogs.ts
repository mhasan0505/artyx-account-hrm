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

const TARGET_SERIALS = ['DEL-09375691', 'PV14250', 'PV142501']
const TARGET_COST = 67000

async function main() {
  console.log('🔧 Starting targeted Dell COGS correction...\n')

  await prisma.$transaction(async tx => {
    let serialCount = 0
    let lineCount = 0

    for (const sn of TARGET_SERIALS) {
      const serial = await tx.serialUnit.findUnique({
        where: { serialNumber: sn },
        include: {
          saleLineSerials: {
            include: {
              saleLine: {
                include: {
                  serials: {
                    include: {
                      serialUnit: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!serial) {
        console.log(`⚠️ Serial number "${sn}" not found in database.`)
        continue
      }

      // 1. Update SerialUnit costPrice
      await tx.serialUnit.update({
        where: { id: serial.id },
        data: { costPrice: TARGET_COST },
      })
      console.log(`✅ Updated SerialUnit [${sn}] -> costPrice: ৳${TARGET_COST.toLocaleString()}`)
      serialCount++

      // 2. Update attached SaleLines
      for (const junction of serial.saleLineSerials) {
        const saleLine = junction.saleLine
        if (!saleLine) continue

        let recalculatedCogs = 0
        for (const s of saleLine.serials) {
          if (TARGET_SERIALS.includes(s.serialUnit.serialNumber)) {
            recalculatedCogs += TARGET_COST
          } else {
            recalculatedCogs += Number(s.serialUnit.costPrice ?? TARGET_COST)
          }
        }

        await tx.saleLine.update({
          where: { id: saleLine.id },
          data: {
            totalCogs: recalculatedCogs,
            unitCost: recalculatedCogs / (saleLine.quantity || 1),
          },
        })
        console.log(
          `   ↳ Updated SaleLine [${saleLine.id}] -> totalCogs: ৳${recalculatedCogs.toLocaleString()} (qty: ${saleLine.quantity})`
        )
        lineCount++
      }
    }

    console.log(`\n🎉 Transaction successful: ${serialCount} serial units and ${lineCount} sale lines corrected.`)
  })
}

main()
  .catch(e => {
    console.error('❌ Error executing correction script:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
