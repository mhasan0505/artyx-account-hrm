'use server'

import { requireAuth, validateOutletAccess } from '@/lib/actions/auth-guard'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { formatLocalDate, getLocalDateRangeBoundaries, toLocalISODate } from '@/lib/date-utils'

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  CASH: '#0F61C8',
  CARD: '#F4B400',
  MOBILE: '#16A34A',
  BANK_TRANSFER: '#8B5CF6',
  GIFT_CARD: '#F97316',
  CREDIT: '#64748B',
}

function paymentColor(method: string) {
  return PAYMENT_METHOD_COLORS[method] ?? '#64748B'
}

// Threshold below which a product is considered "low stock"
const LOW_STOCK_THRESHOLD = 10

async function _getDashboardStats(outletId: string) {
  const now = new Date()
  const { start: todayStart, end: todayEnd, fromStr: todayStr } = getLocalDateRangeBoundaries()
  const [yr, mo, da] = todayStr.split('-').map(Number)
  const weekStartDate = new Date(Date.UTC(yr, mo - 1, da - 6, 12, 0, 0))
  const weekStartStr = toLocalISODate(weekStartDate)
  const { start: weekStart } = getLocalDateRangeBoundaries(weekStartStr, todayStr)

  const emptyStats = {
    todayRevenue: 0,
    todayOrders: 0,
    lowStockCount: 0,
    totalProductCount: 0,
    weeklyRevenue: [] as { day: string; revenue: number; orders: number }[],
    topProducts: [] as { name: string; sold: number; revenue: number }[],
    paymentBreakdown: [] as {
      name: string
      value: number
      amount: number
      color: string
    }[],
    recentOrders: [] as {
      id: string
      saleNumber: string
      customer: string
      items: number
      total: number
      status: string
      createdAt: string
    }[],
    inventoryPulse: [
      { label: 'Healthy', value: 0, color: 'bg-emerald-500' },
      { label: 'Running Low', value: 0, color: 'bg-amber-500' },
      { label: 'Out of Stock', value: 0, color: 'bg-rose-500' },
    ],
    lowStockItems: [] as { name: string; qty: number }[],
    featuredProducts: [] as {
      id: string
      name: string
      price: number
      image?: string
      specs: string[]
    }[],
    salesByHour: [] as { hour: string; sales: number }[],
  }

  try {
    return await withDatabaseReadFallback(
      async () => {
        const [
          todayStats,
          hourlySalesRaw,
          weeklyRevenue,
          topProductsRaw,
          paymentMethodRows,
          recentSales,
          stockLedger,
          allProducts,
        ] = await Promise.all([
          prisma.sale.aggregate({
            where: {
              outletId,
              isQuotation: false,
              status: 'COMPLETED',
              createdAt: { gte: todayStart, lte: todayEnd },
            },
            _sum: { total: true },
            _count: { id: true },
          }),
          prisma.$queryRaw<{ bucket: Date | number; count: bigint }[]>`
            SELECT 
              EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'Asia/Dhaka')::int as bucket,
              COUNT(id) as count
            FROM "Sale"
            WHERE "outletId" = ${outletId}
              AND "isQuotation" = false
              AND "createdAt" >= ${todayStart}
              AND "createdAt" <= ${todayEnd}
            GROUP BY EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'Asia/Dhaka')
          `,
          prisma.$queryRaw<{ bucket: Date | string; revenue: number; orders: bigint }[]>`
            SELECT 
              TO_CHAR("createdAt" AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') as bucket,
              COALESCE(SUM(total), 0) as revenue,
              COUNT(id) as orders
            FROM "Sale"
            WHERE "outletId" = ${outletId}
              AND "isQuotation" = false
              AND "status" = 'COMPLETED'
              AND "createdAt" >= ${weekStart}
              AND "createdAt" <= ${todayEnd}
            GROUP BY TO_CHAR("createdAt" AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')
          `,
          prisma.$queryRaw<{ name: string; sold: bigint; revenue: number }[]>`
            SELECT p.name, SUM(sl.quantity) as sold, COALESCE(SUM(sl.total), 0) as revenue
            FROM "SaleLine" sl
            JOIN "Sale" s ON sl."saleId" = s.id
            JOIN "Product" p ON sl."productId" = p.id
            WHERE s."outletId" = ${outletId} AND s."isQuotation" = false AND s.status = 'COMPLETED'
              AND s."createdAt" >= ${todayStart} AND s."createdAt" <= ${todayEnd}
            GROUP BY p.id, p.name ORDER BY sold DESC LIMIT 5
          `,
          prisma.salePayment.findMany({
            where: {
              sale: {
                outletId,
                isQuotation: false,
                status: 'COMPLETED',
                createdAt: { gte: todayStart, lte: todayEnd },
              },
            },
            select: { method: true, amount: true },
          }),
          prisma.sale.findMany({
            where: {
              outletId,
              isQuotation: false,
              createdAt: { gte: todayStart, lte: todayEnd },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              saleNumber: true,
              total: true,
              status: true,
              createdAt: true,
              customer: { select: { name: true } },
              _count: { select: { lines: true } },
            },
          }),
          prisma.stockLedger.groupBy({
            by: ['productId'],
            where: { outletId },
            _sum: { quantity: true },
          }),
          prisma.product.findMany({
            where: { outletId, isActive: true },
            select: {
              id: true,
              name: true,
              sellingPrice: true,
              imageUrl: true,
              processor: { select: { name: true } },
              ram: { select: { name: true } },
              storage: { select: { name: true } },
            },
            take: 200,
          }),
        ])

        const weeklyMap = new Map<string, { revenue: number; orders: number }>()
        for (const row of weeklyRevenue) {
          const isoDate =
            typeof row.bucket === 'string'
              ? row.bucket
              : toLocalISODate(new Date(row.bucket))
          weeklyMap.set(isoDate, {
            revenue: Number(row.revenue),
            orders: Number(row.orders),
          })
        }

        const weeklyStats: { day: string; revenue: number; orders: number }[] = []
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.UTC(yr, mo - 1, da - i, 12, 0, 0))
          const isoDate = toLocalISODate(d)

          const stats = weeklyMap.get(isoDate) || { revenue: 0, orders: 0 }

          weeklyStats.push({
            day: formatLocalDate(d, { weekday: 'short' }),
            revenue: stats.revenue,
            orders: stats.orders,
          })
        }

        const [
          oldestStockRaw,
          warrantiesExpiringRaw,
          recentCompletedSales,
          recentServiceJobs,
          recentStockAdjustments
        ] = await Promise.all([
          prisma.stockLayer.findMany({
            where: { outletId, quantityRemaining: { gt: 0 } },
            orderBy: { receivedAt: 'asc' },
            take: 5,
            select: { id: true, quantityRemaining: true, receivedAt: true, unitCost: true, product: { select: { name: true, productCode: true } } }
          }),
          prisma.serialUnit.findMany({
            where: { outletId, status: 'SOLD', warrantyExpiry: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } },
            orderBy: { warrantyExpiry: 'asc' },
            take: 5,
            select: { serialNumber: true, warrantyExpiry: true, product: { select: { name: true } }, saleLineSerials: { select: { saleLine: { select: { sale: { select: { customer: { select: { name: true } } } } } } }, take: 1, orderBy: { saleLine: { sale: { createdAt: 'desc' } } } } }
          }),
          prisma.sale.findMany({ where: { outletId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, saleNumber: true, total: true, createdAt: true } }),
          prisma.serviceJob.findMany({ where: { outletId }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, jobNumber: true, status: true, updatedAt: true } }),
          prisma.stockLedger.findMany({ where: { outletId, movementType: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, movementType: true, quantity: true, product: { select: { name: true } }, createdAt: true } })
        ])

        const _oldestStock = oldestStockRaw.map(s => ({
          id: s.id,
          productName: s.product.name,
          productCode: s.product.productCode,
          daysInStock: Math.floor((now.getTime() - s.receivedAt.getTime()) / (1000 * 60 * 60 * 24)),
          unitCost: Number(s.unitCost)
        }))

        const _expiringWarranties = warrantiesExpiringRaw.map(w => ({
          serialNumber: w.serialNumber,
          productName: w.product.name,
          customerName: w.saleLineSerials[0]?.saleLine?.sale?.customer?.name || 'Unknown',
          daysRemaining: Math.ceil(((w.warrantyExpiry ?? new Date()).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        }))

        const recentActivityRaw: { id: string; type: 'SALE' | 'SERVICE' | 'STOCK'; description: string; timestamp: Date }[] = [
          ...recentCompletedSales.map(s => ({ id: s.id, type: 'SALE' as const, description: `Sale ${s.saleNumber} completed — ৳${Number(s.total).toLocaleString()}`, timestamp: s.createdAt })),
          ...recentServiceJobs.map(s => ({ id: s.id, type: 'SERVICE' as const, description: `Service job ${s.jobNumber} updated to ${s.status}`, timestamp: s.updatedAt })),
          ...recentStockAdjustments.map(s => ({ id: s.id, type: 'STOCK' as const, description: `Stock ${s.movementType === 'ADJUSTMENT_IN' ? 'added' : 'removed'}: ${Math.abs(s.quantity)}x ${s.product.name}`, timestamp: s.createdAt }))
        ]

        const _recentActivity = recentActivityRaw
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, 10)
          .map(a => ({ ...a, timestamp: a.timestamp.toISOString() }))

        const topProducts = topProductsRaw.map(row => ({
          name: row.name,
          sold: Number(row.sold),
          revenue: Number(row.revenue),
        }))

        const paymentTotals = new Map<string, number>()
        let paymentGrandTotal = 0
        for (const row of paymentMethodRows) {
          paymentTotals.set(
            row.method,
            (paymentTotals.get(row.method) ?? 0) + Number(row.amount)
          )
          paymentGrandTotal += Number(row.amount)
        }

        const paymentBreakdown =
          paymentGrandTotal > 0
            ? Array.from(paymentTotals.entries()).map(([method, amount]) => ({
                name: method.replace('_', ' '),
                value: Math.round((amount / paymentGrandTotal) * 100),
                amount: Math.round(amount),
                color: paymentColor(method),
              }))
            : []

        const stockMap = new Map(
          stockLedger.map(row => [row.productId, row._sum.quantity ?? 0])
        )
        let healthyCount = 0
        let lowCount = 0
        let outCount = 0
        const lowStockItems: { name: string; qty: number }[] = []

        for (const product of allProducts) {
          const qty = stockMap.get(product.id) ?? 0
          if (qty > LOW_STOCK_THRESHOLD) {
            healthyCount++
          } else if (qty > 0) {
            lowCount++
            lowStockItems.push({ name: product.name, qty })
          } else {
            outCount++
          }
        }

        const productTotal = healthyCount + lowCount + outCount
        const inventoryPulse =
          productTotal > 0
            ? [
                {
                  label: 'Healthy',
                  value: Math.round((healthyCount / productTotal) * 100),
                  color: 'bg-emerald-500',
                },
                {
                  label: 'Running Low',
                  value: Math.round((lowCount / productTotal) * 100),
                  color: 'bg-amber-500',
                },
                {
                  label: 'Out of Stock',
                  value: Math.round((outCount / productTotal) * 100),
                  color: 'bg-rose-500',
                },
              ]
            : emptyStats.inventoryPulse

        const recentOrders = recentSales.map(sale => ({
          id: sale.id,
          saleNumber: sale.saleNumber,
          customer: sale.customer?.name ?? 'Walk-in Customer',
          items: sale._count.lines,
          total: Number(sale.total),
          status: sale.status as string,
          createdAt: sale.createdAt.toISOString(),
        }))

        const hourlyMap = new Map<number, number>()
        for (const row of hourlySalesRaw) {
          const hour =
            typeof row.bucket === 'number'
              ? row.bucket
              : new Date(row.bucket).getHours()
          hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + Number(row.count))
        }

        const salesByHour = Array.from({ length: 24 }, (_, hour) => ({
          hour: `${hour.toString().padStart(2, '0')}:00`,
          sales: hourlyMap.get(hour) ?? 0,
        })).filter((_, index) => index >= 8 && index <= 21)

        const featuredProducts = allProducts.slice(0, 4).map(product => {
          const specs: string[] = []
          if (product.processor?.name) specs.push(product.processor.name)
          if (product.ram?.name) specs.push(`${product.ram.name} RAM`)
          if (product.storage?.name) specs.push(product.storage.name)

          return {
            id: product.id,
            name: product.name,
            price: Number(product.sellingPrice),
            image: product.imageUrl ?? undefined,
            specs,
          }
        })

        return {
          todayRevenue: Number(todayStats._sum.total ?? 0),
          todayOrders: todayStats._count.id,
          lowStockCount: lowCount + outCount,
          totalProductCount: productTotal,
          weeklyRevenue: weeklyStats,
          topProducts,
          paymentBreakdown,
          recentOrders,
          inventoryPulse,
          lowStockItems: lowStockItems.slice(0, 10),
          featuredProducts,
          salesByHour,
        }
      },
      emptyStats,
      `_getDashboardStats(${outletId})`
    )
  } catch (error) {
    // Keep dashboard render resilient in production even for non-connectivity DB issues.
    console.error(
      `[dashboard] Failed to build stats for outlet ${outletId}`,
      error
    )
    return emptyStats
  }
}

export async function getDashboardStats(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  return unstable_cache(
    () => _getDashboardStats(outletId),
    [`dashboard-stats-${outletId}`],
    { revalidate: 60, tags: [`dashboard-${outletId}`] }
  )()
}

export type DashboardStats = Awaited<ReturnType<typeof _getDashboardStats>>
