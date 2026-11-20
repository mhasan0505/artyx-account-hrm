import {
  AgencyAccountBucket,
  JournalSourceType,
  Prisma,
  RevenueLineStatus,
  RevenueRecognitionMethod,
  RevenueScheduleStatus,
  TransactionType,
} from '@prisma/client'
import {
  computeMilestoneInvoiceAllocation,
  round2,
  splitStraightLineSchedule,
} from '@/lib/finance/accounting-math'
import { findAccountByBucket } from '@/lib/finance/agency-coa-template'
import { postBalancedJournal } from '@/lib/finance/journal-engine'

export interface CreateRevenueScheduleInput {
  invoiceId: string
  projectId?: string | null
  retainerId?: string | null
  method: RevenueRecognitionMethod
  /** Non-pass-through invoice amount in base currency (BDT) */
  deferredAmountBase: number
  startDate: Date
  /** Used for STRAIGHT_LINE_MONTHLY (e.g., 3, 6, 12 months) */
  months?: number
  /** Used for MILESTONE recognition when linked to a specific milestone */
  milestoneId?: string | null
  notes?: string | null
}

/**
 * Creates a RevenueSchedule + scheduled RevenueRecognitionLine records for deferred revenue
 * (upfront project deposits, partial milestone pre-billings, or multi-month/annual retainers).
 */
export async function createRevenueSchedule(
  tx: Prisma.TransactionClient,
  input: CreateRevenueScheduleInput
) {
  const totalDeferred = round2(Math.max(0, input.deferredAmountBase))
  if (totalDeferred <= 0) return null

  const linesData: Array<{
    milestoneId: string | null
    periodYear: number
    periodMonth: number
    amount: Prisma.Decimal
    status: RevenueLineStatus
  }> = []

  if (input.method === RevenueRecognitionMethod.STRAIGHT_LINE_MONTHLY) {
    const months = Math.max(1, Math.floor(input.months ?? 1))
    const split = splitStraightLineSchedule(totalDeferred, input.startDate, months)
    for (const s of split) {
      linesData.push({
        milestoneId: null,
        periodYear: s.periodYear,
        periodMonth: s.periodMonth,
        amount: new Prisma.Decimal(s.amount),
        status: RevenueLineStatus.SCHEDULED,
      })
    }
  } else {
    // MILESTONE or single upfront deposit pool
    linesData.push({
      milestoneId: input.milestoneId ?? null,
      periodYear: input.startDate.getFullYear(),
      periodMonth: input.startDate.getMonth() + 1,
      amount: new Prisma.Decimal(totalDeferred),
      status: RevenueLineStatus.SCHEDULED,
    })
  }

  return tx.revenueSchedule.create({
    data: {
      invoiceId: input.invoiceId,
      projectId: input.projectId ?? null,
      retainerId: input.retainerId ?? null,
      recognitionMethod: input.method,
      totalDeferred: new Prisma.Decimal(totalDeferred),
      totalRecognized: new Prisma.Decimal(0),
      status: RevenueScheduleStatus.ACTIVE,
      notes: input.notes ?? null,
      lines: {
        create: linesData,
      },
    },
    include: { lines: true },
  })
}

/**
 * Evaluates a newly issued invoice's milestone items using the partial-invoicing rule:
 * - Uncompleted milestones -> 100% of billed AGI enters Deferred Revenue.
 * - Completed milestones -> clears Unbilled WIP immediately; only over-billing enters Deferred Revenue.
 */
