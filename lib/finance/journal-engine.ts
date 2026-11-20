import {
  JournalEntryStatus,
  JournalSourceType,
  Prisma,
  TransactionType,
} from '@prisma/client'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { round2 } from '@/lib/finance/accounting-math'

/**
 * Canonical filter for querying JournalEntry records.
 * ALWAYS excludes VOID entries so voided journals never silently pollute P&L or Trial Balance.
 */
export const POSTED_JOURNAL_WHERE: Prisma.JournalEntryWhereInput = {
  status: JournalEntryStatus.POSTED,
}

/**
 * Canonical filter for querying AccountLedgerEntry rows.
 * Includes:
 *   - Lines belonging to a POSTED JournalEntry
 *   - Legacy pre-migration rows (journalEntryId === null) prior to backfill
 * Explicitly excludes any line attached to a VOID JournalEntry.
 */
export const ACTIVE_LEDGER_ENTRY_WHERE: Prisma.AccountLedgerEntryWhereInput = {
  OR: [
    { journalEntryId: null },
    { journalEntry: { status: JournalEntryStatus.POSTED } },
  ],
}

export interface BalancedJournalLineInput {
  accountId: string
  type: TransactionType
  amount: number
  description: string
  outletId?: string | null
  referenceId?: string | null
  referenceType?: string | null
}

export interface PostBalancedJournalInput {
  entryDate?: Date
  description: string
  sourceType: JournalSourceType
  sourceId?: string | null
  createdById?: string | null
  lines: BalancedJournalLineInput[]
  allowLockedPeriodOverride?: boolean
}

/**
 * Checks whether the target accounting month is locked.
 * Throws `ACCOUNTING_PERIOD_LOCKED` if locked.
 */
export async function assertAccountingPeriodOpen(
  tx: Prisma.TransactionClient,
  entryDate: Date
): Promise<void> {
  const year = entryDate.getFullYear()
  const month = entryDate.getMonth() + 1

  const period = await tx.accountingPeriod.findUnique({
    where: { year_month: { year, month } },
    select: { isLocked: true },
  })

  if (period?.isLocked) {
    const label = `${year}-${String(month).padStart(2, '0')}`
    throw new Error(
      `ACCOUNTING_PERIOD_LOCKED: Accounting period ${label} is closed. Unlock it before posting entries in this period.`
    )
  }
}

/**
 * Atomically validates and posts a balanced double-entry JournalEntry + AccountLedgerEntry lines.
 * - Filters out zero-amount lines
 * - Enforces AccountingPeriod lock
 * - Enforces SUM(Debits) === SUM(Credits) via assertBalancedJournal
 */
export async function postBalancedJournal(
  tx: Prisma.TransactionClient,
  input: PostBalancedJournalInput
) {
  const entryDate = input.entryDate ?? new Date()
  const nonZeroLines = input.lines
    .map(line => ({
      ...line,
      amount: round2(Math.abs(Number(line.amount) || 0)),
    }))
    .filter(line => line.amount > 0)

  if (nonZeroLines.length < 2) {
    throw new Error('JOURNAL_INVALID: A double-entry journal requires at least 2 non-zero lines.')
  }

  if (!input.allowLockedPeriodOverride) {
    await assertAccountingPeriodOpen(tx, entryDate)
  }

  assertBalancedJournal(
    nonZeroLines.map(l => ({
      accountId: l.accountId,
      type: l.type,
      amount: l.amount,
      description: l.description,
      referenceId: l.referenceId ?? input.sourceId ?? undefined,
      referenceType: l.referenceType ?? input.sourceType,
    }))
  )

  const year = entryDate.getFullYear()
  const month = String(entryDate.getMonth() + 1).padStart(2, '0')
  const count = await tx.journalEntry.count({
    where: {
      entryNumber: { startsWith: `JE-${year}${month}-` },
    },
  })
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase()
  const entryNumber = `JE-${year}${month}-${String(count + 1).padStart(4, '0')}-${suffix}`

  const journal = await tx.journalEntry.create({
    data: {
      entryNumber,
      entryDate,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      status: JournalEntryStatus.POSTED,
      createdById: input.createdById ?? null,
      lines: {
        create: nonZeroLines.map(line => ({
          accountId: line.accountId,
          outletId: line.outletId ?? null,
          type: line.type,
          amount: new Prisma.Decimal(line.amount),
          description: line.description,
          referenceId: line.referenceId ?? input.sourceId ?? null,
          referenceType: line.referenceType ?? input.sourceType,
          entryDate,
          createdAt: entryDate,
        })),
      },
    },
    include: {
      lines: true,
    },
  })

  return journal
}

/**
 * Soft-voids a JournalEntry (never hard-deletes).
 * Optionally posts a balanced reversing entry if `createReversal` is true.
 */
export async function voidJournalEntry(
  tx: Prisma.TransactionClient,
  params: {
    journalEntryId: string
    voidedById?: string | null
    reason: string
    createReversal?: boolean
  }
) {
  const existing = await tx.journalEntry.findUnique({
    where: { id: params.journalEntryId },
    include: { lines: true },
  })

  if (!existing) {
    throw new Error('JOURNAL_NOT_FOUND')
  }

  if (existing.status === JournalEntryStatus.VOID) {
    return existing
  }

  await assertAccountingPeriodOpen(tx, existing.entryDate)

  const updated = await tx.journalEntry.update({
    where: { id: existing.id },
    data: {
      status: JournalEntryStatus.VOID,
      voidedAt: new Date(),
      voidedById: params.voidedById ?? null,
      voidReason: params.reason.trim() || 'Voided by accountant',
    },
  })

  if (params.createReversal && existing.lines.length >= 2) {
    const reversal = await postBalancedJournal(tx, {
      entryDate: new Date(),
      description: `Reversal of ${existing.entryNumber}: ${params.reason}`,
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      createdById: params.voidedById ?? null,
      lines: existing.lines.map(l => ({
        accountId: l.accountId,
        type:
          l.type === TransactionType.DEBIT
            ? TransactionType.CREDIT
            : TransactionType.DEBIT,
        amount: Number(l.amount),
        description: `Reversal — ${l.description}`,
        outletId: l.outletId,
        referenceId: l.referenceId,
        referenceType: l.referenceType,
      })),
    })

    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversesEntryId: existing.id },
    })
  }

  return updated
}
