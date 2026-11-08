/**
 * scripts/audit-gl.ts
 *
 * Diagnostic tool to isolate General Ledger imbalances, audit double-entry integrity,
 * analyze Inventory Valuation (COA 1400), and break down the Balance Sheet discrepancy.
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaClient, TransactionType } from '@prisma/client'
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

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

async function auditGl() {
  console.log('================================================================================')
  console.log('🔍 [GL & BALANCE SHEET AUDITOR] Starting Comprehensive Financial Audit...')
  console.log('================================================================================\n')

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Chart of Accounts Mapping
  // ─────────────────────────────────────────────────────────────────────────────
  const coaAccounts = await prisma.chartOfAccount.findMany({
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: 'asc' },
  })
  const coaMap = new Map(coaAccounts.map(a => [a.id, a]))
  const coaByCode = new Map(coaAccounts.map(a => [a.code, a]))

  console.log(`📊 Loaded ${coaAccounts.length} Chart of Accounts in system.\n`)

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Phase 1: Isolate Unbalanced Transactions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--------------------------------------------------------------------------------')
  console.log('PHASE 1: AUDITING DOUBLE-ENTRY INTEGRITY (Dr vs Cr per Transaction)')
  console.log('--------------------------------------------------------------------------------')

  const allLedgerEntries = await prisma.accountLedgerEntry.findMany({
    include: { account: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Total AccountLedgerEntry records found: ${allLedgerEntries.length}`)

  // Group by referenceId, saleId, or unique transaction identifier
  const transactionGroups = new Map<
    string,
    {
      refId: string
      refType: string
      date: Date
      description: string
      debits: number
      credits: number
      entries: typeof allLedgerEntries
    }
  >()

  for (const entry of allLedgerEntries) {
    const key = entry.referenceId
      ? `${entry.referenceType || 'REF'}:${entry.referenceId}`
      : entry.saleId
      ? `Sale:${entry.saleId}`
      : `Entry:${entry.id}`

    const existing = transactionGroups.get(key) || {
      refId: entry.referenceId || entry.saleId || entry.id,
      refType: entry.referenceType || (entry.saleId ? 'Sale' : 'ManualEntry'),
      date: entry.createdAt,
      description: entry.description,
      debits: 0,
      credits: 0,
      entries: [],
    }

    const amt = Number(entry.amount)
    if (entry.type === TransactionType.DEBIT) {
      existing.debits = round2(existing.debits + amt)
    } else {
      existing.credits = round2(existing.credits + amt)
    }
    existing.entries.push(entry)
    transactionGroups.set(key, existing)
  }

  const unbalancedTxs: Array<{
    key: string
    refId: string
    refType: string
    date: Date
    description: string
    debits: number
    credits: number
    variance: number
    entries: typeof allLedgerEntries
  }> = []

  let totalDebitAll = 0
  let totalCreditAll = 0

  for (const [key, tx] of transactionGroups.entries()) {
    totalDebitAll = round2(totalDebitAll + tx.debits)
    totalCreditAll = round2(totalCreditAll + tx.credits)
    const variance = round2(tx.debits - tx.credits)
    if (Math.abs(variance) > 0.01) {
      unbalancedTxs.push({ key, ...tx, variance })
    }
  }

  console.log(`Total Grouped Transactions: ${transactionGroups.size}`)
  console.log(`Global GL Total Debits : ৳${totalDebitAll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`Global GL Total Credits: ৳${totalCreditAll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`Global Trial Balance Variance (Debits - Credits): ৳${round2(totalDebitAll - totalCreditAll).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  if (unbalancedTxs.length === 0) {
    console.log('\n✅ Double-Entry Integrity: All grouped transactions are perfectly balanced (Debits == Credits).')
  } else {
    console.log(`\n❌ Found ${unbalancedTxs.length} UNBALANCED transactions:`)
    let sumVariance = 0
    for (const tx of unbalancedTxs) {
      sumVariance = round2(sumVariance + Math.abs(tx.variance))
      console.log(`\n⚠️  [${tx.refType}] Key: ${tx.key} | Date: ${tx.date.toISOString().split('T')[0]}`)
      console.log(`   Desc: ${tx.description}`)
      console.log(`   Total Debits : ৳${tx.debits.toFixed(2)} | Total Credits: ৳${tx.credits.toFixed(2)} | Variance: ৳${tx.variance.toFixed(2)}`)
      console.log('   Entries breakdown:')
      for (const e of tx.entries) {
        console.log(`     - [${e.type}] ৳${Number(e.amount).toFixed(2)} | Account ${e.account.code} (${e.account.name}) | ${e.description}`)
      }
    }
    console.log(`\nTotal absolute variance across unbalanced transactions: ৳${sumVariance.toFixed(2)}`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Phase 2: Diagnose Negative Inventory (COA 1400) & Missing Purchases
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------------------------')
  console.log('PHASE 2: INVENTORY VALUATION (COA 1400) & PURCHASES AUDIT')
  console.log('--------------------------------------------------------------------------------')

  const invAccount = coaByCode.get('1400')
  if (invAccount) {
    const invEntries = allLedgerEntries.filter(e => e.accountId === invAccount.id)
    const invDebits = round2(
      invEntries
        .filter(e => e.type === TransactionType.DEBIT)
        .reduce((sum, e) => sum + Number(e.amount), 0)
    )
    const invCredits = round2(
      invEntries
        .filter(e => e.type === TransactionType.CREDIT)
        .reduce((sum, e) => sum + Number(e.amount), 0)
    )
    const netInvGl = round2(invDebits - invCredits)

    console.log(`Inventory COA (1400) GL Summary:`)
    console.log(`  - Total Debits (Inventory Inflow) : ৳${invDebits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${invEntries.filter(e => e.type === TransactionType.DEBIT).length} entries)`)
    console.log(`  - Total Credits (Inventory Outflow): ৳${invCredits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${invEntries.filter(e => e.type === TransactionType.CREDIT).length} entries)`)
    console.log(`  - Net Inventory Valuation in GL    : ৳${netInvGl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

    // Audit Purchases in database vs Inventory GL entries
    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      include: {
        po: {
          select: {
            poNumber: true,
            supplierId: true,
            status: true,
            lines: true,
          },
        },
        payments: true,
      },
    })
    const totalPurchaseInvoiceValue = round2(
      purchaseInvoices.reduce((sum, pi) => sum + Number(pi.total), 0)
    )
    const totalPurchasePayments = round2(
      purchaseInvoices.reduce(
        (sum, pi) => sum + pi.payments.reduce((pSum, p) => pSum + Number(p.amount), 0),
        0
      )
    )

    console.log(`\n📦 Purchase Invoices in Database:`)
    console.log(`  - Total Invoices Count: ${purchaseInvoices.length}`)
    console.log(`  - Total Purchase Value: ৳${totalPurchaseInvoiceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    console.log(`  - Total Payments Made : ৳${totalPurchasePayments.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

    const purchaseGlEntries = allLedgerEntries.filter(
      e => e.referenceType === 'PurchaseInvoice' || e.referenceType === 'Purchase' || e.referenceType === 'PurchaseOrder'
    )
    console.log(`  - General Ledger Entries for Purchases: ${purchaseGlEntries.length}`)

    if (purchaseGlEntries.length === 0 && purchaseInvoices.length > 0) {
      console.log(`\n  🚨 ROOT CAUSE DETECTED FOR NEGATIVE INVENTORY:`)
      console.log(`  Purchase Orders & Invoices (৳${totalPurchaseInvoiceValue.toLocaleString()}) were recorded in the procurement module,`)
      console.log(`  but NEVER posted double-entry journal entries (Dr Inventory 1400 / Cr AP 2100 or Cash/Bank) to the General Ledger!`)
      console.log(`  As a result, Sales COGS continually credited Account 1400 (৳${invCredits.toLocaleString()}) without any purchase debits,`)
      console.log(`  driving Inventory Valuation negative to ৳${netInvGl.toLocaleString()}!`)
    }

    // Check Actual Physical Stock Valuation from StockLedger / Products
    const products = await prisma.product.findMany({
      select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true },
    })
    const stockAgg = await prisma.stockLedger.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
    })
    const stockMap = new Map(stockAgg.map(s => [s.productId, s._sum.quantity ?? 0]))

    let physicalStockValuation = 0
    let totalItemsInStock = 0
    for (const p of products) {
      const qty = stockMap.get(p.id) ?? 0
      if (qty > 0) {
        totalItemsInStock += qty
        physicalStockValuation += qty * Number(p.costPrice || 0)
      }
    }
    physicalStockValuation = round2(physicalStockValuation)

    console.log(`\n📦 Physical Stock Valuation (From Product Catalog & StockLedger):`)
    console.log(`  - Total Units In Stock: ${totalItemsInStock}`)
    console.log(`  - Estimated Real Inventory Value (at Cost): ৳${physicalStockValuation.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Phase 3: Comprehensive Balance Sheet Discrepancy Breakdown
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------------------------')
  console.log('PHASE 3: BALANCE SHEET BREAKDOWN & DISCREPANCY RECONCILIATION')
  console.log('--------------------------------------------------------------------------------')

  // Run the exact Balance Sheet queries
  const asOfDate = new Date()

  // 1. Assets
  const [cashSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1100'
  `
  const cashOnHand = round2(Number(cashSum?.total || 0))

  const [bankSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1110' OR coa.code = '1200'
  `
  const bankBalances = round2(Number(bankSum?.total || 0))

  const [arSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1300'
  `
  const accountsReceivable = round2(Number(arSum?.total || 0))

  const [invSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1400'
  `
  const inventoryValue = round2(Number(invSum?.total || 0))

  const [faSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1500'
  `
  const fixedAssetsNet = round2(Number(faSum?.total || 0))

  const totalAssets = round2(cashOnHand + bankBalances + accountsReceivable + inventoryValue + fixedAssetsNet)

  // 2. Liabilities
  const [apSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '2100'
  `
  const accountsPayable = round2(Number(apSum?.total || 0))

  const [payrollSum] = await prisma.$queryRaw<{ totalAccrued: number }[]>`
    SELECT COALESCE(SUM("netPayable" - "paidAmount"), 0) as "totalAccrued"
    FROM "PayrollEntry" pe
    JOIN "PayrollPeriod" pp ON pe."payrollPeriodId" = pp.id
    WHERE pe.status::text IN ('UNPAID', 'PARTIALLY_PAID')
  `
  const accruedPayroll = round2(Number(payrollSum?.totalAccrued || 0))
  const totalLiabilities = round2(accountsPayable + accruedPayroll)

  // 3. Equity
  const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
    SELECT COALESCE(SUM(ci.amount), 0) as "totalCapital"
    FROM "CapitalInjection" ci
    WHERE ci.status::text = 'APPROVED'
  `
  const ownersCapital = round2(Number(capitalSum?.totalCapital || 0))

  const [obeSum] = await prisma.$queryRaw<{ totalObe: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalObe"
    FROM "AccountLedgerEntry" ale
    JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '3200'
  `
  const openingBalanceEquity = round2(Number(obeSum?.totalObe || 0))

  // P&L
  const [glIncomeSum] = await prisma.$queryRaw<{ totalInc: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalInc"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.type::text = 'INCOME'
  `
  const totalRevenue = round2(Number(glIncomeSum?.totalInc || 0))

  const [glExpenseSum] = await prisma.$queryRaw<{ totalExp: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "totalExp"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.type::text = 'EXPENSE'
  `
  const totalExpenses = round2(Number(glExpenseSum?.totalExp || 0))

  const retainedEarnings = round2(totalRevenue - totalExpenses)
  const totalEquity = round2(ownersCapital + openingBalanceEquity + retainedEarnings)

  const discrepancy = round2(totalAssets - (totalLiabilities + totalEquity))

  console.log('Balance Sheet Line Items:')
  console.log(`  1. Total Assets: ৳${totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Cash on Hand (1100)       : ৳${cashOnHand.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Bank Balances (1110/1200) : ৳${bankBalances.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Receivable (1300): ৳${accountsReceivable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Inventory Valuation (1400): ৳${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
     - Fixed Assets (1500)       : ৳${fixedAssetsNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  2. Total Liabilities: ৳${totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Payable (2100)   : ৳${accountsPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accrued Payroll           : ৳${accruedPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  3. Total Equity: ৳${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Owner's Capital           : ৳${ownersCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Opening Balance Equity    : ৳${openingBalanceEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`        · GL Total Revenue       : ৳${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`        · GL Total Expenses/COGS : ৳${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`\n  4. Discrepancy (Assets - [Liabilities + Equity]): ৳${discrepancy.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  console.log('\n================================================================================')
  console.log('🏁 AUDIT COMPLETE')
  console.log('================================================================================\n')
}

auditGl()
  .catch(err => {
    console.error('❌ Audit execution failed:', err)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