export async function evaluateMilestoneDeferralForInvoice(
  tx: Prisma.TransactionClient,
  params: {
    invoiceId: string
    projectId?: string | null
    issueDate: Date
    exchangeRate: number
    items: Array<{
      milestoneId?: string | null
      isPassThrough?: boolean
      totalPrice: number
    }>
    forceDeferAll?: boolean
  }
) {
  const rate = params.exchangeRate > 0 ? params.exchangeRate : 1
  const milestoneAllocations: Array<{
    milestoneId: string | null
    deferredBase: number
    immediateEarnedBase: number
  }> = []

  for (const item of params.items) {
    if (item.isPassThrough) continue
    const itemBase = round2(item.totalPrice * rate)
    if (itemBase <= 0) continue

    if (item.milestoneId) {
      const milestone = await tx.projectMilestone.findUnique({
        where: { id: item.milestoneId },
        include: {
          invoiceItems: {
            where: {
              invoiceId: { not: params.invoiceId },
              isPassThrough: false,
              invoice: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
            },
            include: { invoice: { select: { exchangeRate: true } } },
          },
        },
      })

      if (milestone) {
        const alreadyInvoicedBase = milestone.invoiceItems.reduce(
          (sum, prev) =>
            sum + Number(prev.totalPrice) * Number(prev.invoice.exchangeRate || 1),
          0
        )

        const alloc = computeMilestoneInvoiceAllocation({
          milestoneValue: Number(milestone.billableAmount || itemBase),
          alreadyInvoicedForMilestone: alreadyInvoicedBase,
          newInvoiceNonPassThrough: itemBase,
          isMilestoneCompleted: !params.forceDeferAll && milestone.status === 'COMPLETED',
        })

        milestoneAllocations.push({
          milestoneId: milestone.id,
          deferredBase: alloc.deferredAmount,
          immediateEarnedBase: alloc.immediateEarnedAmount,
        })
        continue
      }
    }

    if (params.forceDeferAll) {
      milestoneAllocations.push({
        milestoneId: null,
        deferredBase: itemBase,
        immediateEarnedBase: 0,
      })
    } else {
      milestoneAllocations.push({
        milestoneId: null,
        deferredBase: 0,
        immediateEarnedBase: itemBase,
      })
    }
  }

  return {
    totalDeferredBase: round2(
      milestoneAllocations.reduce((s, a) => s + a.deferredBase, 0)
    ),
    totalImmediateEarnedBase: round2(
      milestoneAllocations.reduce((s, a) => s + a.immediateEarnedBase, 0)
    ),
    milestoneAllocations,
  }
}

/**
 * Recognizes a single RevenueRecognitionLine:
 * Posts Dr Deferred Revenue (2250) / Cr Earned Revenue (4210 Project or 4220 Retainer),
 * marks the line RECOGNIZED, and updates parent RevenueSchedule totals & status.
 */
