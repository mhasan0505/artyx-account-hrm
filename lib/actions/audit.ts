'use server'

import { requireRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import { SaleStatus, UserRole } from '@prisma/client'

export async function getDiscountReport(from: string, to: string) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const { start: startDate, end: endDate, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
  if (isInverted) return fail('From date cannot be after To date')

  // Get all sales with discounts (both order-level and line-level)
  const sales = await prisma.sale.findMany({
    where: {
      isQuotation: false,
      status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED, SaleStatus.REFUNDED] },
      createdAt: { gte: startDate, lte: endDate },
      OR: [
        { discountAmt: { gt: 0 } },
        { lines: { some: { discountAmt: { gt: 0 } } } },
      ],
    },
    include: {
      cashier: { select: { name: true } },
      lines: { select: { discountAmt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Get audit logs for discount overrides
  const discountOverrides = await prisma.auditLog.findMany({
    where: {
      action: 'DISCOUNT_OVERRIDE',
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      user: { select: { name: true } },
    },
  })

  const overrideMap = new Map(
    discountOverrides.map(log => [
      log.entityId,
      {
        managerAuthorizerId:
          (log.metadata as any)?.approverName ||
          (log.metadata as any)?.managerAuthorizerId ||
          log.user?.name ||
          null,
      },
    ])
  )

  const totalDiscounts = sales.reduce((sum, s) => {
    const lineDiscounts = s.lines.reduce((lSum, l) => lSum + Number(l.discountAmt || 0), 0)
    return sum + Math.max(Number(s.discountAmt || 0), lineDiscounts)
  }, 0)

  const overrideCount = discountOverrides.length
  const avgDiscountPct =
    sales.length > 0
      ? sales.reduce((sum, s) => {
          const lineDiscounts = s.lines.reduce((lSum, l) => lSum + Number(l.discountAmt || 0), 0)
          const totalDisc = Math.max(Number(s.discountAmt || 0), lineDiscounts)
          const beforeDiscount = Number(s.subtotal || 0) > 0 ? Number(s.subtotal) : Number(s.total) + totalDisc
          const pct =
            beforeDiscount > 0
              ? (totalDisc / beforeDiscount) * 100
              : 0
          return sum + pct
        }, 0) / sales.length
      : 0

  // Group by employee
  const employeeMap = new Map<
    string,
    {
      name: string
      totalDiscounts: number
      salesCount: number
      totalPct: number
    }
  >()

  for (const sale of sales) {
    const cashierName = sale.cashier?.name || 'Unknown'
    const lineDiscounts = sale.lines.reduce((lSum, l) => lSum + Number(l.discountAmt || 0), 0)
    const discountAmount = Math.max(Number(sale.discountAmt || 0), lineDiscounts)
    const beforeDiscount = Number(sale.subtotal || 0) > 0 ? Number(sale.subtotal) : Number(sale.total) + discountAmount
    const discountPct =
      beforeDiscount > 0 ? (discountAmount / beforeDiscount) * 100 : 0

    const existing = employeeMap.get(cashierName) || {
      name: cashierName,
      totalDiscounts: 0,
      salesCount: 0,
      totalPct: 0,
    }

    existing.totalDiscounts += discountAmount
    existing.salesCount += 1
    existing.totalPct += discountPct
    employeeMap.set(cashierName, existing)
  }

  const byEmployee = Array.from(employeeMap.values())
    .map(emp => ({
      cashierName: emp.name,
      totalDiscounts: emp.totalDiscounts,
      salesCount: emp.salesCount,
      avgDiscountPct: emp.totalPct / emp.salesCount,
    }))
    .sort((a, b) => b.totalDiscounts - a.totalDiscounts)

  const discounts = sales.map(sale => {
    const lineDiscounts = sale.lines.reduce((lSum, l) => lSum + Number(l.discountAmt || 0), 0)
    const discountAmount = Math.max(Number(sale.discountAmt || 0), lineDiscounts)
    const beforeDiscount = Number(sale.subtotal || 0) > 0 ? Number(sale.subtotal) : Number(sale.total) + discountAmount
    const discountPct =
      beforeDiscount > 0 ? (discountAmount / beforeDiscount) * 100 : 0
    const override = overrideMap.get(sale.id)

    return {
      date: sale.createdAt.toISOString().slice(0, 10),
      saleNumber: sale.saleNumber,
      cashierName: sale.cashier?.name || 'Unknown',
      discountPct,
      discountAmount,
      isOverride: !!override,
      managerAuthorizerId: override?.managerAuthorizerId || null,
    }
  })

  return ok({
    from,
    to,
    totalDiscounts,
    avgDiscountPct,
    overrideCount,
    byEmployee,
    discounts,
  })
}

export async function getAuditReport(from: string, to: string) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const { start: startDate, end: endDate, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
  if (isInverted) return fail('From date cannot be after To date')

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      action: {
        in: [
          'SALE_VOID',
          'SALE_DELETE',
          'SALE_RETURN',
          'DISCOUNT_OVERRIDE',
          'PRICE_OVERRIDE',
          'STOCK_ADJUSTMENT',
        ],
      },
    },
    include: {
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const voidCount = auditLogs.filter(
    log => log.action === 'SALE_VOID' || log.action === 'SALE_DELETE'
  ).length

  const discountOverrideCount = auditLogs.filter(
    log => log.action === 'DISCOUNT_OVERRIDE'
  ).length

  const returnCount = auditLogs.filter(
    log => log.action === 'SALE_RETURN'
  ).length

  // Group by user
  const userMap = new Map<
    string,
    {
      name: string
      totalActions: number
      voidCount: number
      returnCount: number
    }
  >()

  for (const log of auditLogs) {
    const userName = log.user?.name || 'Unknown'
    const existing = userMap.get(userName) || {
      name: userName,
      totalActions: 0,
      voidCount: 0,
      returnCount: 0,
    }

    existing.totalActions += 1
    if (log.action === 'SALE_VOID' || log.action === 'SALE_DELETE') {
      existing.voidCount += 1
    }
    if (log.action === 'SALE_RETURN') {
      existing.returnCount += 1
    }
    userMap.set(userName, existing)
  }

  const byUser = Array.from(userMap.values()).sort(
    (a, b) => b.totalActions - a.totalActions
  )

  const logs = auditLogs.map(log => ({
    timestamp: log.createdAt.toISOString().slice(0, 19).replace('T', ' '),
    userName: log.user?.name || 'Unknown',
    action: log.action,
    entityType: log.entity,
    details: JSON.stringify(log.metadata),
  }))

  return ok({
    from,
    to,
    voidCount,
    discountOverrideCount,
    returnCount,
    byUser,
    logs,
  })
}
