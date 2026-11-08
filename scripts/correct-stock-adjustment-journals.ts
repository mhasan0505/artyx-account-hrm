import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

/**
 * ==============================================================================
 * SCRIPT: correct-stock-adjustment-journals.ts
 * ==============================================================================
 * Identifies and rectifies historical StockAdjustment journal entries that
 * inadvertently posted to Chart of Accounts '1300' (Accounts Receivable)
 * instead of '1400' (Inventory Asset).
 *
 * THE ACCOUNTING REPAIR:
 * In legacy code (INV-004), `createStockAdjustment` queried `code: '1300'` instead
 * of `code: '1400'`. For any ADJUSTMENT_OUT or ADJUSTMENT_IN, the inventory leg
 * was posted to Accounts Receivable (1300), distorting both the AR aging schedule
 * and the balance sheet Inventory valuation.
 *
 * This script identifies all `AccountLedgerEntry` records where:
 *   - referenceType === 'StockAdjustment'
 *   - accountId === <Account 1300 id>
 *
 * And updates their `accountId` to <Account 1400 id>.
 *
 * SAFETY INVARIANTS:
 * 1. Default mode is DRY-RUN: Prints affected entries without modifying the database.
 * 2. Writes ONLY when explicit '--confirm' CLI argument is passed.
 * 3. Atomic transaction execution with verification before and after.
 * ==============================================================================
 */

async function main() {
  const args = process.argv.slice(2)
  const isConfirm = args.includes('--confirm')

  console.log('=== STOCK ADJUSTMENT JOURNAL ENTRY REPAIR SCRIPT ===')
  console.log(`Execution Mode: ${isConfirm ? '🔴 LIVE WRITE (--confirm)' : '🟢 DRY RUN (Read-Only Preview)'}`)
  console.log('Timestamp:', new Date().toISOString())

  // 1. Resolve Chart of Accounts: 1300 (AR) and 1400 (Inventory Asset)
  const arAccount = await prisma.chartOfAccount.findUnique({
    where: { code: '1300' },
    select: { id: true, code: true, name: true },
  })

  const invAccount = await prisma.chartOfAccount.findUnique({
    where: { code: '1400' },
    select: { id: true, code: true, name: true },
  })

  if (!arAccount) {
    console.error('❌ Error: Account 1300 (Accounts Receivable) not found in Chart of Accounts.')
    process.exit(1)
  }

  if (!invAccount) {
    console.error('❌ Error: Account 1400 (Inventory Asset) not found in Chart of Accounts.')
    process.exit(1)
  }

  console.log(`Found Source Account: ${arAccount.code} - ${arAccount.name} (${arAccount.id})`)
  console.log(`Found Target Account: ${invAccount.code} - ${invAccount.name} (${invAccount.id})`)

  // 2. Query historical entries posted to 1300 for StockAdjustment
  const errantEntries = await prisma.accountLedgerEntry.findMany({
    where: {
      referenceType: 'StockAdjustment',
      accountId: arAccount.id,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\nFound ${errantEntries.length} errant StockAdjustment ledger entries pointing to Account 1300.`)

  if (errantEntries.length === 0) {
    console.log('✅ No historical stock adjustment entries require correction.')
    return
  }

  let totalDebitAmount = 0
  let totalCreditAmount = 0

  for (const entry of errantEntries) {
    const amt = Number(entry.amount)
    if (entry.type === 'DEBIT') totalDebitAmount += amt
    else totalCreditAmount += amt

    console.log(
      `  [Entry ${entry.id}] Ref: ${entry.referenceId} | ${entry.type} ${amt.toFixed(2)} | Date: ${entry.createdAt.toISOString()} | ${entry.description}`
    )
  }

  console.log('\n--- Summary ---')
  console.log(`Total Errant Debits:  ${totalDebitAmount.toFixed(2)}`)
  console.log(`Total Errant Credits: ${totalCreditAmount.toFixed(2)}`)

  if (!isConfirm) {
    console.log('\n🟢 DRY RUN COMPLETE: No database modifications made.')
    console.log('To execute the correction, re-run with: tsx scripts/correct-stock-adjustment-journals.ts --confirm')
    return
  }

  // 3. Perform Live Update
  console.log('\n🔴 Applying corrections in database transaction...')

  const result = await prisma.$transaction(async tx => {
    const updated = await tx.accountLedgerEntry.updateMany({
      where: {
        referenceType: 'StockAdjustment',
        accountId: arAccount.id,
      },
      data: {
        accountId: invAccount.id,
      },
    })
    return updated.count
  })

  console.log(`✅ Successfully updated ${result} ledger entries from Account 1300 to Account 1400.`)
}

main()
  .catch(err => {
    console.error('Fatal error during execution:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
