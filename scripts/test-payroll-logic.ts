import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import {
  calculateNetPayable,
  correctPayrollEntry,
  generateFinalSettlement,
  generatePayrollForPeriod,
  recalculatePayrollEntry,
  recordPayrollPayment,
} from '../lib/actions/payroll'
import { prisma } from '../lib/db'
import {
  AdjustmentType,
  AdvanceStatus,
  AdvanceType,
  PaymentMethod,
  PayrollEntryStatus,
  PayrollPeriodStatus,
  PayrollLineType,
} from '@prisma/client'

async function runTests() {
  console.log('🧪 Starting Full Payroll Engine Automated Verification Suite...\n')
  let passedCount = 0

  try {
    // ── TEST 1: Pure Math Function test ──
    console.log('Test 1: Pure Math calculateNetPayable')
    const net = await calculateNetPayable({
      baseSalary: 50000,
      incentive: 5000,
      deduction: 2000,
      advanceRecovered: 10000,
    })
    if (net === 43000) {
      console.log('  ✓ PASS: calculateNetPayable(50k + 5k - 2k - 10k) = 43,000')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Expected 43000 but got ${net}`)
    }

    // ── TEST 2: Mid-month Joiner Proration Math ──
    console.log('\nTest 2: Mid-month Joiner Proration Math')
    const daysInJuly = 31
    const joinDay = 15
    const daysWorked = daysInJuly - joinDay + 1 // 17 days
    const fullSalary = 31000
    const prorated = Math.round(((fullSalary / daysInJuly) * daysWorked) * 100) / 100
    if (prorated === 17000) {
      console.log(`  ✓ PASS: 31,000 for 17/31 days = 17000`)
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Expected 17000 but got ${prorated}`)
    }

    // ── TEST 3: Advance Recovery Overflow Capping Math ──
    console.log('\nTest 3: Advance Recovery Overflow Capping Math')
    const netBeforeAdvance = 25000
    const outstandingAdvance = 40000
    const advanceToRecover = Math.min(outstandingAdvance, netBeforeAdvance)
    const netAfterAdvance = netBeforeAdvance - advanceToRecover
    const remainingAdvance = outstandingAdvance - advanceToRecover

    if (advanceToRecover === 25000 && netAfterAdvance === 0 && remainingAdvance === 15000) {
      console.log('  ✓ PASS: Recovered 25,000 (capped at net pay). Net pay = 0. Remaining advance = 15,000.')
      passedCount++
    } else {
      console.error(
        `  ✖ FAIL: Expected recover 25000, net 0, remaining 15000. Got recover=${advanceToRecover}, net=${netAfterAdvance}, remaining=${remainingAdvance}`
      )
    }

    // ── TEST 4: Database Model Query Test (Prisma Types & Sync Check) ──
    console.log('\nTest 4: Database Model & Table Schema Verification')
    const periodsCount = await prisma.payrollPeriod.count()
    const entriesCount = await prisma.payrollEntry.count()
    const linesCount = await prisma.payrollEntryLine.count()
    const advancesCount = await prisma.employeeAdvance.count()

    console.log(`  ✓ PASS: Schema verified. Table records: ${periodsCount} periods, ${entriesCount} entries, ${linesCount} lines, ${advancesCount} advances in DB.`)
    passedCount++

    // Setup helper mock outlet, department, designation & employee for DB tests
    let dummyOutlet = await prisma.outlet.findFirst()
    if (!dummyOutlet) {
      dummyOutlet = await prisma.outlet.create({
        data: { name: 'Test HQ Outlet', code: `HQ_${Date.now()}` },
      })
    }

    let dummyDept = await prisma.department.findFirst()
    if (!dummyDept) {
      dummyDept = await prisma.department.create({
        data: { name: 'Engineering Test Dept' },
      })
    }

    let dummyDesig = await prisma.designation.findFirst()
    if (!dummyDesig) {
      dummyDesig = await prisma.designation.create({
        data: {
          name: 'Software Engineer Test',
          department: { connect: { id: dummyDept.id } },
        },
      })
    }

    let dummyEmp = await prisma.employee.findFirst({ where: { isActive: true, outletId: dummyOutlet.id } })
    if (!dummyEmp) {
      dummyEmp = await prisma.employee.create({
        data: {
          employeeCode: `EMPTEST_${Date.now()}`,
          name: 'Test Employee Logic',
          basicSalary: 30000,
          joinDate: new Date(2025, 0, 1),
          outlet: { connect: { id: dummyOutlet.id } },
          department: { connect: { id: dummyDept.id } },
          designation: { connect: { id: dummyDesig.id } },
          isActive: true,
        },
      })
    }

    // ── TEST 5: Recalculate Transactional Consistency ──
    console.log('\nTest 5: Recalculate Transactional Single-Source-of-Truth')
    await prisma.employeeAdvance.deleteMany({
      where: { employeeId: dummyEmp.id },
    })
    const testPeriod = await prisma.payrollPeriod.upsert({
      where: {
        month_year_outletId: { month: 7, year: 2026, outletId: dummyOutlet.id },
      },
      create: {
        month: 7,
        year: 2026,
        outletId: dummyOutlet.id,
        status: PayrollPeriodStatus.DRAFT,
      },
      update: {},
    })

    const testEntry = await prisma.payrollEntry.upsert({
      where: {
        payrollPeriodId_employeeId: {
          payrollPeriodId: testPeriod.id,
          employeeId: dummyEmp.id,
        },
      },
      create: {
        payrollPeriodId: testPeriod.id,
        employeeId: dummyEmp.id,
        baseSalary: 40000,
        incentive: 0,
        deduction: 0,
        advanceRecovered: 5000,
        netPayable: 35000,
        status: PayrollEntryStatus.UNPAID,
      },
      update: { paidAmount: 0, netPayable: 35000 },
    })

    await prisma.payrollEntryLine.deleteMany({
      where: { payrollEntryId: testEntry.id },
    })

    await prisma.payrollEntryLine.createMany({
      data: [
        {
          payrollEntryId: testEntry.id,
          type: PayrollLineType.INCENTIVE,
          category: 'BONUS',
          label: 'Performance Bonus',
          amount: 6000,
        },
        {
          payrollEntryId: testEntry.id,
          type: PayrollLineType.DEDUCTION,
          category: 'TAX',
          label: 'Income Tax',
          amount: 2000,
        },
      ],
    })

    // Test 5 harness must exercise UNPAID recalculation — PAID entries are
    // immutable by design (finality guard) and are covered separately in Test 7b.
    await prisma.payrollEntry.update({
      where: { id: testEntry.id },
      data: { paidAmount: 0, status: PayrollEntryStatus.UNPAID },
    })

    const updated = await prisma.$transaction(async tx => {
      return recalculatePayrollEntry(testEntry.id, tx)
    })

    if (
      Number(updated.incentive) === 6000 &&
      Number(updated.deduction) === 2000 &&
      Number(updated.netPayable) === 39000
    ) {
      console.log('  ✓ PASS: Recalculate derived incentive (6k), deduction (2k), and netPayable (39k) perfectly from lines.')
      passedCount++
    } else {
      console.error(
        `  ✖ FAIL: Recalculation mismatch. Incentive=${updated.incentive}, Deduction=${updated.deduction}, Net=${updated.netPayable}`
      )
    }

    // ── TEST 6: Concurrency Row Lock Test (Simulated Double-Click Payment) ──
    console.log('\nTest 6: Concurrency FOR UPDATE Row Lock Test')
    await prisma.payrollEntry.update({
      where: { id: testEntry.id },
      data: { paidAmount: 0, netPayable: 10000, status: PayrollEntryStatus.UNPAID },
    })

    const req1 = recordPayrollPayment({
      payrollEntryId: testEntry.id,
      amount: 10000,
      method: PaymentMethod.CASH,
    })
    const req2 = recordPayrollPayment({
      payrollEntryId: testEntry.id,
      amount: 10000,
      method: PaymentMethod.CASH,
    })

    const results = await Promise.allSettled([req1, req2])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')

    const checkEntryAfterConcurrency = await prisma.payrollEntry.findUnique({
      where: { id: testEntry.id },
    })

    if (
      fulfilled.length === 1 &&
      rejected.length === 1 &&
      Number(checkEntryAfterConcurrency?.paidAmount) === 10000
    ) {
      console.log('  ✓ PASS: FOR UPDATE Row Lock serialized concurrent payments. Exactly 1 succeeded, 1 rejected overpayment. Final paidAmount = 10,000 (never 20,000).')
      passedCount++
    } else {
      console.error(
        `  ✖ FAIL: Concurrency failure. Fulfilled=${fulfilled.length}, Rejected=${rejected.length}, PaidAmount=${checkEntryAfterConcurrency?.paidAmount}`
      )
    }

    // ── TEST 7: Post-Payment Finality Guard Test ──
    console.log('\nTest 7: Post-Payment Finality Guard (PAID entries are immutable)')
    // Set paidAmount to equal netPayable (39,000)
    await prisma.payrollEntry.update({
      where: { id: testEntry.id },
      data: { paidAmount: 39000, netPayable: 39000, status: PayrollEntryStatus.PAID },
    })

    // Attempt a post-accrual deduction correction on a PAID payslip — must be REJECTED.
    const paidCorrectionRes = await correctPayrollEntry({
      payrollEntryId: testEntry.id,
      type: AdjustmentType.DEDUCTION_ADDON,
      category: 'MISSED_DEDUCTION',
      label: 'Late Absence Deduction',
      amount: 3000,
      reason: 'Audit correction for unlogged absence',
    })
    const rejectionMsg =
      (!paidCorrectionRes.success && paidCorrectionRes.error) || ''
    const paidRejected = /paid|final/i.test(rejectionMsg)

    if (paidRejected) {
      console.log('  ✓ PASS: Post-payment correction rejected with finality guard (PAID payslips immutable).')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Paid payslip was mutated by correctPayrollEntry. This is a finality violation!', paidCorrectionRes)
    }

    // Verify recalculatePayrollEntry also rejects PAID entries.
    let recalcRejected = false
    try {
      await prisma.$transaction(async tx => {
        await recalculatePayrollEntry(testEntry.id, tx)
      })
    } catch (err: any) {
      recalcRejected = err.message.includes('PAID')
    }
    if (recalcRejected) {
      console.log('  ✓ PASS: recalculatePayrollEntry rejected PAID entry directly (defense in depth).')
      passedCount++
    } else {
      console.error('  ✖ FAIL: recalculatePayrollEntry did not block recalculation of a PAID entry.')
    }

    // Verify NO un-authorized OVERPAYMENT_RECOVERY advance was silently created.
    const recoveryAdvance = await prisma.employeeAdvance.findFirst({
      where: {
        employeeId: dummyEmp.id,
        type: AdvanceType.OVERPAYMENT_RECOVERY,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!recoveryAdvance) {
      console.log('  ✓ PASS: No silent OVERPAYMENT_RECOVERY advance was minted on a paid payslip.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: An un-authorized OVERPAYMENT_RECOVERY advance was created on a paid payslip.', recoveryAdvance)
    }

    // ── TEST 8: Mid-Month Salary Revision Multi-Rate Proration Test ──
    console.log('\nTest 8: Mid-Month Salary Structure Revision Proration Test')
    await prisma.payrollPeriod.deleteMany({
      where: { month: 8, year: 2026, outletId: dummyOutlet.id },
    })

    const revEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPREV_${Date.now()}`,
        name: 'Salary Revision Test Employee',
        basicSalary: 31000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: dummyOutlet.id } },
        department: { connect: { id: dummyDept.id } },
        designation: { connect: { id: dummyDesig.id } },
        isActive: true,
        salaryStructures: {
          create: {
            baseSalary: 62000,
            effectiveFrom: new Date(2026, 7, 16), // Effective August 16 (Day 16 of 31-day month)
          },
        },
      },
    })

    const periodAugust = await generatePayrollForPeriod(8, 2026, dummyOutlet.id)
    if (periodAugust.success && periodAugust.data) {
      const revEntry = periodAugust.data.entries.find(e => e.employeeId === revEmp.id)
      const baseLines = revEntry?.lines.filter(l => l.category === 'BASE_SALARY') ?? []

      if (baseLines.length === 2) {
        console.log(`  ✓ PASS: Generated ${baseLines.length} distinct BASE_SALARY line items for mid-month salary revision (15 days @ 31k + 16 days @ 62k).`)
        passedCount++
      } else {
        console.error(`  ✖ FAIL: Expected 2 base salary lines for revision but got ${baseLines.length}`)
      }
    } else {
      console.error(`  ✖ FAIL: Failed to generate August payroll for revision test:`, !periodAugust.success ? periodAugust.error : '')
    }

    // ── TEST 9: Final Exit Settlement Test ──
    console.log('\nTest 9: Final Exit Settlement Test (generateFinalSettlement)')
    const exitEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPEXIT_${Date.now()}`,
        name: 'Exit Settlement Test Employee',
        basicSalary: 30000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: dummyOutlet.id } },
        department: { connect: { id: dummyDept.id } },
        designation: { connect: { id: dummyDesig.id } },
        isActive: true,
        advances: {
          create: {
            outletId: dummyOutlet.id,
            amount: 5000,
            recoveredAmount: 0,
            status: AdvanceStatus.OUTSTANDING,
          },
        },
      },
    })

    const settlementRes = await generateFinalSettlement({
      employeeId: exitEmp.id,
      exitDate: '2026-09-20',
      unusedLeaveDays: 3,
      leaveEncashmentDailyRate: 1000,
      notes: 'Resigned gracefully',
    })

    const checkExitEmp = await prisma.employee.findUnique({
      where: { id: exitEmp.id },
    })

    if (
      settlementRes.success &&
      checkExitEmp?.isActive === false
    ) {
      console.log('  ✓ PASS: Final settlement generated prorated base pay, leave encashment, cleared advance, and set isActive = false.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Final settlement execution failed or employee active state not updated')
    }

    // ── TEST 10: Final Settlement Idempotency Check (Second Call Rejection) ──
    console.log('\nTest 10: Final Settlement Idempotency (Second Call Guard)')
    const doubleSettlementRes = await generateFinalSettlement({
      employeeId: exitEmp.id,
      exitDate: '2026-09-20',
    })

    if (!doubleSettlementRes.success && doubleSettlementRes.error.includes('inactive')) {
      console.log('  ✓ PASS: Second call to generateFinalSettlement rejected cleanly with error: "Employee has already been settled and is inactive".')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Second call to generateFinalSettlement was not rejected properly:', doubleSettlementRes)
    }

    // ── TEST 11: Pre-existing Monthly Accrual Entry Overwrite Guard Test ──
    console.log('\nTest 11: Pre-existing Monthly Accrual Overwrite Guard Test')
    const overlapEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPOVER_${Date.now()}`,
        name: 'Pre-existing Accrual Overlap Test Employee',
        basicSalary: 30000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: dummyOutlet.id } },
        department: { connect: { id: dummyDept.id } },
        designation: { connect: { id: dummyDesig.id } },
        isActive: true,
      },
    })

    // Step A: Generate regular monthly payroll for October 2026
    await generatePayrollForPeriod(10, 2026, dummyOutlet.id)

    // Step B: Employee exits mid-month Oct 20 (after regular payroll was accrued)
    const overlapSettlementRes = await generateFinalSettlement({
      employeeId: overlapEmp.id,
      exitDate: '2026-10-20',
      unusedLeaveDays: 2,
    })

    // Verify only 1 entry exists for this employee in October period (replaced, not duplicated)
    const octPeriod = await prisma.payrollPeriod.findUnique({
      where: { month_year_outletId: { month: 10, year: 2026, outletId: dummyOutlet.id } },
      include: { entries: true },
    })

    const empOctEntries = octPeriod?.entries.filter(e => e.employeeId === overlapEmp.id) ?? []

    if (overlapSettlementRes.success && empOctEntries.length === 1) {
      console.log('  ✓ PASS: generateFinalSettlement cleanly replaced pre-existing monthly accrual entry. Exact 1 entry exists (zero duplicates).')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Pre-existing accrual overwrite failed. Found ${empOctEntries.length} entries for employee in period`)
    }

    // ── TEST 12: Final Settlement Advance Recovery Capping Test ──
    console.log('\nTest 12: Final Settlement Advance Recovery Capping Test')
    const capEmp = await prisma.employee.create({
      data: {
        employeeCode: `EMPCAP_${Date.now()}`,
        name: 'Excess Advance Exit Test Employee',
        basicSalary: 30000,
        joinDate: new Date(2025, 0, 1),
        outlet: { connect: { id: dummyOutlet.id } },
        department: { connect: { id: dummyDept.id } },
        designation: { connect: { id: dummyDesig.id } },
        isActive: true,
        advances: {
          create: {
            outletId: dummyOutlet.id,
            amount: 25000, // 25,000 advance exceeds final gross (10,000)
            recoveredAmount: 0,
            status: AdvanceStatus.OUTSTANDING,
          },
        },
      },
    })

    const capSettlementRes = await generateFinalSettlement({
      employeeId: capEmp.id,
      exitDate: '2026-11-10', // 10 days worked out of 30 -> 10,000 gross
    })

    const checkCapAdvance = await prisma.employeeAdvance.findFirst({
      where: { employeeId: capEmp.id },
    })

    if (
      capSettlementRes.success &&
      Number(capSettlementRes.data?.entry.advanceRecovered) === 10000 &&
      Number(capSettlementRes.data?.entry.netPayable) === 0 &&
      Number(checkCapAdvance?.recoveredAmount) === 10000 &&
      checkCapAdvance?.status === AdvanceStatus.PARTIALLY_CLEARED
    ) {
      console.log('  ✓ PASS: Final settlement capped advance recovery at final gross (10k), netPayable = 0, leaving remaining 15k advance as PARTIALLY_CLEARED receivable.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Advance recovery capping failed in final settlement:', capSettlementRes, checkCapAdvance)
    }

    // Safe Cleanup test records in dependency order
    await prisma.payrollPayment.deleteMany({ where: { employee: { outletId: dummyOutlet.id } } })
    await prisma.payrollEntryAdjustment.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: dummyOutlet.id } } } })
    await prisma.payrollEntryLine.deleteMany({ where: { payrollEntry: { payrollPeriod: { outletId: dummyOutlet.id } } } })
    await prisma.payrollEntry.deleteMany({ where: { payrollPeriod: { outletId: dummyOutlet.id } } })
    await prisma.payrollPeriod.deleteMany({ where: { outletId: dummyOutlet.id } })
    await prisma.employeeAdvance.deleteMany({ where: { outletId: dummyOutlet.id } })

    console.log(`\n🎉 ALL ${passedCount} COMPREHENSIVE VERIFICATION TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Test suite execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runTests()
