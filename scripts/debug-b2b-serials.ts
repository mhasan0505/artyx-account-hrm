import { config } from 'dotenv'
config()

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  // Get outlet from first user with outlet
  const user = await prisma.user.findFirst({
    where: { outletId: { not: '' } },
    select: { outletId: true },
  })
  const outletId = user?.outletId || ''
  console.log('Outlet ID:', outletId)

  // 1. All products with requiresSerial=true
  const allSerialProducts = await prisma.product.findMany({
    where: { requiresSerial: true },
    select: { id: true, name: true, sku: true, outletId: true, isActive: true },
    orderBy: { name: 'asc' },
  })
  console.log('\n=== ALL products with requiresSerial=true ===')
  console.log(`Count: ${allSerialProducts.length}`)
  for (const p of allSerialProducts.slice(0, 10)) {
    const serialCount = await prisma.serialUnit.count({
      where: { productId: p.id, status: 'IN_STOCK' },
    })
    console.log(
      `  ${p.name} (outlet=${p.outletId}, active=${p.isActive}) -> ${serialCount} IN_STOCK serials`
    )
  }

  // 2. Exact query from getProductsForB2B
  const b2bProducts = await prisma.product.findMany({
    where: { outletId, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      sellingPrice: true,
      costPrice: true,
      requiresSerial: true,
      serialUnits: {
        where: { status: 'IN_STOCK' },
        select: { serialNumber: true },
      },
    },
    orderBy: { name: 'asc' },
  })
  console.log(
    '\n=== B2B products (outletId=' + outletId + ', isActive=true) ==='
  )
  console.log(`Total: ${b2bProducts.length}`)
  const serialProducts = b2bProducts.filter(p => p.requiresSerial)
  console.log(`With requiresSerial=true: ${serialProducts.length}`)

  for (const p of serialProducts.slice(0, 5)) {
    console.log(`\n  ${p.name} (${p.sku}):`)
    console.log(`    requiresSerial: ${p.requiresSerial}`)
    console.log(`    serialUnits.length: ${p.serialUnits.length}`)
    if (p.serialUnits.length > 0) {
      console.log(
        `    serials: ${p.serialUnits.map(s => s.serialNumber).join(', ')}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
