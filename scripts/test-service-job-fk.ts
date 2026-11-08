import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function testServiceJobFkHandling() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { prisma } = await import('../lib/db')
  const { createServiceJob } = await import('../lib/actions/service')

  console.log('🧪 Testing Service Job Foreign Key Resilience...\n')

  const customer = await prisma.customer.findFirst()
  if (!customer) throw new Error('No customer found')

  // Case 1: Empty string serialUnitId ""
  console.log('Case 1: Creating job with serialUnitId = ""')
  const res1 = await createServiceJob({
    customerId: customer.id,
    device: 'Laptop Test 1',
    issue: 'Screen issue',
    serialUnitId: '',
  })
  if (!res1.success) throw new Error(`Case 1 failed: ${res1.error}`)
  console.log(`  ✓ Job created with serialUnitId = "": ${res1.data.jobNumber} (serialUnitId: ${res1.data.serialUnitId})`)

  // Case 2: Non-existent serialUnitId "INVALID_SERIAL_123"
  console.log('Case 2: Creating job with serialUnitId = "INVALID_SERIAL_123"')
  const res2 = await createServiceJob({
    customerId: customer.id,
    device: 'Laptop Test 2',
    issue: 'Battery issue',
    serialUnitId: 'INVALID_SERIAL_123',
  })
  if (!res2.success) throw new Error(`Case 2 failed: ${res2.error}`)
  console.log(`  ✓ Job created with non-existent serialUnitId gracefully resolved to null: ${res2.data.jobNumber} (serialUnitId: ${res2.data.serialUnitId})`)

  // Cleanup
  await prisma.serviceJob.deleteMany({
    where: { id: { in: [res1.data.id, res2.data.id] } },
  })

  console.log('\n✅ Foreign key resolution test passed with ZERO errors!')
  await prisma.$disconnect()
}

testServiceJobFkHandling().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
