/**
 * Idempotent Phase 1 Live Data Migration & Backfill Script.
 *
 * Run with: npx tsx scripts/backfill-phase1-accounting.ts
 *
 * Safe to run multiple times:
 * 1. Syncs the canonical Agency Chart of Accounts & classifies existing CoA rows into AgencyAccountBuckets.
 * 2. Backfills legacy orphaned AccountLedgerEntry rows (journalEntryId IS NULL) into synthetic POSTED JournalEntry records
 *    and aligns entryDate = createdAt.
 * 3. Backfills AgencyPayment.baseAmount & currency from parent invoice exchangeRate.
 * 4. Backfills Expense.baseAmount & paidDate (for APPROVED expenses).
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { PrismaPg } from '@prisma/adapter-pg'
import {
  JournalEntryStatus,
  JournalSourceType,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { syncAgencyChartOfAccounts } from '../lib/finance/agency-coa-template'
import { round2 } from '../lib/finance/accounting-math'

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawUrl) {
  throw new Error('Missing DATABASE_URL / DIRECT_URL in environment.')
}

const adapter = new PrismaPg({ connectionString: rawUrl })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🔄 Starting Phase 1 Accounting Backfill...\n')

  // 1. Sync Agency Chart of Accounts
  const coaResult = await syncAgencyChartOfAccounts(prisma)
  console.log(
    `✅ Agency CoA synced: ${coaResult.createdCount} created (${coaResult.createdCodes.join(', ') || 'none'}), ${coaResult.updatedCount} classified.`
  )

  // 2. Backfill orphaned AccountLedgerEntry rows into synthetic JournalEntry batches
  const orphanedEntries = await prisma.accountLedgerEntry.findMany({
    where: { journalEntryId: null },
    orderBy: { createdAt: 'asc' },
  })

  if (orphanedEntries.length === 0) {
    console.log('✅ No orphaned AccountLedgerEntry rows found (already backfilled).')
  } else {
    const groups = new Map<string, typeof orphanedEntries>()
    for (const row of orphanedEntries) {
      const minuteBucket = Math.floor(row.createdAt.getTime() / 60000)
      const key =
        row.referenceType && row.referenceId
          ? `${row.referenceType}:${row.referenceId}`
          : `LEGACY:${minuteBucket}:${row.outletId ?? 'HQ'}`
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }

    let createdJournals = 0
    let linkedLines = 0
    let seq = 1

    for (const [key, lines] of groups.entries()) {
      const entryDate = lines[0].createdAt
      const y = entryDate.getFullYear()
      const m = String(entryDate.getMonth() + 1).padStart(2, '0')
      const entryNumber = `JE-MIG-${y}${m}-${String(seq++).padStart(5, '0')}`
      const desc =
        lines[0].description ||
        `Migrated legacy ledger batch (${key})`

      await prisma.$transaction(async tx => {
        const je = await tx.journalEntry.create({
          data: {
            entryNumber,
            entryDate,
            description: desc.slice(0, 240),
            sourceType: JournalSourceType.MIGRATION_BACKFILL,
            sourceId: lines[0].referenceId ?? null,
            status: JournalEntryStatus.POSTED,
          },
        })

        for (const line of lines) {
          await tx.accountLedgerEntry.update({
            where: { id: line.id },
            data: {
              journalEntryId: je.id,
              entryDate: line.createdAt,
            },
          })
          linkedLines += 1
        }
      })
      createdJournals += 1
    }

    console.log(
      `✅ Migrated ${linkedLines} legacy AccountLedgerEntry rows into ${createdJournals} POSTED JournalEntry batches.`
    )
  }

  // 3. Backfill AgencyPayment.baseAmount & currency
  const paymentsToFix = await prisma.agencyPayment.findMany({
    where: { baseAmount: null },
    include: {
      invoice: { select: { currency: true, exchangeRate: true } },
    },
  })

  for (const p of paymentsToFix) {
    const rate = Number(p.invoice.exchangeRate || 1)
    const baseAmt = round2(Number(p.amount) * rate)
    await prisma.agencyPayment.update({
      where: { id: p.id },
      data: {
        currency: p.invoice.currency || 'BDT',
        settlementRate: new Prisma.Decimal(rate),
        baseAmount: new Prisma.Decimal(baseAmt),
        realizedFxGainLoss: new Prisma.Decimal(0),
      },
    })
  }
  console.log(`✅ Backfilled ${paymentsToFix.length} AgencyPayment baseAmount records.`)

  // 4. Backfill Expense.baseAmount & paidDate
  const expensesToFix = await prisma.expense.findMany({
    where: {
      OR: [
        { baseAmount: null },
        { status: 'APPROVED', paidDate: null },
      ],
    },
  })

  for (const exp of expensesToFix) {
    const rate = Number(exp.exchangeRate || 1)
    const baseAmt = round2(Number(exp.amount) * rate)
    await prisma.expense.update({
      where: { id: exp.id },
      data: {
        baseAmount: exp.baseAmount ?? new Prisma.Decimal(baseAmt),
        ...(exp.status === 'APPROVED' && !exp.paidDate
          ? { paidDate: exp.expenseDate }
          : {}),
      },
    })
  }
  console.log(`✅ Backfilled ${expensesToFix.length} Expense baseAmount/paidDate records.`)

  console.log('\n🎉 Phase 1 accounting backfill complete!')
}

main()
  .catch(err => {
    console.error('❌ Backfill failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
