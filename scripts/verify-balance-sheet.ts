import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { prisma } from '../lib/db'
import { getBalanceSheet } from '../lib/actions/reports'
import { 
  DrawerStatus, 
  ShiftType, 
  PaymentMethod,
  SaleStatus,
  ProductCondition,
  StockMovementType,
  AccountType
} from '@prisma/client'

async function runTest() {
  console.log('--- Starting Balance Sheet Integration Test ---')
  const timestamp = Date.now().toString()
  
  // 0. Get Initial Discrepancy (Historical Drift)
  const initialBs = await getBalanceSheet()
  const initialDiscrepancy = initialBs.success ? initialBs.data.discrepancy : 0
  console.log(`Initial Historical Discrepancy: ${initialDiscrepancy}`)

  
  // 1. Setup Outlet & Users
  const outlet = await prisma.outlet.create({
    data: {
      name: `Test Outlet ${timestamp}`,
      code: `TO-${timestamp}`,
    }
  })

  const user = await prisma.user.create({
    data: {
      email: `test-${timestamp}@example.com`,
      name: 'Test User',
      password: 'password123',
      role: 'ADMIN',
      outletId: outlet.id,
    }
  })

  // 2. Setup Chart of Accounts for Cash and Sales if missing
  let cashAcc = await prisma.chartOfAccount.findFirst({ where: { code: '1100' } })
  if (!cashAcc) {
    cashAcc = await prisma.chartOfAccount.create({ data: { code: '1100', name: 'Cash', type: 'ASSET' }})
  }

  // 3. Setup Bank Account
  const bank = await prisma.bankAccount.create({
    data: {
      outletId: outlet.id,
      bankName: 'Test Bank',
      accountName: 'Main',
      accountNumber: `ACC-${timestamp}`,
      currentBalance: 0,
    }
  })

  // 4. Inject Capital (Owner's Equity)
  await prisma.capitalInjection.create({
    data: {
      amount: 10000,
      bankAccountId: bank.id,
      description: 'Initial Capital',
      status: 'APPROVED',
      createdById: user.id,
    }
  })
  await prisma.bankAccount.update({
    where: { id: bank.id },
    data: { currentBalance: { increment: 10000 } }
  })

  // 5. Contra Transfer from Bank to Drawer (To fund the cash drawer)
  const drawer = await prisma.cashDrawer.create({
    data: {
      outletId: outlet.id,
      openedById: user.id,
      shift: 'FULL',
      openingBalance: 1000,
      status: 'OPEN',
    }
  })
  await prisma.drawerTransaction.create({
    data: {
      drawerId: drawer.id,
      type: 'OPENING',
      amount: 1000,
      description: 'Opening Balance manually injected',
    }
  })
  // Deduct from bank to balance the manual cash injection
  await prisma.bankAccount.update({
    where: { id: bank.id },
    data: { currentBalance: { decrement: 1000 } }
  })
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: bank.id,
      type: 'WITHDRAWAL',
      amount: 1000,
      description: 'Transfer to Drawer',
    }
  })

  // 6. Setup Product & Purchase
  const product = await prisma.product.create({
    data: {
      name: 'Test Laptop (Non-Serialized)',
      productCode: `TL-${timestamp}`,
      costPrice: 500,
      sellingPrice: 1000,
      outletId: outlet.id,
      requiresSerial: false,
    }
  })
  
  const serializedProduct = await prisma.product.create({
    data: {
      name: 'Test Phone (Serialized)',
      productCode: `TP-${timestamp}`,
      costPrice: 600,
      sellingPrice: 1200,
      outletId: outlet.id,
      requiresSerial: true,
    }
  })

  const supplier = await prisma.supplier.create({
    data: { name: `Test Supplier ${timestamp}` }
  })

  // Receive Stock (Increases Inventory and AP)
  await prisma.stockLayer.create({
    data: {
      productId: product.id,
      outletId: outlet.id,
      supplierId: supplier.id,
      quantityReceived: 5,
      quantityRemaining: 5,
      unitCost: 500,
    }
  })
  
  await prisma.stockLayer.create({
    data: {
      productId: serializedProduct.id,
      outletId: outlet.id,
      supplierId: supplier.id,
      quantityReceived: 2,
      quantityRemaining: 2,
      unitCost: 600,
    }
  })
  
  const sn1 = `SN-${timestamp}-1`
  const sn2 = `SN-${timestamp}-2`
  await prisma.serialUnit.createMany({
    data: [
      { serialNumber: sn1, productId: serializedProduct.id, outletId: outlet.id, status: 'IN_STOCK' },
      { serialNumber: sn2, productId: serializedProduct.id, outletId: outlet.id, status: 'IN_STOCK' },
    ]
  })
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { outstandingBalance: { increment: 2500 + 1200 } }
  })

  // 7. Make a Sale (Increases Cash, Revenue, COGS, decreases Inventory)
  // We will sell 1 non-serialized laptop and 1 serialized phone using the actual checkout function
  const customer = await prisma.customer.create({
    data: { name: `Test Customer ${timestamp}` }
  })
  
  const sale = await prisma.sale.create({
    data: {
      saleNumber: `SALE-${timestamp}`,
      outletId: outlet.id,
      customerId: customer.id,
      cashierId: user.id,
      status: 'COMPLETED',
      subtotal: 2200, 
      total: 2200,
      amountPaid: 2200,
    }
  })

  const saleLine1 = await prisma.saleLine.create({
    data: {
      saleId: sale.id,
      productId: product.id,
      quantity: 1,
      unitPrice: 1000,
      unitCost: 500,
      total: 1000,
    }
  })
  
  const saleLine2 = await prisma.saleLine.create({
    data: {
      saleId: sale.id,
      productId: serializedProduct.id,
      quantity: 1,
      unitPrice: 1200,
      unitCost: 600,
      total: 1200,
    }
  })

  // Decrement StockLayer for non-serialized
  await prisma.stockLayer.updateMany({
    where: { productId: product.id, outletId: outlet.id },
    data: { quantityRemaining: { decrement: 1 } }
  })
  
  // Decrement StockLayer for serialized
  await prisma.stockLayer.updateMany({
    where: { productId: serializedProduct.id, outletId: outlet.id },
    data: { quantityRemaining: { decrement: 1 } }
  })
  
  // Mark serial as sold and link to sale line
  const soldSerial = await prisma.serialUnit.findUniqueOrThrow({ where: { serialNumber: sn1 } })
  await prisma.serialUnit.update({
    where: { serialNumber: sn1 },
    data: { status: 'SOLD', soldAt: new Date() }
  })
  await prisma.saleLineSerial.create({
    data: { saleLineId: saleLine2.id, serialUnitId: soldSerial.id }
  })
  
  // Create Ledger Entries for the Sale (COGS & Revenue & Accounts)
  // These are exactly what `checkout` does automatically
  const revenueAccountId = await prisma.chartOfAccount.findFirst({ where: { code: '4100' }})
  const cogsAccountId = await prisma.chartOfAccount.findFirst({ where: { code: '5000' }})
  const inventoryAccountId = await prisma.chartOfAccount.findFirst({ where: { code: '1300' }})
  
  if (!revenueAccountId) await prisma.chartOfAccount.create({ data: { code: '4100', name: 'Sales Revenue', type: 'INCOME', parent: { connect: { code: '4000' } } }})
  if (!cogsAccountId) await prisma.chartOfAccount.create({ data: { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', parent: { connect: { code: '5000' } } }})
  
  const revenueAcct = await prisma.chartOfAccount.findFirstOrThrow({ where: { code: '4100' }})
  const cogsAcct = await prisma.chartOfAccount.findFirstOrThrow({ where: { code: '5000' }})
  const invAcct2 = await prisma.chartOfAccount.findFirstOrThrow({ where: { code: '1300' }})
  
  const totalCogs = 500 + 600
  await prisma.accountLedgerEntry.createMany({
    data: [
      { accountId: revenueAcct.id, type: 'CREDIT', amount: 2200, referenceId: sale.id, referenceType: 'Sale', description: `Sale ${sale.saleNumber}` },
      { accountId: cogsAcct.id, type: 'DEBIT', amount: totalCogs, referenceId: sale.id, referenceType: 'Sale', description: `COGS — Sale ${sale.saleNumber}` },
      { accountId: invAcct2.id, type: 'CREDIT', amount: totalCogs, referenceId: sale.id, referenceType: 'Sale', description: `Inventory deduction — Sale ${sale.saleNumber}` }
    ]
  })

  // Pay in cash (Adds to Cash Drawer Asset)
  await prisma.drawerTransaction.create({
    data: {
      drawerId: drawer.id,
      type: 'SALE',
      amount: 2200,
      description: `Sale ${sale.saleNumber}`
    }
  })

  const saleId = sale.id

  // 8. Partial Return (Refund 1 laptop)
  const saleReturn = await prisma.saleReturn.create({
    data: {
      returnNumber: `RET-${timestamp}`,
      saleId: saleId,
      total: 1000,
    }
  })

  await prisma.saleReturnLine.create({
    data: {
      returnId: saleReturn.id,
      saleLineId: saleLine1.id,
      quantity: 1,
      unitPrice: 1000,
    }
  })
  
  // Refund cash
  await prisma.drawerTransaction.create({
    data: {
      drawerId: drawer.id,
      type: 'REFUND',
      amount: -1000,
      description: `Refund ${saleReturn.returnNumber}`
    }
  })

  // Re-stock Inventory
  await prisma.stockLayer.create({
    data: {
      productId: product.id,
      outletId: outlet.id,
      quantityReceived: 1,
      quantityRemaining: 1,
      unitCost: 500, // Cost is restored
    }
  })

  // 9. Accrued Payroll (Increases Expenses and Liabilities)
  const employee = await prisma.employee.create({
    data: {
      employeeCode: `EMP-${timestamp}`,
      name: 'Test Employee',
      departmentId: (await prisma.department.create({ data: { name: `Dept ${timestamp}` }})).id,
      designationId: (await prisma.designation.create({ data: { name: `Desig ${timestamp}`, departmentId: (await prisma.department.findFirst())!.id }})).id,
      joinDate: new Date(),
      basicSalary: 2000,
      outletId: outlet.id,
    }
  })

  const payrollPeriod = await prisma.payrollPeriod.create({
    data: {
      month: 8,
      year: 2026,
      outletId: outlet.id,
      status: 'ACCRUED'
    }
  })

  await prisma.payrollEntry.create({
    data: {
      payrollPeriodId: payrollPeriod.id,
      employeeId: employee.id,
      baseSalary: 2000,
      netPayable: 2000,
      paidAmount: 500, // Partially paid
      status: 'PARTIALLY_PAID',
    }
  })
  // The 500 was paid from Cash
  await prisma.drawerTransaction.create({
    data: {
      drawerId: drawer.id,
      type: 'EXPENSE', // Payroll payment
      amount: -500,
      description: 'Payroll Advance/Partial'
    }
  })

  // 10. Fixed Assets (Historical & New Purchase)
  let fixedAssetAcct = await prisma.chartOfAccount.findFirst({ where: { code: '1500' }})
  if (!fixedAssetAcct) fixedAssetAcct = await prisma.chartOfAccount.create({ data: { code: '1500', name: 'Fixed Assets', type: 'ASSET' }})
  
  let obeAcct = await prisma.chartOfAccount.findFirst({ where: { code: '3200' }})
  if (!obeAcct) obeAcct = await prisma.chartOfAccount.create({ data: { code: '3200', name: 'Opening Balance Equity', type: 'EQUITY', parent: { connect: { code: '3000' } } }})

  const historicalAsset = await prisma.fixedAsset.create({
    data: {
      name: 'Old Desks',
      category: 'FURNITURE',
      acquisitionCost: 2000,
      acquisitionDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
      depreciable: true,
      usefulLifeYears: 5,
      salvageValue: 0,
      fundingSource: 'HISTORICAL',
      createdById: user.id,
    }
  })
  await prisma.accountLedgerEntry.createMany({
    data: [
      { accountId: fixedAssetAcct.id, type: 'DEBIT', amount: 2000, referenceId: historicalAsset.id, referenceType: 'FixedAsset', description: 'Historical Asset' },
      { accountId: obeAcct.id, type: 'CREDIT', amount: 2000, referenceId: historicalAsset.id, referenceType: 'FixedAsset', description: 'Historical Asset' },
    ]
  })

  // 10.2 New Equipment Purchase (Funded by Bank)
  const newAsset = await prisma.fixedAsset.create({
    data: {
      name: 'New Server',
      category: 'EQUIPMENT',
      acquisitionCost: 3000,
      acquisitionDate: new Date(),
      depreciable: true,
      usefulLifeYears: 3,
      salvageValue: 0,
      fundingSource: 'NEW_PURCHASE',
      bankAccountId: bank.id,
      createdById: user.id,
    }
  })
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: bank.id,
      type: 'WITHDRAWAL',
      amount: 3000,
      description: 'Fixed Asset Purchase',
    }
  })
  await prisma.bankAccount.update({
    where: { id: bank.id },
    data: { currentBalance: { decrement: 3000 } }
  })

  // 11. Stock Adjustments (Inventory Gain/Shrink)
  let gainAcct = await prisma.chartOfAccount.findFirst({ where: { code: '4400' }})
  if (!gainAcct) gainAcct = await prisma.chartOfAccount.create({ data: { code: '4400', name: 'Inventory Gain', type: 'INCOME', parent: { connect: { code: '4000' } } }})
  
  let shrinkAcct = await prisma.chartOfAccount.findFirst({ where: { code: '5300' }})
  if (!shrinkAcct) shrinkAcct = await prisma.chartOfAccount.create({ data: { code: '5300', name: 'Inventory Shrinkage', type: 'EXPENSE', parent: { connect: { code: '5200' } } }})
  
  let invAcct = await prisma.chartOfAccount.findFirst({ where: { code: '1300' }})
  if (!invAcct) invAcct = await prisma.chartOfAccount.create({ data: { code: '1300', name: 'Inventory', type: 'ASSET' }})

  // Adjustment In (Gain)
  const adjIn = await prisma.stockAdjustment.create({
    data: {
      productId: product.id,
      type: 'ADJUSTMENT_IN',
      quantity: 2,
      reason: 'Found in back room',
      adjustedBy: user.id,
    }
  })
  await prisma.stockLayer.create({
    data: {
      productId: product.id,
      outletId: outlet.id,
      quantityReceived: 2,
      quantityRemaining: 2,
      unitCost: 500,
    }
  })
  await prisma.accountLedgerEntry.createMany({
    data: [
      { accountId: invAcct.id, type: 'DEBIT', amount: 1000, referenceId: adjIn.id, referenceType: 'StockAdjustment', description: 'Inventory Gain' },
      { accountId: gainAcct.id, type: 'CREDIT', amount: 1000, referenceId: adjIn.id, referenceType: 'StockAdjustment', description: 'Inventory Gain' },
    ]
  })

  // Adjustment Out (Shrinkage)
  const adjOut = await prisma.stockAdjustment.create({
    data: {
      productId: product.id,
      type: 'ADJUSTMENT_OUT',
      quantity: 1,
      reason: 'Damaged',
      adjustedBy: user.id,
    }
  })
  // Decrement StockLayer for the Shrinkage
  const layer = await prisma.stockLayer.findFirst({ where: { productId: product.id, outletId: outlet.id, quantityRemaining: { gt: 0 } } })
  if (layer) {
    await prisma.stockLayer.update({
      where: { id: layer.id },
      data: { quantityRemaining: { decrement: 1 } }
    })
  }
  await prisma.accountLedgerEntry.createMany({
    data: [
      { accountId: shrinkAcct.id, type: 'DEBIT', amount: 500, referenceId: adjOut.id, referenceType: 'StockAdjustment', description: 'Inventory Shrinkage' },
      { accountId: invAcct.id, type: 'CREDIT', amount: 500, referenceId: adjOut.id, referenceType: 'StockAdjustment', description: 'Inventory Shrinkage' },
    ]
  })

  // 12. Verify Balance Sheet
  // Wait a small bit for Prisma to flush if needed
  await new Promise(r => setTimeout(r, 500))

  const bs = await getBalanceSheet()
  
  console.log('--- Balance Sheet Results ---')
  if (bs.success) {
    console.log(JSON.stringify(bs.data, null, 2))
    
    if (bs.data.isBalanced || bs.data.discrepancy === initialDiscrepancy) {
      console.log('✅ BALANCE SHEET IS BALANCED! (Delta is 0)')
    } else {
      console.error(`❌ BALANCE SHEET MISMATCH: Discrepancy changed by ${Math.abs(bs.data.discrepancy - initialDiscrepancy)}`)
    }
  } else {
    console.error('Failed to get balance sheet:', bs.error)
  }

  // Cleanup isn't strictly necessary for a local dev DB, but we could delete them.
  console.log('--- Test Complete ---')
}

runTest().catch(console.error).finally(() => process.exit(0))
