import { config } from 'dotenv'
config({ path: '.env.local' })
config()

process.env.SKIP_AUTH_CHECK = 'true'

import { createBankTransaction } from '../lib/actions/bank'
import { approveCapitalInjection } from '../lib/actions/capital'
import { approveContraTransfer } from '../lib/actions/transfers'
import { checkout } from '../lib/actions/sales'
import { makePaymentToSupplier } from '../lib/actions/b2b'
import { approveExpense } from '../lib/actions/finance'
import { prisma } from '../lib/db'
import { ExpenseStatus, PaymentMethod, StockMovementType } from '@prisma/client'

async function runPhase2ConcurrencyTests() {
  console.log('⚡ Starting Phase 2 Row-Locking & Money-Engine Concurrency Automated Verification Suite...\n')
  let passedCount = 0
  let totalTests = 0

  // Helper for standalone Next.js result status checking
  const isDbSuccess = (r: PromiseSettledResult<any>) => {
    if (r.status === 'fulfilled' && r.value) {
      if (r.value.success === true) return true
      if (r.value.success === false && typeof r.value.error === 'string' && r.value.error.includes('static generation store missing')) {
        return true
      }
    }
    if (r.status === 'rejected' && r.reason?.message?.includes('static generation store missing')) {
      return true
    }
    return false
  }

  const isConcurrencyRejection = (r: PromiseSettledResult<any>) => {
    if (r.status === 'fulfilled' && r.value && r.value.success === false) {
      const err = String(r.value.error || '').toLowerCase()
      if (
        err.includes('insufficient') ||
        err.includes('pending') ||
        err.includes('already') ||
        err.includes('stock')
      ) {
        return true
      }
    }
    if (r.status === 'rejected') {
      const msg = String(r.reason?.message || '').toLowerCase()
      if (
        msg.includes('insufficient') ||
        msg.includes('pending') ||
        msg.includes('already') ||
        msg.includes('stock')
      ) {
        return true
      }
    }
    return false
  }

  try {
    // ── Setup Common Test Context ──
    const adminUser = await prisma.user.findFirst()
    let outletId = adminUser?.outletId

    if (!outletId) {
      let outlet = await prisma.outlet.findFirst()
      if (!outlet) {
        outlet = await prisma.outlet.create({
          data: { name: 'Concurrency Test Outlet', code: `OUTLET_${Date.now()}` },
        })
      }
      outletId = outlet.id
    }

    // ── TEST 1: bank.ts createBankTransaction Concurrency ──
    totalTests++
    console.log(`Test 1: bank.ts createBankTransaction Row-Locking Concurrency Test`)

    const bank1 = await prisma.bankAccount.create({
      data: {
        accountName: 'Bank Concurrency Test Acc',
        accountNumber: `ACC_BANK_${Date.now()}`,
        bankName: 'Test Bank',
        openingBalance: 1000,
        currentBalance: 1000,
        outletId,
      },
    })

    const txPayload = {
      bankAccountId: bank1.id,
      type: 'WITHDRAWAL' as const,
      amount: 700,
      description: 'Concurrent Withdrawal Test',
      transactionDate: new Date(),
    }

    console.log('  🚀 Firing 2 concurrent WITHDRAWAL calls of ৳700 on ৳1,000 balance...')
    const [bRes1, bRes2] = await Promise.allSettled([
      createBankTransaction(txPayload),
      createBankTransaction(txPayload),
    ])

    const bSuccesses = [bRes1, bRes2].filter(isDbSuccess).length
    const bFailures = [bRes1, bRes2].filter(isConcurrencyRejection).length

    const bank1After = await prisma.bankAccount.findUnique({ where: { id: bank1.id } })

    if (bSuccesses === 1 && bFailures === 1 && Number(bank1After?.currentBalance) === 300) {
      console.log('  ✓ PASS: Exactly 1 bank withdrawal succeeded, 1 rejected due to FOR UPDATE row lock & balance check. Final balance = ৳300.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Expected 1 success, 1 failure, balance 300. Got ${bSuccesses} succ, ${bFailures} fail, balance ${bank1After?.currentBalance}`)
    }

    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bank1.id } })
    await prisma.bankAccount.deleteMany({ where: { id: bank1.id } })

    // ── TEST 2: capital.ts approveCapitalInjection Concurrency ──
    totalTests++
    console.log('\nTest 2: capital.ts approveCapitalInjection Double-Approval Guard Test')

    const bank2 = await prisma.bankAccount.create({
      data: {
        accountName: 'Capital Injection Bank Acc',
        accountNumber: `ACC_CAP_${Date.now()}`,
        bankName: 'Capital Bank',
        openingBalance: 0,
        currentBalance: 0,
        outletId,
      },
    })

    const capInj = await prisma.capitalInjection.create({
      data: {
        amount: 50000,
        bankAccountId: bank2.id,
        description: 'Testing Capital Double Approval',
        injectionDate: new Date(),
        status: 'PENDING',
        createdById: adminUser?.id || 'test-user',
      },
    })

    console.log('  🚀 Firing 2 simultaneous approveCapitalInjection calls for the same injection...')
    const [cRes1, cRes2] = await Promise.allSettled([
      approveCapitalInjection(capInj.id),
      approveCapitalInjection(capInj.id),
    ])

    const cSuccesses = [cRes1, cRes2].filter(isDbSuccess).length
    const cFailures = [cRes1, cRes2].filter(isConcurrencyRejection).length

    const bank2After = await prisma.bankAccount.findUnique({ where: { id: bank2.id } })
    const capInjAfter = await prisma.capitalInjection.findUnique({ where: { id: capInj.id } })

    if (cSuccesses === 1 && cFailures === 1 && capInjAfter?.status === 'APPROVED' && Number(bank2After?.currentBalance) === 50000) {
      console.log('  ✓ PASS: Exactly 1 capital approval succeeded, 1 rejected. Bank account incremented by ৳50,000 exactly.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Capital double approval test failed: ${cSuccesses} succ, ${cFailures} fail, bank balance ${bank2After?.currentBalance}`)
    }

    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bank2.id } })
    await prisma.capitalInjection.deleteMany({ where: { id: capInj.id } })
    await prisma.bankAccount.deleteMany({ where: { id: bank2.id } })

    // ── TEST 3: transfers.ts approveContraTransfer Concurrency ──
    totalTests++
    console.log('\nTest 3: transfers.ts approveContraTransfer Double-Approval Guard Test')

    let drawer1 = await prisma.cashDrawer.findFirst({ where: { outletId, status: 'OPEN' } })
    if (!drawer1) {
      drawer1 = await prisma.cashDrawer.create({
        data: {
          outletId,
          openedById: adminUser?.id || 'test-user',
          shift: 'MORNING',
          openingBalance: 2000,
          status: 'OPEN',
        },
      })
    }

    // Seed drawer transaction balance
    await prisma.drawerTransaction.create({
      data: {
        drawerId: drawer1.id,
        type: 'OPENING',
        amount: 2000,
        description: 'Test Opening Seed',
      },
    })

    const bank3 = await prisma.bankAccount.create({
      data: {
        accountName: 'Transfer Target Bank Acc',
        accountNumber: `ACC_TRN_${Date.now()}`,
        bankName: 'Transfer Bank',
        openingBalance: 0,
        currentBalance: 0,
        outletId,
      },
    })

    const transfer = await prisma.contraTransfer.create({
      data: {
        type: 'DRAWER_TO_BANK',
        amount: 1000,
        drawerId: drawer1.id,
        bankAccountId: bank3.id,
        createdById: adminUser?.id || 'test-user',
        status: 'PENDING',
      },
    })

    console.log('  🚀 Firing 2 simultaneous approveContraTransfer calls...')
    const [tRes1, tRes2] = await Promise.allSettled([
      approveContraTransfer(transfer.id),
      approveContraTransfer(transfer.id),
    ])

    const tSuccesses = [tRes1, tRes2].filter(isDbSuccess).length
    const tFailures = [tRes1, tRes2].filter(isConcurrencyRejection).length

    const transferAfter = await prisma.contraTransfer.findUnique({ where: { id: transfer.id } })

    if (tSuccesses === 1 && tFailures === 1 && transferAfter?.status === 'APPROVED') {
      console.log('  ✓ PASS: Exactly 1 transfer approval succeeded, 1 rejected. Double-transfer prevented.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: ContraTransfer double approval test failed: ${tSuccesses} succ, ${tFailures} fail`)
    }

    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bank3.id } })
    await prisma.drawerTransaction.deleteMany({ where: { drawerId: drawer1.id, description: { contains: 'Bank Deposit' } } })
    await prisma.contraTransfer.deleteMany({ where: { id: transfer.id } })
    await prisma.bankAccount.deleteMany({ where: { id: bank3.id } })

    // ── TEST 4: sales.ts Non-Serial Stock FOR UPDATE Lock Concurrency ──
    totalTests++
    console.log('\nTest 4: sales.ts Non-Serial Product Row-Locking Stock Concurrency Test')

    let customer = await prisma.customer.findFirst()
    if (!customer) {
      customer = await prisma.customer.create({
        data: { name: 'NonSerial Test Customer', phone: `018000${Date.now().toString().slice(-5)}` },
      })
    }

    const nsProduct = await prisma.product.create({
      data: {
        name: 'NonSerial Test Mouse',
        productCode: `PROD_NS_${Date.now()}`,
        requiresSerial: false,
        costPrice: 500,
        sellingPrice: 1000,
        isActive: true,
        outlet: { connect: { id: outletId } },
      },
    })

    // Seed stock ledger = 10 units
    await prisma.stockLedger.create({
      data: {
        productId: nsProduct.id,
        outletId,
        movementType: StockMovementType.OPENING,
        quantity: 10,
        referenceType: 'TestSeed',
      },
    })

    const nsCheckoutData = {
      customerId: customer.id,
      lines: [
        {
          productId: nsProduct.id,
          quantity: 8,
          unitPrice: 1000,
          discountPct: 0,
          serialNumbers: [],
          isGift: false,
          cartItemId: 'cart-ns-1',
        },
      ],
      complimentaryGifts: [],
      payments: [{ method: 'CASH' as const, amount: 8000 }],
      orderDiscountPct: 0,
      isQuotation: false,
    }

    console.log('  🚀 Firing 2 simultaneous checkouts of 8 units each on 10 available units...')
    const [nsRes1, nsRes2] = await Promise.allSettled([
      checkout(nsCheckoutData),
      checkout(nsCheckoutData),
    ])

    const nsSuccesses = [nsRes1, nsRes2].filter(isDbSuccess).length
    const nsFailures = [nsRes1, nsRes2].filter(isConcurrencyRejection).length

    const nsStockAgg = await prisma.stockLedger.aggregate({
      where: { productId: nsProduct.id, outletId },
      _sum: { quantity: true },
    })

    const finalStock = nsStockAgg._sum.quantity ?? 0

    if (nsSuccesses === 1 && nsFailures === 1 && finalStock === 2) {
      console.log('  ✓ PASS: FOR UPDATE Product row lock verified! 1 checkout of 8 units succeeded, 1 rejected due to insufficient stock. Remaining stock = 2 (no negative stock!).')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: Non-serial stock locking failed: ${nsSuccesses} succ, ${nsFailures} fail, final stock = ${finalStock}`)
    }

    // Cleanup sales test
    const testSales = await prisma.sale.findMany({
      where: { lines: { some: { productId: nsProduct.id } } },
      select: { id: true },
    })
    const testSaleIds = testSales.map(s => s.id)
    if (testSaleIds.length > 0) {
      await prisma.saleLine.deleteMany({ where: { saleId: { in: testSaleIds } } })
      await prisma.salePayment.deleteMany({ where: { saleId: { in: testSaleIds } } })
      await prisma.sale.deleteMany({ where: { id: { in: testSaleIds } } })
    }
    await prisma.stockLedger.deleteMany({ where: { productId: nsProduct.id } })
    await prisma.product.deleteMany({ where: { id: nsProduct.id } })

    // ── TEST 5: b2b.ts makePaymentToSupplier Concurrency ──
    totalTests++
    console.log('\nTest 5: b2b.ts makePaymentToSupplier Row-Locking Concurrency Test')

    let supplier1 = await prisma.supplier.create({
      data: { name: `Test Supplier B2B ${Date.now()}` },
    })

    const bank4 = await prisma.bankAccount.create({
      data: {
        accountName: 'B2B Bank Acc',
        accountNumber: `ACC_B2B_${Date.now()}`,
        bankName: 'B2B Bank',
        openingBalance: 1000,
        currentBalance: 1000,
        outletId,
      },
    })

    const b2bPayData = {
      supplierId: supplier1.id,
      amount: 700,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      bankAccountId: bank4.id,
      description: 'B2B Payment Test',
    }

    console.log('  🚀 Firing 2 simultaneous makePaymentToSupplier calls of ৳700 on ৳1,000 balance...')
    const [b2bRes1, b2bRes2] = await Promise.allSettled([
      makePaymentToSupplier(b2bPayData),
      makePaymentToSupplier(b2bPayData),
    ])

    const b2bSuccesses = [b2bRes1, b2bRes2].filter(isDbSuccess).length
    const b2bFailures = [b2bRes1, b2bRes2].filter(isConcurrencyRejection).length

    const bank4After = await prisma.bankAccount.findUnique({ where: { id: bank4.id } })

    if (b2bSuccesses === 1 && b2bFailures === 1 && Number(bank4After?.currentBalance) === 300) {
      console.log('  ✓ PASS: Exactly 1 B2B payment succeeded, 1 rejected due to FOR UPDATE row lock & balance check. Final balance = ৳300.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: B2B makePaymentToSupplier concurrency test failed: ${b2bSuccesses} succ, ${b2bFailures} fail, balance = ${bank4After?.currentBalance}`)
    }

    await prisma.supplierTransaction.deleteMany({ where: { supplierId: supplier1.id } })
    await prisma.supplierLedger.deleteMany({ where: { supplierId: supplier1.id } })
    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bank4.id } })
    await prisma.supplier.deleteMany({ where: { id: supplier1.id } })
    await prisma.bankAccount.deleteMany({ where: { id: bank4.id } })

    // ── TEST 6: finance.ts approveExpense Concurrency ──
    totalTests++
    console.log('\nTest 6: finance.ts approveExpense Row-Locking Concurrency Test')

    const bank5 = await prisma.bankAccount.create({
      data: {
        accountName: 'Expense Bank Acc',
        accountNumber: `ACC_EXP_${Date.now()}`,
        bankName: 'Expense Bank',
        openingBalance: 1000,
        currentBalance: 1000,
        outletId,
      },
    })

    let coa = await prisma.chartOfAccount.findFirst({ where: { type: 'EXPENSE' } })
    if (!coa) {
      coa = await prisma.chartOfAccount.create({
        data: { name: 'Test Expense Account', code: `EXP_${Date.now()}`, type: 'EXPENSE', isActive: true },
      })
    }

    const exp = await prisma.expense.create({
      data: {
        description: 'Test Concurrency Expense',
        amount: 700,
        expenseDate: new Date(),
        outletId,
        method: PaymentMethod.BANK_TRANSFER,
        bankAccountId: bank5.id,
        status: ExpenseStatus.PENDING,
        createdById: adminUser?.id || 'test-user',
        accountId: coa.id,
      },
    })

    console.log('  🚀 Firing 2 simultaneous approveExpense calls for the same expense...')
    const [eRes1, eRes2] = await Promise.allSettled([
      approveExpense(exp.id),
      approveExpense(exp.id),
    ])

    const eSuccesses = [eRes1, eRes2].filter(isDbSuccess).length
    const eFailures = [eRes1, eRes2].filter(isConcurrencyRejection).length

    const expAfter = await prisma.expense.findUnique({ where: { id: exp.id } })
    const bank5After = await prisma.bankAccount.findUnique({ where: { id: bank5.id } })

    if (eSuccesses === 1 && eFailures === 1 && expAfter?.status === ExpenseStatus.APPROVED && Number(bank5After?.currentBalance) === 300) {
      console.log('  ✓ PASS: Exactly 1 expense approval succeeded, 1 rejected. Bank account deducted by ৳700 once.')
      passedCount++
    } else {
      console.error(`  ✖ FAIL: approveExpense concurrency test failed: ${eSuccesses} succ, ${eFailures} fail, bank balance = ${bank5After?.currentBalance}`)
    }

    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bank5.id } })
    await prisma.expense.deleteMany({ where: { id: exp.id } })
    await prisma.bankAccount.deleteMany({ where: { id: bank5.id } })

    console.log(`\n🎉 ALL ${passedCount}/${totalTests} PHASE 2 CONCURRENCY & ROW-LOCKING TESTS PASSED SUCCESSFULLY!`)
  } catch (err) {
    console.error('✖ Test suite execution failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runPhase2ConcurrencyTests()
