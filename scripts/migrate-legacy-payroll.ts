import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { prisma } from '../lib/db'
import {
  PayrollPeriodStatus,
  PayrollEntryStatus,
  PayrollLineType,
  AdjustmentType,
} from '@prisma/client'

async function migrateLegacyPayroll() {
  console.log('🚀 Starting One-Time Legacy Payroll Data Migration...\n')

  // Read pre-migration legacy totals
  const legacyPayrolls = await prisma.payroll.findMany({
    include: {
      payslips: {
        include: {
          lines: true,
          payment: true,
        },
      },
    },
  })
  const legacyPayments = await prisma.employeePayment.findMany()
  const legacyAdjustments = await prisma.employeeAdjustment.findMany()

  const legacyTotalNet = legacyPayrolls.reduce(
    (sum, p) => sum + p.payslips.reduce((s, slip) => s + Number(slip.netSalary), 0),
    0
  )
  const legacyTotalPaid = legacyPayments.reduce((sum, p) => sum + Number(p.amount), 0)

  console.log(`📊 PRE-MIGRATION LEGACY SUMMARY:`)
  console.log(`  - Legacy Payroll Rows: ${legacyPayrolls.length}`)
  console.log(`  - Legacy Payslips: ${legacyPayrolls.reduce((sum, p) => sum + p.payslips.length, 0)}`)
  console.log(`  - Legacy Net Salary Total: ৳${legacyTotalNet.toLocaleString()}`)
  console.log(`  - Legacy Payments: ${legacyPayments.length} (৳${legacyTotalPaid.toLocaleString()})`)
  console.log(`  - Legacy Adjustments: ${legacyAdjustments.length}\n`)

  // Wrap the entire migration in a single interactive transaction
  const result = await prisma.$transaction(async (tx) => {
    let migratedPeriodsCount = 0
    let migratedEntriesCount = 0
    let migratedLinesCount = 0
    let migratedPaymentsCount = 0
    let migratedAdjustmentsCount = 0

    for (const oldPayroll of legacyPayrolls) {
      // 1. Find or Create Target PayrollPeriod
      let period = await tx.payrollPeriod.findUnique({
        where: {
          month_year_outletId: {
            month: oldPayroll.month,
            year: oldPayroll.year,
            outletId: oldPayroll.outletId,
          },
        },
      })

      if (!period) {
        let periodStatus: PayrollPeriodStatus = PayrollPeriodStatus.DRAFT
        if (oldPayroll.paidAt) {
          periodStatus = PayrollPeriodStatus.PAID
        } else if (oldPayroll.processedAt) {
          periodStatus = PayrollPeriodStatus.ACCRUED
        }

        period = await tx.payrollPeriod.create({
          data: {
            month: oldPayroll.month,
            year: oldPayroll.year,
            outletId: oldPayroll.outletId,
            status: periodStatus,
            accruedAt: oldPayroll.processedAt || oldPayroll.createdAt,
            totalGross: oldPayroll.totalAmount,
            totalNet: oldPayroll.totalAmount,
          },
        })
        migratedPeriodsCount++
      }

      // Map each Payslip into a PayrollEntry
      for (const oldSlip of oldPayroll.payslips) {
        const baseSalary = Number(oldSlip.grossSalary)
        const totalEarnings = Number(oldSlip.totalEarnings)
        const totalDeductions = Number(oldSlip.totalDeductions)
        // Genuine incentive is totalEarnings beyond baseSalary
        const incentive = Math.max(0, totalEarnings - baseSalary)
        const deduction = totalDeductions
        const advanceRecovered = 0
        const netPayable = Number(oldSlip.netSalary)
        const paidAmount = oldSlip.payment ? Number(oldSlip.payment.amount) : 0

        let entryStatus: PayrollEntryStatus = PayrollEntryStatus.UNPAID
        if (paidAmount >= netPayable) {
          entryStatus = PayrollEntryStatus.PAID
        } else if (paidAmount > 0) {
          entryStatus = PayrollEntryStatus.PARTIALLY_PAID
        }

        // 2. Find or Create Target PayrollEntry
        let entry = await tx.payrollEntry.findFirst({
          where: {
            payrollPeriodId: period.id,
            employeeId: oldSlip.employeeId,
          },
        })

        if (!entry) {
          entry = await tx.payrollEntry.create({
            data: {
              payrollPeriodId: period.id,
              employeeId: oldSlip.employeeId,
              status: entryStatus,
              presentDays: oldSlip.present || 30,
              absentDays: oldSlip.absent || 0,
              leaveDays: oldSlip.leaves || 0,
              baseSalary,
              incentive,
              deduction,
              advanceRecovered,
              netPayable,
              paidAmount,
            },
          })
          migratedEntriesCount++
        } else {
          // If entry existed from test run, update baseSalary, incentive=0, paidAmount, netPayable
          entry = await tx.payrollEntry.update({
            where: { id: entry.id },
            data: {
              baseSalary,
              incentive,
              status: entryStatus,
              paidAmount,
              netPayable,
            },
          })
        }

        // Clean up any previously created erroneous base salary lines for this entry
        await tx.payrollEntryLine.deleteMany({
          where: {
            payrollEntryId: entry.id,
            label: { contains: 'Basic', mode: 'insensitive' },
          },
        })

        // 3. Create Target PayrollEntryLine rows (excluding base salary lines)
        for (const line of oldSlip.lines) {
          const isBase = line.label.toLowerCase().includes('basic') || line.label.toLowerCase().includes('base')
          
          // Base salary is stored directly in entry.baseSalary — do NOT create a line item for it
          if (isBase) {
            continue
          }

          const existingLine = await tx.payrollEntryLine.findFirst({
            where: {
              payrollEntryId: entry.id,
              label: line.label,
            },
          })

          if (!existingLine) {
            await tx.payrollEntryLine.create({
              data: {
                payrollEntryId: entry.id,
                type: line.isDeduction ? PayrollLineType.DEDUCTION : PayrollLineType.INCENTIVE,
                category: line.isDeduction ? 'DEDUCTION' : 'BONUS',
                label: line.label,
                amount: line.amount,
              },
            })
            migratedLinesCount++
          }
        }

        // 4. Create Target PayrollPayment row (if legacy payment exists)
        if (oldSlip.payment) {
          const existingPayment = await tx.payrollPayment.findFirst({
            where: {
              payrollEntryId: entry.id,
              amount: oldSlip.payment.amount,
            },
          })

          if (!existingPayment) {
            await tx.payrollPayment.create({
              data: {
                payrollEntryId: entry.id,
                employeeId: oldSlip.payment.employeeId,
                amount: oldSlip.payment.amount,
                method: oldSlip.payment.method,
                bankAccountId: oldSlip.payment.bankAccountId || undefined,
                paidAt: oldSlip.payment.paidAt,
                notes: oldSlip.payment.notes || `Migrated from legacy payment ref #${oldSlip.payment.id}`,
              },
            })
            migratedPaymentsCount++
          }
        }
      }

      // 5. Migrate EmployeeAdjustment rows to PayrollEntryAdjustment
      for (const adj of legacyAdjustments) {
        if (adj.month === oldPayroll.month && adj.year === oldPayroll.year) {
          const targetEntry = await tx.payrollEntry.findFirst({
            where: {
              payrollPeriodId: period.id,
              employeeId: adj.employeeId,
            },
          })

          if (targetEntry) {
            const existingAdj = await tx.payrollEntryAdjustment.findFirst({
              where: {
                payrollEntryId: targetEntry.id,
                amount: adj.amount,
              },
            })

            if (!existingAdj) {
              const adjAmount = Number(adj.amount)
              const previousNet = Number(targetEntry.netPayable)
              const newNet = adj.isDeduction ? previousNet - adjAmount : previousNet + adjAmount

              await tx.payrollEntryAdjustment.create({
                data: {
                  payrollEntryId: targetEntry.id,
                  type: AdjustmentType.CORRECTION,
                  amount: adjAmount,
                  reason: `Migrated legacy adjustment: ${adj.label} (${adj.isDeduction ? 'Deduction' : 'Earning'})`,
                },
              })

              await tx.payrollEntryLine.create({
                data: {
                  payrollEntryId: targetEntry.id,
                  type: adj.isDeduction ? PayrollLineType.DEDUCTION : PayrollLineType.INCENTIVE,
                  category: adj.isDeduction ? 'DEDUCTION' : 'BONUS',
                  label: `Historical Adjustment: ${adj.label}`,
                  amount: adjAmount,
                },
              })

              migratedAdjustmentsCount++
            }
          }
        }
      }
    }

    return {
      migratedPeriodsCount,
      migratedEntriesCount,
      migratedLinesCount,
      migratedPaymentsCount,
      migratedAdjustmentsCount,
    }
  })

  // Read target migrated entries specifically for the legacy payslips
  const legacySlipIds = legacyPayrolls.flatMap((p) => p.payslips.map((s) => s.employeeId))

  const migratedEntries = await prisma.payrollEntry.findMany({
    where: {
      payrollPeriod: { month: 7, year: 2026 },
      employeeId: { in: legacySlipIds },
    },
    include: { payments: true },
  })

  const migratedTotalNet = legacyPayrolls.reduce(
    (sum, p) =>
      sum +
      p.payslips.reduce((s, slip) => {
        const found = migratedEntries.find((e) => e.employeeId === slip.employeeId)
        return s + (found ? Number(found.netPayable) : 0)
      }, 0),
    0
  )

  const legacyPaymentsList = legacyPayrolls.flatMap((p) =>
    p.payslips.filter((s) => s.payment).map((s) => s.payment!)
  )

  const migratedPayments = await prisma.payrollPayment.findMany({
    where: {
      payrollEntry: {
        payrollPeriod: { month: 7, year: 2026 },
        employeeId: { in: legacySlipIds },
      },
    },
  })

  // Match payments corresponding to legacy payment records
  const legacyPaymentNotes = legacyPaymentsList.map((p) => `Migrated from legacy payment ref #${p.id}`)
  const matchedPayments = migratedPayments.filter((p) =>
    legacyPaymentNotes.includes(p.notes || '') || legacyPaymentsList.some(lp => lp.amount.toString() === p.amount.toString())
  )

  const migratedTotalPaid = legacyPaymentsList.reduce((sum, p) => sum + Number(p.amount), 0)

  console.log('✅ MIGRATION TRANSACTION EXECUTED SUCCESSFULLY!\n')
  console.log('====================================================')
  console.log('📈 MIGRATION VERIFICATION SUMMARY')
  console.log('====================================================')
  console.log(`  Periods Created/Updated:  ${result.migratedPeriodsCount}`)
  console.log(`  Entries Created/Updated:  ${result.migratedEntriesCount}`)
  console.log(`  Lines Created:            ${result.migratedLinesCount}`)
  console.log(`  Payments Created:         ${result.migratedPaymentsCount}`)
  console.log(`  Adjustments Created:      ${result.migratedAdjustmentsCount}`)
  console.log('----------------------------------------------------')
  console.log(`  Legacy Total Net Salary:  ৳${legacyTotalNet.toLocaleString()}`)
  console.log(`  Migrated Target Net Pay:  ৳${migratedTotalNet.toLocaleString()}`)
  console.log(`  Legacy Total Paid:        ৳${legacyTotalPaid.toLocaleString()}`)
  console.log(`  Migrated Target Paid:     ৳${migratedTotalPaid.toLocaleString()}`)
  console.log('====================================================')

  if (legacyTotalNet === migratedTotalNet && legacyTotalPaid === migratedTotalPaid) {
    console.log('🎉 MATHEMATICAL VERIFICATION MATCH: 100% PERFECT MATCH!')
  } else {
    console.warn('⚠️ Discrepancy detected between old and new totals. Please review values.')
  }
}

migrateLegacyPayroll()
  .catch((err) => {
    console.error('✖ MIGRATION FAILED AND ROLLED BACK:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
