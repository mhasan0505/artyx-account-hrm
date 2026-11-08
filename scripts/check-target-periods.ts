import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'

async function checkTargetPeriods() {
  const periods = await prisma.payrollPeriod.findMany({
    include: {
      entries: true,
    },
  })
  console.log('Target PayrollPeriods in DB:', JSON.stringify(periods, null, 2))
}

checkTargetPeriods().finally(() => prisma.$disconnect())
