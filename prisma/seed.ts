import { PrismaPg } from '@prisma/adapter-pg'
import {
  AccountType,
  PaymentMethod,
  PrismaClient,
  UserRole,
} from '@prisma/client'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seeding database...')

  // ── Outlet ──────────────────────────────────────────────────────────────────
  const outlet = await prisma.outlet.upsert({
    where: { code: 'HQ' },
    update: {},
    create: {
      name: 'Artyx Digital',
      code: 'HQ',
      address:
        'Harun Super Market,Road No: 03, Plot: 03 Shop No#109/110,Ground Floor (Back Side Of Shah Ali Plaza), Mirpur-10, Dhaka-1216, Bangladesh',
      phone: '+880-1920424323 | +880-170161395',
      email: 'admin@artyxdigital.com',
      openTime: '09:00',
      closeTime: '21:00',
    },
  })
  console.log(`✅ Outlet: ${outlet.name}`)

  // ── Admin User ───────────────────────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD
  const adminPin = process.env.ADMIN_INITIAL_PIN

  if (!adminPassword || !adminPin) {
    throw new Error(
      'Missing required environment variables: ADMIN_INITIAL_PASSWORD and ADMIN_INITIAL_PIN must be set to run prisma db seed.'
    )
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 12)
  const hashedPin = await bcrypt.hash(adminPin, 12)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@artyxdigital.com' },
    update: {
      name: 'System Admin',
      password: hashedPassword,
      pin: hashedPin,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      outletId: outlet.id,
    },
    create: {
      name: 'System Admin',
      email: 'admin@artyxdigital.com',
      password: hashedPassword,
      pin: hashedPin,
      role: UserRole.SUPER_ADMIN,
      outletId: outlet.id,
    },
  })
  console.log(`✅ Admin user: ${adminUser.email}`)

  // ── Payment Methods ──────────────────────────────────────────────────────────
  const paymentMethods = [
    { method: PaymentMethod.CASH, label: 'Cash', sortOrder: 1 },
    { method: PaymentMethod.CARD, label: 'Card', sortOrder: 2 },
    { method: PaymentMethod.BKASH, label: 'bKash', sortOrder: 3 },
    { method: PaymentMethod.NAGAD, label: 'Nagad', sortOrder: 4 },
    { method: PaymentMethod.ROCKET, label: 'Rocket', sortOrder: 5 },
    {
      method: PaymentMethod.BANK_TRANSFER,
      label: 'Bank Transfer',
      sortOrder: 6,
    },
    { method: PaymentMethod.CREDIT, label: 'Credit', sortOrder: 7 },
  ]
  for (const pm of paymentMethods) {
    await prisma.paymentMethodConfig.upsert({
      where: { method: pm.method },
      update: {},
      create: pm,
    })
  }
  console.log('✅ Payment methods')

  // ── Tax Rates ────────────────────────────────────────────────────────────────
  await prisma.taxRate.upsert({
    where: { id: 'tax-vat-15' },
    update: {},
    create: {
      id: 'tax-vat-15',
      name: 'VAT 15%',
      rate: 15,
      isDefault: true,
    },
  })
  await prisma.taxRate.upsert({
    where: { id: 'tax-zero' },
    update: {},
    create: {
      id: 'tax-zero',
      name: 'Tax Exempt (0%)',
      rate: 0,
      isDefault: false,
    },
  })
  console.log('✅ Tax rates')

  // ── Chart of Accounts ────────────────────────────────────────────────────────
  const accounts = [
    // Assets
    { code: '1000', name: 'Current Assets', type: AccountType.ASSET },
    {
      code: '1100',
      name: 'Cash in Hand',
      type: AccountType.ASSET,
      parentCode: '1000',
    },
    {
      code: '1110',
      name: 'Mobile Financial Services (MFS)',
      type: AccountType.ASSET,
      parentCode: '1000',
    },
    {
      code: '1200',
      name: 'Bank Accounts',
      type: AccountType.ASSET,
      parentCode: '1000',
    },
    {
      code: '1300',
      name: 'Accounts Receivable',
      type: AccountType.ASSET,
      parentCode: '1000',
    },
    {
      code: '1400',
      name: 'Inventory',
      type: AccountType.ASSET,
      parentCode: '1000',
    },
    { code: '1500', name: 'Fixed Assets', type: AccountType.ASSET },
    {
      code: '1510',
      name: 'Accumulated Depreciation',
      type: AccountType.ASSET,
      parentCode: '1500',
    },
    // Liabilities
    { code: '2000', name: 'Current Liabilities', type: AccountType.LIABILITY },
    {
      code: '2100',
      name: 'Accounts Payable',
      type: AccountType.LIABILITY,
      parentCode: '2000',
    },
    {
      code: '2200',
      name: 'Customer Deposits',
      type: AccountType.LIABILITY,
      parentCode: '2000',
    },
    {
      code: '2210',
      name: 'Accrued Payroll',
      type: AccountType.LIABILITY,
      parentCode: '2000',
    },
    {
      code: '2300',
      name: 'Tax Payable (VAT)',
      type: AccountType.LIABILITY,
      parentCode: '2000',
    },
    // Equity
    { code: '3000', name: 'Owner Equity', type: AccountType.EQUITY },
    {
      code: '3100',
      name: 'Retained Earnings',
      type: AccountType.EQUITY,
      parentCode: '3000',
    },
    {
      code: '3200',
      name: 'Opening Balance Equity',
      type: AccountType.EQUITY,
      parentCode: '3000',
    },
    // Income
    { code: '4000', name: 'Revenue', type: AccountType.INCOME },
    {
      code: '4100',
      name: 'Sales Revenue',
      type: AccountType.INCOME,
      parentCode: '4000',
    },
    {
      code: '4110',
      name: 'Sales Returns & Allowances',
      type: AccountType.INCOME,
      parentCode: '4000',
    },
    {
      code: '4200',
      name: 'Service Revenue',
      type: AccountType.INCOME,
      parentCode: '4000',
    },
    {
      code: '4300',
      name: 'Other Income',
      type: AccountType.INCOME,
      parentCode: '4000',
    },
    {
      code: '4400',
      name: 'Inventory Gain',
      type: AccountType.INCOME,
      parentCode: '4000',
    },
    // Expenses
    { code: '5000', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
    {
      code: '5100',
      name: 'Purchase Cost',
      type: AccountType.EXPENSE,
      parentCode: '5000',
    },
    {
      code: '5300',
      name: 'Inventory Shrinkage',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5310',
      name: 'Inventory Scrap & Loss',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5320',
      name: 'Depreciation Expense',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    { code: '5200', name: 'Operating Expenses', type: AccountType.EXPENSE },
    {
      code: '5210',
      name: 'Salaries & Wages',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5220',
      name: 'Rent',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5230',
      name: 'Utilities',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5240',
      name: 'Internet & Telecom',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5250',
      name: 'Office Supplies',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5260',
      name: 'Marketing & Advertising',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5270',
      name: 'Transportation',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5280',
      name: 'Repair & Maintenance',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5290',
      name: 'MFS Charges',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5291',
      name: 'Bank Charges',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
    {
      code: '5299',
      name: 'Miscellaneous Expense',
      type: AccountType.EXPENSE,
      parentCode: '5200',
    },
  ]

  // First pass: create all without parents
  const accountIdMap: Record<string, string> = {}
  for (const acc of accounts.filter(a => !('parentCode' in a))) {
    const created = await prisma.chartOfAccount.upsert({
      where: { code: acc.code },
      update: {},
      create: { code: acc.code, name: acc.name, type: acc.type },
    })
    accountIdMap[acc.code] = created.id
  }
  // Second pass: create with parents
  for (const acc of accounts.filter(a => 'parentCode' in a)) {
    const parentId = accountIdMap[(acc as { parentCode: string }).parentCode]
    const created = await prisma.chartOfAccount.upsert({
      where: { code: acc.code },
      update: {},
      create: { code: acc.code, name: acc.name, type: acc.type, parentId },
    })
    accountIdMap[acc.code] = created.id
  }
  console.log(`✅ Chart of Accounts (${accounts.length} accounts)`)

  // ── Product Categories ───────────────────────────────────────────────────────
  const categories = [
    { name: 'Laptops', subs: ['Business', 'Gaming', 'Student', 'Ultrabook'] },
    { name: 'Desktops', subs: ['Tower', 'All-in-One', 'Mini PC'] },
    {
      name: 'Components',
      subs: [
        'RAM',
        'SSD',
        'HDD',
        'Processor',
        'GPU',
        'Motherboard',
        'PSU',
        'Cooling',
      ],
    },
    {
      name: 'Accessories',
      subs: [
        'Bags & Cases',
        'Chargers',
        'Cable & Adapters',
        'Mouse',
        'Keyboard',
        'Headset',
        'Webcam',
        'Monitors',
      ],
    },
    {
      name: 'Services',
      subs: [
        'Software Install',
        'Hardware Repair',
        'Data Recovery',
        'Screen Replacement',
        'Battery Replacement',
      ],
    },
    { name: 'Networking', subs: ['Router', 'Switch', 'Access Point', 'NAS'] },
  ]

  for (const cat of categories) {
    const category = await prisma.category.upsert({
      where: { id: `cat-${cat.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: {
        id: `cat-${cat.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: cat.name,
      },
    })
    for (const sub of cat.subs) {
      await prisma.subCategory.upsert({
        where: { id: `sub-${sub.toLowerCase().replace(/\s+/g, '-')}` },
        update: {},
        create: {
          id: `sub-${sub.toLowerCase().replace(/\s+/g, '-')}`,
          name: sub,
          categoryId: category.id,
        },
      })
    }
  }
  console.log('✅ Categories & subcategories')

  // ── Brands ───────────────────────────────────────────────────────────────────
  const brands = [
    'Dell',
    'HP',
    'Lenovo',
    'Microsoft',
    'Apple',
    'Asus',
    'Acer',
    'Samsung',
    'LG',
    'Razer',
  ]
  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { id: `brand-${brand.toLowerCase()}` },
      update: {},
      create: { id: `brand-${brand.toLowerCase()}`, name: brand },
    })
  }
  console.log('✅ Brands')

  // ── HR Setup ─────────────────────────────────────────────────────────────────
  const departments = [
    {
      name: 'Sales',
      designations: ['Sales Executive', 'Sales Manager', 'Cashier'],
    },
    {
      name: 'Technical',
      designations: ['Technician', 'Senior Technician', 'Tech Lead'],
    },
    { name: 'Accounts', designations: ['Accountant', 'Finance Manager'] },
    {
      name: 'Administration',
      designations: ['HR Officer', 'Office Manager', 'Receptionist'],
    },
    { name: 'Management', designations: ['Branch Manager', 'CEO'] },
  ]

  for (const dept of departments) {
    const department = await prisma.department.upsert({
      where: { name: dept.name },
      update: {},
      create: { name: dept.name },
    })
    for (const desig of dept.designations) {
      const key = `${dept.name}-${desig}`.toLowerCase().replace(/\s+/g, '-')
      await prisma.designation.upsert({
        where: { id: `desig-${key}` },
        update: {},
        create: {
          id: `desig-${key}`,
          name: desig,
          departmentId: department.id,
        },
      })
    }
  }
  console.log('✅ Departments & designations')

  // ── Salary Components ────────────────────────────────────────────────────────
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
    await prisma.salaryComponent.upsert({
      where: { name: comp.name },
      update: {},
      create: { name: comp.name, type: comp.type },
    })
  }
  console.log('✅ Salary components')

  // ── Default Walk-in Customer ──────────────────────────────────────────────────
  const defaultWalkInCustomer = await prisma.customer.upsert({
    where: { id: 'cust-walk-in-default' },
    update: {},
    create: {
      id: 'cust-walk-in-default',
      name: 'Walk-in Customer',
      phone: '01700000000',
      outletId: outlet.id,
    },
  })
  console.log(`✅ Walk-in Customer: ${defaultWalkInCustomer.name}`)

  // ── Settings ─────────────────────────────────────────────────────────────────
  const settings = [
    { key: 'store_name', value: 'Artyx Digital' },
    { key: 'store_currency', value: 'BDT' },
    { key: 'store_currency_symbol', value: '৳' },
    { key: 'default_tax_rate_id', value: 'tax-vat-15' },
    { key: 'receipt_footer', value: 'Thank you for shopping at Artyx Digital!' },
    { key: 'low_stock_threshold', value: '5' },
    { key: 'return_approval_threshold', value: '50000' },
    { key: 'return_window_days', value: '30' },
    { key: 'walk_in_customer_id', value: defaultWalkInCustomer.id },
  ]

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    })
  }
  console.log('✅ Settings')

  console.log('\n🎉 Seeding complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Login: admin@artyxdigital.com')
  console.log('  Password: super@dmin2026')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
