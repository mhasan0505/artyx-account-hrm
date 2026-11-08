import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const args = process.argv.slice(2)
  const outletId = args[0]

  if (!outletId) {
    console.error('Usage: npx tsx scripts/check-b2b-serials.ts <outletId>')
    process.exit(1)
  }

  console.log(`Checking B2B serials for outlet: ${outletId}\n`)

  // 1. Find products that require serials
  const serialProducts = await prisma.product.findMany({
    where: {
      outletId,
      isActive: true,
      requiresSerial: true,
    },
    select: {
      id: true,
      name: true,
      sku: true,
      requiresSerial: true,
    },
  })

  console.log(`Products requiring serials: ${serialProducts.length}`)
  for (const p of serialProducts) {
    console.log(`  - ${p.name} (${p.sku ?? 'no sku'})`)
  }
  console.log('')

  // 2. Count all serial units per product
  for (const product of serialProducts) {
    const allSerials = await prisma.serialUnit.findMany({
      where: { productId: product.id },
      select: { serialNumber: true, status: true },
    })
    const inStock = allSerials.filter(s => s.status === 'IN_STOCK')
    console.log(`[${product.name}]`)
    console.log(`  Total serials: ${allSerials.length}`)
    console.log(`  IN_STOCK:      ${inStock.length}`)
    console.log(`  Other status:  ${allSerials.length - inStock.length}`)
    if (allSerials.length > 0) {
      console.log(
        `  Serials: ${allSerials.map(s => s.serialNumber).join(', ')}`
      )
    }
    console.log('')
  }

  // 3. Summary for B2B picker
  const b2bProducts = await prisma.product.findMany({
    where: {
      outletId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      requiresSerial: true,
      serialUnits: {
        where: { status: 'IN_STOCK' },
        select: { serialNumber: true },
      },
    },
  })

  console.log('B2B Picker results:')
  for (const p of b2bProducts) {
    if (p.requiresSerial) {
      console.log(
        `  [${p.name}] requiresSerial=${p.requiresSerial}, serialUnits available=${p.serialUnits.length}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
