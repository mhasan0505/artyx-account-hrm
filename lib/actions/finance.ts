'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { logAuditDirect } from '@/lib/audit/logger'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import { checkAndNotifyDrawerVariance } from '@/lib/notifications/triggers/drawer-variance'
import {
  getPrismaDatabaseErrorMessage,
  prisma,
  withDatabaseReadFallback,
} from '@/lib/db'
import {
  type Prisma,
  type DrawerTransaction,
  AdvanceStatus,
  DrawerStatus,
  ExpenseStatus,
  InvoiceStatus,
  PaymentMethod,
  PayrollEntryStatus,
  PayrollPeriodStatus,
  SaleStatus,
  ShiftType,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { distributeOrderDiscount, round2 } from '@/lib/actions/discount-utils'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { formatProductFullName } from '@/lib/utils/product-name'
import { ensureOpenDrawer, runOutletRollover } from '@/lib/finance/drawer-rollover'

function safeRevalidatePath(path: string, type?: 'page' | 'layout') {
  try {
    revalidatePath(path, type)
  } catch {
    // Ignore static generation store missing error outside Next.js request context
  }
}

function safeRevalidateTag(tag: string) {
  try {
    ;(revalidateTag as any)(tag, 'max')
  } catch {
    // Ignore outside Next.js request context
  }
}

const drawerTxTypeSchema = z.enum([
  'CASH_IN',
  'CASH_OUT',
  'ADJUSTMENT',
])

function failIfDatabaseUnavailable(error: unknown) {
  const message = getPrismaDatabaseErrorMessage(error)
  return message ? fail(message) : null
}

// Cash Drawer
export async function openDrawer(
  openingBalance: number,
  outletId: string,
  openedAt?: Date
) {
  const user = await requireRole(
    UserRole.CASHIER,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  try {
    return await prisma
      .$transaction(async tx => {
        // Outlet-level lock to prevent concurrent drawer openings
        await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`

        const existing = await tx.cashDrawer.findFirst({
          where: { outletId, status: DrawerStatus.OPEN },
        })
        if (existing)
          throw new Error('A cash drawer is already open for this outlet')

        const effectiveOpenedAt = openedAt ?? new Date()
        if (effectiveOpenedAt > new Date()) {
          throw new Error('Open date cannot be in the future')
        }

        // Strict Lineage Validation — only applies when a previous session exists.
        // For the very first drawer open (no history), any opening balance is accepted.
        const lastClosedDrawer = await tx.cashDrawer.findFirst({
          where: { outletId, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
        })
        if (lastClosedDrawer) {
          const expectedBalance = Number(lastClosedDrawer.closingBalance || 0)
          if (Number(openingBalance) !== expectedBalance) {
            throw new Error(`Opening balance must exactly match the previous drawer's closing balance (৳${expectedBalance.toLocaleString()}). Fund additional cash via Contra Transfer.`)
          }
          if (lastClosedDrawer.closedAt && effectiveOpenedAt < lastClosedDrawer.closedAt) {
            throw new Error(
              `Opening date and time cannot be earlier than the previous drawer's closing time (${lastClosedDrawer.closedAt.toISOString()})`
            )
          }
        }

        const drawer = await tx.cashDrawer.create({
          data: {
            outletId,
            openedById: user.id,
            shift: ShiftType.FULL,
            openingBalance,
            status: DrawerStatus.OPEN,
            openedAt: effectiveOpenedAt,
          },
        })

        await tx.drawerTransaction.create({
          data: {
            drawerId: drawer.id,
            type: 'OPENING',
            amount: openingBalance,
            description: 'Opening balance',
            createdAt: effectiveOpenedAt,
          },
        })

        return drawer
      })
      .then(drawer => {
        safeRevalidateTag(`dashboard-${outletId}`)
        safeRevalidatePath('/', 'page')
        safeRevalidatePath('/finances/drawer')
        safeRevalidatePath('/finances/cash')
        safeRevalidatePath('/reports/sales')
        return ok(drawer)
      })
  } catch (error: any) {
    return fail(error.message || 'Failed to open drawer')
  }
}

