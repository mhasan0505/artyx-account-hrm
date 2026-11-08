import { prisma } from '../lib/db'

async function _getDashboardStatsDirect(outletId: string) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - 6)

  const [
    todayStats,
    hourlySalesRaw,
    weeklyRevenue,
    topProductLines,
    paymentMethodRows,
    recentSales,
    stockLedger,
    allProducts,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { outletId, isQuotation: false, status: 'COMPLETED', createdAt: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true },
      _count: { id: true },
    }),
    prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('hour', "createdAt") as bucket, COUNT(id) as count
      FROM "Sale"
      WHERE "outletId" = ${outletId} AND "isQuotation" = false AND "createdAt" >= ${todayStart} AND "createdAt" <= ${todayEnd}
      GROUP BY DATE_TRUNC('hour', "createdAt")
    `,
    prisma.$queryRaw<{ bucket: Date; revenue: number; orders: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt") as bucket, COALESCE(SUM(total), 0) as revenue, COUNT(id) as orders
      FROM "Sale"
      WHERE "outletId" = ${outletId} AND "isQuotation" = false AND "status" = 'COMPLETED' AND "createdAt" >= ${weekStart} AND "createdAt" <= ${todayEnd}
      GROUP BY DATE_TRUNC('day', "createdAt")
    `,
    prisma.saleLine.findMany({
      where: { sale: { outletId, isQuotation: false, status: 'COMPLETED', createdAt: { gte: todayStart, lte: todayEnd } } },
      select: { productId: true, quantity: true, total: true, product: { select: { name: true } } },
    }),
    prisma.salePayment.findMany({
      where: { sale: { outletId, isQuotation: false, status: 'COMPLETED', createdAt: { gte: todayStart, lte: todayEnd } } },
      select: { method: true, amount: true },
    }),
    prisma.sale.findMany({
      where: { outletId, isQuotation: false, createdAt: { gte: todayStart, lte: todayEnd } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, saleNumber: true, total: true, status: true, createdAt: true, customer: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
    prisma.stockLedger.groupBy({
      by: ['productId'],
      where: { outletId },
      _sum: { quantity: true },
    }),
    prisma.product.findMany({
      where: { outletId, isActive: true },
      select: { id: true, name: true, sellingPrice: true, imageUrl: true, processor: { select: { name: true } }, ram: { select: { name: true } }, storage: { select: { name: true } } },
      take: 200,
    }),
  ])

  // The 9 extra queries from current dashboard.ts:
  const [
    oldestStockRaw,
    warrantiesExpiringRaw,
    customersWithSales,
    suppliersWithPOs,
    recentCompletedSales,
    recentServiceJobs,
    recentStockAdjustments
  ] = await Promise.all([
    prisma.stockLayer.findMany({ where: { outletId, quantityRemaining: { gt: 0 } }, orderBy: { receivedAt: 'asc' }, take: 5, select: { id: true, quantityRemaining: true, receivedAt: true, unitCost: true, product: { select: { name: true, productCode: true } } } }),
    prisma.serialUnit.findMany({ where: { outletId, status: 'SOLD', warrantyExpiry: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } }, orderBy: { warrantyExpiry: 'asc' }, take: 5, select: { serialNumber: true, warrantyExpiry: true, product: { select: { name: true } }, saleLineSerials: { select: { saleLine: { select: { sale: { select: { customer: { select: { name: true } } } } } } }, take: 1, orderBy: { saleLine: { sale: { createdAt: 'desc' } } } } } }),
    prisma.sale.findMany({ where: { outletId }, select: { customerId: true }, distinct: ['customerId'] }),
    prisma.purchaseOrder.findMany({ where: { outletId }, select: { supplierId: true }, distinct: ['supplierId'] }),
    prisma.sale.findMany({ where: { outletId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, saleNumber: true, total: true, createdAt: true } }),
    prisma.serviceJob.findMany({ where: { outletId }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, jobNumber: true, status: true, updatedAt: true } }),
    prisma.stockLedger.findMany({ where: { outletId, movementType: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, movementType: true, quantity: true, product: { select: { name: true } }, createdAt: true } })
  ])

  const customerIds = customersWithSales.map(s => s.customerId).filter(Boolean) as string[]
  const supplierIds = suppliersWithPOs.map(s => s.supplierId).filter(Boolean) as string[]

  const [customerAR, supplierAP] = await Promise.all([
    prisma.customer.aggregate({ where: { id: { in: customerIds }, outstandingBalance: { gt: 0 } }, _sum: { outstandingBalance: true } }),
    prisma.supplier.aggregate({ where: { id: { in: supplierIds }, outstandingBalance: { gt: 0 } }, _sum: { outstandingBalance: true } })
  ])

  return { todayRevenue: Number(todayStats._sum.total ?? 0), orders: todayStats._count.id }
}

async function runLoadTest(concurrency: number) {
  console.log(`\n========================================`)
  console.log(`Starting Load Test with Concurrency = ${concurrency}`)
  console.log(`Memory Before: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`)
  console.log(`========================================\n`)

  const outletId = 'cmsk39nw00000a0u4ibswwzow'
  const startTime = Date.now()
  let successes = 0
  let failures = 0
  const errors: any[] = []

  const promises = Array.from({ length: concurrency }).map(async (_, idx) => {
    try {
      await _getDashboardStatsDirect(outletId)
      successes++
    } catch (err: any) {
      failures++
      errors.push({ index: idx, message: err.message, code: err.code })
    }
  })

  await Promise.all(promises)
  const elapsed = Date.now() - startTime

  console.log(`\nResults:`)
  console.log(`- Time Elapsed: ${elapsed}ms`)
  console.log(`- Successes: ${successes}/${concurrency}`)
  console.log(`- Failures: ${failures}/${concurrency}`)
  console.log(`- Memory After: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`)
  if (errors.length > 0) {
    console.log(`- Sample Errors:`, errors.slice(0, 3))
  }
}

async function main() {
  await runLoadTest(20)
  await prisma.$disconnect()
}

main().catch(console.error)
