/**
 * scripts/heal-service-revenue.ts
 *
 * Retroactive Financial Data Healer for Service & Repair Jobs
 * Reconciles missing Double-Entry General Ledger (AccountLedgerEntry),
 * Cash Drawer (DrawerTransaction), and Bank (BankTransaction) records
 * for past Service Invoices and Payments.
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import {
  BankTransactionType,
  InvoiceStatus,
  PaymentMethod,
  PrismaClient,
  TransactionType,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres'

const needsSsl = /sslmode=require|sslmode=verify-full|neon\.tech|ssl=/.test(
  connectionString
)

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 2,
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function healServiceRevenue() {
  console.log('🔧 [Heal Service Revenue] Starting financial audit and retroactive reconciliation...\n')

  // 1. Fetch Chart of Accounts
  const coaAccounts = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: ['1100', '1200', '1300', '1400', '4200', '5000', '5290', '5291', '5299'] },
    },
    select: { id: true, code: true, name: true },
  })

  const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
  console.log(`📊 Loaded ${coaAccounts.length} Chart of Accounts codes:`)
  for (const a of coaAccounts) {
    console.log(`   - Code ${a.code}: ${a.name} (ID: ${a.id})`)
  }

  const cashAccountId = coaMap.get('1100')
  const bankAssetAccountId = coaMap.get('1200')
  const accountsReceivableAccountId = coaMap.get('1300')
  const inventoryAccountId = coaMap.get('1400')
  const serviceRevenueAccountId = coaMap.get('4200')
  const cogsAccountId = coaMap.get('5000')

  if (!serviceRevenueAccountId || !cashAccountId) {
    throw new Error('Critical COA accounts (4200 Service Revenue / 1100 Cash in Hand) are missing from database.')
  }

  // 2. Fetch all Service Invoices with relations
  const invoices = await prisma.serviceInvoice.findMany({
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          outletId: true,
          customerId: true,
          status: true,
        },
      },
      payments: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n📋 Found ${invoices.length} Service Invoices in the database.`)

  let healedInvoiceCount = 0
  let generatedLedgerCount = 0
  let generatedDrawerTxCount = 0
  let generatedBankTxCount = 0
  let totalRevenueReconciled = 0
  let totalCashInjected = 0
  let totalBankInjected = 0

  for (const inv of invoices) {
    console.log(`\n▶ Processing Invoice ${inv.invoiceNumber} (Job: ${inv.job?.jobNumber || 'N/A'})...`)
    const invTotal = Number(inv.total)
    const invLabor = Number(inv.laborCost)
    const invParts = Number(inv.partsCost)
    const targetOutletId = inv.job?.outletId || ''

    // Calculate actual payments
    const cashPaid = inv.payments
      .filter(p => p.method === PaymentMethod.CASH)
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const nonCashPaid = inv.payments
      .filter(p => p.method !== PaymentMethod.CASH)
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const totalPaid = cashPaid + nonCashPaid
    const dueAmount = Math.max(0, invTotal - totalPaid)

    // Check existing AccountLedgerEntry records for this invoice
    const existingLedgerEntries = await prisma.accountLedgerEntry.findMany({
      where: {
        referenceId: inv.id,
        referenceType: 'ServiceInvoice',
      },
    })

    if (existingLedgerEntries.length === 0 && invTotal > 0) {
      console.log(`   ⚠️ Missing General Ledger entries for Invoice ${inv.invoiceNumber}. Rebuilding...`)

      const ledgerEntries: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = []

      // Cr Service Revenue
      if (serviceRevenueAccountId && invTotal > 0) {
        ledgerEntries.push({
          accountId: serviceRevenueAccountId,
          type: TransactionType.CREDIT,
          amount: invTotal,
          description: `Service Revenue — Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
      }

      // Dr Cash in Hand
      if (cashAccountId && cashPaid > 0) {
        ledgerEntries.push({
          accountId: cashAccountId,
          type: TransactionType.DEBIT,
          amount: cashPaid,
          description: `Cash Payment — Service Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
      }

      // Dr Bank Accounts
      if (bankAssetAccountId && nonCashPaid > 0) {
        ledgerEntries.push({
          accountId: bankAssetAccountId,
          type: TransactionType.DEBIT,
          amount: nonCashPaid,
          description: `Bank/MFS Payment — Service Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
      }

      // Dr Accounts Receivable
      if (accountsReceivableAccountId && dueAmount > 0) {
        ledgerEntries.push({
          accountId: accountsReceivableAccountId,
          type: TransactionType.DEBIT,
          amount: dueAmount,
          description: `Accounts Receivable — Service Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
      }

      // Dr COGS & Cr Inventory for consumed parts
      if (cogsAccountId && inventoryAccountId && invParts > 0) {
        ledgerEntries.push({
          accountId: cogsAccountId,
          type: TransactionType.DEBIT,
          amount: invParts,
          description: `Service Parts COGS — Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
        ledgerEntries.push({
          accountId: inventoryAccountId,
          type: TransactionType.CREDIT,
          amount: invParts,
          description: `Service Parts Inventory Deduction — Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'ServiceInvoice',
          createdAt: inv.createdAt,
        })
      }

      if (ledgerEntries.length > 0) {
        await prisma.accountLedgerEntry.createMany({
          data: ledgerEntries,
        })
        generatedLedgerCount += ledgerEntries.length
        totalRevenueReconciled += invTotal
        console.log(`   ✅ Injected ${ledgerEntries.length} General Ledger entries (Revenue: ৳${invTotal}).`)
      }
    } else {
      console.log(`   ✓ General Ledger already intact (${existingLedgerEntries.length} entries found).`)
    }

    // Check Cash Drawer Transaction for cash payments
    if (cashPaid > 0) {
      const existingDrawerTx = await prisma.drawerTransaction.findFirst({
        where: {
          description: { contains: inv.invoiceNumber },
        },
      })

      if (!existingDrawerTx) {
        console.log(`   ⚠️ Missing Cash Drawer transaction for cash payment (৳${cashPaid}). Linking to drawer...`)

        // Find an open or recent drawer for the outlet
        const drawer =
          (await prisma.cashDrawer.findFirst({
            where: {
              outletId: targetOutletId,
              status: 'OPEN',
            },
            orderBy: { openedAt: 'desc' },
          })) ||
          (await prisma.cashDrawer.findFirst({
            where: { outletId: targetOutletId },
            orderBy: { openedAt: 'desc' },
          }))

        if (drawer) {
          await prisma.drawerTransaction.create({
            data: {
              drawerId: drawer.id,
              type: 'SERVICE_PAYMENT',
              amount: cashPaid,
              description: `Service Payment Invoice ${inv.invoiceNumber}`,
              createdAt: inv.createdAt,
            },
          })
          generatedDrawerTxCount++
          totalCashInjected += cashPaid
          console.log(`   ✅ Linked ৳${cashPaid} cash payment to Drawer [${drawer.id}]`)
        } else {
          console.warn(`   ⚠️ No cash drawer found for outlet [${targetOutletId}]. Unable to link drawer transaction.`)
        }
      }
    }

    // Check Bank Transactions for bank/MFS payments
    for (const p of inv.payments) {
      if (p.method !== PaymentMethod.CASH && Number(p.amount) > 0 && p.bankAccountId) {
        const existingBankTx = await prisma.bankTransaction.findFirst({
          where: {
            referenceId: inv.id,
            referenceType: 'ServiceInvoice',
          },
        })

        if (!existingBankTx) {
          console.log(`   ⚠️ Missing BankTransaction for ${p.method} (৳${p.amount}). Recording...`)
          await prisma.bankTransaction.create({
            data: {
              bankAccountId: p.bankAccountId,
              type: BankTransactionType.DEPOSIT,
              amount: Number(p.amount),
              description: `Service Invoice Payment ${inv.invoiceNumber}`,
              referenceId: inv.id,
              referenceType: 'ServiceInvoice',
              createdAt: p.paidAt,
            },
          })
          generatedBankTxCount++
          totalBankInjected += Number(p.amount)
          console.log(`   ✅ Created BankTransaction for BankAccount [${p.bankAccountId}].`)
        }
      }
    }

    healedInvoiceCount++
  }

  // 3. Scan for Completed/Delivered Service Jobs that have finalCost but NO ServiceInvoice
  const uninvoicedCompletedJobs = await prisma.serviceJob.findMany({
    where: {
      invoice: null,
      status: { in: ['COMPLETED', 'DELIVERED'] },
      OR: [
        { finalCost: { gt: 0 } },
        { estimatedCost: { gt: 0 } },
      ],
    },
    include: {
      customer: { select: { name: true, phone: true } },
    },
  })

  console.log('\n─────────────────────────────────────────────────────────────────────────────')
  console.log('🏁 RECONCILIATION SUMMARY REPORT')
  console.log('─────────────────────────────────────────────────────────────────────────────')
  console.log(`Invoices Audited & Reconciled: ${healedInvoiceCount}`)
  console.log(`Double-Entry GL Entries Generated: ${generatedLedgerCount}`)
  console.log(`Cash Drawer Transactions Injected: ${generatedDrawerTxCount}`)
  console.log(`Bank Transactions Created: ${generatedBankTxCount}`)
  console.log(`Total Service Revenue Reconciled: ৳${totalRevenueReconciled.toLocaleString()}`)
  console.log(`Total Cash Liquidity Injected: ৳${totalCashInjected.toLocaleString()}`)
  console.log(`Total Bank Liquidity Injected: ৳${totalBankInjected.toLocaleString()}`)

  if (uninvoicedCompletedJobs.length > 0) {
    console.log(`\n⚠️  FOUND ${uninvoicedCompletedJobs.length} COMPLETED SERVICE JOB(S) WITH NO INVOICE ATTACHED:`)
    for (const job of uninvoicedCompletedJobs) {
      console.log(
        `   - Ticket: ${job.jobNumber} | Customer: ${job.customer?.name || 'Walk-in'} | Status: ${job.status} | Final/Est Cost: ৳${job.finalCost || job.estimatedCost}`
      )
    }
    console.log('   (Tip: Create official invoices for these completed tickets in the Service UI to formally book the revenue)')
  }
  console.log('─────────────────────────────────────────────────────────────────────────────\n')
}

healServiceRevenue()
  .catch(err => {
    console.error('❌ Error during service revenue healing:', err)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