export async function closeDrawer(
  drawerId: string,
  closingBalance: number,
  closedAt?: Date
) {
  const user = await requireAuth()

  try {
    // Capture the DB-computed running balance inside the tx so we can
    // pass the accurate value to the variance notification (Bug 1 fix).
    let capturedRunningBalance = 0

    return await prisma
      .$transaction(async tx => {
        // Lock CashDrawer row FIRST to serialize balance calculation and prevent closing race conditions
        await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${drawerId} FOR UPDATE`

        const drawer = await tx.cashDrawer.findUnique({
          where: { id: drawerId },
        })
        if (!drawer) throw new Error('Drawer not found')
        validateOutletAccess(user, drawer.outletId)
        if (drawer.status !== DrawerStatus.OPEN)
          throw new Error('Drawer is already closed')

        // Ownership/Manager gate: only the user who opened the drawer or a Manager/Admin can close it
        const allowedRoles = [UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN]
        if (drawer.openedById !== user.id && !(allowedRoles as string[]).includes(user.role)) {
          throw new Error('Only the user who opened the drawer or a manager can close it')
        }

        // Calculate system-expected balance via aggregation for reliability
        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId },
          _sum: { amount: true },
        })

        const runningBalance = Number(stats._sum.amount || 0)
        capturedRunningBalance = runningBalance
        const variance = closingBalance - runningBalance

        const effectiveClosedAt = closedAt ?? new Date()
        if (effectiveClosedAt > new Date()) {
          throw new Error('Close date cannot be in the future')
        }
        if (effectiveClosedAt < drawer.openedAt) {
          throw new Error('Close date cannot be earlier than drawer open date')
        }

        const closed = await tx.cashDrawer.update({
          where: { id: drawerId },
          data: {
            status: DrawerStatus.CLOSED,
            closedAt: effectiveClosedAt,
            // closingBalance = user's physical count input
            // physicalCount  = same (the field stores the counted amount)
            // The system-expected running balance is stored implicitly as (closingBalance - variance)
            closingBalance,
            physicalCount: closingBalance,
            variance,
          },
        })

        return closed
      })
      .then(closed => {
        // Use the DB-computed runningBalance from inside the transaction (Bug 1 fix).
        // Previously this was re-derived as closingBalance - variance which is algebraically
        // equivalent but fragile if either field is ever adjusted independently.
        checkAndNotifyDrawerVariance({
          drawerId: closed.id,
          outletId: closed.outletId,
          variance: Number(closed.variance || 0),
          closingBalance: Number(closed.closingBalance || 0),
          runningBalance: capturedRunningBalance,
          closedById: user.id,
          closedAt: closed.closedAt || new Date(),
        }).catch(err => {
          console.error('[CashDrawer] Failed to check drawer variance alert:', err)
        })

        safeRevalidateTag(`dashboard-${closed.outletId}`)
        safeRevalidatePath('/', 'page')
        safeRevalidatePath('/finances/drawer')
        safeRevalidatePath('/finances/cash')
        safeRevalidatePath('/reports/sales')
        return ok({ ...closed, closedById: user.id })
      })
  } catch (error: any) {
    return fail(error.message || 'Failed to close drawer')
  }
}

const drawerTxSchema = z.object({
  drawerId: z.string(),
  type: drawerTxTypeSchema,
  amount: z.coerce.number().refine(n => n !== 0, 'Amount cannot be zero'),
  adjustmentType: z.enum(['IN', 'OUT']).optional(),
  throughAccountId: z.string().min(1, 'Please select an account'),
  description: z.string().optional(),
  transactionDate: z.coerce.date().optional(),
})

export async function recordDrawerTransaction(
  data: z.infer<typeof drawerTxSchema>
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = drawerTxSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  try {
    await prisma.$transaction(async tx => {
      // Row lock on CashDrawer to serialize balance check and prevent concurrent cash-out overdraft
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${parsed.data.drawerId} FOR UPDATE`
      }

      const drawer = await tx.cashDrawer.findUnique({
        where: { id: parsed.data.drawerId },
      })
      if (!drawer) throw new Error('Drawer not found')
      if (drawer.status !== DrawerStatus.OPEN)
        throw new Error('Drawer is closed')

      validateOutletAccess(user, drawer.outletId)
      const targetDrawer = drawer

      const isDownwardAdj =
        parsed.data.type === 'ADJUSTMENT' &&
        (parsed.data.adjustmentType === 'OUT' || parsed.data.amount < 0)

      const isOutflow =
        ['CASH_OUT', 'REFUND', 'EXPENSE'].includes(parsed.data.type) ||
        isDownwardAdj

      const absAmount = Math.abs(parsed.data.amount)
      const signedAmount = isOutflow ? -absAmount : absAmount

      // Balance check for cash out or downward adjustment
      if (signedAmount < 0) {
        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId: targetDrawer.id },
          _sum: { amount: true },
        })
        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < absAmount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${absAmount.toLocaleString()}`
          )
        }
      }

      const effectiveTxDate = parsed.data.transactionDate ?? new Date()
      if (effectiveTxDate > new Date()) {
        throw new Error('Transaction date cannot be in the future')
      }
      if (effectiveTxDate < targetDrawer.openedAt) {
        throw new Error(
          'Transaction date cannot be earlier than drawer open date'
        )
      }

      const throughAccount = await tx.chartOfAccount.findUnique({
        where: { id: parsed.data.throughAccountId },
        select: { id: true, code: true, name: true, isActive: true },
      })
      if (!throughAccount || !throughAccount.isActive) {
        throw new Error('Selected account is invalid or inactive')
      }

      const cashAccount = await tx.chartOfAccount.findFirst({
        where: {
          OR: [
            { code: '1100' },
            { name: { contains: 'cash', mode: 'insensitive' } },
          ],
          isActive: true,
        },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      })

      if (!cashAccount) {
        throw new Error('Cash account (1100) not found in Chart of Accounts')
      }

      const txRow = await tx.drawerTransaction.create({
        data: {
          drawerId: targetDrawer.id,
          type: parsed.data.type,
          amount: signedAmount,
          description: parsed.data.description ?? parsed.data.type,
          createdAt: effectiveTxDate,
        },
      })

      const isCashIn = signedAmount > 0
      const actionLabel =
        parsed.data.type === 'ADJUSTMENT'
          ? isCashIn ? 'adjustment in' : 'adjustment out'
          : isCashIn
            ? 'cash in'
            : 'cash out'

      const gl = [
        {
          accountId: cashAccount.id,
          type: isCashIn ? TransactionType.DEBIT : TransactionType.CREDIT,
          amount: absAmount,
          description: `Drawer ${actionLabel} via ${throughAccount.name}`,
          referenceId: txRow.id,
          referenceType: 'DrawerTransaction',
          createdAt: effectiveTxDate,
        },
        {
          accountId: throughAccount.id,
          type: isCashIn ? TransactionType.CREDIT : TransactionType.DEBIT,
          amount: absAmount,
          description: `Drawer ${actionLabel} via ${throughAccount.name}`,
          referenceId: txRow.id,
          referenceType: 'DrawerTransaction',
          createdAt: effectiveTxDate,
        },
      ]
      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({
        data: gl,
      })

      await logAuditDirect(
        user.id,
        'DRAWER_TX_RECORD',
        'DrawerTransaction',
        txRow.id,
        {
          type: parsed.data.type,
          amount: parsed.data.amount,
          throughAccountId: parsed.data.throughAccountId,
        }
      )
    })

    revalidatePath('/finances/drawer')
    revalidatePath('/ledger/trial-balance')
    revalidatePath('/ledger/accounts')
    return ok({ success: true })
  } catch (error) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(
      error instanceof Error ? error.message : 'Failed to record transaction'
    )
  }
}

export async function getCashFlowAccounts() {
  await requireAuth()
  return withDatabaseReadFallback(
    async () => {
      const preferred = await prisma.chartOfAccount.findMany({
        where: {
          isActive: true,
          NOT: [{ code: { in: ['1000', '2000', '3000', '4000', '5000'] } }],
        },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
        },
        orderBy: [{ code: 'asc' }],
      })

      if (preferred.length > 0) {
        return preferred
      }

      return prisma.chartOfAccount.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
        },
        orderBy: [{ code: 'asc' }],
      })
    },
    [],
    'getCashFlowAccounts'
  )
}

type DrawerWithRelations = Prisma.CashDrawerGetPayload<{
  include: {
    openedBy: { select: { name: true } }
    transactions: true
  }
}>

export type SerializedDrawer = Omit<
  DrawerWithRelations,
  'openingBalance' | 'closingBalance' | 'physicalCount' | 'variance' | 'transactions'
> & {
  openingBalance: number
  closingBalance: number | null
  physicalCount: number | null
  variance: number | null
  transactions: Array<
    Omit<DrawerTransaction, 'amount'> & {
      amount: number
    }
  >
}

function serializeDrawer(drawer: DrawerWithRelations): SerializedDrawer
function serializeDrawer(drawer: null): null
function serializeDrawer(drawer: DrawerWithRelations | null): SerializedDrawer | null
function serializeDrawer(drawer: DrawerWithRelations | null): SerializedDrawer | null {
  if (!drawer) return null
  return {
    ...drawer,
    openingBalance: Number(drawer.openingBalance ?? 0),
    closingBalance: drawer.closingBalance !== null ? Number(drawer.closingBalance) : null,
    physicalCount: drawer.physicalCount !== null ? Number(drawer.physicalCount) : null,
    variance: drawer.variance !== null ? Number(drawer.variance) : null,
    transactions: drawer.transactions.map((t) => ({
      ...t,
      amount: Number(t.amount ?? 0),
    })),
  }
}

export async function getOpenDrawer(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  try {
    await runOutletRollover(outletId, 'UI')
  } catch (err) {
    // Non-blocking: continue to read fallback
  }
  const drawer = await withDatabaseReadFallback(
    () =>
      prisma.cashDrawer.findFirst({
        where: { outletId, status: DrawerStatus.OPEN },
        include: {
          openedBy: { select: { name: true } },
          transactions: { orderBy: { createdAt: 'asc' } },
        },
      }),
    null,
    `getOpenDrawer(${outletId})`
  )
  return serializeDrawer(drawer)
}

export async function getDrawerSessions(outletId: string): Promise<SerializedDrawer[]> {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  const sessions = await withDatabaseReadFallback(
    () =>
      prisma.cashDrawer.findMany({
        where: { outletId },
        include: {
          openedBy: { select: { name: true } },
          transactions: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { openedAt: 'desc' },
        take: 50,
      }),
    [],
    `getDrawerSessions(${outletId})`
  )
  return Array.isArray(sessions) ? sessions.map((s) => serializeDrawer(s)) : []
}

// ─────────────────────────────────────────────
// AUTO-OPEN: last-close carry-forward
// ─────────────────────────────────────────────

/**
 * Read-only: returns { closingBalance, closedAt } of the most recently closed
 * drawer for the outlet, or null if no closed drawer exists.
 * Used by the UI to pre-fill the opening balance on the next business day.
 */
export async function getLastClosedDrawer(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  const drawer = await withDatabaseReadFallback(
    () =>
      prisma.cashDrawer.findFirst({
        where: { outletId, status: DrawerStatus.CLOSED },
        orderBy: { closedAt: 'desc' },
        select: { id: true, closingBalance: true, closedAt: true },
      }),
    null,
    `getLastClosedDrawer(${outletId})`
  )
  if (!drawer) return null
  return {
    id: drawer.id,
    closingBalance:
      drawer.closingBalance !== null && drawer.closingBalance !== undefined
        ? Number(drawer.closingBalance)
        : null,
    closedAt: drawer.closedAt,
  }
}

/**
 * Demand-driven auto-open: opens a new cash drawer using the closing balance
 * of the most recent closed drawer for this outlet.
 *
 * Guards (in transaction, after acquiring the Outlet-level lock):
 *   already_open          — an OPEN drawer already exists
 *   no_history            — no CLOSED drawer has ever existed for this outlet
 *   invalid_closing_balance — the carried-forward balance is not a finite non-negative number
 *
 * Returns { opened: true, openingBalance } on success,
 * or { opened: false, reason } for every guard case.
 */
export async function autoOpenDrawerFromLastClose(outletId: string): Promise<
  | { opened: true; openingBalance: number }
  | { opened: false; reason: 'already_open' | 'no_history' | 'invalid_closing_balance' | 'error'; message?: string }
> {
  const user = await requireRole(
    UserRole.CASHIER,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  try {
    const result = await prisma.$transaction(async tx => {
      // 1. Acquire outlet-level lock to serialize concurrent open attempts.
      // There is no existing CashDrawer row to lock yet, so we lock the parent Outlet row.
      await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`

      // 2. Re-check inside the lock — this is the only safe check.
      const existingOpen = await tx.cashDrawer.findFirst({
        where: { outletId, status: DrawerStatus.OPEN },
        select: { id: true },
      })
      if (existingOpen) return { opened: false as const, reason: 'already_open' as const }

      // 3. Find the most recent closed drawer.
      const lastClosed = await tx.cashDrawer.findFirst({
        where: { outletId, status: DrawerStatus.CLOSED },
        orderBy: { closedAt: 'desc' },
        select: { id: true, closingBalance: true, closedAt: true },
      })
      if (!lastClosed) return { opened: false as const, reason: 'no_history' as const }

      // 4. Validate the carried-forward balance.
      if (lastClosed.closingBalance === null || lastClosed.closingBalance === undefined) {
        return { opened: false as const, reason: 'invalid_closing_balance' as const }
      }
      const openingBalance = Number(lastClosed.closingBalance)
      if (!Number.isFinite(openingBalance) || openingBalance < 0) {
        return { opened: false as const, reason: 'invalid_closing_balance' as const }
      }

      // 5. Create the new drawer. openedAt is "now" — not the old closedAt.
      const openedAt = new Date()
      const drawer = await tx.cashDrawer.create({
        data: {
          outletId,
          openedById: user.id,
          shift: ShiftType.FULL,
          openingBalance,
          status: DrawerStatus.OPEN,
          openedAt,
        },
      })

      // 6. Create the opening DrawerTransaction.
      await tx.drawerTransaction.create({
        data: {
          drawerId: drawer.id,
          type: 'OPENING',
          amount: openingBalance,
          description: 'Auto-open: carried forward from previous closing balance',
          createdAt: openedAt,
        },
      })

      return { opened: true as const, openingBalance, drawerId: drawer.id }
    })

    if (result.opened) {
      // Audit log outside the transaction so it never rolls back the main open.
      await logAuditDirect(
        user.id,
        'CASH_DRAWER_AUTO_OPENED',
        'CashDrawer',
        result.drawerId,
        { outletId, openingBalance: result.openingBalance }
      )
      try { revalidatePath('/finances/drawer') } catch { /* outside Next.js request context */ }
      return { opened: true, openingBalance: result.openingBalance }
    }

    return result
  } catch (error: any) {
    return { opened: false, reason: 'error', message: error.message || 'Failed to auto-open drawer' }
  }
}

