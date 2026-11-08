import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'
import { recalculatePayrollEntry } from '../lib/actions/payroll'

async function verifyRecalculation() {
  console.log('🧪 Verifying recalculatePayrollEntry on Migrated Entries...\n')

  const legacyPeriod = await prisma.payrollPeriod.findFirst({
    where: { month: 7, year: 2026 },
    include: {
      entries: {
        include: { lines: true },
      },
    },
  })

  if (!legacyPeriod) {
    throw new Error('No period found for 7/2026')
  }

  console.log(`Found Period ${legacyPeriod.month}/${legacyPeriod.year} with ${legacyPeriod.entries.length} entries.`)

  for (const entry of legacyPeriod.entries) {
    console.log(`Entry #${entry.id.slice(-6)} (Employee ${entry.employeeId.slice(-6)}):`)
    console.log(`  BEFORE Recalc: baseSalary=৳${entry.baseSalary}, incentive=৳${entry.incentive}, netPayable=৳${entry.netPayable}`)
    console.log(`  Line Items Count: ${entry.lines.length}`)
    
    // Call recalculatePayrollEntry
    await recalculatePayrollEntry(entry.id)

    const updatedEntry = await prisma.payrollEntry.findUnique({ where: { id: entry.id } })
    console.log(`  AFTER Recalc:  baseSalary=৳${updatedEntry?.baseSalary}, incentive=৳${updatedEntry?.incentive}, netPayable=৳${updatedEntry?.netPayable}`)

    if (Number(updatedEntry?.baseSalary) === Number(entry.baseSalary) && Number(updatedEntry?.incentive) === Number(entry.incentive)) {
      console.log(`  ✓ VERIFIED: Base salary & incentive remained 100% stable with ZERO drift!`)
    } else {
      console.error(`  ✖ ERROR: Recalculation drift detected!`)
    }
  }
}

verifyRecalculation()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
