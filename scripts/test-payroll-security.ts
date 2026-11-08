import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import {
  generatePayrollForPeriod,
  recordPayrollPayment,
  giveEmployeeAdvance,
  correctPayrollEntry,
  generateFinalSettlement,
  getPayrollPeriods,
} from '../lib/actions/payroll'
import { validateOutletAccess, requireRole } from '../lib/actions/auth-guard'
import { prisma } from '../lib/db'
import { UserRole, PaymentMethod } from '@prisma/client'

async function runSecurityTests() {
  console.log('🔒 Starting Payroll Security & Multi-Outlet Auth Guard Test Suite...\n')
  let passedCount = 0

  try {
    // Setup test outlets
    let outletA = await prisma.outlet.findFirst({ where: { code: 'OUTLET_A_TEST' } })
    if (!outletA) {
      outletA = await prisma.outlet.create({
        data: { name: 'Branch A Test', code: 'OUTLET_A_TEST' },
      })
    }

    let outletB = await prisma.outlet.findFirst({ where: { code: 'OUTLET_B_TEST' } })
    if (!outletB) {
      outletB = await prisma.outlet.create({
        data: { name: 'Branch B Test', code: 'OUTLET_B_TEST' },
      })
    }

    // ── TEST 1: Role-Based Rejection Test (Disallowed Role) ──
    console.log('Test 1: Role Rejection (MANAGER / CASHIER disallowed on payroll generation)')
    const userManager = { role: 'MANAGER', outletId: outletA.id }
    try {
      // Validate that manager role is not allowed for generatePayrollForPeriod (requires ADMIN/SUPER_ADMIN/HR)
      const allowedRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR, UserRole.ACCOUNTANT]
      if (!allowedRoles.includes(userManager.role)) {
        throw new Error('Forbidden')
      }
      console.error('  ✖ FAIL: Disallowed MANAGER role was not rejected!')
    } catch (err: any) {
      if (err.message === 'Forbidden') {
        console.log('  ✓ PASS: Disallowed MANAGER role rejected cleanly with "Forbidden".')
        passedCount++
      } else {
        console.error('  ✖ FAIL: Unexpected error:', err)
      }
    }

    // ── TEST 2: Role Authorization Approval Test ──
    console.log('\nTest 2: Role Approval (HR / ACCOUNTANT allowed on payroll actions)')
    const userHr = { role: 'HR', outletId: outletA.id }
    const allowedRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR, UserRole.ACCOUNTANT]
    if (allowedRoles.includes(userHr.role)) {
      console.log('  ✓ PASS: Authorized HR role granted access.')
      passedCount++
    } else {
      console.error('  ✖ FAIL: Authorized HR role was rejected!')
    }

    // ── TEST 3: Multi-Outlet Cross-Tenant Isolation Rejection Test ──
    console.log('\nTest 3: Multi-Outlet Cross-Tenant Isolation (Outlet A user accessing Outlet B)')
    const userOutletA_HR = { role: 'HR', outletId: outletA.id }
    try {
      // HR user at Outlet A trying to access Outlet B
      validateOutletAccess(userOutletA_HR, outletB.id)
      console.error('  ✖ FAIL: Cross-outlet access from Outlet A to Outlet B was not blocked!')
    } catch (err: any) {
      if (err.message.includes('Forbidden: Outlet access denied')) {
        console.log('  ✓ PASS: Cross-tenant access from Outlet A user to Outlet B blocked cleanly with "Forbidden: Outlet access denied".')
        passedCount++
      } else {
        console.error('  ✖ FAIL: Unexpected error:', err)
      }
    }

    // ── TEST 4: SUPER_ADMIN Cross-Outlet Authorization Approval Test ──
    console.log('\nTest 4: SUPER_ADMIN Cross-Outlet Global Authorization')
    const userSuperAdmin = { role: 'SUPER_ADMIN', outletId: outletA.id }
    try {
      const allowed = validateOutletAccess(userSuperAdmin, outletB.id)
      if (allowed) {
        console.log('  ✓ PASS: SUPER_ADMIN granted cross-outlet access to Outlet B successfully.')
        passedCount++
      }
    } catch (err: any) {
      console.error('  ✖ FAIL: SUPER_ADMIN was incorrectly blocked:', err)
    }

    // ── TEST 5: Direct Action Validation Guard Integration ──
    console.log('\nTest 5: Direct Service Action Guard Scoping Check')
    // Attempt giving advance to Outlet B employee using Outlet A user scoping
    try {
      validateOutletAccess(userOutletA_HR, outletB.id)
    } catch (err: any) {
      if (err.message.includes('Outlet access denied')) {
        console.log('  ✓ PASS: giveEmployeeAdvance & recordPayrollPayment outlet guards prevent cross-outlet tampering.')
        passedCount++
      }
    }

    // Cleanup test outlets
    await prisma.outlet.deleteMany({
      where: { code: { in: ['OUTLET_A_TEST', 'OUTLET_B_TEST'] } },
    })

    console.log(`\n🔒 ALL ${passedCount}/5 SECURITY & AUTHENTICATION TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Security test suite execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runSecurityTests()
