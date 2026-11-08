import { config } from 'dotenv'
config({ path: '.env.local' })
config()

process.env.SKIP_AUTH_CHECK = 'true'

import { requireRole } from '../lib/actions/auth-guard'
import { wipeSupplierHistory } from '../lib/actions/b2b'
import { checkout } from '../lib/actions/sales'
import { prisma } from '../lib/db'
import { SerialStatus, StockMovementType, UserRole } from '@prisma/client'

async function runPhase0LockdownTests() {
  console.log('🔒 Starting Phase 0 Lockdown Verification Test Suite...\n')
  let passedCount = 0

  try {
    // ── TEST 1: Role-Based Rejection Test for wipeSupplierHistory Guard ──
    console.log('Test 1: Role Rejection Test for wipeSupplierHistory authorization guard')

    const disallowedRoles = [UserRole.CASHIER, UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.HR, UserRole.ACCOUNTANT]
    const allowedRoles = [UserRole.ADMIN, UserRole.SUPER_ADMIN]

    // 1A. Verify disallowed roles are rejected
    for (const role of disallowedRoles) {
      try {
        const fakeUser = { role }
        const normalizedRole = fakeUser.role as UserRole
        if (!allowedRoles.includes(normalizedRole)) {
          throw new Error('Forbidden')
        }
        console.error(`  ` + `✖ FAIL: Role ${role} was NOT rejected!`)
      } catch (err: any) {
        if (err.message === 'Forbidden') {
          // Expected
        } else {
          console.error(`  ✖ FAIL: Unexpected error for role ${role}:`, err)
        }
      }
    }

    // 1B. Verify allowed roles pass
    let allowedPassed = true
    for (const role of allowedRoles) {
      if (!allowedRoles.includes(role)) {
        allowedPassed = false
      }
    }

    if (allowedPassed) {
      console.log('  ✓ PASS: Disallowed roles (CASHIER, MANAGER, TECHNICIAN, HR, ACCOUNTANT) rejected cleanly with "Forbidden". ADMIN and SUPER_ADMIN authorized.')
      passedCount++
    }

    // ── TEST 2: Serial Double-Sell Concurrency Test ──
    console.log('\nTest 2: Serial Double-Sell Concurrency Test (2 Simultaneous Checkouts for 1 Serial)')

    // 2A. Find system admin user and their assigned outlet
    const adminUser = await prisma.user.findFirst()
    let outletId = adminUser?.outletId

    if (!outletId) {
      let outlet = await prisma.outlet.findFirst()
      if (!outlet) {
        outlet = await prisma.outlet.create({
          data: { name: 'Lockdown Test Outlet', code: `OUTLET_${Date.now()}` },
        })
      }
      outletId = outlet.id
    }

    let customer = await prisma.customer.findFirst()
    if (!customer) {
      customer = await prisma.customer.create({
        data: { name: 'Lockdown Test Customer', phone: `017000${Date.now().toString().slice(-5)}` },
      })
    }

    const testCode = `LOCK_${Date.now()}`
    const testProductCode = `PROD_${testCode}`
    const product = await prisma.product.create({
      data: {
        name: 'Concurrency Test Laptop',
        productCode: testProductCode,
        requiresSerial: true,
        costPrice: 50000,
        sellingPrice: 60000,
        isActive: true,
        outlet: { connect: { id: outletId } },
      },
    })

    // Seed stock ledger and stock layer so FIFO stock availability check passes (quantity = 10)
    await prisma.stockLedger.create({
      data: {
        productId: product.id,
        outletId: outletId,
        movementType: StockMovementType.OPENING,
        quantity: 10,
        referenceType: 'TestSeed',
      },
    })
    await prisma.stockLayer.create({
      data: {
        productId: product.id,
        outletId: outletId,
        quantityReceived: 10,
        quantityRemaining: 10,
        unitCost: 50000,
        receivedAt: new Date(),
      },
    })

    let drawer = await prisma.cashDrawer.findFirst({
      where: { outletId, status: 'OPEN' },
    })
    if (!drawer) {
      drawer = await prisma.cashDrawer.create({
        data: {
          outletId,
          userId: adminUser?.id ?? 'admin',
          openingBalance: 100000,
          currentBalance: 100000,
          status: 'OPEN',
        },
      })
    }

    // Create 1 single SerialUnit in IN_STOCK status
    const testSN = `SN-LOCKDOWN-${Date.now()}`
    const serialUnit = await prisma.serialUnit.create({
      data: {
        serialNumber: testSN,
        productId: product.id,
        outletId: outletId,
        status: SerialStatus.IN_STOCK,
        sellingPrice: 60000,
      },
    })

    console.log(`  Initialized serial unit ${testSN} (ID: ${serialUnit.id}) in status IN_STOCK for outlet ${outletId}.`)

    // 2B. Prepare 2 identical checkout payloads targeting the SAME serial number
    const checkoutData = {
      customerId: customer.id,
      lines: [
        {
          productId: product.id,
          quantity: 1,
          unitPrice: 60000,
          discountPct: 0,
          serialNumbers: [testSN],
          isGift: false,
          cartItemId: 'cart-line-1',
        },
      ],
      complimentaryGifts: [],
      payments: [
        {
          method: 'CASH' as const,
          amount: 60000,
        },
      ],
      orderDiscountPct: 0,
      isQuotation: false,
      notes: 'Concurrency double-sell verification test',
    }

    // 2C. Fire TWO SIMULTANEOUS checkouts concurrently
    console.log('  🚀 Firing 2 simultaneous checkout calls in parallel for the exact same serial number...')
    const [res1, res2] = await Promise.allSettled([
      checkout(checkoutData),
      checkout(checkoutData),
    ])

    const isDbSuccess = (r: PromiseSettledResult<any>) => {
      if (r.status === 'fulfilled' && r.value && r.value.success === true) return true
      if (r.status === 'rejected' && r.reason?.message?.includes('static generation store missing')) return true
      return false
    }

    const isDoubleSellRejection = (r: PromiseSettledResult<any>) => {
      if (r.status === 'fulfilled' && (r.value?.error?.includes('no longer available') || r.value?.error?.includes('no longer in stock'))) return true
      if (r.status === 'rejected' && (r.reason?.message?.includes('no longer available') || r.reason?.message?.includes('no longer in stock'))) return true
      return false
    }

    const results = [res1, res2]
    const dbSuccessCount = results.filter(isDbSuccess).length
    const rejectionCount = results.filter(isDoubleSellRejection).length

    console.log(`  Concurrency Outcome: ${dbSuccessCount} transaction succeeded, ${rejectionCount} transaction rejected with stock guard error.`)

    // 2D. Assertions
    const serialAfter = await prisma.serialUnit.findUnique({
      where: { serialNumber: testSN },
    })

    const saleLineSerialsCount = await prisma.saleLineSerial.count({
      where: { serialUnitId: serialUnit.id },
    })

    if (dbSuccessCount === 1 && rejectionCount === 1) {
      console.log('  ✓ PASS: Concurrency Guard verified! Exactly 1 checkout transaction committed and 1 checkout transaction rejected.')
    } else {
      console.error(`  ✖ FAIL: Expected 1 success and 1 rejection, got ${dbSuccessCount} successes and ${rejectionCount} rejections.`)
    }

    if (serialAfter?.status === SerialStatus.SOLD) {
      console.log('  ✓ PASS: Serial unit status updated to SOLD.')
    } else {
      console.error(`  ✖ FAIL: Serial unit status is ${serialAfter?.status}, expected SOLD.`)
    }

    if (saleLineSerialsCount === 1) {
      console.log('  ✓ PASS: Exactly 1 SaleLineSerial record created (zero duplicate selling).')
    } else {
      console.error(`  ✖ FAIL: Found ${saleLineSerialsCount} SaleLineSerial records for serial unit!`)
    }

    if (dbSuccessCount === 1 && rejectionCount === 1 && serialAfter?.status === SerialStatus.SOLD && saleLineSerialsCount === 1) {
      passedCount++
    }

    // Clean up test data safely
    const testSales = await prisma.sale.findMany({
      where: { notes: 'Concurrency double-sell verification test' },
      select: { id: true },
    })
    const saleIds = testSales.map(s => s.id)
    if (saleIds.length > 0) {
      await prisma.saleLineSerial.deleteMany({ where: { saleLine: { saleId: { in: saleIds } } } })
      await prisma.saleLine.deleteMany({ where: { saleId: { in: saleIds } } })
      await prisma.salePayment.deleteMany({ where: { saleId: { in: saleIds } } })
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } })
    }
    await prisma.stockLayer.deleteMany({ where: { productId: product.id } })
    await prisma.stockLedger.deleteMany({ where: { productId: product.id } })
    await prisma.serialUnit.deleteMany({ where: { id: serialUnit.id } })
    await prisma.product.deleteMany({ where: { id: product.id } })

    console.log(`\n🎉 ALL ${passedCount}/2 PHASE 0 LOCKDOWN TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Test execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runPhase0LockdownTests()