export async function recognizeRevenueLine(
  tx: Prisma.TransactionClient,
  params: {
    lineId: string
    recognizedAt?: Date
    actorId?: string | null
  }
) {
  const line = await tx.revenueRecognitionLine.findUnique({
    where: { id: params.lineId },
    include: {
      schedule: {
        include: {
          invoice: { select: { invoiceNumber: true } },
        },
      },
      milestone: { select: { title: true } },
    },
  })

  if (!line) throw new Error('RECOGNITION_LINE_NOT_FOUND')
  if (line.status === RevenueLineStatus.RECOGNIZED) return line
  if (line.status === RevenueLineStatus.CANCELLED) {
    throw new Error('Cannot recognize a cancelled revenue line')
  }

  const amount = round2(Number(line.amount))
  const recognitionDate = params.recognizedAt ?? new Date()

  const deferredAcctId = await findAccountByBucket(
    tx,
    AgencyAccountBucket.DEFERRED_REVENUE,
    '2250'
  )
  const earnedBucket =
    line.schedule.recognitionMethod === RevenueRecognitionMethod.STRAIGHT_LINE_MONTHLY ||
    line.schedule.retainerId
      ? AgencyAccountBucket.REVENUE_RETAINER
      : AgencyAccountBucket.REVENUE_PROJECT
  const earnedAcctId = await findAccountByBucket(
    tx,
    earnedBucket,
    earnedBucket === AgencyAccountBucket.REVENUE_RETAINER ? '4220' : '4210'
  )

  let journalEntryId: string | null = null

  if (deferredAcctId && earnedAcctId && amount > 0) {
    const label = line.milestone?.title
      ? `Milestone "${line.milestone.title}" (${line.schedule.invoice.invoiceNumber})`
      : `${line.periodYear}-${String(line.periodMonth).padStart(2, '0')} Retainer Recognition (${line.schedule.invoice.invoiceNumber})`

    const journal = await postBalancedJournal(tx, {
      entryDate: recognitionDate,
      description: `Revenue Recognition — ${label}`,
      sourceType: JournalSourceType.REV_REC,
      sourceId: line.id,
      createdById: params.actorId ?? null,
      lines: [
        {
          accountId: deferredAcctId,
          type: TransactionType.DEBIT,
          amount,
          description: `Release Deferred Revenue — ${label}`,
          referenceId: line.schedule.invoiceId,
          referenceType: 'RevenueRecognition',
        },
        {
          accountId: earnedAcctId,
          type: TransactionType.CREDIT,
          amount,
          description: `Recognize Earned Revenue — ${label}`,
          referenceId: line.schedule.invoiceId,
          referenceType: 'RevenueRecognition',
        },
      ],
    })
    journalEntryId = journal.id
  }

  const updatedLine = await tx.revenueRecognitionLine.update({
    where: { id: line.id },
    data: {
      status: RevenueLineStatus.RECOGNIZED,
      recognizedAt: recognitionDate,
      journalEntryId,
    },
  })

  // Recalculate parent schedule totals cleanly
  const allLines = await tx.revenueRecognitionLine.findMany({
    where: { scheduleId: line.scheduleId },
    select: { amount: true, status: true },
  })
  const recognizedSum = round2(
    allLines
      .filter(l => l.status === RevenueLineStatus.RECOGNIZED)
      .reduce((s, l) => s + Number(l.amount), 0)
  )
  const hasScheduledLeft = allLines.some(l => l.status === RevenueLineStatus.SCHEDULED)

  await tx.revenueSchedule.update({
    where: { id: line.scheduleId },
    data: {
      totalRecognized: new Prisma.Decimal(recognizedSum),
      status: hasScheduledLeft
        ? RevenueScheduleStatus.ACTIVE
        : RevenueScheduleStatus.COMPLETED,
    },
  })

  return updatedLine
}

/**
 * Recognizes all scheduled straight-line lines up through `asOfDate`
 * AND all scheduled milestone lines whose linked milestone is already COMPLETED.
 */
export async function recognizeAllDueRevenueLines(
  tx: Prisma.TransactionClient,
  params: { asOfDate?: Date; actorId?: string | null }
) {
  const asOf = params.asOfDate ?? new Date()
  const cutoffYear = asOf.getFullYear()
  const cutoffMonth = asOf.getMonth() + 1

  const candidateLines = await tx.revenueRecognitionLine.findMany({
    where: {
      status: RevenueLineStatus.SCHEDULED,
      schedule: { status: RevenueScheduleStatus.ACTIVE },
      OR: [
        // Straight-line monthly lines whose period <= current month
        {
          milestoneId: null,
          OR: [
            { periodYear: { lt: cutoffYear } },
            { periodYear: cutoffYear, periodMonth: { lte: cutoffMonth } },
          ],
        },
        // Milestone lines whose linked milestone has been marked COMPLETED
        {
          milestone: { status: 'COMPLETED' },
        },
      ],
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  })

  let recognizedCount = 0
  let recognizedTotal = 0

  for (const line of candidateLines) {
    await recognizeRevenueLine(tx, {
      lineId: line.id,
      recognizedAt: asOf,
      actorId: params.actorId ?? null,
    })
    recognizedCount += 1
    recognizedTotal = round2(recognizedTotal + Number(line.amount))
  }

  return { recognizedCount, recognizedTotal }
}
