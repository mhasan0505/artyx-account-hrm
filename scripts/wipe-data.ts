import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function wipeData() {
  console.log('================================================================================')
  console.log('🚨 [DATABASE PURGE ENGINE] Starting Data Wipe...')
  console.log('   Preserving: Products, Categories, Brands, Units, Employees, Outlets, Users, COA')
  console.log('   Deleting  : Sales, Purchases, Service Jobs, GL, Cash Drawer, Bank & Payroll History')
  console.log('================================================================================')

  const initialProducts = await prisma.product.count()
  const initialEmployees = await prisma.employee.count()
  const initialUsers = await prisma.user.count()
  const initialOutlets = await prisma.outlet.count()
  const initialCOA = await prisma.chartOfAccount.count()

  console.log(`\n📋 Pre-Wipe Verification:`)
  console.log(`  - Products Count    : ${initialProducts}`)
  console.log(`  - Employees Count   : ${initialEmployees}`)
  console.log(`  - Users Count       : ${initialUsers}`)
  console.log(`  - Outlets Count     : ${initialOutlets}`)
  console.log(`  - Chart of Accounts : ${initialCOA}\n`)

  await prisma.$transaction(async (tx) => {
    console.log('🗑️  1. Deleting Sales, Returns & Quotations...')
    await tx.saleLineSerial.deleteMany({})
    await tx.saleReturnLine.deleteMany({})
    await tx.saleReturn.deleteMany({})
    await tx.salePayment.deleteMany({})
    await tx.saleEditLog.deleteMany({})
    await tx.saleLine.deleteMany({})
    await tx.quotationLine.deleteMany({})
    await tx.quotation.deleteMany({})
    await tx.sale.deleteMany({})

    console.log('🗑️  2. Deleting Purchases & Supplier Invoices...')
    await tx.purchaseOrderLineSerial.deleteMany({})
    await tx.purchaseReturnLineSerial.deleteMany({})
    await tx.purchaseReturnLine.deleteMany({})
    await tx.purchaseReturn.deleteMany({})
    await tx.purchasePayment.deleteMany({})
    await tx.purchaseInvoiceEditLog.deleteMany({})
    await tx.purchaseInvoice.deleteMany({})
    await tx.purchaseOrderLine.deleteMany({})
    await tx.purchaseOrder.deleteMany({})

    console.log('🗑️  3. Deleting Service & Repair Data...')
    await tx.serviceJobPart.deleteMany({})
    await tx.servicePayment.deleteMany({})
    await tx.serviceInvoice.deleteMany({})
    await tx.serviceJob.deleteMany({})

    console.log('🗑️  4. Deleting Stock Movements, Layers & Transfers...')
    await tx.stockTransferLine.deleteMany({})
    await tx.stockTransfer.deleteMany({})
    await tx.serialUnit.deleteMany({})
    await tx.stockLayer.deleteMany({})
    await tx.stockLedger.deleteMany({})
    await tx.stockAdjustment.deleteMany({})

    console.log('🗑️  5. Deleting Payroll & Advances...')
    await tx.payrollPayment.deleteMany({})
    await tx.payrollEntryAdjustment.deleteMany({})
    await tx.payrollEntryLine.deleteMany({})
    await tx.payrollEntry.deleteMany({})
    await tx.payrollPeriod.deleteMany({})
    await tx.employeeAdvance.deleteMany({})

    console.log('🗑️  6. Deleting Financials, Capital & Expenses...')
    await tx.fixedAsset.deleteMany({})
    await tx.expense.deleteMany({})
    await tx.capitalInjection.deleteMany({})
    await tx.cheque.deleteMany({})
    await tx.contraTransfer.deleteMany({})
    await tx.drawerTransaction.deleteMany({})
    await tx.cashDrawer.deleteMany({})
    await tx.bankTransaction.deleteMany({})

    console.log('🗑️  7. Deleting General Ledger & Partner Ledgers...')
    await tx.accountLedgerEntry.deleteMany({})
    await tx.customerLedger.deleteMany({})
    await tx.customerNote.deleteMany({})
    await tx.supplierLedger.deleteMany({})
    await tx.supplierNote.deleteMany({})
    await tx.supplierTransaction.deleteMany({})
    await tx.auditLog.deleteMany({})

    console.log('🔄 8. Resetting Bank Account balances to 0...')
    await tx.bankAccount.updateMany({
      data: {
        currentBalance: 0,
      },
    })
  }, {
    maxWait: 30000,
    timeout: 60000,
  })

  console.log('\n================================================================================')
  console.log('✅ [DATABASE PURGE COMPLETE] All Transaction History Cleanly Dropped!')
  console.log('================================================================================')

  const finalProducts = await prisma.product.count()
  const finalEmployees = await prisma.employee.count()
  const finalUsers = await prisma.user.count()
  const finalOutlets = await prisma.outlet.count()
  const finalCOA = await prisma.chartOfAccount.count()
  const finalSales = await prisma.sale.count()
  const finalPurchases = await prisma.purchaseInvoice.count()
  const finalServiceJobs = await prisma.serviceJob.count()
  const finalGL = await prisma.accountLedgerEntry.count()
  const finalDrawers = await prisma.cashDrawer.count()
  const finalStockLayers = await prisma.stockLayer.count()

  console.log(`📊 Post-Wipe Verification:`)
  console.log(`  - Products Count    : ${finalProducts} (Preserved)`)
  console.log(`  - Employees Count   : ${finalEmployees} (Preserved)`)
  console.log(`  - Users Count       : ${finalUsers} (Preserved)`)
  console.log(`  - Outlets Count     : ${finalOutlets} (Preserved)`)
  console.log(`  - Chart of Accounts : ${finalCOA} (Preserved)`)
  console.log(`  - Sales Count       : ${finalSales} (Cleaned)`)
  console.log(`  - Purchases Count   : ${finalPurchases} (Cleaned)`)
  console.log(`  - Service Jobs Count: ${finalServiceJobs} (Cleaned)`)
  console.log(`  - Stock Layers Count: ${finalStockLayers} (Cleaned)`)
  console.log(`  - GL Entries Count  : ${finalGL} (Cleaned)`)
  console.log(`  - Cash Drawers Count: ${finalDrawers} (Cleaned)`)
}

wipeData()
  .catch((err) => {
    console.error('❌ Wipe failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
