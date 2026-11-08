/**
 * ============================================================================
 * WARNING: THIS SCRIPT MODIFIES GENERAL LEDGER AND PAYROLL ACCRUAL DATA IN THE DATABASE!
 * ============================================================================
 *
 * This remediation utility backfills double-entry General Ledger accruals for
 * historical PayrollEntry records (Debit: 5210 Salaries & Wages, Credit: 2210 Accrued Payroll)
 * and realigns historical payment debits from 5210 to 2210.
 *
 * SAFETY GUARD:
 * You MUST provide the `--confirm` CLI flag to execute database modifications.
 * Running without `--confirm` will run in dry-run/preview mode.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/heal-payroll.ts --confirm
 * ============================================================================
 */

import { prisma } from '../lib/db'
import { AccountType, TransactionType } from '@prisma/client'

async function main() {
  const isConfirmed = process.argv.includes('--confirm')

  console.log('='.repeat(70))
  console.log('PAYROLL ACCRUAL REMEDIATION SCRIPT')
  console.log('='.repeat(70))

  if (!isConfirmed) {
    console.warn('\n[DRY RUN MODE] --confirm flag not passed. No database changes will be written.')
    console.warn('To apply changes, run: npx tsx --env-file=.env.local scripts/heal-payroll.ts --confirm\n')
  } else {
    console.log('\n[LIVE EXECUTION] --confirm flag detected. Writing ledger modifications...\n')
  }

  // 1. Ensure COA 2000, 2210, 5210
  let liabilityParent = await prisma.chartOfAccount.findFirst({
    where: { code: '2000' },
  })
  if (!liabilityParent) {
    if (isConfirmed) {
      liabilityParent = await prisma.chartOfAccount.create({
        data: {
          code: '2000',
          name: 'Current Liabilities',
          type: AccountType.LIABILITY,
          isActive: true,
        },
      })
      console.log(`Created COA 2000 Current Liabilities: ${liabilityParent.id}`)
    } else {
      console.log('[Dry-Run] Would create COA 2000 Current Liabilities')
    }
  }

  let accruedPayrollCoa = await prisma.chartOfAccount.findFirst({
    where: { code: '2210' },
  })
  if (!accruedPayrollCoa) {
    if (isConfirmed && liabilityParent) {
      accruedPayrollCoa = await prisma.chartOfAccount.create({
        data: {
          code: '2210',
          name: 'Accrued Payroll',
          type: AccountType.LIABILITY,
          parentId: liabilityParent.id,
          isActive: true,
        },
      })
      console.log(`Created COA 2210 Accrued Payroll: ${accruedPayrollCoa.id}`)
    } else {
      console.log('[Dry-Run] Would create COA 2210 Accrued Payroll')
    }
  } else {
    console.log(`Found COA 2210 Accrued Payroll: ${accruedPayrollCoa.id}`)
  }

  let salaryExpenseCoa = await prisma.chartOfAccount.findFirst({
    where: { code: '5210' },
  })
  if (!salaryExpenseCoa) {
    let expenseParent = await prisma.chartOfAccount.findFirst({
      where: { code: '5200' },
    })
    if (!expenseParent && isConfirmed) {
      expenseParent = await prisma.chartOfAccount.create({
        data: {
          code: '5200',
          name: 'Operating Expenses',
          type: AccountType.EXPENSE,
          isActive: true,
        },
      })
    }
    if (isConfirmed) {
      salaryExpenseCoa = await prisma.chartOfAccount.create({
        data: {
          code: '5210',
          name: 'Salaries & Wages',
          type: AccountType.EXPENSE,
          parentId: expenseParent?.id,
          isActive: true,
        },
      })
      console.log(`Created COA 5210 Salaries & Wages: ${salaryExpenseCoa.id}`)
    } else {
      console.log('[Dry-Run] Would create COA 5210 Salaries & Wages')
    }
  } else {
    console.log(`Found COA 5210 Salaries & Wages: ${salaryExpenseCoa.id}`)
  }

  // 2. Backfill Accruals for all existing PayrollEntry records
  const entries = await prisma.payrollEntry.findMany({
    include: {
      employee: { select: { name: true } },
      payrollPeriod: { select: { month: true, year: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Found ${entries.length} total PayrollEntry records`)

  let accrualsToCreate = 0
  let accrualAmountTotal = 0

  for (const entry of entries) {
    const net = Number(entry.netPayable)
    if (net <= 0) continue

    const existing = await prisma.accountLedgerEntry.findFirst({
      where: {
        referenceId: entry.id,
        referenceType: 'PAYROLL_ACCRUAL',
      },
    })

    if (!existing) {
      accrualsToCreate++
      accrualAmountTotal += net

      if (isConfirmed && salaryExpenseCoa && accruedPayrollCoa) {
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
      }
    }
  }
  console.log(
    isConfirmed
      ? `Created ${accrualsToCreate} accrual journal entries totaling ৳${accrualAmountTotal.toFixed(2)}`
      : `[Dry-Run] Found ${accrualsToCreate} unposted accrual entries totaling ৳${accrualAmountTotal.toFixed(2)}`
  )

  // 3. Re-point historical payment entries
  if (salaryExpenseCoa && accruedPayrollCoa) {
    const paymentEntriesToRealign = await prisma.accountLedgerEntry.findMany({
      where: {
        referenceType: 'PAYROLL_PAYMENT',
        type: TransactionType.DEBIT,
        accountId: salaryExpenseCoa.id,
      },
    })

    if (paymentEntriesToRealign.length > 0) {
      if (isConfirmed) {
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
        console.log(`Re-pointed ${paymentEntriesToRealign.length} payment entries to COA 2210`)
      } else {
        console.log(`[Dry-Run] Would re-point ${paymentEntriesToRealign.length} payment entries to COA 2210`)
      }
    } else {
      console.log('No historical payments needed realignment')
    }
  }

  console.log('\nRemediation script completed successfully.')
}

main()
  .catch(err => {
    console.error('Fatal error running payroll remediation script:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
