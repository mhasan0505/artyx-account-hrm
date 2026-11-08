import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, UserRole, AccountType } from '@prisma/client'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function seedAgency() {
  console.log('🚀 Seeding Artyx Digital Agency Platform...')

  // 1. Agency Outlet / HQ
  const hq = await prisma.outlet.upsert({
    where: { code: 'HQ' },
    update: {
      name: 'Artyx Digital HQ',
      address: 'Dhaka, Bangladesh',
      phone: '+880 1700 000000',
      email: 'hello@artyxdigital.com',
      slogan: 'Advanced Software & Digital Marketing Agency',
    },
    create: {
      name: 'Artyx Digital HQ',
      code: 'HQ',
      address: 'Dhaka, Bangladesh',
      phone: '+880 1700 000000',
      email: 'hello@artyxdigital.com',
      slogan: 'Advanced Software & Digital Marketing Agency',
      openTime: '10:00',
      closeTime: '19:00',
    },
  })
  console.log(`✅ Outlet: ${hq.name}`)

  // 2. Super Admin User
  const defaultPassword = process.env.ADMIN_INITIAL_PASSWORD || 'ArtyxAdmin2026!'
  const defaultPin = process.env.ADMIN_INITIAL_PIN || '1234'
  const hashedPassword = await bcrypt.hash(defaultPassword, 12)
  const hashedPin = await bcrypt.hash(defaultPin, 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@artyxdigital.com' },
    update: {
      name: 'Artyx Executive Admin',
      password: hashedPassword,
      pin: hashedPin,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      outletId: hq.id,
    },
    create: {
      name: 'Artyx Executive Admin',
      email: 'admin@artyxdigital.com',
      password: hashedPassword,
      pin: hashedPin,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      outletId: hq.id,
    },
  })
  console.log(`✅ Admin: ${admin.email} (Password: ${defaultPassword})`)

  // 3. Agency Departments & Designations
  const departments = [
    { name: 'Engineering & Software' },
    { name: 'Performance Marketing & SEO' },
    { name: 'Creative & UI/UX Design' },
    { name: 'Operations & Management' },
  ]

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { name: dept.name },
      update: {},
      create: { name: dept.name },
    })
  }
  console.log('✅ Agency Departments seeded')

  // 4. Agency Bank & MFS Accounts
  const mainBank = await prisma.bankAccount.upsert({
    where: { accountNumber: '1501204892001' },
    update: {},
    create: {
      bankName: 'BRAC Bank PLC',
      accountName: 'Artyx Digital Ltd',
      accountNumber: '1501204892001',
      branch: 'Gulshan Branch',
      isMfs: false,
      openingBalance: 250000,
      currentBalance: 250000,
      outletId: hq.id,
    },
  })

  const bkashMerchant = await prisma.bankAccount.upsert({
    where: { accountNumber: '01700000000' },
    update: {},
    create: {
      bankName: 'bKash Merchant',
      accountName: 'Artyx Digital',
      accountNumber: '01700000000',
      branch: 'Head Office',
      isMfs: true,
      transactionChargePct: 1.5,
      openingBalance: 50000,
      currentBalance: 50000,
      outletId: hq.id,
    },
  })
  console.log('✅ Agency Bank Accounts seeded')

  // 5. Agency Partners & Initial Equity Structure
  const existingOwners = await prisma.agencyOwner.count()
  if (existingOwners === 0) {
    const owner1 = await prisma.agencyOwner.create({
      data: {
        name: 'Managing Partner',
        title: 'Chief Executive Officer',
        email: 'ceo@artyxdigital.com',
        phone: '+880 1711 111111',
        equityPercentage: 50.0,
        initialCapital: 300000,
        currentCapitalBalance: 300000,
        totalDrawings: 0,
        totalProfitDistributed: 0,
        isActive: true,
      },
    })

    const owner2 = await prisma.agencyOwner.create({
      data: {
        name: 'Technical Co-Founder',
        title: 'Chief Technology Officer',
        email: 'cto@artyxdigital.com',
        phone: '+880 1711 222222',
        equityPercentage: 30.0,
        initialCapital: 180000,
        currentCapitalBalance: 180000,
        totalDrawings: 0,
        totalProfitDistributed: 0,
        isActive: true,
      },
    })

    const owner3 = await prisma.agencyOwner.create({
      data: {
        name: 'Growth Partner',
        title: 'Head of Performance Marketing',
        email: 'growth@artyxdigital.com',
        phone: '+880 1711 333333',
        equityPercentage: 20.0,
        initialCapital: 120000,
        currentCapitalBalance: 120000,
        totalDrawings: 0,
        totalProfitDistributed: 0,
        isActive: true,
      },
    })

    // Add initial capital ledger records
    await prisma.ownerEquityLedger.createMany({
      data: [
        {
          ownerId: owner1.id,
          entryType: 'CAPITAL_INJECTED',
          amount: 300000,
          balance: 300000,
          reference: 'INITIAL_EQUITY',
          description: 'Initial equity contribution (50% share)',
        },
        {
          ownerId: owner2.id,
          entryType: 'CAPITAL_INJECTED',
          amount: 180000,
          balance: 180000,
          reference: 'INITIAL_EQUITY',
          description: 'Initial equity contribution (30% share)',
        },
        {
          ownerId: owner3.id,
          entryType: 'CAPITAL_INJECTED',
          amount: 120000,
          balance: 120000,
          reference: 'INITIAL_EQUITY',
          description: 'Initial equity contribution (20% share)',
        },
      ],
    })
    console.log('✅ Agency Partners (50% / 30% / 20%) seeded')
  }

  // 6. Demo Clients with Credentials & Projects
  const existingClients = await prisma.agencyClient.count()
  if (existingClients === 0) {
    const client1 = await prisma.agencyClient.create({
      data: {
        clientCode: 'CLI-1001',
        companyName: 'Apex Lifestyle Bangladesh',
        contactPerson: 'Kamrul Hassan (Marketing Director)',
        email: 'marketing@apexlifestyle.com.bd',
        phone: '+880 1712 345678',
        whatsapp: '+880 1712 345678',
        website: 'https://apexlifestyle.com.bd',
        address: 'Tejgaon I/A, Dhaka',
        city: 'Dhaka',
        country: 'Bangladesh',
        clientType: 'HYBRID',
        status: 'ACTIVE',
        billingCurrency: 'BDT',
        outstandingBalance: 85000,
      },
    })

    // Add credentials for client 1
    await prisma.clientCredential.createMany({
      data: [
        {
          clientId: client1.id,
          title: 'Namecheap Domain Registrar',
          category: 'DOMAIN',
          loginUrl: 'https://namecheap.com',
          username: 'apex_domains',
          password: 'DomainPassword2026!',
          notes: 'Auto-renews every November',
        },
        {
          clientId: client1.id,
          title: 'Hostinger Cloud VPS',
          category: 'HOSTING',
          loginUrl: 'https://hpanel.hostinger.com',
          username: 'admin@apexlifestyle.com.bd',
          password: 'HostingerPass#987',
          notes: 'Server IP: 185.192.12.44',
        },
        {
          clientId: client1.id,
          title: 'Shopify / WooCommerce Admin',
          category: 'CMS_ADMIN',
          loginUrl: 'https://apexlifestyle.com.bd/admin',
          username: 'artyx_admin',
          password: 'ShopifySecurePass2026',
        },
      ],
    })

    // Add monthly marketing retainer for client 1
    await prisma.clientRetainer.create({
      data: {
        clientId: client1.id,
        serviceName: 'Meta Ads & Creative Content Marketing Retainer',
        monthlyFee: 65000,
        billingDay: 1,
        currency: 'BDT',
        isActive: true,
      },
    })

    // Add custom software project for client 1
    const project1 = await prisma.agencyProject.create({
      data: {
        projectCode: 'PRJ-1001',
        clientId: client1.id,
        name: 'Custom Mobile App & E-Commerce Integration',
        serviceCategory: 'Software Development',
        contractValue: 250000,
        status: 'IN_PROGRESS',
        description: 'React Native mobile application integrated with existing store.',
      },
    })

    // Add sample invoice
    const inv1 = await prisma.agencyInvoice.create({
      data: {
        invoiceNumber: 'INV-2026-0001',
        clientId: client1.id,
        projectId: project1.id,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        subtotal: 150000,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        totalAmount: 150000,
        paidAmount: 65000,
        dueAmount: 85000,
        currency: 'BDT',
        status: 'PARTIAL',
        notes: '50% Advance milestone for mobile application design & alpha build.',
        items: {
          create: [
            {
              description: 'Mobile App Architecture, UI/UX Wireframes & Design System',
              serviceCategory: 'Software Development',
              quantity: 1,
              unitPrice: 65000,
              totalPrice: 65000,
            },
            {
              description: 'Frontend Core Screen Implementation (Sprint 1 & 2)',
              serviceCategory: 'Software Development',
              quantity: 1,
              unitPrice: 85000,
              totalPrice: 85000,
            },
          ],
        },
      },
    })

    // Add payment for invoice 1
    await prisma.agencyPayment.create({
      data: {
        paymentNumber: 'PAY-2026-0001',
        invoiceId: inv1.id,
        clientId: client1.id,
        amount: 65000,
        paymentMethod: 'BANK_TRANSFER',
        bankAccountId: mainBank.id,
        reference: 'BRAC-EFT-9921',
        notes: 'Wire payment for sprint 1 milestone',
      },
    })

    // Client ledger
    await prisma.clientLedger.createMany({
      data: [
        {
          clientId: client1.id,
          date: new Date(),
          type: 'DEBIT',
          amount: 150000,
          balance: 150000,
          reference: 'INV-2026-0001',
          description: 'Invoice INV-2026-0001 issued',
        },
        {
          clientId: client1.id,
          date: new Date(),
          type: 'CREDIT',
          amount: 65000,
          balance: 85000,
          reference: 'PAY-2026-0001',
          description: 'Payment PAY-2026-0001 received via Bank Wire',
        },
      ],
    })

    console.log('✅ Demo Client (Apex Lifestyle) with credentials, project, invoice & payment seeded')
  }

  console.log('✨ Artyx Digital Agency Platform seeded successfully!')
}

seedAgency()
  .catch(e => {
    console.error('❌ Seeding error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
