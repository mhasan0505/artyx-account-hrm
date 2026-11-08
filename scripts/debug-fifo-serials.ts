import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function checkSerialOutlets() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { prisma } = await import('../lib/db')
  const { getFifoRecommendations } = await import('../lib/actions/products')

  console.log('🔍 Checking SerialUnits and Outlets...\n')

  const outlets = await prisma.outlet.findMany()
  console.log('Outlets in DB:')
  outlets.forEach(o => console.log(`  - ${o.id}: ${o.name}`))

  for (const outlet of outlets) {
    const res = await getFifoRecommendations(outlet.id)
    if (!res.success) continue
    const itemsWithSerials = res.data.filter(i => i.serialNumbers.length > 0)
    console.log(`\nOutlet "${outlet.name}" (${outlet.id}):`)
    console.log(`  - Total Recs: ${res.data.length}`)
    console.log(`  - Recs with Serials: ${itemsWithSerials.length}`)
    res.data.slice(0, 3).forEach(i => {
      console.log(`     * Product: ${i.productName}`)
      console.log(`       RequiresSerial: ${i.requiresSerial} | Serials (${i.serialNumbers.length}): ${i.serialNumbers.join(', ') || 'NONE'}`)
    })
  }

  await prisma.$disconnect()
}

checkSerialOutlets().catch(console.error)
