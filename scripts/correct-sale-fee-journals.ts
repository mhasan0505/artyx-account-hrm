import { prisma } from '../lib/db'
import { TransactionType } from '@prisma/client'

/**
 * ==============================================================================
 * SCRIPT: correct-sale-fee-journals.ts
 * ==============================================================================
 * Corrects historical unbalanced Sale journal entries caused by gross vs. net
 * payment gateway fee over-debits in Account 1200.
 *
 * THE ACCOUNTING REPAIR:
 * In legacy checkout journals, Account 1200 (Bank Asset) was debited for the
 * gross payment amount while Account 5290 (Fee Expense) was also debited for
 * the fee amount, resulting in Total Debits = Gross + Fee vs Total Credits = Gross.
 * To bring the sale group into balance, this script posts exactly ONE entry per sale:
 *   - Cr 1200 (Bank Asset) for the fee amount
 *   - referenceType: 'SaleFeeCorrection'
 *   - referenceId: saleId
 *
 * SAFETY INVARIANTS:
 * 1. Default mode is DRY-RUN: Prints adjusting entries without modifying the database.
 * 2. Writes ONLY when explicit '--confirm' CLI argument is passed.
 * 3. IDEMPOTENT: Skips any Sale that already has associated entries with
 *    referenceType === 'SaleFeeCorrection'.
 *
 * POSTING DATE TRADE-OFF (--post-date=today|original, default: 'today'):
 * ------------------------------------------------------------------------------
 * - 'today' (Recommended for GAAP / Audit):
 *   Posts adjusting entries as of today's date. This preserves the financial
 *   closure of prior closed accounting periods, ensuring historical tax and
 *   financial statements remain unchanged while rectifying current balance sheet
 *   and account balances in the active period.
 *
 * - 'original':
 *   Backdates adjusting entries to the original sale's 'createdAt' date. This
 *   achieves perfect historical symmetry for individual sales journals, but
 *   alters historical trial balance and ledger reports for previously closed
 *   fiscal periods.
 * ==============================================================================
 */

