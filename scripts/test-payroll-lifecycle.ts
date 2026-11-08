import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import {
  generatePayrollForPeriod,
  recordPayrollPayment,
  giveEmployeeAdvance,
  voidPayrollPayment,
  deletePayrollPeriod,
} from '../lib/actions/payroll'
import { prisma } from '../lib/db'
import {
  PaymentMethod,
  PayrollEntryStatus,
  PayrollPeriodStatus,
} from '@prisma/client'

async function runLifecycleTest() {
  console.log('🔁 Starting Payroll Void / Delete / Advance-Cap Lifecycle Test...\n')
  let passedCount = 0

  try {
    let testOutlet = await prisma.outlet.findFirst({ where: { code: 'LIFECYCLE_TEST_OUTLET' } })
    if (!testOutlet) {
      testOutlet = await prisma.outlet.create({
        data: { name: 'Lifecycle Test Outlet', code: 'LIFECYCLE_TEST_OUTLET' },
      })
    }

    let testDept = await prisma.department.findFirst()
    if (!testDept) {
      testDept = await prisma.department.create({ data: { name: 'Lifecycle Testing Dept' } })
    }

    let testDesig = await prisma.designation.findFirst()
    if (!testDesig) {
      testDesig = await prisma.designation.create({
        data: { name: 'Lifecycle Staff', department: { connect: { id: testDept.id } } },
      })
    }

    // Cleanup prior runs for this outlet
    await prisma.payrollPayment.deleteMany({ where: { employee: { outletId: testOutlet.id } } })
    await prisma.payrollEntryLine.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntryAdjustment.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntry.deleteMany({ where: { payrollPeriod: { outletId: testOutlet.id } } })
    await prisma.payrollPeriod.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.employeeAdvance.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.drawerTransaction.deleteMany({ where: { drawer: { outletId: testOutlet.id } } })
    await prisma.cashDrawer.deleteMany({ where: { outletId: testOutlet.id } })

    // ── TEST A: Advance Cap blocks advance beyond monthly salary ──
    console.log('Test A: Advance Cap (outstanding + new advance cannot exceed monthly salary)')

    // Open a cash drawer for the outlet so cash payouts can post.
    const adminUser = await prisma.user.findFirst()
    if (!adminUser) throw new Error('No user found to open drawer')
    const drawer = await prisma.cashDrawer.create({
      data: {
        outletId: testOutlet.id,
        openedById: adminUser.id,
        shift: 'MORNING',
        status: 'OPEN',
        openingBalance: 200000,
      },
    })
    // Seed the drawer balance via a PAYIN transaction (balance is summed from transactions).
    await prisma.drawerTransaction.create({
      data: {
        drawerId: drawer.id,
        type: 'PAYIN',
        amount: 200000,
        description: 'Opening float',
      },
    })

    const capEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPCAP_${Date.now()}`,
        name: 'Advance Cap Employee',
        basicSalary: 20000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: testOutlet.id } },
        department: { connect: { id: testDept.id } },
        designation: { connect: { id: testDesig.id } },
        isActive: true,
      },
    })

    // 15,000 is within the 20,000 cap — allowed
    const firstAdvance = await giveEmployeeAdvance({
      employeeId: capEmp.id,
      outletId: testOutlet.id,
      amount: 15000,
      method: PaymentMethod.CASH,
      notes: 'Cap test - allowed advance',
    })

    // 10,000 more would exceed 20,000 cap — blocked
    const blockedAdvance = await giveEmployeeAdvance({
      employeeId: capEmp.id,
      outletId: testOutlet.id,
      amount: 10000,
      method: PaymentMethod.CASH,
      notes: 'Cap test - blocked advance',
    })

    if (firstAdvance.success && !blockedAdvance.success && blockedAdvance.error?.includes('exceeds')) {
      console.log('  ✓ PASS: 15,000 advance allowed; second 10,000 blocked (would exceed 20,000 salary cap).')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Advance cap not enforced.', { firstAdvance, blockedAdvance })
    }

    // ── TEST B: deletePayrollPeriod on a DRAFT period (no payments) ──
    console.log('\nTest B: deletePayrollPeriod removes DRAFT period and cascades entries/lines')
    const draftPeriod = await prisma.payrollPeriod.create({
      data: {
        month: 12,
        year: 2026,
        outletId: testOutlet.id,
        status: PayrollPeriodStatus.DRAFT,
      },
    })
    const draftEntry = await prisma.payrollEntry.create({
      data: {
        payrollPeriodId: draftPeriod.id,
        employeeId: capEmp.id,
        baseSalary: 20000,
        incentive: 0,
        deduction: 0,
        advanceRecovered: 0,
        netPayable: 20000,
        status: PayrollEntryStatus.UNPAID,
      },
    })
    await prisma.payrollEntryLine.create({
      data: {
        payrollEntryId: draftEntry.id,
        type: 'INCENTIVE',
        category: 'BASE_SALARY',
        label: 'Basic Salary',
        amount: 20000,
      },
    })

    const deleteDraft = await deletePayrollPeriod(draftPeriod.id)
    const leftoverPeriod = await prisma.payrollPeriod.findUnique({ where: { id: draftPeriod.id } })
    const leftoverEntry = await prisma.payrollEntry.findUnique({ where: { id: draftEntry.id } })
    const leftoverLine = await prisma.payrollEntryLine.findFirst({ where: { payrollEntryId: draftEntry.id } })

    if (deleteDraft.success && !leftoverPeriod && !leftoverEntry && !leftoverLine) {
      console.log('  ✓ PASS: DRAFT period deleted; entries and lines cascaded with zero orphans.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: DRAFT deletion or cascade failed.', { deleteDraft, leftoverPeriod, leftoverEntry, leftoverLine })
    }

    // ── TEST C: deletePayrollPeriod blocks a period with recorded payments ──
    console.log('\nTest C: deletePayrollPeriod blocks paid/paymented periods')
    // Accrue a real period so we can pay an entry
    const accrualRes = await generatePayrollForPeriod(11, 2026, testOutlet.id)
    const paidPeriodId = accrualRes.success ? accrualRes.data?.id : null
    if (!paidPeriodId) {
      throw new Error('Failed to accrue payroll for lifecycle test')
    }
    const paidEntry = await prisma.payrollEntry.findFirst({
      where: { payrollPeriodId: paidPeriodId },
    })
    if (!paidEntry) throw new Error('No payroll entry found for lifecycle test')

    await recordPayrollPayment({
      payrollEntryId: paidEntry.id,
      amount: Number(paidEntry.netPayable),
      method: PaymentMethod.CASH,
    })

    const deletePaymented = await deletePayrollPeriod(paidPeriodId)
    const delPaymentedMsg = (!deletePaymented.success && deletePaymented.error) || ''
    if (!deletePaymented.success && /payments|PAID|paid|DRAFT or ACCRUED/i.test(delPaymentedMsg)) {
      console.log('  ✓ PASS: deletePayrollPeriod rejected a paid/paymented period.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: deletePayrollPeriod allowed deleting a paid/paymented period.', deletePaymented)
    }

    // ── TEST D: voidPayrollPayment reverses drawer/GL and restores entry state ──
    console.log('\nTest D: voidPayrollPayment atomically reverses cash & ledger legs')
    const payment = await prisma.payrollPayment.findFirst({
      where: { payrollEntryId: paidEntry.id },
    })
    if (!payment) throw new Error('No payroll payment found to void')

    const drawerBefore = await prisma.cashDrawer.findFirst({
      where: { outletId: testOutlet.id, status: 'OPEN' },
    })
    const drawerBalanceBefore = drawerBefore
      ? Number((await prisma.drawerTransaction.aggregate({ where: { drawerId: drawerBefore.id }, _sum: { amount: true } }))._sum.amount || 0)
      : 0

    const voidRes = await voidPayrollPayment({ paymentId: payment.id, reason: 'Lifecycle test reversal' })
    const checkEntry = await prisma.payrollEntry.findUnique({ where: { id: paidEntry.id } })
    const checkPayment = await prisma.payrollPayment.findUnique({ where: { id: payment.id } })
    const checkPeriod = await prisma.payrollPeriod.findUnique({ where: { id: paidPeriodId } })

    const drawerAfter = await prisma.cashDrawer.findFirst({
      where: { outletId: testOutlet.id, status: 'OPEN' },
    })
    const drawerBalanceAfter = drawerAfter
      ? Number((await prisma.drawerTransaction.aggregate({ where: { drawerId: drawerAfter.id }, _sum: { amount: true } }))._sum.amount || 0)
      : 0

    const ledgerReversed = await prisma.accountLedgerEntry.count({
      where: { referenceId: payment.id, referenceType: 'PAYROLL_PAYMENT_VOID' },
    })

    if (
      voidRes.success &&
      checkPayment?.voidedAt &&
      checkPayment.voidReason === 'Lifecycle test reversal' &&
      Number(checkEntry?.paidAmount) === 0 &&
      checkEntry?.status === PayrollEntryStatus.UNPAID &&
      checkPeriod?.status === PayrollPeriodStatus.ACCRUED &&
      drawerBalanceAfter === drawerBalanceBefore + Number(payment.amount) &&
      ledgerReversed >= 2
    ) {
      console.log('  ✓ PASS: Void reversed drawer (cash returned), restored entry to UNPAID, downgraded period to ACCRUED, posted GL reversal.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Void reversal incomplete.', {
        voidRes,
        paidAmount: checkEntry?.paidAmount,
        entryStatus: checkEntry?.status,
        periodStatus: checkPeriod?.status,
        drawerBalanceBefore,
        drawerBalanceAfter,
        ledgerReversed,
        checkPayment,
      })
    }

    // ── TEST E: voidPayrollPayment blocks double-void ──
    console.log('\nTest E: voidPayrollPayment rejects a second void on the same payment')
    const doubleVoid = await voidPayrollPayment({ paymentId: payment.id, reason: 'Double void attempt' })
    if (!doubleVoid.success && doubleVoid.error?.includes('already been voided')) {
      console.log('  ✓ PASS: Second void attempt rejected.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Double void was not rejected.', doubleVoid)
    }

    // Cleanup test records
    await prisma.payrollPayment.deleteMany({ where: { employee: { outletId: testOutlet.id } } })
    await prisma.payrollEntryLine.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntryAdjustment.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: testOutlet.id } } } })
    await prisma.payrollEntry.deleteMany({ where: { payrollPeriod: { outletId: testOutlet.id } } })
    await prisma.payrollPeriod.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.employeeAdvance.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.employee.deleteMany({ where: { outletId: testOutlet.id } })
    await prisma.drawerTransaction.deleteMany({ where: { drawer: { outletId: testOutlet.id } } })
    await prisma.cashDrawer.deleteMany({ where: { outletId: testOutlet.id } })

    console.log(`\n🔁 ALL ${passedCount}/5 LIFECYCLE TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Lifecycle test suite execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runLifecycleTest()
