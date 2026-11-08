import { prisma } from '@/lib/db'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'

export type PrismaClientOrTx = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export interface ResolvedDrawerSession {
  drawer: any | null
  openingBalance: number
  start: Date
  end: Date
}

/**
 * Resolves the applicable CashDrawer session and opening float for a given outlet and calendar date.
 * Shared between getDailyCashReport and getZReport to eliminate reader/writer drift.
 */
export async function resolveDrawerSessionForDate(
  outletId: string,
  dateStr: string,
  client: PrismaClientOrTx = prisma,
  options?: { earliestOnDate?: boolean }
): Promise<ResolvedDrawerSession> {
  const { start, end } = getLocalDateRangeBoundaries(dateStr, dateStr, 6)
  const earliestOnDate = options?.earliestOnDate ?? false

  // When resolving the daily opening float across all shifts of a day (earliestOnDate = true),
  // a session that started before midnight and spanned into today takes precedence over a shift opened later today.
  if (earliestOnDate) {
    const activeAcrossStart = await client.cashDrawer.findFirst({
      where: {
        outletId,
        openedAt: { lt: start },
        OR: [
          { status: 'OPEN' },
          { closedAt: { gte: start } },
        ],
      },
      orderBy: { openedAt: 'asc' },
      include: {
        openedBy: { select: { id: true, name: true } },
      },
    })

    if (activeAcrossStart) {
      const txBeforeStart = await client.drawerTransaction.aggregate({
        _sum: { amount: true },
        where: {
          drawerId: activeAcrossStart.id,
          createdAt: { lt: start },
          type: { not: 'OPENING' },
        },
      })
      const openingBalance =
        Number(activeAcrossStart.openingBalance || 0) +
        Number(txBeforeStart._sum?.amount || 0)

      return {
        drawer: activeAcrossStart,
        openingBalance,
        start,
        end,
      }
    }
  }

  // 1. Check if a drawer was opened on this calendar day
  const openedOnDate = await client.cashDrawer.findFirst({
    where: {
      outletId,
      openedAt: { gte: start, lte: end },
    },
    orderBy: { openedAt: earliestOnDate ? 'asc' : 'desc' },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  })

  if (openedOnDate) {
    // If a drawer was opened on this date, its opening float is directly read from openingBalance.
    // Note: If openingBalance is 0, it legitimately preserves 0 (zero-float trap fix).
    return {
      drawer: openedOnDate,
      openingBalance: Number(openedOnDate.openingBalance || 0),
      start,
      end,
    }
  }

  // 2. Check if a drawer session spanned across midnight of targetDate
  const activeAcrossStart = await client.cashDrawer.findFirst({
    where: {
      outletId,
      openedAt: { lt: start },
      OR: [
        { status: 'OPEN' },
        { closedAt: { gte: start } },
      ],
    },
    orderBy: { openedAt: 'desc' },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  })

  if (activeAcrossStart) {
    const txBeforeStart = await client.drawerTransaction.aggregate({
      _sum: { amount: true },
      where: {
        drawerId: activeAcrossStart.id,
        createdAt: { lt: start },
        type: { not: 'OPENING' },
      },
    })
    const openingBalance =
      Number(activeAcrossStart.openingBalance || 0) +
      Number(txBeforeStart._sum?.amount || 0)

    return {
      drawer: activeAcrossStart,
      openingBalance,
      start,
      end,
    }
  }

  // 3. Fallback: Find the most recent drawer session that closed prior to start (e.g. store closed today)
  const lastClosedBeforeStart = await client.cashDrawer.findFirst({
    where: {
      outletId,
      status: 'CLOSED',
      closedAt: { lt: start },
    },
    orderBy: { closedAt: 'desc' },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  })

  if (lastClosedBeforeStart) {
    return {
      drawer: lastClosedBeforeStart,
      openingBalance: Number(lastClosedBeforeStart.closingBalance || 0),
      start,
      end,
    }
  }

  // 4. First day of business fallback
  const firstDrawer = await client.cashDrawer.findFirst({
    where: { outletId },
    orderBy: { openedAt: 'asc' },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  })

  return {
    drawer: firstDrawer,
    openingBalance: firstDrawer ? Number(firstDrawer.openingBalance || 0) : 0,
    start,
    end,
  }
}
