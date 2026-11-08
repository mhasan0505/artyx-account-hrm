import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, UserRole, AccountType, PaymentMethod } from '@prisma/client'

async function prepareDeliveryDatabase() {
  console.log('🚀 Preparing Delivery Database...\n')

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  const client = await pool.connect()

  try {
    // ── 1. Fetch all tables from public schema ──
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name != '_prisma_migrations'
      ORDER BY table_name;
    `)
    const tables: string[] = tablesRes.rows.map(r => r.table_name)
    console.log(`Found ${tables.length} application tables to reset.`)

    // ── 2. TRUNCATE ALL TABLES WITH CASCADE ──
    console.log('Truncating all tables simultaneously with CASCADE (schema strictly preserved)...')
    const tableListSql = tables.map(t => `"${t}"`).join(', ')
    await client.query(`TRUNCATE TABLE ${tableListSql} CASCADE;`)
    console.log('  ✓ All business and transactional data truncated.\n')
  } finally {
    client.release()
  }

  // ── 3. Re-seed Minimal Skeleton with Prisma ──
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  try {
    console.log('🌱 Seeding minimal required skeleton...')

    // 3A. Exactly ONE Outlet
    const outlet = await prisma.outlet.create({
      data: {
        name: 'Artyx Digital',
        code: 'HQ',
        address:
          'Harun Super Market, Road No: 03, Plot: 03 Shop No#109/110, Ground Floor (Back Side Of Shah Ali Plaza), Mirpur-10, Dhaka-1216, Bangladesh',
        phone: '+880-1920424323',
        email: 'admin@artyxdigital.com',
        openTime: '09:00',
        closeTime: '21:00',
        isActive: true,
      },
    })
    console.log(`  ✓ Outlet created: "${outlet.name}" (Code: ${outlet.code}, ID: ${outlet.id})`)

    // 3B. Standard Initial Password & PIN for SUPER_ADMIN
    const rawAdminPassword = process.env.ADMIN_INITIAL_PASSWORD
    const rawAdminPin = process.env.ADMIN_INITIAL_PIN
    if (!rawAdminPassword || !rawAdminPin) {
      throw new Error(
        'Missing required environment variables: ADMIN_INITIAL_PASSWORD and ADMIN_INITIAL_PIN must be set.'
      )
    }
    const hashedAdminPassword = await bcrypt.hash(rawAdminPassword, 12)
    const hashedAdminPin = await bcrypt.hash(rawAdminPin, 12)

    const adminUser = await prisma.user.create({
      data: {
        name: 'Artyx Admin',
        email: 'admin@artyxdigital.com',
        password: hashedAdminPassword,
        pin: hashedAdminPin,
        role: UserRole.SUPER_ADMIN,
        outletId: outlet.id,
        isActive: true,
      },
    })
    console.log(`  ✓ SUPER_ADMIN User created: "${adminUser.email}"`)

    // 3C. Payment Method Configs
    const paymentMethods = [
      { method: PaymentMethod.CASH, label: 'Cash', sortOrder: 1 },
      { method: PaymentMethod.CARD, label: 'Card', sortOrder: 2 },
      { method: PaymentMethod.BKASH, label: 'bKash', sortOrder: 3 },
      { method: PaymentMethod.NAGAD, label: 'Nagad', sortOrder: 4 },
      { method: PaymentMethod.ROCKET, label: 'Rocket', sortOrder: 5 },
      { method: PaymentMethod.BANK_TRANSFER, label: 'Bank Transfer', sortOrder: 6 },
      { method: PaymentMethod.CREDIT, label: 'Credit (B2B/Due)', sortOrder: 7 },
    ]
    for (const pm of paymentMethods) {
      await prisma.paymentMethodConfig.create({ data: pm })
    }
    console.log(`  ✓ ${paymentMethods.length} PaymentMethodConfigs created`)

    // 3D. Tax Rates
    await prisma.taxRate.create({
      data: {
        id: 'tax-vat-15',
        name: 'VAT 15%',
        rate: 15,
        isDefault: true,
      },
    })
    await prisma.taxRate.create({
      data: {
        id: 'tax-zero',
        name: 'Tax Exempt (0%)',
        rate: 0,
        isDefault: false,
      },
    })
    console.log(`  ✓ Tax Rates created`)

    // 3E. Chart of Accounts (Complete Balanced Hierarchy)
    const accounts = [
      // Assets
      { code: '1000', name: 'Current Assets', type: AccountType.ASSET },
      { code: '1100', name: 'Cash in Hand', type: AccountType.ASSET, parentCode: '1000' },
      { code: '1200', name: 'Bank Accounts', type: AccountType.ASSET, parentCode: '1000' },
      { code: '1300', name: 'Accounts Receivable', type: AccountType.ASSET, parentCode: '1000' },
      { code: '1400', name: 'Inventory Asset', type: AccountType.ASSET, parentCode: '1000' },
      { code: '1500', name: 'Fixed Assets', type: AccountType.ASSET },
      // Liabilities
      { code: '2000', name: 'Current Liabilities', type: AccountType.LIABILITY },
      { code: '2100', name: 'Accounts Payable', type: AccountType.LIABILITY, parentCode: '2000' },
      { code: '2200', name: 'Customer Deposits / Accrued Payroll', type: AccountType.LIABILITY, parentCode: '2000' },
      { code: '2300', name: 'Sales Tax Payable (VAT)', type: AccountType.LIABILITY, parentCode: '2000' },
      // Equity
      { code: '3000', name: 'Owner Equity', type: AccountType.EQUITY },
      { code: '3100', name: 'Owner Capital / Retained Earnings', type: AccountType.EQUITY, parentCode: '3000' },
      { code: '3200', name: 'Opening Balance Equity', type: AccountType.EQUITY, parentCode: '3000' },
      // Income
      { code: '4000', name: 'Revenue', type: AccountType.INCOME },
      { code: '4100', name: 'Sales Revenue', type: AccountType.INCOME, parentCode: '4000' },
      { code: '4200', name: 'Service Revenue', type: AccountType.INCOME, parentCode: '4000' },
      { code: '4300', name: 'Other Income', type: AccountType.INCOME, parentCode: '4000' },
      { code: '4400', name: 'Inventory Gain', type: AccountType.INCOME, parentCode: '4000' },
      // Expenses
      { code: '5000', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
      { code: '5100', name: 'Purchase Cost', type: AccountType.EXPENSE, parentCode: '5000' },
      { code: '5200', name: 'Operating Expenses', type: AccountType.EXPENSE },
      { code: '5210', name: 'Salaries & Wages', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5220', name: 'Rent Expense', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5230', name: 'Utilities Expense', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5240', name: 'Internet & Telecom', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5250', name: 'Office Supplies', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5260', name: 'Marketing & Advertising', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5270', name: 'Transportation', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5280', name: 'Repair & Maintenance', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5290', name: 'Miscellaneous Expense / MFS Charges', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5291', name: 'Bank Charges', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5300', name: 'Inventory Shrinkage', type: AccountType.EXPENSE, parentCode: '5200' },
      { code: '5400', name: 'Depreciation Expense', type: AccountType.EXPENSE, parentCode: '5200' },
    ]

    const coaMap: Record<string, string> = {}
    // First pass: parents
    for (const acc of accounts.filter(a => !('parentCode' in a))) {
      const created = await prisma.chartOfAccount.create({
        data: { code: acc.code, name: acc.name, type: acc.type },
      })
      coaMap[acc.code] = created.id
    }
    // Second pass: children
    for (const acc of accounts.filter(a => 'parentCode' in a)) {
      const parentId = coaMap[(acc as { parentCode: string }).parentCode]
      const created = await prisma.chartOfAccount.create({
        data: { code: acc.code, name: acc.name, type: acc.type, parentId },
      })
      coaMap[acc.code] = created.id
    }
    console.log(`  ✓ Chart of Accounts created: ${accounts.length} accounts`)

    // 3F. Categories & Subcategories
    const categories = [
      { name: 'Laptops', subs: ['Business', 'Gaming', 'Student', 'Ultrabook'] },
      { name: 'Desktops', subs: ['Tower', 'All-in-One', 'Mini PC'] },
      { name: 'Components', subs: ['RAM', 'SSD', 'HDD', 'Processor', 'GPU', 'Motherboard', 'PSU', 'Cooling'] },
      { name: 'Accessories', subs: ['Bags & Cases', 'Chargers', 'Cable & Adapters', 'Mouse', 'Keyboard', 'Headset', 'Webcam', 'Monitors'] },
      { name: 'Services', subs: ['Software Install', 'Hardware Repair', 'Data Recovery', 'Screen Replacement', 'Battery Replacement'] },
      { name: 'Networking', subs: ['Router', 'Switch', 'Access Point', 'NAS'] },
    ]
    for (const cat of categories) {
      const catSlug = cat.name.toLowerCase().replace(/\s+/g, '-')
      const createdCat = await prisma.category.create({
        data: {
          id: `cat-${catSlug}`,
          name: cat.name,
        },
      })
      for (const sub of cat.subs) {
        const subSlug = sub.toLowerCase().replace(/\s+/g, '-')
        await prisma.subCategory.create({
          data: {
            id: `sub-${subSlug}`,
            name: sub,
            categoryId: createdCat.id,
          },
        })
      }
    }
    console.log(`  ✓ Categories & Subcategories created`)

    // 3G. Brands
    const brands = ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Samsung', 'LG', 'Microsoft', 'Razer']
    for (const brand of brands) {
      await prisma.brand.create({
        data: {
          id: `brand-${brand.toLowerCase()}`,
          name: brand,
        },
      })
    }
    console.log(`  ✓ Brands created`)

    // 3H. Hardware Specs (Processor, RAM, Storage)
    const processors = ['Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M1', 'Apple M2', 'Apple M3']
    for (const p of processors) {
      await prisma.processor.create({ data: { name: p } })
    }
    const gens = ['10th Gen', '11th Gen', '12th Gen', '13th Gen', '14th Gen', 'Zen 3', 'Zen 4']
    for (const g of gens) {
      await prisma.processorGen.create({ data: { name: g } })
    }
    const rams = ['4GB', '8GB', '16GB', '32GB', '64GB']
    for (const r of rams) {
      await prisma.ram.create({ data: { name: r } })
    }
    const storages = ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD', '1TB HDD']
    for (const s of storages) {
      await prisma.storage.create({ data: { name: s } })
    }
    console.log(`  ✓ Hardware specifications (Processor, RAM, Storage) created`)

    // 3I. HR Departments & Designations
    const departments = [
      { name: 'Sales', designations: ['Sales Executive', 'Sales Manager', 'Cashier'] },
      { name: 'Technical', designations: ['Technician', 'Senior Technician', 'Tech Lead'] },
      { name: 'Accounts', designations: ['Accountant', 'Finance Manager'] },
      { name: 'Administration', designations: ['HR Officer', 'Office Manager', 'Receptionist'] },
      { name: 'Management', designations: ['Branch Manager', 'CEO'] },
    ]
    for (const dept of departments) {
      const createdDept = await prisma.department.create({ data: { name: dept.name } })
      for (const desig of dept.designations) {
        const key = `${dept.name}-${desig}`.toLowerCase().replace(/\s+/g, '-')
        await prisma.designation.create({
          data: {
            id: `desig-${key}`,
            name: desig,
            departmentId: createdDept.id,
          },
        })
      }
    }
    console.log(`  ✓ HR Departments & Designations created`)

    // 3J. Salary Components
    const salaryComponents = [
      { name: 'Basic Salary', type: 'EARNING' },
      { name: 'House Rent Allowance', type: 'EARNING' },
      { name: 'Medical Allowance', type: 'EARNING' },
      { name: 'Transport Allowance', type: 'EARNING' },
      { name: 'Provident Fund', type: 'DEDUCTION' },
      { name: 'Income Tax', type: 'DEDUCTION' },
      { name: 'Advance Recovery', type: 'DEDUCTION' },
    ]
    for (const comp of salaryComponents) {
      await prisma.salaryComponent.create({ data: comp })
    }
    console.log(`  ✓ Salary Components created`)

    // 3K. System Settings
    const settings = [
      { key: 'store_name', value: 'Artyx Digital' },
      { key: 'store_currency', value: 'BDT' },
      { key: 'store_currency_symbol', value: '৳' },
      { key: 'default_tax_rate_id', value: 'tax-vat-15' },
      { key: 'receipt_footer', value: 'Thank you for shopping with Artyx Digital!' },
      { key: 'low_stock_threshold', value: '5' },
      { key: 'manager_override_pin', value: '9988' },
    ]
    for (const s of settings) {
      await prisma.setting.create({ data: s })
    }
    console.log(`  ✓ System Settings created\n`)

    // ── 4. Verify Final Row Counts Across All Tables ──
    const clientAudit = await pool.connect()
    const tableSummary: { table: string; count: number }[] = []
    try {
      const tablesAuditRes = await clientAudit.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `)
      for (const row of tablesAuditRes.rows) {
        const tName = row.table_name
        const countRes = await clientAudit.query(`SELECT COUNT(*)::int as count FROM "${tName}"`)
        tableSummary.push({ table: tName, count: countRes.rows[0].count })
      }
    } finally {
      clientAudit.release()
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('               DELIVERY DATABASE RESET SUMMARY                    ')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`Outlet:          Artyx Digital (HQ)`)
    console.log(`SUPER_ADMIN:     admin@artyxdigital.com`)
    console.log(`Secure Password: ${rawAdminPassword}`)
    console.log(`Manager PIN:     9988`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('📊 Complete Table Row Count Audit:')
    tableSummary.forEach(item => {
      console.log(`  • ${item.table.padEnd(30)} : ${item.count} rows`)
    })

    return {
      outlet,
      adminEmail: adminUser.email,
      adminPassword: rawAdminPassword,
      tableSummary,
    }
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

prepareDeliveryDatabase().catch(err => {
  console.error('❌ Failed to prepare delivery database:', err)
  process.exit(1)
})
