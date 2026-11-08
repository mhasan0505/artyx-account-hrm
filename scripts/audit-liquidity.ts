/**
 * scripts/audit-liquidity.ts
 *
 * Forensic Liquidity & Cash/Bank Synchronization Auditor:
 * 1. Audits BankAccount.currentBalance vs BankTransaction history vs AccountLedgerEntry (COA 1200/1110).
 * 2. Audits CashDrawer balances vs DrawerTransaction history vs AccountLedgerEntry (COA 1100).
 * 3. Identifies every transaction where payments flowed into/out of Bank or Cash without symmetric General Ledger synchronization.
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

async function auditLiquidity() {
  console.log('================================================================================')
  console.log('🏦 [LIQUIDITY & DUAL-SOURCE SYNCHRONIZATION AUDITOR]')
  console.log('================================================================================\n')

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Chart of Accounts Lookup
  // ─────────────────────────────────────────────────────────────────────────────
  const coaAccounts = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: ['1100', '1110', '1200', '1300', '1400', '2100', '3000', '3200', '4100', '4200', '5000', '5290', '5291'] },
    },
    select: { id: true, code: true, name: true },
  })
  const coaMap = new Map(coaAccounts.map(a => [a.code, a]))

  console.log('Chart of Accounts Identified:')
  for (const c of coaAccounts) {
    console.log(`  - Code ${c.code}: ${c.name} (ID: ${c.id})`)
  }
  console.log('')

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Bank Accounts vs Bank Transactions vs GL (1200/1110)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--------------------------------------------------------------------------------')
  console.log('PHASE 1: BANK & MFS ACCOUNTS AUDIT')
  console.log('--------------------------------------------------------------------------------')

  const bankAccounts = await prisma.bankAccount.findMany({
    include: {
      transactions: true,
    },
    orderBy: { accountName: 'asc' },
  })

  let totalBankCurrentBalance = 0
  let totalBankTxCalculatedBalance = 0

  console.log(`Found ${bankAccounts.length} Bank / MFS Accounts:\n`)

  for (const b of bankAccounts) {
    const curBal = round2(Number(b.currentBalance || 0))
    totalBankCurrentBalance = round2(totalBankCurrentBalance + curBal)

    const deposits = round2(
      b.transactions
        .filter(t => t.type === 'DEPOSIT' || t.type === 'TRANSFER_IN')
        .reduce((sum, t) => sum + Number(t.amount), 0)
    )
    const withdrawals = round2(
      b.transactions
        .filter(t => t.type === 'WITHDRAWAL' || t.type === 'TRANSFER_OUT')
        .reduce((sum, t) => sum + Number(t.amount), 0)
    )
    const txCalculatedBalance = round2(deposits - withdrawals)
    totalBankTxCalculatedBalance = round2(totalBankTxCalculatedBalance + txCalculatedBalance)

    const diff = round2(curBal - txCalculatedBalance)

    console.log(`🏛️ [${b.bankName}] ${b.accountName} (${b.accountNumber || 'No Acc#'})`)
    console.log(`   - ID                          : ${b.id}`)
    console.log(`   - BankAccount.currentBalance  : ৳${curBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    console.log(`   - BankTransaction Net History : ৳${txCalculatedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${b.transactions.length} txns: +৳${deposits.toLocaleString()} / -৳${withdrawals.toLocaleString()})`)
    if (Math.abs(diff) > 0.01) {
      console.log(`   - ⚠️ Local Drift (Col vs Txns) : ৳${diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    } else {
      console.log(`   - ✓ Local Balance Matches BankTransaction history perfectly.`)
    }
  }

  console.log(`\nTotal BankAccount.currentBalance sum: ৳${totalBankCurrentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`Total BankTransaction History sum   : ৳${totalBankTxCalculatedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  // Check AccountLedgerEntry for Code 1200 and 1110
  const bankGlEntries = await prisma.accountLedgerEntry.findMany({
    where: {
      account: {
        code: { in: ['1110', '1200'] },
      },
    },
    include: { account: true },
  })

  const bankGlDebits = round2(
    bankGlEntries.filter(e => e.type === TransactionType.DEBIT).reduce((sum, e) => sum + Number(e.amount), 0)
  )
  const bankGlCredits = round2(
    bankGlEntries.filter(e => e.type === TransactionType.CREDIT).reduce((sum, e) => sum + Number(e.amount), 0)
  )
  const bankGlNet = round2(bankGlDebits - bankGlCredits)

  console.log(`\n🏦 General Ledger Bank Accounts (COA 1110 & 1200):`)
  console.log(`   - Total Debits (Inflow)  : ৳${bankGlDebits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${bankGlEntries.filter(e => e.type === TransactionType.DEBIT).length} entries)`)
  console.log(`   - Total Credits (Outflow): ৳${bankGlCredits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${bankGlEntries.filter(e => e.type === TransactionType.CREDIT).length} entries)`)
  console.log(`   - Net Bank Position in GL: ৳${bankGlNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`   - 🚨 DISCONNECT (Bank UI ৳${totalBankCurrentBalance.toLocaleString()} vs GL ৳${bankGlNet.toLocaleString()}): ৳${round2(totalBankCurrentBalance - bankGlNet).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Cash Drawer vs Drawer Transactions vs GL (1100)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------------------------')
  console.log('PHASE 2: CASH DRAWER & CASH IN HAND AUDIT')
  console.log('--------------------------------------------------------------------------------')

  const drawers = await prisma.cashDrawer.findMany({
    include: {
      transactions: true,
      outlet: { select: { name: true } },
    },
    orderBy: { openedAt: 'desc' },
  })

  console.log(`Found ${drawers.length} Cash Drawers in system:\n`)

  let totalActiveDrawerBalance = 0

  for (const d of drawers) {
    const curBal = round2(Number(d.currentBalance || 0))
    const opBal = round2(Number(d.openingBalance || 0))
    const txSum = round2(d.transactions.reduce((sum, t) => sum + Number(t.amount), 0))
    const expectedBal = round2(opBal + txSum)

    if (d.status === 'OPEN') {
      totalActiveDrawerBalance = round2(totalActiveDrawerBalance + curBal)
    }

    console.log(`💵 [${d.status}] Drawer ${d.id} | Outlet: ${d.outlet?.name || d.outletId}`)
    console.log(`   - Opening Balance          : ৳${opBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    console.log(`   - Drawer.currentBalance    : ৳${curBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    console.log(`   - Transactions Total (${d.transactions.length})  : ৳${txSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    console.log(`   - Expected Balance (Op+Txn): ৳${expectedBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  }

  const cashGlEntries = await prisma.accountLedgerEntry.findMany({
    where: { account: { code: '1100' } },
    include: { account: true },
  })

  const cashGlDebits = round2(
    cashGlEntries.filter(e => e.type === TransactionType.DEBIT).reduce((sum, e) => sum + Number(e.amount), 0)
  )
  const cashGlCredits = round2(
    cashGlEntries.filter(e => e.type === TransactionType.CREDIT).reduce((sum, e) => sum + Number(e.amount), 0)
  )
  const cashGlNet = round2(cashGlDebits - cashGlCredits)

  console.log(`\n💵 General Ledger Cash in Hand (COA 1100):`)
  console.log(`   - Total Debits (Inflow)  : ৳${cashGlDebits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${cashGlEntries.filter(e => e.type === TransactionType.DEBIT).length} entries)`)
  console.log(`   - Total Credits (Outflow): ৳${cashGlCredits.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${cashGlEntries.filter(e => e.type === TransactionType.CREDIT).length} entries)`)
  console.log(`   - Net Cash Position in GL: ৳${cashGlNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`   - Active Cash Drawer UI  : ৳${totalActiveDrawerBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`   - Disconnect (GL vs Drawer UI): ৳${round2(cashGlNet - totalActiveDrawerBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Trace Non-Cash Payments (Sales, Purchases, ContraTransfers, Fixed Assets)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------------------------')
  console.log('PHASE 3: FORENSIC TRANSACTION TRACE (WHERE DID BANK PAYMENTS GO?)')
  console.log('--------------------------------------------------------------------------------')

  // Check Sales Payments
  const salesWithPayments = await prisma.sale.findMany({
    where: { isQuotation: false, status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
    include: {
      payments: true,
      ledgerEntries: { include: { account: true } },
    },
  })

  let salesBankPaymentsTotal = 0
  let salesCashPaymentsTotal = 0
  let salesMissingBankGlCount = 0

  for (const s of salesWithPayments) {
    for (const p of s.payments) {
      const amt = Number(p.amount)
      if (p.method === 'CASH') {
        salesCashPaymentsTotal += amt
      } else {
        salesBankPaymentsTotal += amt
        // Check if GL entry was created as 1100 (Cash) instead of 1200 (Bank) or not created at all
        const bankGl = s.ledgerEntries.find(e => e.account.code === '1200' || e.account.code === '1110')
        const cashGl = s.ledgerEntries.find(e => e.account.code === '1100')
        if (!bankGl) {
          salesMissingBankGlCount++
          console.log(`⚠️ Sale ${s.saleNumber}: Paid ৳${amt} via ${p.method} (Bank Acc: ${p.bankAccountId || 'None'}), but GL has NO COA 1200 entry! (Cash GL: ${cashGl ? `৳${cashGl.amount}` : 'None'})`)
        }
      }
    }
  }

  console.log(`\nSales Payments Audit:`)
  console.log(`  - Total Cash Payments on Sales : ৳${round2(salesCashPaymentsTotal).toLocaleString()}`)
  console.log(`  - Total Bank/MFS Payments      : ৳${round2(salesBankPaymentsTotal).toLocaleString()}`)
  console.log(`  - Sales with Missing Bank GL   : ${salesMissingBankGlCount}`)

  // Check Contra Transfers
  const contraTransfers = await prisma.contraTransfer.findMany({
    where: { status: 'APPROVED' },
    include: { bankAccount: true, drawer: true },
  })
  console.log(`\nContra Transfers (Approved): ${contraTransfers.length}`)
  for (const ct of contraTransfers) {
    console.log(`  - [${ct.type}] ৳${Number(ct.amount)} | Bank: ${ct.bankAccount?.accountName || ct.bankAccountId} | Drawer: ${ct.drawerId}`)
  }

  // Check Fixed Assets
  const fixedAssets = await prisma.fixedAsset.findMany({
    where: { fundingSource: 'NEW_PURCHASE' },
    include: { bankAccount: true },
  })
  console.log(`\nFixed Assets (New Purchases): ${fixedAssets.length}`)
  for (const fa of fixedAssets) {
    console.log(`  - Asset: ${fa.name} | Cost: ৳${Number(fa.acquisitionCost)} | Bank: ${fa.bankAccount?.accountName || fa.bankAccountId} | Drawer: ${fa.drawerId}`)
  }

  console.log('\n================================================================================')
  console.log('🏁 LIQUIDITY AUDIT COMPLETE')
  console.log('================================================================================\n')
}

auditLiquidity()
  .catch(err => console.error('❌ Liquidity audit failed:', err))
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
