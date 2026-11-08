/**
 * scripts/heal-payroll-accruals.ts
 *
 * Automated Payroll General Ledger Remediation:
 * 1. Ensures Chart of Accounts has 2210 "Accrued Payroll" (LIABILITY) under 2000.
 * 2. Backfills missing double-entry accruals for existing PayrollEntry rows:
 *    - DEBIT:  5210 Salaries & Wages (EXPENSE)
 *    - CREDIT: 2210 Accrued Payroll (LIABILITY)
 * 3. Re-points any previous PAYROLL_PAYMENT debit entries from 5210 (expense) to 2210 (liability)
 *    to prevent double-expensing of paid amounts.
 * 4. Verifies the Balance Sheet equation: Assets == Liabilities + Equity.
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import {
  AccountType,
  PaymentMethod,
  PrismaClient,
  TransactionType,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const rawUrl =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres'

const connectionString = rawUrl
  .replace(/&?channel_binding=[^&]*/g, '')
  .replace(/\?&/, '?')

const needsSsl = /sslmode=require|sslmode=verify-full|neon\.tech|ssl=/.test(
  connectionString
)

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 2,
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

async function healPayrollAccruals() {
  console.log('================================================================================')
  console.log('💼 [PAYROLL ACCRUAL REMEDIATION] Converting Payroll to Pure Double-Entry GL...')
  console.log('================================================================================\n')

  // 1. Ensure Chart of Accounts
  console.log('Step 1: Verifying Chart of Accounts (COA)...')
  let liabilityParent = await prisma.chartOfAccount.findFirst({
    where: { code: '2000' },
  })
  if (!liabilityParent) {
    liabilityParent = await prisma.chartOfAccount.create({
      data: {
        code: '2000',
        name: 'Current Liabilities',
        type: AccountType.LIABILITY,
        isActive: true,
      },
    })
  }

  let accruedPayrollCoa = await prisma.chartOfAccount.findFirst({
    where: { code: '2210' },
  })
  if (!accruedPayrollCoa) {
    accruedPayrollCoa = await prisma.chartOfAccount.create({
      data: {
        code: '2210',
        name: 'Accrued Payroll',
        type: AccountType.LIABILITY,
        parentId: liabilityParent.id,
        isActive: true,
      },
    })
    console.log(`  ✓ Created Chart of Account: 2210 - Accrued Payroll (ID: ${accruedPayrollCoa.id})`)
  } else {
    console.log(`  ✓ Found Chart of Account: 2210 - Accrued Payroll (ID: ${accruedPayrollCoa.id})`)
  }

  let salaryExpenseCoa = await prisma.chartOfAccount.findFirst({
    where: { code: '5210' },
  })
  if (!salaryExpenseCoa) {
    let expenseParent = await prisma.chartOfAccount.findFirst({
      where: { code: '5200' },
    })
    if (!expenseParent) {
      expenseParent = await prisma.chartOfAccount.create({
        data: {
          code: '5200',
          name: 'Operating Expenses',
          type: AccountType.EXPENSE,
          isActive: true,
        },
      })
    }
    salaryExpenseCoa = await prisma.chartOfAccount.create({
      data: {
        code: '5210',
        name: 'Salaries & Wages',
        type: AccountType.EXPENSE,
        parentId: expenseParent.id,
        isActive: true,
      },
    })
    console.log(`  ✓ Created Chart of Account: 5210 - Salaries & Wages (ID: ${salaryExpenseCoa.id})`)
  } else {
    console.log(`  ✓ Found Chart of Account: 5210 - Salaries & Wages (ID: ${salaryExpenseCoa.id})`)
  }

  // 2. Backfill Accruals for all existing PayrollEntry records
  console.log('\nStep 2: Inspecting and backfilling missing payroll accruals...')
  const entries = await prisma.payrollEntry.findMany({
    include: {
      employee: { select: { name: true } },
      payrollPeriod: { select: { month: true, year: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`  Found ${entries.length} total PayrollEntry records.`)

  let accrualsCreated = 0
  let accrualAmountTotal = 0

  for (const entry of entries) {
    const net = Number(entry.netPayable)
    if (net <= 0) continue

    // Check if accrual already exists
    const existing = await prisma.accountLedgerEntry.findFirst({
      where: {
        referenceId: entry.id,
        referenceType: 'PAYROLL_ACCRUAL',
      },
    })

    if (!existing) {
      const desc = `Payroll Accrual: ${entry.employee.name} (${entry.payrollPeriod.month}/${entry.payrollPeriod.year})`
      await prisma.accountLedgerEntry.createMany({
        data: [
          {
            accountId: salaryExpenseCoa.id,
            type: TransactionType.DEBIT,
            amount: net,
            description: desc,
            referenceId: entry.id,
            referenceType: 'PAYROLL_ACCRUAL',
            createdAt: entry.createdAt,
          },
          {
            accountId: accruedPayrollCoa.id,
            type: TransactionType.CREDIT,
            amount: net,
            description: desc,
            referenceId: entry.id,
            referenceType: 'PAYROLL_ACCRUAL',
            createdAt: entry.createdAt,
          },
        ],
      })
      accrualsCreated++
      accrualAmountTotal += net
    }
  }
  console.log(`  ✓ Created ${accrualsCreated} accrual journal entries totaling ৳${accrualAmountTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`)

  // 3. Re-point past PAYROLL_PAYMENT debit legs to 2210 Accrued Payroll
  console.log('\nStep 3: Aligning historical payment entries...')
  const paymentEntriesToRealign = await prisma.accountLedgerEntry.findMany({
    where: {
      referenceType: 'PAYROLL_PAYMENT',
      type: TransactionType.DEBIT,
      accountId: salaryExpenseCoa.id,
    },
  })

  if (paymentEntriesToRealign.length > 0) {
    await prisma.accountLedgerEntry.updateMany({
      where: {
        referenceType: 'PAYROLL_PAYMENT',
        type: TransactionType.DEBIT,
        accountId: salaryExpenseCoa.id,
      },
      data: {
        accountId: accruedPayrollCoa.id,
      },
    })
    console.log(`  ✓ Re-pointed ${paymentEntriesToRealign.length} payment DEBIT entries from 5210 (Expense) to 2210 (Accrued Payroll Liability).`)
  } else {
    console.log('  ✓ No historical payment entries needed realignment.')
  }

  // 4. Re-calculate Balance Sheet from General Ledger
  console.log('\nStep 4: Recalculating Balance Sheet to verify mathematical parity...')

  const [cashSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1100'
  `
  const cashOnHand = round2(Number(cashSum?.total || 0))

  const [bankSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE (coa.code = '1110' OR coa.code = '1200')
  `
  const bankBalances = round2(Number(bankSum?.total || 0))

  const [arSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1300'
  `
  const accountsReceivable = round2(Number(arSum?.total || 0))

  const [invSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1400'
  `
  const inventoryValue = round2(Number(invSum?.total || 0))

  const [fixedAssetsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(
      "acquisitionCost" - COALESCE(
        CASE 
          WHEN depreciable = true AND "usefulLifeYears" > 0 THEN
            LEAST(
              "acquisitionCost" - "salvageValue",
              ("acquisitionCost" - "salvageValue") * (
                EXTRACT(EPOCH FROM (NOW() - "acquisitionDate")) / (365.25 * 86400)
              ) / "usefulLifeYears"
            )
          ELSE 0
        END, 0
      )
    ), 0) as "total"
    FROM "FixedAsset"
    WHERE status::text = 'ACTIVE'
  `
  const fixedAssetsNet = round2(Number(fixedAssetsSum?.total || 0))
  const totalAssets = round2(cashOnHand + bankBalances + accountsReceivable + inventoryValue + fixedAssetsNet)

  // Liabilities
  const [apSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '2100'
  `
  const accountsPayable = round2(Number(apSum?.total || 0))

  const [payrollGlSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '2210'
  `
  const accruedPayroll = round2(Number(payrollGlSum?.total || 0))
  const totalLiabilities = round2(accountsPayable + accruedPayroll)

  // Equity
  const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalCapital"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '3000'
  `
  const ownersCapital = round2(Number(capitalSum?.totalCapital || 0))

  const [obeSum] = await prisma.$queryRaw<{ totalObe: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalObe"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '3200'
  `
  const openingBalanceEquity = round2(Number(obeSum?.totalObe || 0))

  const [glIncomeSum] = await prisma.$queryRaw<{ totalInc: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalInc"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.type::text = 'INCOME'
  `
  const totalRevenue = round2(Number(glIncomeSum?.totalInc || 0))

  const [glExpenseSum] = await prisma.$queryRaw<{ totalExp: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "totalExp"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.type::text = 'EXPENSE'
  `
  const totalExpenses = round2(Number(glExpenseSum?.totalExp || 0))

  const retainedEarnings = round2(totalRevenue - totalExpenses)
  const totalEquity = round2(ownersCapital + openingBalanceEquity + retainedEarnings)

  const discrepancy = round2(totalAssets - (totalLiabilities + totalEquity))

  console.log('\n📊 POST-REMEDIATION BALANCE SHEET STATEMENT:')
  console.log(`  1. Total Assets: ৳${totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Cash on Hand (1100)       : ৳${cashOnHand.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Bank Balances (1110/1200) : ৳${bankBalances.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Receivable (1300): ৳${accountsReceivable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Inventory Valuation (1400): ৳${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Fixed Assets (Net)        : ৳${fixedAssetsNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  2. Total Liabilities: ৳${totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Payable (2100)   : ৳${accountsPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accrued Payroll (2210)    : ৳${accruedPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  3. Total Equity: ৳${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Owner's Capital           : ৳${ownersCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Opening Balance Equity    : ৳${openingBalanceEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Retained Earnings         : ৳${retainedEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`        · Revenue                : ৳${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`        · Expenses (inc. Payroll): ৳${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  4. Total Liabilities & Equity: ৳${(totalLiabilities + totalEquity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  5. Net Discrepancy (Assets - [Liab + Eq]): ৳${discrepancy.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  if (Math.abs(discrepancy) < 0.01) {
    console.log('\n🎉 SUCCESS: BALANCE SHEET IS MATHEMATICALLY PERFECT & 100% BALANCED! (Assets == Liabilities + Equity)')
  } else {
    console.log(`\n⚠️ Remaining Discrepancy: ৳${discrepancy.toFixed(2)}`)
  }

  console.log('================================================================================\n')
}

healPayrollAccruals()
  .catch(err => {
    console.error('❌ Remediation script execution failed:', err)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