export async function getReconciliationSummary(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  return withDatabaseReadFallback(
    async () => {
      const bankAccounts = await prisma.bankAccount.findMany({
        where: { outletId, isActive: true },
        orderBy: { accountName: 'asc' },
      })
      return { bankAccounts }
    },
    { bankAccounts: [] },
    `getReconciliationSummary(${outletId})`
  )
}

// Expenses
const CATEGORY_COA_MAP: Record<string, string> = {
  Rent: '5220',
  Salary: '5210',
  Utility: '5230',
  Internet: '5240',
  Transport: '5270',
  Maintenance: '5280',
  Marketing: '5260',
  Other: '5290',
}

const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, 'Category name must be at least 2 characters').max(80),
})

/** Custom operating-expense categories are backed by their own ledger account. */
export async function getCustomExpenseCategories() {
  await requireAuth()
  const standardCodes = Object.values(CATEGORY_COA_MAP)
  return prisma.chartOfAccount.findMany({
    where: {
      type: 'EXPENSE',
      isActive: true,
      parent: { code: '5200' },
      code: { notIn: standardCodes },
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })
}

export async function createExpenseCategory(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const parsed = expenseCategorySchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.chartOfAccount.findFirst({
    where: {
      type: 'EXPENSE',
      name: { equals: parsed.data.name, mode: 'insensitive' },
    },
    select: { id: true, name: true, code: true },
  })
  if (existing) return fail('An expense category with this name already exists')

  const parent = await prisma.chartOfAccount.findUnique({
    where: { code: '5200' },
    select: { id: true },
  })
  if (!parent) return fail('Operating Expenses account (5200) is not configured')

  try {
    const category = await prisma.chartOfAccount.create({
      data: {
        code: `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: parsed.data.name,
        type: 'EXPENSE',
        parentId: parent.id,
      },
      select: { id: true, name: true, code: true },
    })
    await logAuditDirect(user.id, 'EXPENSE_CATEGORY_CREATED', 'ChartOfAccount', category.id, {
      name: category.name,
      code: category.code,
    })
    safeRevalidatePath('/expenses')
    safeRevalidatePath('/master-setup/chart-of-accounts')
    return ok(category)
  } catch (error: any) {
    return fail(error.message || 'Failed to create expense category')
  }
}

const expenseSchema = z.object({
  accountId: z.string().optional(),
  category: z.string().optional(),
  employeeId: z.string().optional(),
  salaryMonth: z.string().optional(),
  chequeDate: z.string().optional(),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  expenseDate: z.coerce.date(),
  outletId: z.string().optional(),
  receiptUrl: z.string().optional(),
  method: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  projectId: z.string().optional(),
  categoryTag: z.string().optional(),
  vendorName: z.string().optional(),
  invoiceNumber: z.string().optional(),
})

export async function createExpense(data: z.infer<typeof expenseSchema>) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER
  )
  const parsed = expenseSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const outletId = user.role === 'SUPER_ADMIN' ? (parsed.data.outletId || user.outletId) : (user.outletId || parsed.data.outletId)
  if (!outletId) {
    return fail('User is not associated with an outlet')
  }
  validateOutletAccess(user, outletId)

  let targetCode = parsed.data.category ? (CATEGORY_COA_MAP[parsed.data.category] || '5290') : undefined
  if (parsed.data.employeeId || parsed.data.category === 'Salary') {
    targetCode = '5210'
  }

  let finalAccountId = parsed.data.accountId
  if (!finalAccountId && targetCode) {
    const matchedAccount = await prisma.chartOfAccount.findFirst({
      where: { code: targetCode, isActive: true },
      select: { id: true },
    })
    if (matchedAccount) finalAccountId = matchedAccount.id
  }

  if (!finalAccountId) {
    const resolvedAccount = parsed.data.accountId
      ? await prisma.chartOfAccount.findUnique({
          where: { id: parsed.data.accountId },
          select: { id: true },
        })
      : null

    const fallbackExpenseAccount = resolvedAccount
      ? null
      : await prisma.chartOfAccount.findFirst({
          where: {
            OR: [{ code: '5290' }, { type: 'EXPENSE' }],
            isActive: true,
          },
          orderBy: [{ code: 'asc' }],
          select: { id: true },
        })

    finalAccountId = resolvedAccount?.id ?? fallbackExpenseAccount?.id
  }

  if (!finalAccountId) {
    return fail(
      'No valid expense account found (Code 5290). Please configure Chart of Accounts in settings.'
    )
  }

  if (parsed.data.method !== 'CASH' && !parsed.data.bankAccountId) {
    return fail('Bank/MFS account is required for non-cash expenses')
  }

  let finalDescription = parsed.data.description
  let linkedReceiptUrl = parsed.data.receiptUrl
  let employee: any = null
  let month = parsed.data.expenseDate.getMonth() + 1
  let year = parsed.data.expenseDate.getFullYear()

  if (parsed.data.category === 'Salary' || parsed.data.employeeId) {
    if (!parsed.data.employeeId) {
      return fail('Please select an employee for salary expense')
    }

    employee = await prisma.employee.findUnique({
      where: { id: parsed.data.employeeId },
      include: {
        advances: {
          where: { status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] } },
          orderBy: { givenDate: 'asc' },
        },
      },
    })
    if (!employee) return fail('Employee not found')
    validateOutletAccess(user, employee.outletId)

    if (parsed.data.salaryMonth) {
      const parts = parsed.data.salaryMonth.split('-')
      if (parts.length >= 2) {
        year = parseInt(parts[0], 10)
        month = parseInt(parts[1], 10)
      }
    }
  }

  try {
    return await prisma.$transaction(async tx => {
      if (employee) {
        // 1. Ensure PayrollPeriod exists
        let period = await tx.payrollPeriod.findUnique({
          where: {
            month_year_outletId: { month, year, outletId: employee.outletId },
          },
        })

        if (!period) {
          try {
            period = await tx.payrollPeriod.create({
              data: {
                month,
                year,
                outletId: employee.outletId,
                status: PayrollPeriodStatus.DRAFT,
                totalGross: 0,
                totalNet: 0,
              },
            })
          } catch (pErr: any) {
            if (pErr?.code === 'P2002') {
              period = await tx.payrollPeriod.findUnique({
                where: { month_year_outletId: { month, year, outletId: employee.outletId } },
              })
            } else {
              throw pErr
            }
          }
        }

        if (!period) throw new Error('Failed to resolve payroll period');

        // 2. Ensure PayrollEntry exists
        let entry = await tx.payrollEntry.findUnique({
          where: {
            payrollPeriodId_employeeId: {
              payrollPeriodId: period.id,
              employeeId: employee.id,
            },
          },
        })

        if (!entry) {
          const daysInMonth = new Date(year, month, 0).getDate()
          const basicSalary = Number(employee.basicSalary)
          const joinDate = new Date(employee.joinDate)

          let daysWorked = daysInMonth
          if (
            joinDate.getFullYear() === year &&
            joinDate.getMonth() + 1 === month
          ) {
            daysWorked = Math.max(1, Math.min(daysInMonth, daysInMonth - joinDate.getDate() + 1))
          }

          const proratedBase =
            daysWorked === daysInMonth
              ? basicSalary
              : Math.round(((basicSalary / daysInMonth) * daysWorked + Number.EPSILON) * 100) / 100

          const attendances = await tx.attendance.findMany({
            where: {
              employeeId: employee.id,
              date: {
                gte: new Date(year, month - 1, 1),
                lt: new Date(year, month, 1),
              },
            },
          })

          let absentDays = 0
          attendances.forEach(att => {
            if (att.status === 'ABSENT') absentDays++
          })

          const absenceDeduction =
            absentDays > 0
              ? Math.round(((basicSalary / daysInMonth) * absentDays + Number.EPSILON) * 100) / 100
              : 0

          const totalOutstandingAdv = employee.advances.reduce(
            (sum: number, adv: any) => sum + (Number(adv.amount) - Number(adv.recoveredAmount)),
            0
          )

          const netBeforeAdv = Math.max(0, proratedBase - absenceDeduction)
          const advanceToRecover = Math.min(totalOutstandingAdv, netBeforeAdv)
          const netPayable = Math.max(
            0,
            Math.round((netBeforeAdv - advanceToRecover + Number.EPSILON) * 100) / 100
          )

          entry = await tx.payrollEntry.create({
            data: {
              payrollPeriodId: period.id,
              employeeId: employee.id,
              baseSalary: proratedBase,
              deduction: absenceDeduction,
              advanceRecovered: advanceToRecover,
              netPayable,
              paidAmount: 0,
              status: PayrollEntryStatus.UNPAID,
            },
          })
        }

        // 3. Overpayment guard
        const remainingPayable = Math.max(
          0,
          Math.round((Number(entry.netPayable) - Number(entry.paidAmount) + Number.EPSILON) * 100) / 100
        )

        if (remainingPayable <= 0.01) {
          throw new Error(
            `Salary for ${employee.name} for ${year}-${String(month).padStart(2, '0')} has already been fully paid.`
          )
        }

        if (parsed.data.amount > remainingPayable + 0.01) {
          throw new Error(
            `Payment amount (৳${parsed.data.amount.toLocaleString()}) exceeds remaining net payable (৳${remainingPayable.toLocaleString()}) for ${employee.name}.`
          )
        }

        const empCode = employee.employeeCode || `EMP-${employee.id.slice(-4)}`
        const empTag = `[Emp: ${employee.name} (${empCode}) | Month: ${year}-${String(month).padStart(2, '0')}]`
        if (!finalDescription.includes('[Emp:')) {
          finalDescription = `${empTag} ${finalDescription || 'Staff Salary'}`
        }

        linkedReceiptUrl = linkedReceiptUrl || `payroll-entry:${entry.id}`
      }

      if (parsed.data.method === 'CHEQUE' && parsed.data.chequeDate) {
        if (!finalDescription.includes('[Cheque Matures:')) {
          finalDescription += ` | [Cheque Matures: ${parsed.data.chequeDate}]`
        }
      }

      const expense = await tx.expense.create({
        data: {
          accountId: finalAccountId,
          description: finalDescription,
          amount: parsed.data.amount,
          expenseDate: parsed.data.expenseDate,
          outletId,
          receiptUrl: linkedReceiptUrl,
          createdById: user.id,
          status: ExpenseStatus.PENDING,
          method: parsed.data.method,
          bankAccountId: parsed.data.bankAccountId || null,
          projectId: parsed.data.projectId || null,
          categoryTag: parsed.data.categoryTag || parsed.data.category || null,
          vendorName: parsed.data.vendorName || null,
          invoiceNumber: parsed.data.invoiceNumber || null,
        },
      })

      safeRevalidatePath('/expenses')
      return ok(expense)
    })
  } catch (error: any) {
    return fail(error.message || 'An error occurred while creating expense')
  }
}

export async function approveExpense(expenseId: string) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  try {
    const expense = await prisma.$transaction(async tx => {
      // Explicit row locking on Expense to prevent concurrent double-approval
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`

      const current = await tx.expense.findUnique({
        where: { id: expenseId },
        include: { account: true },
      })

      if (!current) throw new Error('Expense not found')
      validateOutletAccess(user, current.outletId)
      if (current.status !== ExpenseStatus.PENDING) {
        throw new Error('Only pending expenses can be approved')
      }

      // Check if this was an expense generated from an already executed payroll payment
      if (current.receiptUrl?.startsWith('payroll-payment:')) {
        return tx.expense.update({
          where: { id: current.id },
          data: { status: ExpenseStatus.APPROVED, approvedById: user.id },
        })
      }

      // Check if this is a salary expense linked to a PayrollEntry
      let linkedPayrollEntryId: string | null = null
      if (current.receiptUrl?.startsWith('payroll-entry:')) {
        linkedPayrollEntryId = current.receiptUrl.replace('payroll-entry:', '')
      }

      let linkedEntry: any = null
      if (linkedPayrollEntryId) {
        await tx.$executeRaw`SELECT id FROM "PayrollEntry" WHERE id = ${linkedPayrollEntryId} FOR UPDATE`
        linkedEntry = await tx.payrollEntry.findUnique({
          where: { id: linkedPayrollEntryId },
          include: { employee: true, payrollPeriod: true },
        })
      }

      const amount = Number(current.amount)

      if (linkedEntry) {
        const remainingPayable = Math.max(
          0,
          Math.round((Number(linkedEntry.netPayable) - Number(linkedEntry.paidAmount) + Number.EPSILON) * 100) / 100
        )
        if (amount > remainingPayable + 0.01) {
          throw new Error(
            `Cannot approve: Amount (৳${amount.toLocaleString()}) exceeds remaining net payable (৳${remainingPayable.toLocaleString()})`
          )
        }

        // Record PayrollPayment
        await tx.payrollPayment.create({
          data: {
            payrollEntryId: linkedEntry.id,
            employeeId: linkedEntry.employeeId,
            amount,
            method: current.method || PaymentMethod.CASH,
            bankAccountId: current.bankAccountId,
            reference: `EXPENSE:${current.id}`,
            notes: current.description,
            createdById: user.id,
          },
        })

        // Update PayrollEntry paidAmount & status
        const newPaidAmount = Number(linkedEntry.paidAmount) + amount
        const newEntryStatus =
          newPaidAmount >= Number(linkedEntry.netPayable) - 0.01
            ? PayrollEntryStatus.PAID
            : PayrollEntryStatus.PARTIALLY_PAID

        await tx.payrollEntry.update({
          where: { id: linkedEntry.id },
          data: {
            paidAmount: newPaidAmount,
            status: newEntryStatus,
          },
        })

        // Recover advance if this was unpaid
        if (Number(linkedEntry.advanceRecovered) > 0 && linkedEntry.status === PayrollEntryStatus.UNPAID) {
          let toDeduct = Number(linkedEntry.advanceRecovered)
          const empAdvances = await tx.employeeAdvance.findMany({
            where: {
              employeeId: linkedEntry.employeeId,
              status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] },
            },
            orderBy: { givenDate: 'asc' },
          })
          for (const adv of empAdvances) {
            if (toDeduct <= 0) break
            const unrecovered = Number(adv.amount) - Number(adv.recoveredAmount)
            const recoverHere = Math.min(unrecovered, toDeduct)
            const newRecovered = Number(adv.recoveredAmount) + recoverHere
            const newAdvStatus =
              newRecovered >= Number(adv.amount) ? AdvanceStatus.CLEARED : AdvanceStatus.PARTIALLY_CLEARED
            await tx.employeeAdvance.update({
              where: { id: adv.id },
              data: { recoveredAmount: newRecovered, status: newAdvStatus },
            })
            toDeduct -= recoverHere
          }
        }

        // Check if all siblings in period are paid
        const allEntries = await tx.payrollEntry.findMany({
          where: { payrollPeriodId: linkedEntry.payrollPeriodId },
          select: { status: true },
        })
        if (allEntries.every(e => e.status === PayrollEntryStatus.PAID)) {
          await tx.payrollPeriod.update({
            where: { id: linkedEntry.payrollPeriodId },
            data: { status: PayrollPeriodStatus.PAID },
          })
        }
      }

      // Money leg: Deduct cash from drawer or bank account
      if (current.method === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, current.outletId, { now: current.expenseDate ?? new Date() })

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a drawer first.'
          )
        }

        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM "CashDrawer" WHERE id = ${openDrawer.id} FOR UPDATE`
        }

        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId: openDrawer.id },
          _sum: { amount: true },
        })

        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < amount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${amount.toLocaleString()}`
          )
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: 'EXPENSE',
            amount: -amount,
            description: `Expense: ${current.description} [${current.id}]`,
            referenceId: current.id,
            referenceType: 'Expense',
            createdAt: current.expenseDate,
          },
        })
      } else {
        if (!current.bankAccountId) {
          throw new Error('Bank/MFS account is required for this expense')
        }

        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${current.bankAccountId} FOR UPDATE`

        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: current.bankAccountId },
        })

        if (!bankAccount) throw new Error('Bank account not found')

        if (Number(bankAccount.currentBalance) < amount) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: 'WITHDRAWAL',
            amount,
            description: `Expense: ${current.description} [${current.id}]`,
            transactionAt: current.expenseDate,
            referenceId: current.id,
            referenceType: 'Expense',
          },
        })
        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { decrement: amount } },
        })
      }

      // GL Accounting Entry:
      // Resolve credit asset account: 1100 (Cash) or 1200 / 1110 (Bank)
      const assetAccount = await tx.chartOfAccount.findFirst({
        where:
          current.method === PaymentMethod.CASH
            ? {
                OR: [
                  { code: '1100' },
                  { name: { contains: 'cash', mode: 'insensitive' } },
                ],
                isActive: true,
              }
            : {
                OR: [
                  { code: '1200' },
                  { code: '1110' },
                  { name: { contains: 'bank', mode: 'insensitive' } },
                ],
                isActive: true,
              },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      })

      if (!assetAccount) {
        throw new Error(
          `Asset account for ${current.method === PaymentMethod.CASH ? 'Cash (1100)' : 'Bank (1200)'} not found in Chart of Accounts`
        )
      }

      // Determine debit account:
      // If linked to an accrued payroll period, debit 2210 Accrued Payroll to avoid duplicate P&L expense!
      let debitAccountId = current.accountId
      if (linkedEntry) {
        const hasAccrual = await tx.accountLedgerEntry.findFirst({
          where: { referenceId: linkedEntry.id, referenceType: 'PAYROLL_ACCRUAL' },
          select: { id: true },
        })
        if (hasAccrual) {
          const accruedPayrollAcc = await tx.chartOfAccount.findFirst({
            where: { code: '2210', isActive: true },
            select: { id: true },
          })
          if (accruedPayrollAcc) debitAccountId = accruedPayrollAcc.id
        }
      }

      const gl = [
        {
          accountId: debitAccountId,
          type: TransactionType.DEBIT,
          amount,
          description: `Expense: ${current.description} [${current.id}]`,
          referenceId: current.id,
          referenceType: 'Expense',
          createdAt: current.expenseDate,
        },
        {
          accountId: assetAccount.id,
          type: TransactionType.CREDIT,
          amount,
          description: `Expense: ${current.description} [${current.id}]`,
          referenceId: current.id,
          referenceType: 'Expense',
          createdAt: current.expenseDate,
        },
      ]
      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({
        data: gl,
      })

      return tx.expense.update({
        where: { id: current.id },
        data: { status: ExpenseStatus.APPROVED, approvedById: user.id },
      })
    })

    await logAuditDirect(user.id, 'EXPENSE_APPROVED', 'Expense', expense.id, {
      amount: Number(expense.amount),
      expenseDate: expense.expenseDate.toISOString(),
    })

    safeRevalidateTag(`dashboard-${expense.outletId}`)
    safeRevalidatePath('/', 'page')
    safeRevalidatePath('/expenses')
    safeRevalidatePath('/hr/payroll')
    safeRevalidatePath('/reports/sales')
    safeRevalidatePath('/ledger/trial-balance')
    safeRevalidatePath('/ledger/transactions')
    return ok(expense)
  } catch (error: any) {
    return fail(error.message || 'Failed to approve expense')
  }
}

export async function rejectExpense(expenseId: string) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  try {
    const expense = await prisma.$transaction(async tx => {
      // Row lock on Expense to serialize against concurrent approveExpense calls
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`

      const current = await tx.expense.findUnique({
        where: { id: expenseId },
      })

      if (!current) throw new Error('Expense not found')
      validateOutletAccess(user, current.outletId)
      if (current.status !== ExpenseStatus.PENDING) {
        throw new Error('Only pending expenses can be rejected')
      }

      const updated = await tx.expense.updateMany({
        where: { id: expenseId, status: ExpenseStatus.PENDING },
        data: { status: ExpenseStatus.REJECTED },
      })

      if (updated.count === 0) {
        throw new Error('Expense has already been approved or rejected')
      }

      return { ...current, status: ExpenseStatus.REJECTED }
    })

    safeRevalidateTag(`dashboard-${expense.outletId}`)
    safeRevalidatePath('/', 'page')
    safeRevalidatePath('/expenses')
    safeRevalidatePath('/reports/sales')
    return ok(expense)
  } catch (error: any) {
    return fail(error.message || 'Failed to reject expense')
  }
}

