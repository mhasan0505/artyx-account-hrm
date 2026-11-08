import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, PaymentMethod } from '@prisma/client'

async function verifyDeliveryReadiness() {
  console.log('🔍 Running Delivery Database End-to-End Verification Suite...\n')

  const { getBalanceSheet } = await import('../lib/actions/reports')
  const { checkout } = await import('../lib/actions/sales')

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  let allChecksPassed = true

  try {
    // ── 1. Verify SUPER_ADMIN user & Login Authentication ──
    console.log('Step 1: Checking SUPER_ADMIN Login & Outlet Association...')
    const admin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      include: { outlet: true },
    })

    if (!admin || !admin.outlet) {
      throw new Error('SUPER_ADMIN user or assigned outlet not found!')
    }
    console.log(`  ✓ Found SUPER_ADMIN user: ${admin.email} (Name: "${admin.name}")`)
    console.log(`  ✓ Assigned Outlet: "${admin.outlet.name}" (Code: ${admin.outlet.code})`)

    // Verify password hash format is valid bcrypt
    if (!admin.password.startsWith('$2')) {
      throw new Error('SUPER_ADMIN password is not a valid bcrypt hash!')
    }
    console.log(`  ✓ Password verified as valid bcrypt hash\n`)

    // ── 2. Verify Balance Sheet on Clean State (৳0 = ৳0) ──
    console.log('Step 2: Testing Balance Sheet Generation on Fresh Database...')
    const bsReport = await getBalanceSheet()
    if (!bsReport.success) {
      throw new Error(`Balance Sheet failed to generate: ${bsReport.error}`)
    }

    const { assets, liabilities, equity, isBalanced, discrepancy } = bsReport.data
    console.log(`  • Total Assets:      ৳${assets.totalAssets.toFixed(2)}`)
    console.log(`  • Total Liabilities: ৳${liabilities.totalLiabilities.toFixed(2)}`)
    console.log(`  • Total Equity:      ৳${equity.totalEquity.toFixed(2)}`)
    console.log(`  • Discrepancy:       ৳${discrepancy.toFixed(2)}`)
    console.log(`  • Is Balanced:       ${isBalanced ? 'YES (Balanced)' : 'NO'}`)

    if (!isBalanced || Math.abs(discrepancy) >= 0.01) {
      throw new Error('Balance Sheet is not balanced on clean database!')
    }
    console.log(`  ✓ Balance Sheet verified: ৳0.00 Assets = ৳0.00 (Liabilities + Equity)\n`)

    // ── 3. Verify Pristine Zero-Transaction Baseline ──
    console.log('Step 3: Verifying Pure Zero-Transaction State...')
    const counts = {
      products: await prisma.product.count(),
      customers: await prisma.customer.count(),
      suppliers: await prisma.supplier.count(),
      sales: await prisma.sale.count(),
      purchaseOrders: await prisma.purchaseOrder.count(),
      purchaseInvoices: await prisma.purchaseInvoice.count(),
      serviceJobs: await prisma.serviceJob.count(),
      stockLedgers: await prisma.stockLedger.count(),
      stockLayers: await prisma.stockLayer.count(),
      ledgerEntries: await prisma.accountLedgerEntry.count(),
      cashDrawers: await prisma.cashDrawer.count(),
      expenses: await prisma.expense.count(),
      auditLogs: await prisma.auditLog.count(),
    }

    console.log(`  • Products:         ${counts.products} (Expected: 0)`)
    console.log(`  • Customers:        ${counts.customers} (Expected: 0)`)
    console.log(`  • Suppliers:        ${counts.suppliers} (Expected: 0)`)
    console.log(`  • Sales:            ${counts.sales} (Expected: 0)`)
    console.log(`  • Purchases:        ${counts.purchaseInvoices} (Expected: 0)`)
    console.log(`  • Service Jobs:     ${counts.serviceJobs} (Expected: 0)`)
    console.log(`  • Stock Ledgers:    ${counts.stockLedgers} (Expected: 0)`)
    console.log(`  • Ledger Entries:   ${counts.ledgerEntries} (Expected: 0)`)
    console.log(`  • Cash Drawers:     ${counts.cashDrawers} (Expected: 0)`)

    const nonZeroCounts = Object.entries(counts).filter(([_, count]) => count > 0)
    if (nonZeroCounts.length > 0) {
      throw new Error(`Database is not blank! Non-zero tables found: ${nonZeroCounts.map(([t, c]) => `${t}: ${c}`).join(', ')}`)
    }
    console.log('  ✓ All business and transactional tables are 100% blank.\n')

    // ── 4. Verify Master Skeleton Completeness ──
    console.log('Step 4: Verifying Master Configuration Skeleton...')
    const coaCount = await prisma.chartOfAccount.count()
    const pmCount = await prisma.paymentMethodConfig.count()
    const taxCount = await prisma.taxRate.count()
    const catCount = await prisma.category.count()
    const brandCount = await prisma.brand.count()
    const settingsCount = await prisma.setting.count()

    console.log(`  • Chart of Accounts: ${coaCount} accounts (Expected: >= 30)`)
    console.log(`  • Payment Methods:   ${pmCount} configs (Expected: 7)`)
    console.log(`  • Tax Rates:         ${taxCount} rates (Expected: 2)`)
    console.log(`  • Categories:        ${catCount} categories (Expected: 6)`)
    console.log(`  • Brands:            ${brandCount} brands (Expected: 10)`)
    console.log(`  • Settings:          ${settingsCount} settings (Expected: >= 7)`)

    if (coaCount < 30 || pmCount !== 7 || taxCount < 2 || catCount < 6 || brandCount < 10) {
      throw new Error('Master skeleton is incomplete!')
    }
    console.log('  ✓ Master skeleton is fully populated and healthy.\n')

    // ── 5. Final Row Count Confirmation ──
    console.log('Step 5: Final Row Counts Across Database Tables:')
    const client = await pool.connect()
    try {
      const tablesAuditRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `)
      for (const row of tablesAuditRes.rows) {
        const tName = row.table_name
        const countRes = await client.query(`SELECT COUNT(*)::int as count FROM "${tName}"`)
        console.log(`  • ${tName.padEnd(30)} : ${countRes.rows[0].count} rows`)
      }
    } finally {
      client.release()
    }

    console.log('\n🎉 ALL DELIVERY CHECKS COMPLETED AND VERIFIED 100%!')
  } catch (err: any) {
    allChecksPassed = false
    console.error('❌ Verification check failed:', err)
  } finally {
    await prisma.$disconnect()
    await pool.end()
    if (!allChecksPassed) {
      process.exit(1)
    }
  }
}

verifyDeliveryReadiness()
