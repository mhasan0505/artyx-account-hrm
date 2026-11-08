import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

/**
 * Required Chart of Accounts for standard operational workflows:
 * - 1100: Cash on Hand
 * - 1110: Mobile Financial Services (MFS)
 * - 1200: Bank Accounts
 * - 1300: Accounts Receivable
 * - 1400: Inventory Asset
 * - 1500: Fixed Assets
 * - 1510: Accumulated Depreciation
 * - 2100: Accounts Payable
 * - 2210: Accrued Payroll
 * - 2300: VAT / Tax Payable
 * - 3000: Owner Equity
 * - 3200: Opening Balance Equity
 * - 4100: Sales Revenue
 * - 4200: Service Revenue
 * - 4400: Inventory Gain
 * - 5000: Cost of Goods Sold
 * - 5290: MFS Charges
 * - 5291: Bank Charges
 * - 5299: Miscellaneous Expense
 * - 5300: Inventory Shrinkage
 * - 5320: Depreciation Expense
 */
const REQUIRED_ACCOUNTS = [
  { code: '1100', defaultName: 'Cash on Hand' },
  { code: '1110', defaultName: 'Mobile Financial Services (MFS)' },
  { code: '1200', defaultName: 'Bank Accounts' },
  { code: '1300', defaultName: 'Accounts Receivable' },
  { code: '1400', defaultName: 'Inventory Asset' },
  { code: '1500', defaultName: 'Fixed Assets' },
  { code: '1510', defaultName: 'Accumulated Depreciation' },
  { code: '2100', defaultName: 'Accounts Payable' },
  { code: '2210', defaultName: 'Accrued Payroll' },
  { code: '2300', defaultName: 'VAT / Tax Payable' },
  { code: '3000', defaultName: 'Owner Equity' },
  { code: '3200', defaultName: 'Opening Balance Equity' },
  { code: '4100', defaultName: 'Sales Revenue' },
  { code: '4200', defaultName: 'Service Revenue' },
  { code: '4400', defaultName: 'Inventory Gain' },
  { code: '5000', defaultName: 'Cost of Goods Sold' },
  { code: '5290', defaultName: 'MFS Charges' },
  { code: '5291', defaultName: 'Bank Charges' },
  { code: '5299', defaultName: 'Miscellaneous Expense' },
  { code: '5300', defaultName: 'Inventory Shrinkage' },
  { code: '5320', defaultName: 'Depreciation Expense' },
]

async function main() {
  console.log('--- Chart of Accounts (COA) Verification ---')

  const targetCodes = REQUIRED_ACCOUNTS.map(a => a.code)
  const existing = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: targetCodes },
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
    },
  })

  const existingMap = new Map(existing.map(a => [a.code, a]))
  const missing: { code: string; defaultName: string }[] = []

  for (const req of REQUIRED_ACCOUNTS) {
    const acc = existingMap.get(req.code)
    if (acc) {
      console.log(`[PASS] ${acc.code} - ${acc.name} (${acc.type})`)
    } else {
      console.error(`[FAIL] ${req.code} - ${req.defaultName} is MISSING`)
      missing.push(req)
    }
  }

  if (missing.length > 0) {
    console.error(`\nCOA Check Failed: ${missing.length} missing required account(s):`)
    for (const m of missing) {
      console.error(`  - Code ${m.code} (${m.defaultName})`)
    }
    process.exit(1)
  }

  console.log(`\nAll ${REQUIRED_ACCOUNTS.length} required COA accounts are present.`)
}

main()
  .catch((err) => {
    console.error('Fatal error verifying COA:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
