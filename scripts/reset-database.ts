import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function resetDatabase() {
  console.log('🗑️  Starting database reset...\n')
  console.log('⚠️  WARNING: This will DELETE all transactional data!')
  console.log(
    '✅ Products, Categories, Brands, and System Config will be PRESERVED\n'
  )

  try {
    // Delete in order to respect foreign key constraints

    console.log('Deleting transactional and operational data...')

    // Audit & Logs
    await prisma.auditLog.deleteMany({})
    console.log('  ✓ AuditLog')

    await prisma.saleEditLog.deleteMany({})
    console.log('  ✓ SaleEditLog')

    await prisma.purchaseInvoiceEditLog.deleteMany({})
    console.log('  ✓ PurchaseInvoiceEditLog')

    // Cash Drawer & Finance
    await prisma.drawerTransaction.deleteMany({})
    console.log('  ✓ DrawerTransaction')

    await prisma.cashDrawer.deleteMany({})
    console.log('  ✓ CashDrawer')

    await prisma.contraTransfer.deleteMany({})
    console.log('  ✓ ContraTransfer')

    await prisma.cheque.deleteMany({})
    console.log('  ✓ Cheque')

    await prisma.bankTransaction.deleteMany({})
    console.log('  ✓ BankTransaction')

    await prisma.bankAccount.deleteMany({})
    console.log('  ✓ BankAccount')

    // Expenses
    await prisma.expense.deleteMany({})
    console.log('  ✓ Expense')

    // HR & Payroll
    await prisma.payslipLine.deleteMany({})
    console.log('  ✓ PayslipLine')

    await prisma.payslip.deleteMany({})
    console.log('  ✓ Payslip')

    await prisma.payroll.deleteMany({})
    console.log('  ✓ Payroll')

    await prisma.employeePayment.deleteMany({})
    console.log('  ✓ EmployeePayment')

    await prisma.employeeAdjustment.deleteMany({})
    console.log('  ✓ EmployeeAdjustment')

    await prisma.attendance.deleteMany({})
    console.log('  ✓ Attendance')

    await prisma.leaveBalance.deleteMany({})
    console.log('  ✓ LeaveBalance')

    await prisma.leaveRequest.deleteMany({})
    console.log('  ✓ LeaveRequest')

    await prisma.employeeSalaryComponent.deleteMany({})
    console.log('  ✓ EmployeeSalaryComponent')

    await prisma.employee.deleteMany({})
    console.log('  ✓ Employee')

    // Delete HR master data (delete children before parents due to FKs)
    await prisma.designation.deleteMany({})
    console.log('  ✓ Designation')

    await prisma.department.deleteMany({})
    console.log('  ✓ Department')

    await prisma.salaryComponent.deleteMany({})
    console.log('  ✓ SalaryComponent')

    await prisma.leaveType.deleteMany({})
    console.log('  ✓ LeaveType')

    // Service Jobs
    await prisma.servicePayment.deleteMany({})
    console.log('  ✓ ServicePayment')

    await prisma.serviceInvoice.deleteMany({})
    console.log('  ✓ ServiceInvoice')

    await prisma.serviceJobPart.deleteMany({})
    console.log('  ✓ ServiceJobPart')

    await prisma.serviceJob.deleteMany({})
    console.log('  ✓ ServiceJob')

    // Quotations
    await prisma.quotationLine.deleteMany({})
    console.log('  ✓ QuotationLine')

    await prisma.quotation.deleteMany({})
    console.log('  ✓ Quotation')

    // Sales
    await prisma.saleReturnLine.deleteMany({})
    console.log('  ✓ SaleReturnLine')

    await prisma.saleReturn.deleteMany({})
    console.log('  ✓ SaleReturn')

    await prisma.saleLineSerial.deleteMany({})
    console.log('  ✓ SaleLineSerial')

    await prisma.saleLine.deleteMany({})
    console.log('  ✓ SaleLine')

    await prisma.salePayment.deleteMany({})
    console.log('  ✓ SalePayment')

    await prisma.sale.deleteMany({})
    console.log('  ✓ Sale')

    // Purchases
    await prisma.purchaseOrderLineSerial.deleteMany({})
    console.log('  ✓ PurchaseOrderLineSerial')

    await prisma.purchaseReturnLine.deleteMany({})
    console.log('  ✓ PurchaseReturnLine')

    await prisma.purchaseReturn.deleteMany({})
    console.log('  ✓ PurchaseReturn')

    await prisma.purchasePayment.deleteMany({})
    console.log('  ✓ PurchasePayment')

    await prisma.purchaseInvoice.deleteMany({})
    console.log('  ✓ PurchaseInvoice')

    await prisma.purchaseOrderLine.deleteMany({})
    console.log('  ✓ PurchaseOrderLine')

    await prisma.purchaseOrder.deleteMany({})
    console.log('  ✓ PurchaseOrder')

    // Customers & Suppliers
    await prisma.customerLedger.deleteMany({})
    console.log('  ✓ CustomerLedger')

    await prisma.customerNote.deleteMany({})
    console.log('  ✓ CustomerNote')

    await prisma.customer.deleteMany({})
    console.log('  ✓ Customer')

    await prisma.customerGroup.deleteMany({})
    console.log('  ✓ CustomerGroup')

    await prisma.supplierLedger.deleteMany({})
    console.log('  ✓ SupplierLedger')

    await prisma.supplierNote.deleteMany({})
    console.log('  ✓ SupplierNote')

    await prisma.supplier.deleteMany({})
    console.log('  ✓ Supplier')

    // Stock Management
    await prisma.stockTransferLine.deleteMany({})
    console.log('  ✓ StockTransferLine')

    await prisma.stockTransfer.deleteMany({})
    console.log('  ✓ StockTransfer')

    await prisma.stockAdjustment.deleteMany({})
    console.log('  ✓ StockAdjustment')

    await prisma.stockLedger.deleteMany({})
    console.log('  ✓ StockLedger')

    await prisma.serialUnit.deleteMany({})
    console.log('  ✓ SerialUnit')

    // Accounting (Ledger entries)
    await prisma.accountLedgerEntry.deleteMany({})
    console.log('  ✓ AccountLedgerEntry')

    await prisma.chartOfAccount.deleteMany({})
    console.log('  ✓ ChartOfAccount')

    // Reset users to admin only
    console.log('\nResetting users...')
    await prisma.user.deleteMany({
      where: {
        role: { not: 'SUPER_ADMIN' },
      },
    })
    console.log('  ✓ Deleted non-admin users')

    // Ensure we have at least one admin
    const outlet = await prisma.outlet.findFirst()
    if (!outlet) {
      throw new Error('No outlet found! Please run seed script first.')
    }

    const adminExists = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
    })

    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('super@dmin2026', 12)
      await prisma.user.create({
        data: {
          name: 'System Admin',
          email: 'admin@artyxdigital.com',
          password: hashedPassword,
          role: 'SUPER_ADMIN',
          outletId: outlet.id,
          isActive: true,
        },
      })
      console.log('  ✓ Created fresh admin user: admin@artyxdigital.com')
    } else {
      console.log('  ✓ Admin user preserved')
    }

    console.log('\n✅ Database reset complete!')
    console.log('\n📊 Data preserved:')
    console.log('  • Products & Product configurations')
    console.log('  • Categories & Brands')
    console.log('  • Tax rates')
    console.log('  • Payment method configs')
    console.log('  • Outlets')
    console.log('  • Admin users')

    console.log('\n🗑️  Data deleted:')
    console.log('  • All sales & purchases')
    console.log('  • All customers & suppliers')
    console.log('  • All invoices & payments')
    console.log('  • All stock movements & serials')
    console.log('  • All service jobs & quotations')
    console.log('  • All expenses & cash drawers')
    console.log('  • All HR & payroll data')
    console.log('  • All audit logs')

    const productCount = await prisma.product.count()
    const categoryCount = await prisma.category.count()
    const brandCount = await prisma.brand.count()

    console.log(`\n📦 Products retained: ${productCount}`)
    console.log(`📁 Categories retained: ${categoryCount}`)
    console.log(`🏷️  Brands retained: ${brandCount}`)
  } catch (error) {
    console.error('\n❌ Error during reset:', error)
    throw error
  }
}

async function main() {
  console.log('\n⚠️  ⚠️  ⚠️  WARNING ⚠️  ⚠️  ⚠️')
  console.log('This will DELETE all transactional data from the database!')
  console.log('Only products and system configuration will be preserved.')
  console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n')

  // 5 second delay to allow cancellation
  await new Promise(resolve => setTimeout(resolve, 5000))

  await resetDatabase()
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
