/**
 * Automatic cash drawer rollover.
 *
 * Business rules (agreed with the owner):
 *  - The business day boundary is local midnight, Asia/Dhaka (UTC+6, no DST).
 *  - At the day boundary the open drawer is closed AT THE EXPECTED (computed)
 *    balance and a new drawer is opened with exactly the same amount.
 *  - If several days were missed, ONE session is created per calendar day.
 *  - Auto-created drawers inherit `openedById` from the previous drawer.
 *  - Physical counts are optional (see `countDrawerCash` in lib/actions/finance.ts).
 *
 * No money moves during a rollover, so no GL entries are posted: it is purely a
 * session boundary. Opening == previous closing, which satisfies the strict
 * lineage rule enforced by `openDrawer`.
 *
 * NOTE: this is intentionally a plain module (NOT a "use server" file) because
 * it exports helpers/constants that are not async Server Actions.
 */
import { prisma } from '@/lib/db'
import { Prisma, ShiftType } from '@prisma/client'

type Db = any

/** Asia/Dhaka is a fixed UTC+6 offset (no daylight saving). */
const TZ_OFFSET_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Safety cap on catch-up days. Beyond this an operator must open manually. */
export const MAX_ROLLOVER_DAYS = 62

/** `Setting.key` used as an owner-controlled kill-switch ('false' disables). */
export const AUTO_ROLLOVER_SETTING_KEY = 'autoDrawerRollover'

export type RolloverSource = 'CRON' | 'LAZY' | 'UI'

export type RolloverResult = {
  status: 'noop' | 'rolled_over' | 'auto_opened' | 'no_history' | 'disabled'
  /** Today's open drawer after the rollover (null when none could be opened). */
  drawer: Awaited<ReturnType<Db['cashDrawer']['findFirst']>>
  /** Number of calendar days that were processed. */
  daysProcessed: number
  closedDrawerIds: string[]
  openedDrawerIds: string[]
}

// ─────────────────────────────────────────────
// Pure date helpers (exported for tests)
// ─────────────────────────────────────────────

/** Local (Asia/Dhaka) calendar date `YYYY-MM-DD` of an instant. */
export function localDateOf(date: Date): string {
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** The UTC instant of 00:00:00.000 local time on the given local date. */
export function localDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - TZ_OFFSET_MS)
}

/** Next local calendar date string. */
export function nextLocalDate(dateStr: string): string {
  return localDateOf(new Date(localDayStart(dateStr).getTime() + DAY_MS))
}

