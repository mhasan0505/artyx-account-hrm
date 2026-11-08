/**
 * scripts/heal-balance-sheet.ts
 *
 * Automated Double-Entry Financial Healer:
 * 1. Corrects corrupted Sale SAL-MSPV0JF7 (updates Account 4100 from ৳0 to ৳45,000).
 * 2. Backfills all missing Purchase Invoices and Purchase Payments into the General Ledger (AccountLedgerEntry).
 * 3. Validates that Inventory Valuation (COA 1400) is restored to positive and verifies the Balance Sheet equation.
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import {
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

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

async function healBalanceSheet() {
  console.log('================================================================================')
  console.log('🩺 [BALANCE SHEET HEALER] Executing Comprehensive Financial Remediation...')
  console.log('================================================================================\n')

  // 1. Resolve Chart of Accounts
  const coaAccounts = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: ['1100', '1200', '1300', '1400', '2100', '4100', '4200', '5000', '5290', '5291', '5299'] },
    },
    select: { id: true, code: true, name: true },
  })
  const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))

  const cashAccountId = coaMap.get('1100')
  const bankAssetAccountId = coaMap.get('1200')
  const arAccountId = coaMap.get('1300')
  const inventoryAccountId = coaMap.get('1400')
  const apAccountId = coaMap.get('2100')
  const salesRevenueAccountId = coaMap.get('4100')

  if (!inventoryAccountId || !apAccountId || !salesRevenueAccountId || !cashAccountId) {
    throw new Error('Critical COA accounts (1100, 1400, 2100, 4100) are missing from database.')
  }

  console.log('✅ Resolved COA Account IDs:')
  console.log(`   - 1100 Cash in Hand        : ${cashAccountId}`)
  console.log(`   - 1200 Bank Accounts       : ${bankAssetAccountId}`)
  console.log(`   - 1300 Accounts Receivable : ${arAccountId}`)
  console.log(`   - 1400 Inventory           : ${inventoryAccountId}`)
  console.log(`   - 2100 Accounts Payable    : ${apAccountId}`)
  console.log(`   - 4100 Sales Revenue       : ${salesRevenueAccountId}\n`)

  await prisma.$transaction(async (tx) => {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: HEAL CORRUPTED SALE SAL-MSPV0JF7
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--------------------------------------------------------------------------------')
    console.log('STEP 1: HEALING CORRUPTED SALE RECORD (SAL-MSPV0JF7)')
    console.log('--------------------------------------------------------------------------------')

    const targetSale = await tx.sale.findFirst({
      where: { saleNumber: 'SAL-MSPV0JF7' },
      select: { id: true, saleNumber: true, total: true },
    })

    if (targetSale) {
      const corruptedRevenueEntry = await tx.accountLedgerEntry.findFirst({
        where: {
          accountId: salesRevenueAccountId,
          type: TransactionType.CREDIT,
          amount: 0,
          OR: [
            { referenceId: targetSale.id },
            { saleId: targetSale.id },
            { description: { contains: 'SAL-MSPV0JF7' } },
          ],
        },
      })

      if (corruptedRevenueEntry) {
        console.log(`Found corrupted revenue entry [${corruptedRevenueEntry.id}] with ৳0.00 credit.`)
        await tx.accountLedgerEntry.update({
          where: { id: corruptedRevenueEntry.id },
          data: {
            amount: 45000,
            description: `Sale ${targetSale.saleNumber}`,
          },
        })
        console.log('✅ Successfully updated Account 4100 credit to ৳45,000.00 for Sale SAL-MSPV0JF7.')
      } else {
        // Check if already 45,000
        const correctEntry = await tx.accountLedgerEntry.findFirst({
          where: {
            accountId: salesRevenueAccountId,
            type: TransactionType.CREDIT,
            amount: 45000,
            OR: [
              { referenceId: targetSale.id },
              { saleId: targetSale.id },
              { description: { contains: 'SAL-MSPV0JF7' } },
            ],
          },
        })
        if (correctEntry) {
          console.log('✓ Sale SAL-MSPV0JF7 revenue entry is already correct at ৳45,000.00.')
        } else {
          console.log('⚠️ Revenue entry for SAL-MSPV0JF7 not found by amount 0. Creating fresh entry...')
          await tx.accountLedgerEntry.create({
            data: {
              accountId: salesRevenueAccountId,
              type: TransactionType.CREDIT,
              amount: 45000,
              description: `Sale ${targetSale.saleNumber}`,
              referenceId: targetSale.id,
              referenceType: 'Sale',
              saleId: targetSale.id,
            },
          })
          console.log('✅ Created missing ৳45,000.00 Sales Revenue entry.')
        }
      }
    } else {
      console.warn('⚠️ Sale SAL-MSPV0JF7 not found by saleNumber in database.')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: BACKFILL MISSING PURCHASE INVOICES & PAYMENTS (GL INJECTION)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--------------------------------------------------------------------------------')
    console.log('STEP 2: BACKFILLING GENERAL LEDGER ENTRIES FOR PURCHASE INVOICES')
    console.log('--------------------------------------------------------------------------------')

    const purchaseInvoices = await tx.purchaseInvoice.findMany({
      include: {
        po: { select: { poNumber: true, status: true } },
        payments: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`Auditing ${purchaseInvoices.length} Purchase Invoices for missing GL double-entries...`)

    let injectedInvoicesCount = 0
    let injectedEntriesCount = 0
    let totalPurchasesInjectedValue = 0
    let totalPaymentsInjectedValue = 0

    for (const inv of purchaseInvoices) {
      const invTotal = Number(inv.total)
      if (invTotal <= 0) continue

      // Check if invoice has existing GL entries
      const existingEntries = await tx.accountLedgerEntry.findMany({
        where: {
          referenceId: inv.id,
          referenceType: 'PurchaseInvoice',
        },
      })

      const hasInventoryDebit = existingEntries.some(
        e => e.accountId === inventoryAccountId && e.type === TransactionType.DEBIT
      )

      if (!hasInventoryDebit) {
        console.log(`▶ Backfilling Invoice ${inv.invoiceNumber} (PO: ${inv.po?.poNumber || 'N/A'}) - Total: ৳${invTotal.toLocaleString()}`)

        const ledgerEntriesToInsert: Array<{
          accountId: string
          type: TransactionType
          amount: number
          description: string
          referenceId: string
          referenceType: string
          createdAt: Date
        }> = []

        // 1. Dr Inventory (1400): Total invoice amount
        ledgerEntriesToInsert.push({
          accountId: inventoryAccountId,
          type: TransactionType.DEBIT,
          amount: invTotal,
          description: `Purchase Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'PurchaseInvoice',
          createdAt: inv.createdAt,
        })

        // 2. Cr Accounts Payable (2100): Total invoice amount
        ledgerEntriesToInsert.push({
          accountId: apAccountId,
          type: TransactionType.CREDIT,
          amount: invTotal,
          description: `Purchase Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'PurchaseInvoice',
          createdAt: inv.createdAt,
        })

        // 3. Process Payments already made against this purchase invoice
        for (const p of inv.payments) {
          const pAmount = Number(p.amount)
          if (pAmount <= 0) continue

          const paymentAssetAccountId =
            p.method === PaymentMethod.CASH ? cashAccountId : bankAssetAccountId

          if (paymentAssetAccountId) {
            // Dr Accounts Payable (2100): Payment reduces AP
            ledgerEntriesToInsert.push({
              accountId: apAccountId,
              type: TransactionType.DEBIT,
              amount: pAmount,
              description: `Payment for Purchase Invoice ${inv.invoiceNumber}`,
              referenceId: inv.id,
              referenceType: 'PurchaseInvoice',
              createdAt: p.paidAt || inv.createdAt,
            })

            // Cr Cash in Hand (1100) or Bank Accounts (1200): Outflow of money
            ledgerEntriesToInsert.push({
              accountId: paymentAssetAccountId,
              type: TransactionType.CREDIT,
              amount: pAmount,
              description: `Payment for Purchase Invoice ${inv.invoiceNumber}`,
              referenceId: inv.id,
              referenceType: 'PurchaseInvoice',
              createdAt: p.paidAt || inv.createdAt,
            })

            totalPaymentsInjectedValue += pAmount
          }
        }

        await tx.accountLedgerEntry.createMany({
          data: ledgerEntriesToInsert,
        })

        injectedInvoicesCount++
        injectedEntriesCount += ledgerEntriesToInsert.length
        totalPurchasesInjectedValue += invTotal
        console.log(`   ✅ Injected ${ledgerEntriesToInsert.length} GL entries for Invoice ${inv.invoiceNumber}`)
      } else {
        console.log(`   ✓ Invoice ${inv.invoiceNumber} already has GL entries. Skipping.`)
      }
    }

    console.log(`\nSummary of GL Injections:`)
    console.log(`  - Purchase Invoices Backfilled: ${injectedInvoicesCount}`)
    console.log(`  - General Ledger Entries Created: ${injectedEntriesCount}`)
    console.log(`  - Total Purchase Value Added to Inventory (1400): ৳${totalPurchasesInjectedValue.toLocaleString()}`)
    console.log(`  - Total Purchase Payments Recorded in GL: ৳${totalPaymentsInjectedValue.toLocaleString()}`)
  }, {
    maxWait: 20000,
    timeout: 120000,
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: POST-REMEDIATION BALANCE SHEET RECALCULATION & VALIDATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------------------------')
  console.log('STEP 3: FINAL BALANCE SHEET VERIFICATION')
  console.log('--------------------------------------------------------------------------------')

  // Assets
  const [cashSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1100'
  `
  const cashOnHand = round2(Number(cashSum?.total || 0))

  const [bankSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1110' OR coa.code = '1200'
  `
  const bankBalances = round2(Number(bankSum?.total || 0))

  const [arSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1300'
  `
  const accountsReceivable = round2(Number(arSum?.total || 0))

  const [invSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '1400'
  `
  const inventoryValue = round2(Number(invSum?.total || 0))

  // Fixed Assets Net
  const fixedAssets = await prisma.fixedAsset.findMany()
  const fixedAssetsNet = round2(
    fixedAssets.reduce((sum, a) => sum + Number(a.acquisitionCost) - Number(a.accumulatedDepreciation || 0), 0)
  )

  const totalAssets = round2(cashOnHand + bankBalances + accountsReceivable + inventoryValue + fixedAssetsNet)

  // Liabilities
  const [apSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "total"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '2100'
  `
  const accountsPayable = round2(Number(apSum?.total || 0))

  const [payrollSum] = await prisma.$queryRaw<{ totalAccrued: number }[]>`
    SELECT COALESCE(SUM("netPayable" - "paidAmount"), 0) as "totalAccrued"
    FROM "PayrollEntry" pe
    WHERE pe.status::text IN ('UNPAID', 'PARTIALLY_PAID')
  `
  const accruedPayroll = round2(Number(payrollSum?.totalAccrued || 0))
  const totalLiabilities = round2(accountsPayable + accruedPayroll)

  // Equity
  const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
    SELECT COALESCE(SUM(ci.amount), 0) as "totalCapital"
    FROM "CapitalInjection" ci WHERE ci.status::text = 'APPROVED'
  `
  const ownersCapital = round2(Number(capitalSum?.totalCapital || 0))

  const [obeSum] = await prisma.$queryRaw<{ totalObe: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END), 0) as "totalObe"
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
    WHERE coa.code = '3200'
  `
  const openingBalanceEquity = round2(Number(obeSum?.totalObe || 0))

  // P&L & Retained Earnings
  const [salesSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(total), 0) as "total" FROM "Sale" WHERE "isQuotation" = false AND status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED')
  `
  const [cogsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(COALESCE(NULLIF(sl."totalCogs", 0), sl.quantity * COALESCE(NULLIF(sl."unitCost", 0), 0))), 0) as "total"
    FROM "SaleLine" sl JOIN "Sale" s ON sl."saleId" = s.id
    WHERE s."isQuotation" = false AND s.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED')
  `
  const [returnsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(total), 0) as "total" FROM "SaleReturn"
  `
  const [returnedCogsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(srl.quantity * (sl."totalCogs" / sl.quantity)), 0) as "total"
    FROM "SaleReturnLine" srl JOIN "SaleLine" sl ON srl."saleLineId" = sl.id
  `
  const netSales = round2(Number(salesSum?.total || 0) - Number(returnsSum?.total || 0))
  const totalCogs = round2(Number(cogsSum?.total || 0) - Number(returnedCogsSum?.total || 0))

  const [expenseSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "total" FROM "Expense" WHERE status::text = 'APPROVED'
  `
  const directExpenses = round2(Number(expenseSum?.total || 0))

  const [payrollExpSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM("netPayable"), 0) as "total" FROM "PayrollEntry"
  `
  const payrollExpenses = round2(Number(payrollExpSum?.total || 0))

  const retainedEarnings = round2(netSales - totalCogs - (directExpenses + payrollExpenses))
  const totalEquity = round2(ownersCapital + openingBalanceEquity + retainedEarnings)

  const discrepancy = round2(totalAssets - (totalLiabilities + totalEquity))

  console.log('\n📊 POST-HEALING BALANCE SHEET STATEMENT:')
  console.log(`  1. Total Assets: ৳${totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Cash on Hand (1100)       : ৳${cashOnHand.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Bank Balances (1110/1200) : ৳${bankBalances.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Receivable (1300): ৳${accountsReceivable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Inventory Valuation (1400): ৳${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Fixed Assets (Net)        : ৳${fixedAssetsNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  2. Total Liabilities: ৳${totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accounts Payable (2100)   : ৳${accountsPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Accrued Payroll           : ৳${accruedPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  3. Total Equity: ৳${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Owner's Capital           : ৳${ownersCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Opening Balance Equity    : ৳${openingBalanceEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`     - Retained Earnings         : ৳${retainedEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`\n  4. Final Balance Sheet Discrepancy: ৳${discrepancy.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  if (Math.abs(discrepancy) < 0.01) {
    console.log('\n🎉 SUCCESS: BALANCE SHEET IS MATHEMATICALLY PERFECT & 100% BALANCED! (Assets == Liabilities + Equity)')
  } else {
    console.log(`\n⚠️ Remaining Variance: ৳${discrepancy.toFixed(2)}`)
  }

  console.log('================================================================================\n')
}

healBalanceSheet()
  .catch(err => {
    console.error('❌ Healing script execution failed:', err)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
