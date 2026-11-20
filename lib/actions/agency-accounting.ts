'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  Prisma,
  RevenueLineStatus,
  RevenueRecognitionMethod,
  RevenueScheduleStatus,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { normalizeRole } from '@/lib/auth/route-access'
import { syncAgencyChartOfAccounts } from '@/lib/finance/agency-coa-template'
import {
  createRevenueSchedule,
  recognizeAllDueRevenueLines,
  recognizeRevenueLine,
} from '@/lib/finance/rev-rec-engine'
import { voidJournalEntry } from '@/lib/finance/journal-engine'
import { round2 } from '@/lib/finance/accounting-math'

const ACCOUNTING_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'])

function assertAccountingAccess(role: string | null | undefined) {
  const normalized = normalizeRole(role)
  if (!ACCOUNTING_ADMIN_ROLES.has(normalized)) {
    throw new Error('Forbidden: Accounting privilege required.')
  }
}

export async function syncAgencyCoaAction() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  const result = await syncAgencyChartOfAccounts(prisma)
  revalidatePath('/master-setup/chart-of-accounts')
  revalidatePath('/finances/profit-loss')
  return { success: true, ...result }
}

export async function getRevenueRecognitionOverview() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  const now = new Date()
  const cutoffYear = now.getFullYear()
  const cutoffMonth = now.getMonth() + 1

  const [schedules, unbilledMilestones, periods, recentJournals, deferrableInvoices] =
    await Promise.all([
      prisma.revenueSchedule.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              issueDate: true,
              currency: true,
              client: { select: { companyName: true } },
            },
          },
          project: { select: { id: true, name: true, projectCode: true } },
          retainer: { select: { id: true, serviceName: true } },
          lines: {
            orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
            include: {
              milestone: { select: { id: true, title: true, status: true } },
              journalEntry: { select: { entryNumber: true, status: true } },
            },
          },
        },
      }),
      prisma.projectMilestone.findMany({
        where: {
          status: 'COMPLETED',
          isBilled: false,
          billableAmount: { gt: 0 },
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectCode: true,
              client: { select: { companyName: true } },
            },
          },
        },
        orderBy: { completedDate: 'desc' },
      }),
      prisma.accountingPeriod.findMany({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
        include: {
          lockedBy: { select: { name: true } },
        },
      }),
      prisma.journalEntry.findMany({
        where: { status: 'POSTED' },
        orderBy: { entryDate: 'desc' },
        take: 12,
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
            },
          },
        },
      }),
      prisma.agencyInvoice.findMany({
        where: {
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          revenueSchedules: { none: {} },
        },
        orderBy: { issueDate: 'desc' },
        take: 25,
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          exchangeRate: true,
          issueDate: true,
          projectId: true,
          client: { select: { companyName: true } },
        },
      }),
    ])

  let totalDeferredLiability = 0
  let totalRecognizedToDate = 0
  let dueToRecognizeAmount = 0
  let dueToRecognizeCount = 0

  const monthlyWaterfallMap = new Map<
    string,
    { label: string; year: number; month: number; scheduled: number; recognized: number }
  >()

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  for (const sch of schedules) {
    if (sch.status === RevenueScheduleStatus.CANCELLED) continue
    for (const line of sch.lines) {
      const amt = Number(line.amount)
      const key = `${line.periodYear}-${String(line.periodMonth).padStart(2, '0')}`
      const bucket = monthlyWaterfallMap.get(key) ?? {
        label: `${monthNames[line.periodMonth - 1] ?? 'M'} ${String(line.periodYear).slice(-2)}`,
        year: line.periodYear,
        month: line.periodMonth,
        scheduled: 0,
        recognized: 0,
      }

      if (line.status === RevenueLineStatus.RECOGNIZED) {
        totalRecognizedToDate += amt
        bucket.recognized = round2(bucket.recognized + amt)
      } else if (line.status === RevenueLineStatus.SCHEDULED) {
        totalDeferredLiability += amt
        bucket.scheduled = round2(bucket.scheduled + amt)

        const isDueMonthly =
          !line.milestoneId &&
          (line.periodYear < cutoffYear ||
            (line.periodYear === cutoffYear && line.periodMonth <= cutoffMonth))
        const isDueMilestone = line.milestone?.status === 'COMPLETED'

        if (isDueMonthly || isDueMilestone) {
          dueToRecognizeAmount += amt
          dueToRecognizeCount += 1
        }
      }
      monthlyWaterfallMap.set(key, bucket)
    }
  }

  const waterfall = Array.from(monthlyWaterfallMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-9)
    .map(([, v]) => v)

  const unbilledWipTotal = round2(
    unbilledMilestones.reduce((s, m) => s + Number(m.billableAmount || 0), 0)
  )

  return {
    summary: {
      totalDeferredLiability: round2(totalDeferredLiability),
      totalRecognizedToDate: round2(totalRecognizedToDate),
      dueToRecognizeAmount: round2(dueToRecognizeAmount),
      dueToRecognizeCount,
      unbilledWipTotal,
      unbilledMilestonesCount: unbilledMilestones.length,
    },
    waterfall,
    schedules: schedules.map(s => ({
      id: s.id,
      invoiceId: s.invoice.id,
      invoiceNumber: s.invoice.invoiceNumber,
      clientName: s.invoice.client.companyName,
      projectName: s.project?.name ?? null,
      retainerName: s.retainer?.serviceName ?? null,
      recognitionMethod: s.recognitionMethod,
      totalDeferred: Number(s.totalDeferred),
      totalRecognized: Number(s.totalRecognized),
      remainingDeferred: round2(Number(s.totalDeferred) - Number(s.totalRecognized)),
      status: s.status,
      lines: s.lines.map(l => ({
        id: l.id,
        periodYear: l.periodYear,
        periodMonth: l.periodMonth,
        amount: Number(l.amount),
        status: l.status,
        recognizedAt: l.recognizedAt,
        milestoneTitle: l.milestone?.title ?? null,
        milestoneStatus: l.milestone?.status ?? null,
        journalEntryNumber: l.journalEntry?.entryNumber ?? null,
      })),
    })),
    unbilledMilestones: unbilledMilestones.map(m => ({
      id: m.id,
      title: m.title,
      completedDate: m.completedDate,
      billableAmount: Number(m.billableAmount || 0),
      projectId: m.project.id,
      projectName: m.project.name,
      projectCode: m.project.projectCode,
      clientName: m.project.client.companyName,
    })),
    periods: periods.map(p => ({
      id: p.id,
      year: p.year,
      month: p.month,
      isLocked: p.isLocked,
      lockedAt: p.lockedAt,
      lockedByName: p.lockedBy?.name ?? null,
      notes: p.notes,
    })),
    recentJournals: recentJournals.map(j => ({
      id: j.id,
      entryNumber: j.entryNumber,
      entryDate: j.entryDate,
      description: j.description,
      sourceType: j.sourceType,
      totalDebit: round2(
        j.lines
          .filter(l => l.type === 'DEBIT')
          .reduce((s, l) => s + Number(l.amount), 0)
      ),
      lineCount: j.lines.length,
    })),
    deferrableInvoices: deferrableInvoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client.companyName,
      amountBase: round2(Number(inv.totalAmount) * Number(inv.exchangeRate || 1)),
      issueDate: inv.issueDate,
      projectId: inv.projectId,
    })),
  }
}