export async function getExpenses(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  return prisma.expense.findMany({
    where: { outletId },
    include: {
      account: { select: { name: true, code: true } },
      bankAccount: { select: { bankName: true, accountName: true } },
      createdBy: { select: { name: true } },
      project: {
        select: {
          id: true,
          name: true,
          projectCode: true,
          client: { select: { companyName: true } },
        },
      },
    },
    orderBy: { expenseDate: 'desc' },
    take: 200,
  })
}

export async function getAccountLedger(accountId: string) {
  await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  return prisma.accountLedgerEntry.findMany({
    where: { accountId },
    include: { account: { select: { name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
}

export async function getLedgerTransactions(filters?: {
  accountId?: string
  from?: string
  to?: string
}) {
  await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const fromDate = filters?.from ? new Date(filters.from) : null
  const toDate = filters?.to ? new Date(filters.to) : null
  if (fromDate) fromDate.setHours(0, 0, 0, 0)
  if (toDate) toDate.setHours(23, 59, 59, 999)

  return prisma.accountLedgerEntry.findMany({
    where: {
      ...(filters?.accountId ? { accountId: filters.accountId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    },
    include: {
      account: { select: { id: true, code: true, name: true } },
      sale: {
        select: {
          id: true,
          saleNumber: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
}

export async function getTrialBalance() {
  await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  // Aggregate debit/credit sums at the DB level instead of loading every
  // ledger entry row into JS memory.
  const [accounts, aggregated] = await Promise.all([
    prisma.chartOfAccount.findMany({
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    }),
    prisma.accountLedgerEntry.groupBy({
      by: ['accountId', 'type'],
      _sum: { amount: true },
    }),
  ])

  // Build a fast lookup: accountId → { DEBIT: number, CREDIT: number }
  const sumMap = new Map<string, { DEBIT: number; CREDIT: number }>()
  for (const row of aggregated) {
    const entry = sumMap.get(row.accountId) ?? { DEBIT: 0, CREDIT: 0 }
    entry[row.type as 'DEBIT' | 'CREDIT'] += Number(row._sum.amount ?? 0)
    sumMap.set(row.accountId, entry)
  }

  const result = accounts.map(account => {
    const sums = sumMap.get(account.id) ?? { DEBIT: 0, CREDIT: 0 }
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      debit: sums.DEBIT,
      credit: sums.CREDIT,
      balance: sums.DEBIT - sums.CREDIT,
    }
  })

  return ok(result)
}

export async function getProfitLossReport(
  outletId: string,
  from: string,
  to: string
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  const { start: startDate, end: endDate, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
  if (isInverted) return fail('From date cannot be after To date')

  // 1. Concurrently fetch SaleLines, Service Invoices, and SaleReturnLines in the period for the outlet
  const [saleLines, serviceInvoices, returnLines] = await Promise.all([
    prisma.saleLine.findMany({
      where: {
        sale: {
          outletId,
          isQuotation: false,
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED, SaleStatus.REFUNDED] },
          createdAt: { gte: startDate, lte: endDate },
        },
      },
      select: {
        id: true,
        saleId: true,
        productId: true,
        quantity: true,
        unitPrice: true,
        unitCost: true,
        totalCogs: true,
        discountAmt: true,
        total: true,
        isGift: true,
        parentLineId: true,
        sale: {
          select: {
            saleNumber: true,
            createdAt: true,
            subtotal: true,
            discountAmt: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            requiresSerial: true,
            costPrice: true,
            sellingPrice: true,
            display: true,
            processor: { select: { name: true } },
            processorGen: { select: { name: true } },
            ram: { select: { name: true } },
            storage: { select: { name: true } },
          },
        },
        serials: {
          include: {
            serialUnit: {
              select: {
                id: true,
                serialNumber: true,
                costPrice: true,
                sellingPrice: true,
              },
            },
          },
        },
      },
      orderBy: {
        sale: {
          createdAt: 'desc',
        },
      },
    }),

    // 1b. Fetch Service Invoices in the period for the outlet (Bug 2 fix: Service & Repair revenue in P&L)
    prisma.serviceInvoice.findMany({
      where: {
        job: {
          outletId,
        },
        createdAt: { gte: startDate, lte: endDate },
      },
      include: {
        job: {
          select: {
            device: true,
            jobNumber: true,
            parts: {
              include: {
                product: { select: { name: true, costPrice: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // 1c. Fetch SaleReturnLines in the period for the outlet (joined with SaleReturn & Sale)
    prisma.saleReturnLine.findMany({
      where: {
        return: {
          createdAt: { gte: startDate, lte: endDate },
          OR: [
            { outletId },
            { sale: { outletId } },
          ],
          sale: {
            isQuotation: false,
            status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED, SaleStatus.REFUNDED] },
          },
        },
      },
      include: {
        return: {
          select: {
            id: true,
            returnNumber: true,
            createdAt: true,
            total: true,
          },
        },
        saleLine: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            unitCost: true,
            totalCogs: true,
            product: {
              select: {
                id: true,
                name: true,
                costPrice: true,
                requiresSerial: true,
                display: true,
                processor: { select: { name: true } },
                processorGen: { select: { name: true } },
                ram: { select: { name: true } },
                storage: { select: { name: true } },
              },
            },
          },
        },
        serials: {
          include: {
            serialUnit: {
              select: {
                id: true,
                serialNumber: true,
                costPrice: true,
              },
            },
          },
        },
      },
      orderBy: {
        return: {
          createdAt: 'desc',
        },
      },
    }),
  ])

  // Group lines by saleId to allocate gift costs (otherCost) to main product lines
  const saleLinesMap = new Map<string, typeof saleLines>()
  for (const line of saleLines) {
    const list = saleLinesMap.get(line.saleId) || []
    list.push(line)
    saleLinesMap.set(line.saleId, list)
  }

  // Recover and distribute order-level discounts per sale to non-gift lines
  const orderDiscountByLineId = new Map<string, number>()
  for (const linesInSale of saleLinesMap.values()) {
    const nonGiftLinesInSale = linesInSale.filter(l => !l.isGift)
    const saleDiscountAmt = Number(linesInSale[0]?.sale?.discountAmt ?? 0)
    const discountMap = distributeOrderDiscount(
      saleDiscountAmt,
      nonGiftLinesInSale.map(l => ({
        id: l.id,
        total: Number(l.total ?? 0),
        discountAmt: Number(l.discountAmt ?? 0),
      }))
    )
    for (const [lineId, amt] of discountMap) {
      orderDiscountByLineId.set(lineId, amt)
    }
  }

  const lineOtherCostMap = new Map<string, number>()
  const unhandledGiftLines: typeof saleLines = []

  for (const linesInSale of saleLinesMap.values()) {
    const giftLines = linesInSale.filter(l => l.isGift)
    const mainLines = linesInSale.filter(l => !l.isGift)

    if (giftLines.length === 0) continue

    if (mainLines.length === 0) {
      unhandledGiftLines.push(...giftLines)
      continue
    }

    let unparentedGiftCost = 0
    for (const g of giftLines) {
      const gQty = g.quantity || 1
      const gCogs =
        Number(g.totalCogs) > 0
          ? Number(g.totalCogs)
          : Number(g.unitCost) > 0
            ? Number(g.unitCost) * gQty
            : Number(g.product.costPrice) * gQty

      if (g.parentLineId && mainLines.some(m => m.id === g.parentLineId)) {
        lineOtherCostMap.set(
          g.parentLineId,
          (lineOtherCostMap.get(g.parentLineId) || 0) + gCogs
        )
      } else {
        unparentedGiftCost += gCogs
      }
    }

    if (unparentedGiftCost > 0) {
      const serializedMainLines = mainLines.filter(
        m => m.product.requiresSerial || (m.serials && m.serials.length > 0)
      )

      if (serializedMainLines.length > 0) {
        const totalSerialQty = serializedMainLines.reduce(
          (sum, m) => sum + (m.quantity || 1),
          0
        )
        for (const m of serializedMainLines) {
          const mQty = m.quantity || 1
          const share = unparentedGiftCost * (mQty / totalSerialQty)
          lineOtherCostMap.set(
            m.id,
            (lineOtherCostMap.get(m.id) || 0) + share
          )
        }
      } else {
        const totalSale = mainLines.reduce((sum, m) => sum + Number(m.total), 0)
        for (const m of mainLines) {
          const share =
            totalSale > 0
              ? unparentedGiftCost * (Number(m.total) / totalSale)
              : unparentedGiftCost / mainLines.length
          lineOtherCostMap.set(
            m.id,
            (lineOtherCostMap.get(m.id) || 0) + share
          )
        }
      }
    }
  }

  const itemLines: {
    date: string
    name: string
    serialNumbers: string
    qty: number
    unitCost: number
    otherCost: number
    totalCost: number
    avrSaleUnit: number
    discount: number
    totalSale: number
    profitLoss: number
  }[] = []

  // Map for aggregating non-serialized products by productId
  const nonSerializedMap = new Map<
    string,
    {
      date: string
      name: string
      qty: number
      totalCost: number
      totalOtherCost: number
      totalDiscount: number
      totalSale: number
    }
  >()

  for (const line of saleLines) {
    if (line.isGift && !unhandledGiftLines.includes(line)) {
      // Gift line costs have been absorbed into otherCost on main product rows
      continue
    }

    const saleDate = line.sale?.createdAt
      ? line.sale.createdAt.toISOString().slice(0, 10)
      : '—'
    const isSerialized =
      line.product.requiresSerial || (line.serials && line.serials.length > 0)
    const lineOtherCost = lineOtherCostMap.get(line.id) || 0
    const orderDiscountShare = orderDiscountByLineId.get(line.id) ?? 0

    const fullProdName = formatProductFullName({
      ...line.product,
      processor: line.product.processor?.name,
      processorGen: line.product.processorGen?.name,
      ram: line.product.ram?.name,
      storage: line.product.storage?.name,
      display: line.product.display,
    })

    if (isSerialized) {
      const lineTotal = Number(line.total)
      const lineQuantity = line.quantity || 1
      const lineGross = Number(line.unitPrice) * lineQuantity
      const baseLineDiscount = Number(line.discountAmt) > 0
        ? Number(line.discountAmt)
        : Math.max(0, lineGross - lineTotal)
      const totalLineDiscount = round2(baseLineDiscount + orderDiscountShare)
      const lineNetSale = Math.max(0, round2(lineTotal - orderDiscountShare))

      const lineCogs =
        Number(line.totalCogs) > 0
          ? Number(line.totalCogs)
          : Number(line.unitCost) * lineQuantity

      const effectiveUnitPrice = lineGross / lineQuantity
      const fallbackUnitCost = lineCogs / lineQuantity
      const otherCostPerUnit = lineOtherCost / lineQuantity
      const discountPerUnit = totalLineDiscount / lineQuantity
      const netSalePerUnit = lineNetSale / lineQuantity

      if (line.serials && line.serials.length > 0) {
        for (const s of line.serials) {
          const serialCost =
            s.serialUnit?.costPrice != null
              ? Number(s.serialUnit.costPrice)
              : fallbackUnitCost
          const serialSale = effectiveUnitPrice
          const profitLoss = netSalePerUnit - serialCost - otherCostPerUnit

          itemLines.push({
            date: saleDate,
            name: fullProdName,
            serialNumbers: s.serialUnit?.serialNumber || '—',
            qty: 1,
            unitCost: serialCost,
            otherCost: otherCostPerUnit,
            totalCost: serialCost,
            avrSaleUnit: serialSale,
            discount: discountPerUnit,
            totalSale: netSalePerUnit,
            profitLoss,
          })
        }

        // If line quantity exceeds the number of recorded serialUnits
        const unattachedCount = lineQuantity - line.serials.length
        for (let i = 0; i < unattachedCount; i++) {
          const serialCost = fallbackUnitCost
          const serialSale = effectiveUnitPrice
          const profitLoss = netSalePerUnit - serialCost - otherCostPerUnit

          itemLines.push({
            date: saleDate,
            name: fullProdName,
            serialNumbers: '—',
            qty: 1,
            unitCost: serialCost,
            otherCost: otherCostPerUnit,
            totalCost: serialCost,
            avrSaleUnit: serialSale,
            discount: discountPerUnit,
            totalSale: netSalePerUnit,
            profitLoss,
          })
        }
      } else {
        // Serialized product with no serialUnit records attached
        for (let i = 0; i < lineQuantity; i++) {
          const serialCost = fallbackUnitCost
          const serialSale = effectiveUnitPrice
          const profitLoss = netSalePerUnit - serialCost - otherCostPerUnit

          itemLines.push({
            date: saleDate,
            name: fullProdName,
            serialNumbers: '—',
            qty: 1,
            unitCost: serialCost,
            otherCost: otherCostPerUnit,
            totalCost: serialCost,
            avrSaleUnit: serialSale,
            discount: discountPerUnit,
            totalSale: netSalePerUnit,
            profitLoss,
          })
        }
      }
    } else {
      // Non-serialized item: aggregate by productId
      const lineCost =
        Number(line.totalCogs) > 0
          ? Number(line.totalCogs)
          : Number(line.unitCost) * line.quantity
            
      const lineTotal = Number(line.total)
      const lineQuantity = line.quantity || 1
      const lineGross = Number(line.unitPrice) * lineQuantity
      const baseLineDiscount = Number(line.discountAmt) > 0
        ? Number(line.discountAmt)
        : Math.max(0, lineGross - lineTotal)
      const totalLineDiscount = round2(baseLineDiscount + orderDiscountShare)
      const lineNetSale = Math.max(0, round2(lineTotal - orderDiscountShare))

      const existing = nonSerializedMap.get(line.productId)
      if (existing) {
        existing.qty += lineQuantity
        existing.totalCost += lineCost
        existing.totalOtherCost += lineOtherCost
        existing.totalDiscount += totalLineDiscount
        existing.totalSale += lineNetSale
      } else {
        nonSerializedMap.set(line.productId, {
          date: saleDate,
          name: fullProdName,
          qty: lineQuantity,
          totalCost: lineCost,
          totalOtherCost: lineOtherCost,
          totalDiscount: totalLineDiscount,
          totalSale: lineNetSale,
        })
      }
    }
  }

  const unmatchedSerializedReturns: Array<{
    prodId: string
    retLine: any
    remainingRetQty: number
    remainingRetRevenue: number
    remainingRetCogs: number
  }> = []

  // 2. Net out returns against product map and serialized itemLines
  for (const retLine of returnLines) {
    const prodId = retLine.saleLine.productId
    const retQty = retLine.quantity || 1
    const refundUnitPrice =
      Number(retLine.refundUnitPrice) > 0
        ? Number(retLine.refundUnitPrice)
        : Number(retLine.unitPrice)
    const retRevenue = refundUnitPrice * retQty

    const unitCogs =
      Number(retLine.returnedCogs) > 0
        ? Number(retLine.returnedCogs) / retQty
        : Number(retLine.saleLine.totalCogs) > 0
          ? Number(retLine.saleLine.totalCogs) / Math.max(1, retLine.saleLine.quantity)
          : Number(retLine.saleLine.unitCost) > 0
            ? Number(retLine.saleLine.unitCost)
            : Number(retLine.saleLine.product?.costPrice || 0)
    const retCogs =
      Number(retLine.returnedCogs) > 0
        ? Number(retLine.returnedCogs)
        : unitCogs * retQty

    let remainingRetQty = retQty
    let remainingRetRevenue = retRevenue
    let remainingRetCogs = retCogs

    const retProd = retLine.saleLine?.product
    const retProdName = retProd
      ? formatProductFullName({
          ...retProd,
          processor: retProd.processor?.name,
          processorGen: retProd.processorGen?.name,
          ram: retProd.ram?.name,
          storage: retProd.storage?.name,
          display: retProd.display,
        })
      : 'Returned Item'

    // If the returned unit is serialized and tracked by serial number, try matching existing itemLine
    if (retLine.serials && retLine.serials.length > 0) {
      for (const s of retLine.serials) {
        const serialNo = s.serialUnit?.serialNumber
        if (serialNo) {
          const idx = itemLines.findIndex(
            it => it.serialNumbers === serialNo && (it.name === retProdName || it.name === retProd?.name)
          )
          if (idx !== -1) {
            const matched = itemLines[idx]
            remainingRetQty -= 1
            remainingRetRevenue -= matched.totalSale
            remainingRetCogs -= matched.totalCost
            itemLines.splice(idx, 1)
          }
        }
      }
    }

    // For remaining returned quantity (non-serialized, or serialized returns from prior periods)
    if (remainingRetQty > 0 || remainingRetRevenue > 0 || remainingRetCogs > 0) {
      if (retLine.saleLine.product.requiresSerial) {
        // Serialized product whose return has no matching serial record in this period.
        // Record in unmatchedSerializedReturns for audit transparency,
        // and insert as a negative line item in itemLines so it nets revenue & COGS in this period.
        unmatchedSerializedReturns.push({
          prodId,
          retLine,
          remainingRetQty,
          remainingRetRevenue,
          remainingRetCogs,
        })

        const retDate = retLine.return?.createdAt
          ? retLine.return.createdAt.toISOString().slice(0, 10)
          : '—'
        const retSerials = (retLine.serials || [])
          .map((s: any) => s.serialUnit?.serialNumber)
          .filter(Boolean)
        const serialNumbers = retSerials.length > 0 ? retSerials.join(', ') : '—'
        const unitCost = remainingRetQty !== 0 ? Math.abs(remainingRetCogs / remainingRetQty) : 0
        const otherCost = 0
        const totalCost = -remainingRetCogs
        const avrSaleUnit = remainingRetQty !== 0 ? Math.abs(remainingRetRevenue / remainingRetQty) : 0
        const discount = 0
        const totalSale = -remainingRetRevenue
        const profitLoss = totalSale - totalCost - otherCost

        itemLines.push({
          date: retDate,
          name: retProdName,
          serialNumbers,
          qty: -remainingRetQty,
          unitCost,
          otherCost,
          totalCost,
          avrSaleUnit,
          discount,
          totalSale,
          profitLoss,
        })
        continue
      }
      const existing = nonSerializedMap.get(prodId)
      if (existing) {
        existing.qty -= remainingRetQty
        existing.totalSale -= remainingRetRevenue
        existing.totalCost -= remainingRetCogs
      } else {
        // Return belongs to a previous period's sale: insert as negative baseline
        const retDate = retLine.return?.createdAt
          ? retLine.return.createdAt.toISOString().slice(0, 10)
          : '—'
        nonSerializedMap.set(prodId, {
          date: retDate,
          name: retProdName,
          qty: -remainingRetQty,
          totalCost: -remainingRetCogs,
          totalOtherCost: 0,
          totalDiscount: 0,
          totalSale: -remainingRetRevenue,
        })
      }
    }
  }

  // Add aggregated non-serialized items to itemLines
  for (const nonSer of nonSerializedMap.values()) {
    // If a product was sold and completely returned within this period, skip 0-qty line
    if (nonSer.qty === 0 && nonSer.totalSale === 0 && nonSer.totalCost === 0) {
      continue
    }

    const unitCost = nonSer.qty !== 0 ? Math.abs(nonSer.totalCost / nonSer.qty) : 0
    const otherCost = nonSer.totalOtherCost
    const avrSaleUnit = nonSer.qty !== 0 ? (nonSer.totalSale + nonSer.totalDiscount) / nonSer.qty : 0
    const discount = nonSer.totalDiscount
    const profitLoss = nonSer.totalSale - nonSer.totalCost - otherCost

    itemLines.push({
      date: nonSer.date,
      name: nonSer.name,
      serialNumbers: '—',
      qty: nonSer.qty,
      unitCost,
      otherCost,
      totalCost: nonSer.totalCost,
      avrSaleUnit,
      discount,
      totalSale: nonSer.totalSale,
      profitLoss,
    })
  }

  // 2b. Add Service & Repair jobs into itemLines (Bug 2 fix)
  for (const inv of serviceInvoices) {
    const invDate = inv.createdAt.toISOString().slice(0, 10)
    const invTotal = Number(inv.total)
    const partsCost = inv.job.parts.reduce(
      (sum, p) => sum + Number(p.product?.costPrice ?? p.unitCost) * p.quantity,
      0
    )
    const profitLoss = invTotal - partsCost

    itemLines.push({
      date: invDate,
      name: `Service: ${inv.job.device} (${inv.job.jobNumber})`,
      serialNumbers: '—',
      qty: 1,
      unitCost: partsCost,
      otherCost: 0,
      totalCost: partsCost,
      avrSaleUnit: invTotal,
      discount: 0,
      totalSale: invTotal,
      profitLoss,
    })
  }

  // Sort itemLines by totalSale descending
  itemLines.sort((a, b) => b.totalSale - a.totalSale)

  const totalItemsCost = itemLines.reduce((sum, i) => sum + (i.totalCost != null ? i.totalCost : (i.unitCost * i.qty)), 0)
  const totalOtherCost = itemLines.reduce((sum, i) => sum + i.otherCost, 0)
  const totalItemsSale = itemLines.reduce((sum, i) => sum + i.totalSale, 0)
  const grossProfit = totalItemsSale - totalItemsCost - totalOtherCost

  // Audit calculations for return transparency
  const totalReturns = returnLines.reduce(
    (sum, l) => sum + (Number(l.refundUnitPrice || l.unitPrice) * (l.quantity || 1)),
    0
  )
  const returnedCogs = returnLines.reduce(
    (sum, l) =>
      sum +
      (Number(l.returnedCogs) > 0
        ? Number(l.returnedCogs)
        : (l.quantity || 1) *
          (Number(l.saleLine.totalCogs) > 0
            ? Number(l.saleLine.totalCogs) / Math.max(1, l.saleLine.quantity)
            : Number(l.saleLine.unitCost) > 0
              ? Number(l.saleLine.unitCost)
              : Number(l.saleLine.product?.costPrice || 0))),
    0
  )
  const grossSales = totalItemsSale + totalReturns

  // 3. Operating Expenses
  const expenses = await prisma.expense.findMany({
    where: {
      outletId,
      status: ExpenseStatus.APPROVED,
      expenseDate: { gte: startDate, lte: endDate },
    },
    select: {
      description: true,
      amount: true,
      expenseDate: true,
    },
    orderBy: { expenseDate: 'asc' },
  })

  const operatingExpenses = expenses.map(e => ({
    description: e.description,
    date: e.expenseDate.toISOString().slice(0, 10),
    amount: Number(e.amount),
  }))

  const totalOperatingExpenses = operatingExpenses.reduce(
    (sum, e) => sum + e.amount,
    0
  )

  const netProfit = grossProfit - totalOperatingExpenses

  const totalDiscount = itemLines.reduce((sum, i) => sum + i.discount, 0)

  // 4. GL Cross-Check / Reconciliation (FIN-F12 / REP-F1)
  let glRevenue = 0
  let glCogs = 0
  try {
    const glIncomeSum = await prisma.$queryRaw<{ totalInc: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "totalInc"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.type::text = 'INCOME'
        AND ale."createdAt" >= ${startDate}
        AND ale."createdAt" <= ${endDate}
    `
    glRevenue = Math.round(Number(glIncomeSum[0]?.totalInc || 0) * 100) / 100

    const glCogsSum = await prisma.$queryRaw<{ totalCogs: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "totalCogs"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE (coa.code = '5000' OR (coa.type::text = 'EXPENSE' AND coa.code LIKE '5%'))
        AND ale."createdAt" >= ${startDate}
        AND ale."createdAt" <= ${endDate}
    `
    glCogs = Math.round(Number(glCogsSum[0]?.totalCogs || 0) * 100) / 100
  } catch (err) {
    console.warn('[ProfitLoss] GL cross-check query skipped or failed:', err)
  }

  const subledgerCogs = Math.round((totalItemsCost + totalOtherCost) * 100) / 100
  const subledgerRevenue = Math.round(totalItemsSale * 100) / 100
  const revenueDiscrepancy = Math.round((glRevenue - subledgerRevenue) * 100) / 100
  const cogsDiscrepancy = Math.round((glCogs - subledgerCogs) * 100) / 100
  const isReconciled = Math.abs(revenueDiscrepancy) < 0.05 && Math.abs(cogsDiscrepancy) < 0.05

  return ok({
    from,
    to,
    itemLines,
    grossSales,
    totalReturns,
    returnedCogs,
    totalItemsCost,
    totalOtherCost,
    totalDiscount,
    totalItemsSale,
    netSales: totalItemsSale,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    netProfit,
    unmatchedSerializedReturns,
    unmatchedReturns: unmatchedSerializedReturns,
    glReconciliation: {
      glRevenue,
      glCogs,
      subledgerRevenue,
      subledgerCogs,
      revenueDiscrepancy,
      cogsDiscrepancy,
      isReconciled,
    },
  })
}

export async function getExpenseReport(
  outletId: string,
  from: string,
  to: string
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  const { start: startDate, end: endDate, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
  if (isInverted) return fail('From date cannot be after To date')

  const expenses = await prisma.expense.findMany({
    where: {
      outletId,
      status: ExpenseStatus.APPROVED,
      expenseDate: { gte: startDate, lte: endDate },
    },
    include: {
      account: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
    orderBy: { expenseDate: 'desc' },
  })

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  // Group by category (account name)
  const categoryMap = new Map<string, number>()
  for (const exp of expenses) {
    const category = exp.account?.name || 'Uncategorized'
    categoryMap.set(
      category,
      (categoryMap.get(category) || 0) + Number(exp.amount)
    )
  }

  const byCategory = Array.from(categoryMap.entries())
    .map(([category, total]) => ({
      category,
      total,
      percentage: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // Calculate MFS/Bank charges (look for specific descriptions or account code 5290)
  const mfsBankCharges = expenses
    .filter(
      exp =>
        exp.description.toLowerCase().includes('mfs') ||
        exp.description.toLowerCase().includes('bank') ||
        exp.description.toLowerCase().includes('charge') ||
        exp.description.toLowerCase().includes('fee') ||
        exp.account?.name?.toLowerCase().includes('miscellaneous')
    )
    .reduce((s, e) => s + Number(e.amount), 0)

  return ok({
    from,
    to,
    totalExpenses,
    mfsBankCharges,
    byCategory,
    expenses: expenses.map(exp => ({
      date: exp.expenseDate.toISOString().slice(0, 10),
      category: exp.account?.name || 'Uncategorized',
      description: exp.description,
      amount: Number(exp.amount),
      status: exp.status,
      approvedBy: exp.approvedBy?.name || null,
    })),
  })
}

export async function getDetailedExpenseReport(
  outletId: string,
  from: string,
  to: string
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  const { start: startDate, end: endDate, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
  if (isInverted) return fail('From date cannot be after To date')

  // 1. Gift Costs
  const giftLines = await prisma.saleLine.findMany({
    where: {
      isGift: true,
      sale: {
        outletId,
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        createdAt: { gte: startDate, lte: endDate },
      },
    },
    select: {
      quantity: true,
      totalCogs: true,
      product: {
        select: {
          name: true,
          display: true,
          processor: { select: { name: true } },
          processorGen: { select: { name: true } },
          ram: { select: { name: true } },
          storage: { select: { name: true } },
        },
      },
    },
  })

  const giftMap = new Map<string, { qty: number; unitCost: number; totalCost: number }>()
  for (const line of giftLines) {
    const name = formatProductFullName({
      ...line.product,
      processor: line.product.processor?.name,
      processorGen: line.product.processorGen?.name,
      ram: line.product.ram?.name,
      storage: line.product.storage?.name,
      display: line.product.display,
    })
    const existing = giftMap.get(name)
    if (existing) {
      existing.qty += line.quantity
      existing.totalCost += Number(line.totalCogs)
    } else {
      giftMap.set(name, {
        qty: line.quantity,
        unitCost: Number(line.totalCogs) / (line.quantity || 1),
        totalCost: Number(line.totalCogs),
      })
    }
  }

  const gifts = Array.from(giftMap.entries()).map(([name, data]) => ({
    name,
    qty: data.qty,
    unitCost: data.unitCost,
    totalCost: data.totalCost,
  }))

  const totalGiftCost = gifts.reduce((sum, g) => sum + g.totalCost, 0)

  // 2. Operating Expenses
  const expenses = await prisma.expense.findMany({
    where: {
      outletId,
      status: ExpenseStatus.APPROVED,
      expenseDate: { gte: startDate, lte: endDate },
    },
    select: {
      description: true,
      amount: true,
      expenseDate: true,
    },
    orderBy: { expenseDate: 'asc' },
  })

  const operatingExpenses = expenses.map(e => ({
    description: e.description,
    date: e.expenseDate.toISOString().slice(0, 10),
    amount: Number(e.amount),
  }))

  const totalOperatingExpenses = operatingExpenses.reduce(
    (sum, e) => sum + e.amount,
    0
  )

  return ok({
    from,
    to,
    gifts,
    totalGiftCost,
    operatingExpenses,
    totalOperatingExpenses,
    grandTotal: totalGiftCost + totalOperatingExpenses,
  })
}

export async function getDueReport(outletId: string) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  validateOutletAccess(user, outletId)

  const [sales, serviceInvoices] = await Promise.all([
    prisma.sale.findMany({
      where: {
        outletId,
        isQuotation: false,
        status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] },
        OR: [
          {
            amountPaid: {
              lt: prisma.sale.fields.total,
            },
          },
          {
            payments: {
              some: {
                method: 'CREDIT',
              },
            },
          },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            linkedSupplier: {
              select: {
                id: true,
                name: true,
                outstandingBalance: true,
              },
            },
          },
        },
        payments: {
          select: {
            method: true,
            amount: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.serviceInvoice.findMany({
      where: {
        job: {
          outletId,
        },
        status: {
          notIn: [InvoiceStatus.PAID, InvoiceStatus.VOID, InvoiceStatus.DRAFT],
        },
      },
      include: {
        job: {
          select: {
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                linkedSupplier: {
                  select: {
                    id: true,
                    name: true,
                    outstandingBalance: true,
                  },
                },
              },
            },
          },
        },
        payments: {
          select: {
            method: true,
            amount: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Process sales to calculate accurate due, especially for legacy sales where amountPaid included credit
  const processedSales = sales
    .map(sale => {
      const hasCredit = sale.payments.some(p => p.method === 'CREDIT')
      let due = Number(sale.total) - Number(sale.amountPaid)

      if (hasCredit) {
        const nonCreditPaid = sale.payments
          .filter(p => p.method !== 'CREDIT')
          .reduce((sum, p) => sum + Number(p.amount), 0)
        due = Number(sale.total) - nonCreditPaid
      }

      return {
        ...sale,
        calculatedDue: due,
        calculatedPaid: Number(sale.total) - due,
      }
    })
    .filter(s => s.calculatedDue > 0)

  // REP-F2: Process unpaid ServiceInvoice rows
  const processedServiceInvoices = serviceInvoices
    .map(inv => {
      const hasCredit = inv.payments.some(p => p.method === 'CREDIT')
      let due = Number(inv.total) - Number(inv.amountPaid)

      if (hasCredit) {
        const nonCreditPaid = inv.payments
          .filter(p => p.method !== 'CREDIT')
          .reduce((sum, p) => sum + Number(p.amount), 0)
        due = Number(inv.total) - nonCreditPaid
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.job?.customer ?? null,
        createdAt: inv.createdAt,
        total: Number(inv.total),
        calculatedPaid: Number(inv.total) - due,
        calculatedDue: due,
      }
    })
    .filter(inv => inv.calculatedDue > 0)

  const totalDue =
    processedSales.reduce((sum, s) => sum + s.calculatedDue, 0) +
    processedServiceInvoices.reduce((sum, s) => sum + s.calculatedDue, 0)

  // Group by customer
  const customerMap = new Map<
    string,
    {
      name: string
      phone: string | null
      email: string | null
      linkedSupplier: { id: string; name: string; outstandingBalance: any } | null
      totalDue: number
      invoiceCount: number
      oldestDate: Date
    }
  >()

  for (const sale of processedSales) {
    if (!sale.customer) continue

    const customerId = sale.customer.id
    const due = sale.calculatedDue

    const existing = customerMap.get(customerId) || {
      name: sale.customer.name,
      phone: sale.customer.phone,
      email: sale.customer.email,
      linkedSupplier: sale.customer.linkedSupplier ?? null,
      totalDue: 0,
      invoiceCount: 0,
      oldestDate: sale.createdAt,
    }

    existing.totalDue += due
    existing.invoiceCount += 1
    if (sale.createdAt < existing.oldestDate) {
      existing.oldestDate = sale.createdAt
    }

    customerMap.set(customerId, existing)
  }

  for (const inv of processedServiceInvoices) {
    if (!inv.customer) continue

    const customerId = inv.customer.id
    const due = inv.calculatedDue

    const existing = customerMap.get(customerId) || {
      name: inv.customer.name,
      phone: inv.customer.phone,
      email: inv.customer.email,
      linkedSupplier: inv.customer.linkedSupplier ?? null,
      totalDue: 0,
      invoiceCount: 0,
      oldestDate: inv.createdAt,
    }

    existing.totalDue += due
    existing.invoiceCount += 1
    if (inv.createdAt < existing.oldestDate) {
      existing.oldestDate = inv.createdAt
    }

    customerMap.set(customerId, existing)
  }

  const now = new Date()
  const customers = Array.from(customerMap.entries())
    .map(([id, cust]) => {
      const grossAr = cust.totalDue
      const grossAp = cust.linkedSupplier ? Number(cust.linkedSupplier.outstandingBalance || 0) : 0
      const netBalance = grossAr - grossAp

      return {
        customerId: id,
        customerName: cust.name,
        customerPhone: cust.phone,
        customerEmail: cust.email,
        totalDue: cust.totalDue,
        grossArBalance: grossAr,
        grossApBalance: grossAp,
        netBalance,
        isB2BLinked: Boolean(cust.linkedSupplier),
        linkedSupplierName: cust.linkedSupplier?.name ?? null,
        linkedSupplierId: cust.linkedSupplier?.id ?? null,
        invoiceCount: cust.invoiceCount,
        oldestDueDays: Math.floor(
          (now.getTime() - cust.oldestDate.getTime()) / (1000 * 60 * 60 * 24)
        ),
      }
    })
    .sort((a, b) => b.totalDue - a.totalDue)

  const saleInvoices = processedSales.map(sale => {
    const total = Number(sale.total)
    const paid = sale.calculatedPaid
    const due = sale.calculatedDue
    const daysOverdue = Math.floor(
      (now.getTime() - sale.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    )

    return {
      saleNumber: sale.saleNumber,
      customerName: sale.customer?.name || 'Walk-in',
      date: sale.createdAt.toISOString().slice(0, 10),
      total,
      paid,
      due,
      daysOverdue,
    }
  })

  const serviceInvoicesList = processedServiceInvoices.map(inv => {
    const daysOverdue = Math.floor(
      (now.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    )
    return {
      saleNumber: inv.invoiceNumber,
      customerName: inv.customer?.name || 'Walk-in (Service)',
      date: inv.createdAt.toISOString().slice(0, 10),
      total: inv.total,
      paid: inv.calculatedPaid,
      due: inv.calculatedDue,
      daysOverdue,
    }
  })

  const invoices = [...saleInvoices, ...serviceInvoicesList].sort((a, b) => b.due - a.due)

  const netTotalDue = customers.reduce(
    (sum, c) => sum + (c.isB2BLinked ? Math.max(0, c.netBalance) : c.totalDue),
    0
  )

  return ok({
    totalDue,
    netTotalDue,
    customers,
    invoices,
  })
}
