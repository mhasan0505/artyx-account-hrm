import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

import { PaymentMethod, SerialStatus, ShiftType, UserRole } from '@prisma/client'

async function runPhase9ServiceTests() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { prisma } = await import('../lib/db')
  const { createServiceJob, createServiceInvoice, deleteServiceJob } = await import(
    '../lib/actions/service'
  )

  console.log('🧪 Starting Phase 9 Service Integrity Test Suite...\n')

  const outlet = await prisma.outlet.findFirst()
  if (!outlet) throw new Error('No outlet found in DB')

  const adminUser = await prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN } })
  if (!adminUser) throw new Error('No admin user found in DB')

  // Setup test customer, non-serialized product + layer, serialized product + serialUnit, open cash drawer, bank account
  const customer = await prisma.customer.create({
    data: {
      name: `Phase 9 Customer ${Date.now()}`,
      phone: `01900${Math.floor(100000 + Math.random() * 900000)}`,
      outstandingBalance: 0,
    },
  })

  const nonSerialProduct = await prisma.product.create({
    data: {
      name: `RAM Part ${Date.now()}`,
      productCode: `RAM-${Date.now()}`,
      costPrice: 2000,
      sellingPrice: 3000,
      requiresSerial: false,
      outletId: outlet.id,
    },
  })

  const nonSerialLayer = await prisma.stockLayer.create({
    data: {
      productId: nonSerialProduct.id,
      outletId: outlet.id,
      quantityReceived: 10,
      quantityRemaining: 10,
      unitCost: 2000,
      receivedAt: new Date(),
    },
  })

  const serialProduct = await prisma.product.create({
    data: {
      name: `SSD Serial Part ${Date.now()}`,
      productCode: `SSD-${Date.now()}`,
      costPrice: 4000,
      sellingPrice: 5500,
      requiresSerial: true,
      outletId: outlet.id,
    },
  })

  const testSerialNo = `SN-P9-${Date.now()}`
  const serialUnit = await prisma.serialUnit.create({
    data: {
      serialNumber: testSerialNo,
      productId: serialProduct.id,
      outletId: outlet.id,
      status: SerialStatus.IN_STOCK,
    },
  })

  // Create an open CashDrawer for the outlet
  const drawer = await prisma.cashDrawer.create({
    data: {
      outletId: outlet.id,
      openedById: adminUser.id,
      openingBalance: 1000,
      shift: ShiftType.MORNING,
      status: 'OPEN',
    },
  })

  // Create a BankAccount for bank payment testing
  const bankAccount = await prisma.bankAccount.create({
    data: {
      accountName: `Phase 9 Bank ${Date.now()}`,
      accountNumber: `ACC-${Date.now()}`,
      bankName: 'Test Bank',
      outletId: outlet.id,
      currentBalance: 5000,
    },
  })

  try {
    // -------------------------------------------------------------
    // Test 1: Service Job Creation & Outlet Scoping
    // -------------------------------------------------------------
    console.log('Test 1: Service Job Creation & Outlet Scoping')
    const jobRes = await createServiceJob({
      customerId: customer.id,
      outletId: outlet.id,
      device: 'MacBook Pro M1',
      issue: 'Screen replacement and SSD upgrade',
      estimatedCost: 10000,
    })

    if (!jobRes.success) {
      throw new Error(`createServiceJob failed: ${jobRes.error}`)
    }
    const job = jobRes.data
    console.log(`  - Created Service Job ${job.jobNumber} (ID: ${job.id})`)
    if (job.outletId !== outlet.id) {
      throw new Error(`Expected outletId ${outlet.id}, got ${job.outletId}`)
    }
    console.log('✓ Service ticket created with forced server-side outletId!\n')

    // -------------------------------------------------------------
    // Test 2: Invoice Creation (Parts, Cash Drawer, Bank Balance, Customer Due)
    // -------------------------------------------------------------
    console.log('Test 2: Invoice Creation Integration (Parts + Cash/Bank Payment + Customer Due)')
    // Labor: ৳2,000
    // Part 1: Non-serialized RAM (2 units @ ৳2,000 = ৳4,000)
    // Part 2: Serialized SSD (1 unit @ ৳4,000 = ৳4,000)
    // Total = ৳10,000
    // Payment 1: Cash ৳3,000
    // Payment 2: Bank ৳2,000
    // Total Paid = ৳5,000 -> Customer Due = ৳5,000

    const invRes = await createServiceInvoice({
      jobId: job.id,
      laborCost: 2000,
      parts: [
        { productId: nonSerialProduct.id, quantity: 2, unitCost: 2000 },
        { productId: serialProduct.id, serialNumber: testSerialNo, quantity: 1, unitCost: 4000 },
      ],
      payments: [
        { method: PaymentMethod.CASH, amount: 3000 },
        { method: PaymentMethod.BANK_TRANSFER, amount: 2000, bankAccountId: bankAccount.id },
      ],
    })

    if (!invRes.success) {
      throw new Error(`createServiceInvoice failed: ${invRes.error}`)
    }
    const inv = invRes.data
    console.log(`  - Created Service Invoice ${inv.invoiceNumber} (Total: ৳${inv.total}, Paid: ৳${inv.amountPaid})`)

    // Verify non-serialized StockLayer remaining: 10 - 2 = 8
    const updatedLayer = await prisma.stockLayer.findUnique({ where: { id: nonSerialLayer.id } })
    if (updatedLayer?.quantityRemaining !== 8) {
      throw new Error(`Expected non-serialized layer remaining = 8, got ${updatedLayer?.quantityRemaining}`)
    }
    console.log(`  - Non-serialized StockLayer decremented cleanly (Remaining: 8)`)

    // Verify serialized SerialUnit status: IN_SERVICE
    const updatedSerial = await prisma.serialUnit.findUnique({ where: { id: serialUnit.id } })
    if (updatedSerial?.status !== SerialStatus.IN_SERVICE) {
      throw new Error(`Expected serial status IN_SERVICE, got ${updatedSerial?.status}`)
    }
    console.log(`  - SerialUnit status updated to IN_SERVICE`)

    // Verify DrawerTransaction
    const drawerTx = await prisma.drawerTransaction.findFirst({ where: { drawerId: drawer.id } })
    if (!drawerTx || Number(drawerTx.amount) !== 3000) {
      throw new Error(`Expected DrawerTransaction amount 3000, got ${drawerTx?.amount}`)
    }
    console.log(`  - Cash payment hit CashDrawer (DrawerTransaction ৳3,000 recorded)`)

    // Verify BankTransaction & BankAccount balance: 5000 + 2000 = 7000
    const updatedBank = await prisma.bankAccount.findUnique({ where: { id: bankAccount.id } })
    if (Number(updatedBank?.currentBalance) !== 7000) {
      throw new Error(`Expected bank balance = 7000, got ${updatedBank?.currentBalance}`)
    }
    const bankTx = await prisma.bankTransaction.findFirst({ where: { bankAccountId: bankAccount.id } })
    if (!bankTx || Number(bankTx.amount) !== 2000) {
      throw new Error(`Expected BankTransaction amount 2000, got ${bankTx?.amount}`)
    }
    console.log(`  - Bank payment hit BankAccount (New balance: ৳7,000, BankTransaction recorded)`)

    // Verify Customer Due & CustomerLedger: 5000
    const updatedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } })
    if (Number(updatedCustomer?.outstandingBalance) !== 5000) {
      throw new Error(`Expected customer due = 5000, got ${updatedCustomer?.outstandingBalance}`)
    }
    const customerLedger = await prisma.customerLedger.findFirst({ where: { customerId: customer.id } })
    if (!customerLedger || Number(customerLedger.amount) !== 5000) {
      throw new Error(`Expected CustomerLedger due amount 5000, got ${customerLedger?.amount}`)
    }
    console.log(`  - Unpaid balance recorded as Customer Due (Outstanding: ৳5,000, CustomerLedger recorded)\n`)

    // -------------------------------------------------------------
    // Test 3: Delete Guard on Ticket with Invoice
    // -------------------------------------------------------------
    console.log('Test 3: Delete Guard on Invoiced Service Ticket')
    const delRes = await deleteServiceJob(job.id)
    if (delRes.success) {
      throw new Error('Expected deleteServiceJob to fail when invoice exists!')
    }
    console.log(`✓ Delete ticket with invoice blocked correctly: "${delRes.error}"\n`)

    // -------------------------------------------------------------
    // Test 4: Role Rejection Test for Non-Authorized User
    // -------------------------------------------------------------
    console.log('Test 4: Role Rejection Test for Unauthorized User Role')
    process.env.MOCK_USER_ROLE = 'CASHIER'
    try {
      let threwError = false
      try {
        await createServiceJob({
          customerId: customer.id,
          outletId: outlet.id,
          device: 'Phone',
          issue: 'Test',
        })
      } catch (err: any) {
        threwError = true
        console.log(`✓ Unauthorized CASHIER creation rejected correctly: "${err?.message || err}"\n`)
      }

      if (!threwError) {
        throw new Error('Expected createServiceJob to throw Forbidden for unauthorized CASHIER role!')
      }
    } finally {
      delete process.env.MOCK_USER_ROLE
    }

    // -------------------------------------------------------------
    // Test 5: Serial Consumption Concurrency Guard Test
    // -------------------------------------------------------------
    console.log('Test 5: Serial Consumption Concurrency Guard Test')
    const concurrentSerialNo = `SN-CONC-${Date.now()}`
    await prisma.serialUnit.create({
      data: {
        serialNumber: concurrentSerialNo,
        productId: serialProduct.id,
        outletId: outlet.id,
        status: SerialStatus.IN_STOCK,
      },
    })

    const job2Res = await createServiceJob({
      customerId: customer.id,
      outletId: outlet.id,
      device: 'Laptop 2',
      issue: 'SSD upgrade',
    })
    const job3Res = await createServiceJob({
      customerId: customer.id,
      outletId: outlet.id,
      device: 'Laptop 3',
      issue: 'SSD upgrade',
    })

    if (!job2Res.success || !job3Res.success) throw new Error('Job creation failed')

    // Fire 2 concurrent invoice requests attempting to use the same serial unit
    const [inv2Res, inv3Res] = await Promise.all([
      createServiceInvoice({
        jobId: job2Res.data.id,
        laborCost: 1000,
        parts: [{ productId: serialProduct.id, serialNumber: concurrentSerialNo, quantity: 1, unitCost: 4000 }],
        payments: [],
      }),
      createServiceInvoice({
        jobId: job3Res.data.id,
        laborCost: 1000,
        parts: [{ productId: serialProduct.id, serialNumber: concurrentSerialNo, quantity: 1, unitCost: 4000 }],
        payments: [],
      }),
    ])

    const successCount = [inv2Res, inv3Res].filter(r => r.success).length
    const failCount = [inv2Res, inv3Res].filter(r => !r.success).length

    if (successCount !== 1 || failCount !== 1) {
      throw new Error(`Expected exactly 1 success and 1 fail, got ${successCount} success and ${failCount} fail`)
    }
    console.log('✓ Concurrent double-consumption of serial unit blocked atomically!\n')

    console.log('✅ ALL PHASE 9 SERVICE INTEGRITY TESTS PASSED SUCCESSFULLY!')
  } finally {
    // Cleanup test records
    await prisma.serviceJobPart.deleteMany({ where: { jobId: { in: (await prisma.serviceJob.findMany({ where: { customerId: customer.id } })).map(j => j.id) } } })
    await prisma.servicePayment.deleteMany({})
    await prisma.serviceInvoice.deleteMany({})
    await prisma.serviceJob.deleteMany({ where: { customerId: customer.id } })
    await prisma.drawerTransaction.deleteMany({ where: { drawerId: drawer.id } })
    await prisma.cashDrawer.delete({ where: { id: drawer.id } })
    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: bankAccount.id } })
    await prisma.bankAccount.delete({ where: { id: bankAccount.id } })
    await prisma.customerLedger.deleteMany({ where: { customerId: customer.id } })
    await prisma.customer.delete({ where: { id: customer.id } })
    await prisma.stockLedger.deleteMany({ where: { productId: { in: [nonSerialProduct.id, serialProduct.id] } } })
    await prisma.stockLayer.deleteMany({ where: { productId: nonSerialProduct.id } })
    await prisma.serialUnit.deleteMany({ where: { productId: serialProduct.id } })
    await prisma.product.deleteMany({ where: { id: { in: [nonSerialProduct.id, serialProduct.id] } } })
    await prisma.$disconnect()
  }
}

runPhase9ServiceTests().catch(err => {
  console.error('❌ Phase 9 verification failed:', err)
  process.exit(1)
})