export async function runDueRevenueRecognitionAction() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  const res = await prisma.$transaction(async tx =>
    recognizeAllDueRevenueLines(tx, {
      asOfDate: new Date(),
      actorId: session.user.id,
    })
  )

  revalidatePath('/finances/revenue-recognition')
  revalidatePath('/finances/profit-loss')
  revalidatePath('/')
  return { success: true, ...res }
}

export async function recognizeSingleRevenueLineAction(lineId: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  await prisma.$transaction(async tx =>
    recognizeRevenueLine(tx, {
      lineId,
      recognizedAt: new Date(),
      actorId: session.user.id,
    })
  )

  revalidatePath('/finances/revenue-recognition')
  revalidatePath('/finances/profit-loss')
  revalidatePath('/')
  return { success: true }
}

export async function createManualRevenueScheduleAction(input: {
  invoiceId: string
  method: RevenueRecognitionMethod
  months?: number
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  const invoice = await prisma.agencyInvoice.findUnique({
    where: { id: input.invoiceId },
    include: { items: true },
  })
  if (!invoice) throw new Error('Invoice not found')

  const rate = Number(invoice.exchangeRate || 1)
  const nonPassThroughBase = round2(
    invoice.items
      .filter(it => !it.isPassThrough)
      .reduce((s, it) => s + Number(it.totalPrice) * rate, 0) ||
      Number(invoice.totalAmount) * rate
  )

  await prisma.$transaction(async tx => {
    await createRevenueSchedule(tx, {
      invoiceId: invoice.id,
      projectId: invoice.projectId,
      method: input.method,
      deferredAmountBase: nonPassThroughBase,
      startDate: invoice.issueDate,
      months: input.months ?? 1,
      notes: input.notes ?? null,
    })
  })

  revalidatePath('/finances/revenue-recognition')
  revalidatePath('/finances/profit-loss')
  return { success: true }
}

export async function toggleAccountingPeriodLockAction(input: {
  year: number
  month: number
  lock: boolean
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  await prisma.accountingPeriod.upsert({
    where: { year_month: { year: input.year, month: input.month } },
    update: {
      isLocked: input.lock,
      lockedAt: input.lock ? new Date() : null,
      lockedById: input.lock ? session.user.id : null,
      notes: input.notes ?? null,
    },
    create: {
      year: input.year,
      month: input.month,
      isLocked: input.lock,
      lockedAt: input.lock ? new Date() : null,
      lockedById: input.lock ? session.user.id : null,
      notes: input.notes ?? null,
    },
  })

  revalidatePath('/finances/revenue-recognition')
  return { success: true }
}

export async function voidJournalEntryAction(journalEntryId: string, reason: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  await prisma.$transaction(async tx =>
    voidJournalEntry(tx, {
      journalEntryId,
      voidedById: session.user.id,
      reason,
      createReversal: true,
    })
  )

  revalidatePath('/finances/revenue-recognition')
  revalidatePath('/ledger/transactions')
  revalidatePath('/finances/profit-loss')
  return { success: true }
}

export async function updateEmployeeCostProfileAction(input: {
  employeeId: string
  weeklyCapacityHours: number
  overheadMultiplier: number
  loadedHourlyCost: number | null
  isBillableRole: boolean
}) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  assertAccountingAccess(session.user.role)

  await prisma.employee.update({
    where: { id: input.employeeId },
    data: {
      weeklyCapacityHours: new Prisma.Decimal(Math.max(1, input.weeklyCapacityHours)),
      overheadMultiplier: new Prisma.Decimal(Math.max(1, input.overheadMultiplier)),
      loadedHourlyCost:
        input.loadedHourlyCost && input.loadedHourlyCost > 0
          ? new Prisma.Decimal(input.loadedHourlyCost)
          : null,
      isBillableRole: input.isBillableRole,
    },
  })

  revalidatePath('/finances/project-profitability')
  revalidatePath('/finances/profit-loss')
  return { success: true }
}
