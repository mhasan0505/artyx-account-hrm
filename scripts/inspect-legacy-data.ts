import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'

async function inspectLegacyData() {
  const payrolls = await prisma.payroll.findMany({
    include: {
      payslips: {
        include: {
          lines: true,
          payment: true,
        },
      },
    },
  })

  const adjustments = await prisma.employeeAdjustment.findMany()
  const legacyPayments = await prisma.employeePayment.findMany()

  console.log('=== LEGACY PAYROLLS ===')
  console.log(JSON.stringify(payrolls, null, 2))

  console.log('\n=== LEGACY ADJUSTMENTS ===')
  console.log(JSON.stringify(adjustments, null, 2))

  console.log('\n=== LEGACY PAYMENTS ===')
  console.log(JSON.stringify(legacyPayments, null, 2))
}

inspectLegacyData()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
