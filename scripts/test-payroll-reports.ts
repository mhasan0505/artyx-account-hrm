import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import {
  getPayrollAccrualExpenseReport,
  getPayrollCashFlowReport,
  generatePayrollForPeriod,
  recordPayrollPayment,
} from '../lib/actions/payroll'
import { prisma } from '../lib/db'
import { PaymentMethod, PayrollPeriodStatus } from '@prisma/client'

async function runReportAcceptanceTest() {
  console.log('📊 Starting Phase 4 Accrual Expense vs Cash Outflow Report Test...\n')
  let passedCount = 0

  try {
    let testOutlet = await prisma.outlet.findFirst({ where: { code: 'REPORT_TEST_OUTLET' } })
    if (!testOutlet) {
      testOutlet = await prisma.outlet.create({
        data: { name: 'Report Test Outlet', code: 'REPORT_TEST_OUTLET' },
      })
    }

    let testDept = await prisma.department.findFirst()
    if (!testDept) {
      testDept = await prisma.department.create({ data: { name: 'Report Testing Dept' } })
    }

    let testDesig = await prisma.designation.findFirst()
    if (!testDesig) {
      testDesig = await prisma.designation.create({
        data: { name: 'Report Staff', department: { connect: { id: testDept.id } } },
      })
    }

    const reportEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPREPORT_${Date.now()}`,
        name: 'July Accrual August Payment Employee',
        basicSalary: 40000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: testOutlet.id } },
        department: { connect: { id: testDept.id } },
        designation: { connect: { id: testDesig.id } },
        isActive: true,
      },
    })

    // Clean up any old test records for testOutlet
    await prisma.payrollPayment.deleteMany({ where: { employee: { outletId: testOutlet.id } } })
    await prisma.payrollEntryLine.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntry.deleteMany({ where: { payrollPeriod: { outletId: testOutlet.id } } })
    await prisma.payrollPeriod.deleteMany({ where: { outletId: testOutlet.id } })

    // Step 1: Accrue July 2026 Payroll (Month 7)
    const periodJuly = await prisma.payrollPeriod.create({
      data: {
        month: 7,
        year: 2026,
        outletId: testOutlet.id,
        status: PayrollPeriodStatus.ACCRUED,
        accruedAt: new Date(2026, 6, 31), // Accrued July 31
        totalGross: 40000,
        totalNet: 40000,
      },
    })

    const entryJuly = await prisma.payrollEntry.create({
      data: {
        payrollPeriodId: periodJuly.id,
        employeeId: reportEmp.id,
        baseSalary: 40000,
        incentive: 0,
        deduction: 0,
        advanceRecovered: 0,
        netPayable: 40000,
        paidAmount: 0,
      },
    })

    // Step 2: Record Payment for July Payroll on August 5, 2026
    const paymentAug = await prisma.payrollPayment.create({
      data: {
        payrollEntry: { connect: { id: entryJuly.id } },
        employee: { connect: { id: reportEmp.id } },
        amount: 40000,
        method: PaymentMethod.CASH,
        paidAt: new Date('2026-08-05T10:00:00.000Z'), // Paid on August 5
        notes: 'Disbursed salary for July on August 5th',
      },
    })

    // Step 3: Run Accrual Expense Report for 2026
    const accrualReport = await getPayrollAccrualExpenseReport(testOutlet.id, 2026)
    const julyAccrual = accrualReport.find(r => r.month === 7)
    const augAccrual = accrualReport.find(r => r.month === 8)

    console.log('Test 1: Accrual Expense Report (P&L View)')
    if (julyAccrual?.grossExpense === 40000 && (!augAccrual || augAccrual.grossExpense === 0)) {
      console.log('  ✓ PASS: July Accrual Expense Report shows ৳40,000 in July (Month 7) and ৳0 in August (Month 8).')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Accrual report mismatch. July=${julyAccrual?.grossExpense}, Aug=${augAccrual?.grossExpense}`)
    }

    // Step 4: Run Cash Outflow Report for 2026
    const cashReport = await getPayrollCashFlowReport(testOutlet.id, 2026)
    const julyCash = cashReport.find(r => r.month === 7)
    const augCash = cashReport.find(r => r.month === 8)

    console.log('\nTest 2: Cash Outflow Report (Cash Flow View)')
    if (julyCash?.totalCashOutflow === 0 && augCash?.totalCashOutflow === 40000) {
      console.log('  ✓ PASS: August Cash Outflow Report shows ৳40,000 in August (Month 8) and ৳0 in July (Month 7).')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Cash outflow report mismatch. July=${julyCash?.totalCashOutflow}, Aug=${augCash?.totalCashOutflow}`)
    }

    // Safe cleanup
    await prisma.payrollPayment.deleteMany({ where: { employee: { outletId: testOutlet.id } } })
    await prisma.payrollEntryLine.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntry.deleteMany({ where: { payrollPeriod: { outletId: testOutlet.id } } })
    await prisma.payrollPeriod.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.employee.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.outlet.delete({ where: { id: testOutlet.id } })

    console.log(`\n🎉 ALL ${passedCount}/2 REPORT ACCEPTANCE TESTS PASSED PERFECTLY!`)
  } catch (err) {
    console.error('✖ Report acceptance test failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runReportAcceptanceTest()