/** Number of whole local days from `fromStr` (exclusive) to `toStr` (inclusive). */
export function localDaysBetween(fromStr: string, toStr: string): number {
  return Math.round(
    (localDayStart(toStr).getTime() - localDayStart(fromStr).getTime()) / DAY_MS
  )
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ─────────────────────────────────────────────
// Core algorithm
// ─────────────────────────────────────────────

/**
 * Brings the outlet's drawer up to date. Must be called inside a transaction
 * that already holds the Outlet row lock (`SELECT ... FOR UPDATE`).
 * Idempotent: when today's drawer already exists it returns `noop`.
 */
export async function rolloverWithinTx(
  tx: Db,
  outletId: string,
  now: Date = new Date(),
  source: RolloverSource = 'LAZY'
): Promise<RolloverResult> {
  const todayStr = localDateOf(now)
  const todayStart = localDayStart(todayStr)

  const open = await tx.cashDrawer.findFirst({
    where: { outletId, status: 'OPEN' },
  })

  if (open && open.openedAt >= todayStart) {
    return {
      status: 'noop',
      drawer: open,
      daysProcessed: 0,
      closedDrawerIds: [],
      openedDrawerIds: [],
    }
  }

  const closedDrawerIds: string[] = []
  const openedDrawerIds: string[] = []

  let balance: number
  let openerId: string
  let firstDayStr: string
  let sourceDrawerId: string | null = null

  if (open) {
    // Serialize against concurrent cash entries on the stale drawer.
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${open.id} FOR UPDATE`
    }
    openerId = open.openedById
    sourceDrawerId = open.id
    const openDate = open.openedAt instanceof Date ? open.openedAt : now
    firstDayStr = localDateOf(openDate)
    balance = 0 // computed below once the first day boundary is known
  } else {
    const last = await tx.cashDrawer.findFirst({
      where: { outletId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
    })
    if (!last) {
      // The very first drawer must be opened manually with the real float.
      return {
        status: 'no_history',
        drawer: null,
        daysProcessed: 0,
        closedDrawerIds,
        openedDrawerIds,
      }
    }
    const carried = Number(last.closingBalance)
    if (last.closingBalance === null || !Number.isFinite(carried)) {
      throw new Error(
        'Previous drawer has no valid closing balance. Open the drawer manually.'
      )
    }
    openerId = last.openedById
    balance = round2(carried)
    firstDayStr = localDateOf(last.closedAt ?? now)
  }

  // Days that need a (new) drawer: the day after `firstDayStr` .. today.
  const missingDays = localDaysBetween(firstDayStr, todayStr)
  if (missingDays > MAX_ROLLOVER_DAYS) {
    throw new Error(
      `Drawer gap is ${missingDays} days (limit ${MAX_ROLLOVER_DAYS}). Please open the drawer manually.`
    )
  }

  // ── Segment 0: close the stale open drawer at the end of its own day ──────
  if (open && sourceDrawerId) {
    const firstDayEnd = localDayStart(nextLocalDate(firstDayStr))
    const agg = await tx.drawerTransaction.aggregate({
      where: { drawerId: open.id, createdAt: { lt: firstDayEnd } },
      _sum: { amount: true },
    })
    balance = round2(Number(agg._sum.amount ?? 0))

    const closed = await tx.cashDrawer.update({
      where: { id: open.id },
      data: {
        status: 'CLOSED',
        closedAt: firstDayEnd,
        closingBalance: balance,
        // Not physically counted: leave null so it is never mistaken for a
        // counted session with zero variance.
        physicalCount: null,
        variance: null,
        closeMethod: 'AUTO',
      },
    })
    closedDrawerIds.push(closed.id)
  }

  // ── Segments 1..N: one drawer per calendar day up to and including today ──
  let dayStr = firstDayStr
  let todayDrawer: RolloverResult['drawer'] = null

  for (let i = 0; i < missingDays; i++) {
    dayStr = nextLocalDate(dayStr)
    const dayStart = localDayStart(dayStr)
    const dayEnd = localDayStart(nextLocalDate(dayStr))
    const isToday = dayStr === todayStr

    // Entries made on the stale drawer after midnight belong to this day.
    let moved = 0
    if (sourceDrawerId) {
      const range = {
        gte: dayStart,
        ...(isToday ? {} : { lt: dayEnd }),
      }
      const agg = await tx.drawerTransaction.aggregate({
        where: {
          drawerId: sourceDrawerId,
          createdAt: range,
          type: { not: 'OPENING' },
        },
        _sum: { amount: true },
      })
      moved = round2(Number(agg._sum.amount ?? 0))
    }

    const opening = balance
    const closing = round2(opening + moved)

    const drawer = await tx.cashDrawer.create({
      data: {
        outletId,
        openedById: openerId,
        shift: ShiftType.FULL,
        status: isToday ? 'OPEN' : 'CLOSED',
        openingBalance: opening,
        closingBalance: isToday ? null : closing,
        physicalCount: null,
        variance: null,
        openedAt: dayStart,
        closedAt: isToday ? null : dayEnd,
        openMethod: 'AUTO',
        closeMethod: isToday ? null : 'AUTO',
      },
    })

    await tx.drawerTransaction.create({
      data: {
        drawerId: drawer.id,
        type: 'OPENING',
        amount: opening,
        description: 'Auto-open: carried forward from previous closing balance',
        createdAt: dayStart,
      },
    })

    if (sourceDrawerId && moved !== 0) {
      await tx.drawerTransaction.updateMany({
        where: {
          drawerId: sourceDrawerId,
          createdAt: { gte: dayStart, ...(isToday ? {} : { lt: dayEnd }) },
          type: { not: 'OPENING' },
        },
        data: { drawerId: drawer.id },
      })
    }

    openedDrawerIds.push(drawer.id)
    if (isToday) {
      todayDrawer = drawer
    } else {
      closedDrawerIds.push(drawer.id)
    }
    balance = closing
  }

  // Same-day reopen after a manual close (no missing days): open "now".
  if (!todayDrawer) {
    const last = open
      ? null
      : await tx.cashDrawer.findFirst({
          where: { outletId, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
        })
    const openedAt = last?.closedAt ?? now
    const drawer = await tx.cashDrawer.create({
      data: {
        outletId,
        openedById: openerId,
        shift: ShiftType.FULL,
        status: 'OPEN',
        openingBalance: balance,
        openedAt,
        openMethod: 'AUTO',
      },
    })
    await tx.drawerTransaction.create({
      data: {
        drawerId: drawer.id,
        type: 'OPENING',
        amount: balance,
        description: 'Auto-open: carried forward from previous closing balance',
        createdAt: openedAt,
      },
    })
    openedDrawerIds.push(drawer.id)
    todayDrawer = drawer
  }

  if (typeof tx.auditLog?.create === 'function') {
    await tx.auditLog.create({
      data: {
        userId: openerId,
        action: 'CASH_DRAWER_AUTO_ROLLOVER',
        entity: 'CashDrawer',
        entityId: todayDrawer.id,
        metadata: {
          source,
          outletId,
          actor: 'SYSTEM',
          daysProcessed: Math.max(missingDays, 1),
          carriedBalance: balance,
          closedDrawerIds,
          openedDrawerIds,
        } as Prisma.InputJsonValue,
      },
    })
  }

  return {
    status: open ? 'rolled_over' : 'auto_opened',
    drawer: todayDrawer,
    daysProcessed: Math.max(missingDays, 1),
    closedDrawerIds,
    openedDrawerIds,
  }
}

// ─────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────

/** Owner kill-switch. Defaults to enabled. */
export async function isAutoRolloverEnabled(db: Db): Promise<boolean> {
  if (typeof db.setting?.findUnique !== 'function') return true
  try {
    const setting = await db.setting.findUnique({
      where: { key: AUTO_ROLLOVER_SETTING_KEY },
      select: { value: true },
    })
    return setting?.value !== 'false'
  } catch {
    return true
  }
}

/**
 * Drop-in replacement for
 *   tx.cashDrawer.findFirst({ where: { outletId, status: 'OPEN' } })
 * that self-heals a missing or stale (previous day) drawer first.
 *
 * Returns today's OPEN drawer, or null when none exists and none can be
 * created automatically (first ever drawer, or auto-rollover switched off).
 * Callers keep their existing "No open cash drawer" error for the null case.
 */
export async function ensureOpenDrawer(
  tx: Db,
  outletId: string,
  options: { now?: Date; source?: RolloverSource } = {}
) {
  const now = options.now ?? new Date()
  const todayStart = localDayStart(localDateOf(now))

  // Fast path: no locks, one indexed read.
  const open = await tx.cashDrawer.findFirst({
    where: { outletId, status: 'OPEN' },
  })
  if (open && !(open.openedAt instanceof Date)) return open
  if (open && open.openedAt >= todayStart) return open

  if (!(await isAutoRolloverEnabled(tx))) return open

  // Slow path: serialize on the Outlet row (same order as openDrawer).
  if (typeof tx.$executeRaw === 'function') {
    await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`
  }
  const result = await rolloverWithinTx(tx, outletId, now, options.source ?? 'LAZY')
  return result.drawer
}

/** Runs the rollover for one outlet in its own transaction (cron / UI). */
export async function runOutletRollover(
  outletId: string,
  source: RolloverSource = 'CRON',
  now: Date = new Date()
): Promise<RolloverResult> {
  return prisma.$transaction(
    async tx => {
      if (!(await isAutoRolloverEnabled(tx))) {
        return {
          status: 'disabled' as const,
          drawer: null,
          daysProcessed: 0,
          closedDrawerIds: [],
          openedDrawerIds: [],
        }
      }
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`
      }
      return rolloverWithinTx(tx, outletId, now, source)
    },
    { timeout: 30_000, maxWait: 10_000 }
  )
}

/** Rolls over every active outlet. One failing outlet never blocks the rest. */
export async function runAllOutletsRollover(
  source: RolloverSource = 'CRON',
  now: Date = new Date()
) {
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })

  const results: Array<{
    outletId: string
    outletName: string
    status: RolloverResult['status'] | 'error'
    daysProcessed?: number
    error?: string
  }> = []

  for (const outlet of outlets) {
    try {
      const r = await runOutletRollover(outlet.id, source, now)
      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        status: r.status,
        daysProcessed: r.daysProcessed,
      })
    } catch (err: any) {
      console.error(`[DrawerRollover] outlet ${outlet.id} failed:`, err)
      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        status: 'error',
        error: err?.message || 'Rollover failed',
      })
    }
  }
  return results
}