async function main() {
  const args = process.argv.slice(2)
  const isConfirm = args.includes('--confirm')
  const postDateArg = args.find(a => a.startsWith('--post-date='))
  const postDateMode = postDateArg ? postDateArg.split('=')[1] : 'today'

  if (postDateMode !== 'today' && postDateMode !== 'original') {
    console.error("Invalid --post-date option. Must be 'today' or 'original'.")
    process.exit(1)
  }

  console.log('=== SALE FEE JOURNAL ENTRY CORRECTION SCRIPT ===')
  console.log(`Execution Mode: ${isConfirm ? '🔴 LIVE WRITE (--confirm)' : '🟢 DRY RUN (Read-Only Preview)'}`)
  console.log(`Posting Date Mode: ${postDateMode}`)
  console.log('Timestamp:', new Date().toISOString())

  // Find Account 1200 (Bank Asset)
  const bankAcc = await prisma.chartOfAccount.findUnique({
    where: { code: '1200' },
    select: { id: true, code: true, name: true },
  })

  if (!bankAcc) {
    console.error('Account 1200 (Bank Asset) not found in Chart of Accounts.')
    process.exit(1)
  }

  // Find all sales with ledger entries
  const sales = await prisma.sale.findMany({
    select: {
      id: true,
      saleNumber: true,
      createdAt: true,
      payments: {
        select: { feeAmount: true },
      },
    },
  })

  // Get all existing ledger entries for sales and existing corrections
  const allEntries = await prisma.accountLedgerEntry.findMany({
    where: {
      referenceType: { in: ['Sale', 'SaleFeeCorrection'] },
    },
    select: {
      id: true,
      referenceType: true,
      referenceId: true,
      type: true,
      amount: true,
    },
  })

  // Set of sales that already have corrections, and group debit/credit accumulators
  const correctedSaleIds = new Set<string>()
  const saleDebitSum = new Map<string, number>()
  const saleCreditSum = new Map<string, number>()

  for (const entry of allEntries) {
    if (entry.referenceType === 'SaleFeeCorrection' && entry.referenceId) {
      correctedSaleIds.add(entry.referenceId)
      // Accumulate correction credit into sale's credit total
      const amt = Number(entry.amount) || 0
      if (entry.type === 'CREDIT') {
        saleCreditSum.set(entry.referenceId, (saleCreditSum.get(entry.referenceId) || 0) + amt)
      }
    } else if (entry.referenceType === 'Sale' && entry.referenceId) {
      const amt = Number(entry.amount) || 0
      if (entry.type === 'DEBIT') {
        saleDebitSum.set(entry.referenceId, (saleDebitSum.get(entry.referenceId) || 0) + amt)
      } else if (entry.type === 'CREDIT') {
        saleCreditSum.set(entry.referenceId, (saleCreditSum.get(entry.referenceId) || 0) + amt)
      }
    }
  }

  const eligibleCorrections: Array<{
    saleId: string
    saleNumber: string
    saleDate: Date
    debitTotal: number
    creditTotal: number
    difference: number
    feeTotal: number
  }> = []

  for (const sale of sales) {
    // Idempotency: skip if already corrected
    if (correctedSaleIds.has(sale.id)) continue

    const debits = saleDebitSum.get(sale.id) || 0
    const credits = saleCreditSum.get(sale.id) || 0
    const diff = Math.round((debits - credits) * 100) / 100

    const feeTotal = Math.round(
      sale.payments.reduce((s, p) => s + (Number(p.feeAmount) || 0), 0) * 100
    ) / 100

    // Only correct if debits exceed credits by exactly the fee total (within 1 cent)
    if (diff > 0.01 && feeTotal > 0 && Math.abs(diff - feeTotal) <= 0.01) {
      eligibleCorrections.push({
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        saleDate: sale.createdAt,
        debitTotal: debits,
        creditTotal: credits,
        difference: diff,
        feeTotal,
      })
    }
  }

  console.log(`\nFound ${eligibleCorrections.length} candidate sales for fee adjustment.`)

  if (eligibleCorrections.length === 0) {
    console.log('No unbalanced sales matching fee discrepancies require correction.')
    return
  }

  console.table(
    eligibleCorrections.map(c => ({
      saleNumber: c.saleNumber,
      debits: c.debitTotal.toFixed(2),
      credits: c.creditTotal.toFixed(2),
      feeTotal: c.feeTotal.toFixed(2),
      adjustmentNeeded: `Cr 1200: ৳${c.feeTotal.toFixed(2)} (referenceType: SaleFeeCorrection)`,
    }))
  )

  if (!isConfirm) {
    console.log('\n[DRY RUN COMPLETE] To create adjusting entries, execute with: --confirm')
    return
  }

  console.log('\nExecuting live adjustments inside transaction...')
  const now = new Date()

  await prisma.$transaction(async tx => {
    for (const item of eligibleCorrections) {
      const entryDate = postDateMode === 'original' ? item.saleDate : now

      // Post exactly ONE entry per sale: Cr 1200 for the fee amount (no equity entry)
      await tx.accountLedgerEntry.create({
        data: {
          accountId: bankAcc.id,
          type: TransactionType.CREDIT,
          amount: item.feeTotal,
          description: `Fee adjustment: Reverse over-debit for Sale ${item.saleNumber}`,
          referenceId: item.saleId,
          referenceType: 'SaleFeeCorrection',
          createdAt: entryDate,
        },
      })

      console.log(`Created adjusting entry for Sale ${item.saleNumber} (${item.saleId}): Cr 1200 ৳${item.feeTotal}`)
    }
  })

  console.log(`\n✅ Successfully created ${eligibleCorrections.length} adjusting ledger entries (Cr 1200).`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error('Correction script failed:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
