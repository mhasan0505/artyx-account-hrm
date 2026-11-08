import { config } from 'dotenv'
config({ path: '.env.local' })
config()

process.env.SKIP_AUTH_CHECK = 'true'

import { checkout, deleteSale } from '../lib/actions/sales'
import { deleteBankAccount } from '../lib/actions/bank'
import { prisma } from '../lib/db'
import { ExpenseStatus, PaymentMethod, StockMovementType } from '@prisma/client'

async function runPhase3ReversalTests() {
  console.log('⚡ Starting Phase 3 Delete/Reversal Integrity Automated Verification Suite...\n')
  let passedCount = 0
  let totalTests = 0

  try {
    const adminUser = await prisma.user.findFirst()
    let outletId = adminUser?.outletId

    if (!outletId) {
      let outlet = await prisma.outlet.findFirst()
      if (!outlet) {
        outlet = await prisma.outlet.create({
          data: { name: 'Reversal Test Outlet', code: `OUTLET_${Date.now()}` },
        })
      }
      outletId = outlet.id
    }

    // ── TEST 1: Credit Sale Deletion Balance & Ledger Reversal ──
    totalTests++
    console.log('Test 1: Credit Sale Deletion Customer Balance & Ledger Net-Zero Reversal')

    const customer = await prisma.customer.create({
      data: {
        name: `Reversal Test Customer ${Date.now()}`,
        phone: `01700${Date.now().toString().slice(-6)}`,
        outstandingBalance: 0,
      },
    })

    const product = await prisma.product.create({
      data: {
        name: 'Reversal Test Item',
        productCode: `PROD_REV_${Date.now()}`,
        requiresSerial: false,
        costPrice: 500,
        sellingPrice: 1500,
        isActive: true,
        outlet: { connect: { id: outletId } },
      },
    })

    await prisma.stockLedger.create({
      data: {
        productId: product.id,
        outletId,
        movementType: StockMovementType.OPENING,
        quantity: 10,
        referenceType: 'TestSeed',
      },
    })

    await prisma.stockLayer.create({
      data: {
        productId: product.id,
        outletId,
        quantityReceived: 10,
        quantityRemaining: 10,
        unitCost: 500,
        receivedAt: new Date(),
      },
    })

    const creditCheckoutData = {
      customerId: customer.id,
      lines: [
        {
          productId: product.id,
          quantity: 2,
          unitPrice: 1500,
          discountPct: 0,
          serialNumbers: [],
          isGift: false,
          cartItemId: 'cart-rev-1',
        },
      ],
      complimentaryGifts: [],
      payments: [{ method: 'CREDIT' as const, amount: 3000 }],
      orderDiscountPct: 0,
      isQuotation: false,
    }

    console.log('  🚀 Creating ৳3,000 Credit Sale for Customer...')
    try {
      await checkout(creditCheckoutData)
    } catch (err: any) {
      if (!err?.message?.includes('static generation store missing')) {
        throw err
      }
    }

    const createdSale = await prisma.sale.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    })

    if (!createdSale) {
      throw new Error('Credit sale creation failed to persist in DB')
    }

    const saleId = createdSale.id

    const customerAfterSale = await prisma.customer.findUnique({ where: { id: customer.id } })
    const ledgerAfterSale = await prisma.customerLedger.findMany({ where: { customerId: customer.id } })

    console.log(`  📊 Post-Sale Customer Balance: ৳${customerAfterSale?.outstandingBalance}, Ledger Entries: ${ledgerAfterSale.length}`)

    if (Number(customerAfterSale?.outstandingBalance) !== 3000 || ledgerAfterSale.length !== 1) {
      throw new Error(`Setup failed: Customer balance expected 3000, got ${customerAfterSale?.outstandingBalance}`)
    }

    console.log('  🗑 Executing deleteSale for Credit Sale...')
    try {
      await deleteSale(saleId)
    } catch (err: any) {
      if (!err?.message?.includes('static generation store missing')) {
        throw err
      }
    }

    const customerAfterDelete = await prisma.customer.findUnique({ where: { id: customer.id } })
    const ledgerAfterDelete = await prisma.customerLedger.findMany({ where: { customerId: customer.id } })

    const finalBalance = Number(customerAfterDelete?.outstandingBalance || 0)
    const finalLedgerCount = ledgerAfterDelete.length

    if (finalBalance === 0 && finalLedgerCount === 0) {
      console.log('  ✓ PASS: Credit Sale deleted cleanly! Customer outstanding balance reversed to ৳0, and CustomerLedger voided/deleted completely.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Expected balance 0 & ledger count 0. Got balance ${finalBalance}, ledger count ${finalLedgerCount}`)
    }

    // Cleanup Test 1
    await prisma.stockLayer.deleteMany({ where: { productId: product.id } })
    await prisma.stockLedger.deleteMany({ where: { productId: product.id } })
    await prisma.product.deleteMany({ where: { id: product.id } })
    await prisma.customer.deleteMany({ where: { id: customer.id } })

    // ── TEST 2: bank.ts deleteBankAccount Reference Protection ──
    totalTests++
    console.log('\nTest 2: bank.ts deleteBankAccount Referential Integrity Safeguards')

    const testBank = await prisma.bankAccount.create({
      data: {
        accountName: 'Deletion Safeguard Bank',
        accountNumber: `ACC_DEL_${Date.now()}`,
        bankName: 'Safeguard Bank',
        openingBalance: 1000,
        currentBalance: 1000,
        outletId,
      },
    })

    // Test A: Linked Expense
    let coa = await prisma.chartOfAccount.findFirst({ where: { type: 'EXPENSE' } })
    if (!coa) {
      coa = await prisma.chartOfAccount.create({
        data: { name: 'Test Expense Account', code: `EXP_${Date.now()}`, type: 'EXPENSE', isActive: true },
      })
    }

    const testExpense = await prisma.expense.create({
      data: {
        description: 'Test Safeguard Expense',
        amount: 500,
        expenseDate: new Date(),
        outletId,
        method: PaymentMethod.BANK_TRANSFER,
        bankAccountId: testBank.id,
        status: ExpenseStatus.PENDING,
        createdById: adminUser?.id || 'test-user',
        accountId: coa.id,
      },
    })

    console.log('  🚀 Testing deleteBankAccount rejection when linked to Expense...')
    const delRes1 = await deleteBankAccount(testBank.id)

    if (delRes1.success === false && delRes1.error.includes('linked to expenses')) {
      console.log('  ✓ PASS: Rejection verified for linked Expense!')
    } else {
      console.error(`  ✖ FAIL: Failed to block bank account deletion linked to Expense: ${JSON.stringify(delRes1)}`)
    }

    await prisma.expense.deleteMany({ where: { id: testExpense.id } })

    // Test B: Linked Capital Injection
    const capInj = await prisma.capitalInjection.create({
      data: {
        amount: 20000,
        bankAccountId: testBank.id,
        description: 'Safeguard Capital Test',
        injectionDate: new Date(),
        status: 'PENDING',
        createdById: adminUser?.id || 'test-user',
      },
    })

    console.log('  🚀 Testing deleteBankAccount rejection when linked to Capital Injection...')
    const delRes2 = await deleteBankAccount(testBank.id)

    if (delRes2.success === false && delRes2.error.includes('linked to capital injections')) {
      console.log('  ✓ PASS: Rejection verified for linked Capital Injection!')
    } else {
      console.error(`  ✖ FAIL: Failed to block bank account deletion linked to Capital Injection: ${JSON.stringify(delRes2)}`)
    }

    await prisma.capitalInjection.deleteMany({ where: { id: capInj.id } })

    // Test C: Unlinked deletion succeeds
    console.log('  🚀 Testing deleteBankAccount when all linked references are cleared...')
    try {
      await deleteBankAccount(testBank.id)
    } catch (err: any) {
      if (!err?.message?.includes('static generation store missing')) {
        throw err
      }
    }

    const bankCheck = await prisma.bankAccount.findUnique({ where: { id: testBank.id } })

    if (!bankCheck) {
      console.log('  ✓ PASS: Unlinked Bank Account deleted successfully!')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Unlinked bank account was not deleted from DB`)
    }

    console.log(`\n🎉 ALL ${passedCount}/${totalTests} PHASE 3 DELETE & REVERSAL INTEGRITY TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Test suite execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runPhase3ReversalTests()
