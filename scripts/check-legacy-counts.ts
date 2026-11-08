import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'

async function checkLegacyCounts() {
  const [payrollCount, payslipCount, payslipLineCount, adjustmentCount, paymentCount] = await Promise.all([
    prisma.payroll.count(),
    prisma.payslip.count(),
    prisma.payslipLine.count(),
    prisma.employeeAdjustment.count(),
    prisma.employeePayment.count(),
  ])

  console.log('--- LEGACY PAYROLL TABLES ROW COUNTS ---')
  console.log(`Payroll: ${payrollCount}`)
  console.log(`Payslip: ${payslipCount}`)
  console.log(`PayslipLine: ${payslipLineCount}`)
  console.log(`EmployeeAdjustment: ${adjustmentCount}`)
  console.log(`EmployeePayment: ${paymentCount}`)
}

checkLegacyCounts()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
