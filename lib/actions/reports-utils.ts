import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function getNetSalesAndCogs(
  start: Date | null,
  end: Date,
  outletId?: string
) {
  // Execute all 4 raw SQL aggregation queries concurrently
  const [
    salesRows,
    cogsRows,
    returnsRows,
    returnedCogsRows,
    serviceRows,
    serviceCogsRows,
  ] = await Promise.all([
    // 1. Aggregate Gross Sales
    prisma.$queryRaw<{ netSales: number }[]>`
      SELECT COALESCE(SUM(total), 0) as "netSales"
      FROM "Sale"
      WHERE "isQuotation" = false
        AND status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ${outletId ? Prisma.sql`AND "outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND "createdAt" >= ${start}` : Prisma.empty}
        AND "createdAt" <= ${end}
    `,

    // 2. Aggregate Gross COGS
    prisma.$queryRaw<{ totalCogs: number }[]>`
      SELECT COALESCE(SUM(COALESCE(sl."totalCogs", sl.quantity * sl."unitCost", 0)), 0) as "totalCogs"
      FROM "SaleLine" sl
      JOIN "Sale" s ON sl."saleId" = s.id
      WHERE s."isQuotation" = false
        AND s.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ${outletId ? Prisma.sql`AND s."outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND s."createdAt" >= ${start}` : Prisma.empty}
        AND s."createdAt" <= ${end}
    `,

    // 3. Aggregate Total Returns Value
    prisma.$queryRaw<{ totalReturns: number }[]>`
      SELECT COALESCE(SUM(sr.total), 0) as "totalReturns"
      FROM "SaleReturn" sr
      JOIN "Sale" s ON sr."saleId" = s.id
      WHERE s.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ${outletId ? Prisma.sql`AND s."outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND sr."createdAt" >= ${start}` : Prisma.empty}
        AND sr."createdAt" <= ${end}
    `,

    // 4. Aggregate Returned COGS
    prisma.$queryRaw<{ returnedCogs: number }[]>`
      SELECT COALESCE(SUM(srl."returnedCogs"), 0) as "returnedCogs"
      FROM "SaleReturnLine" srl
      JOIN "SaleReturn" sr ON srl."returnId" = sr.id
      JOIN "Sale" s ON sr."saleId" = s.id
      WHERE s.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ${outletId ? Prisma.sql`AND s."outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND sr."createdAt" >= ${start}` : Prisma.empty}
        AND sr."createdAt" <= ${end}
    `,

    // 5. Aggregate Service Invoices (Bug 3 fix: Service & Repair revenue)
    prisma.$queryRaw<{ serviceSales: number }[]>`
      SELECT COALESCE(SUM(si.total), 0) as "serviceSales"
      FROM "ServiceInvoice" si
      JOIN "ServiceJob" sj ON si."jobId" = sj.id
      WHERE 1=1
        ${outletId ? Prisma.sql`AND sj."outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND si."createdAt" >= ${start}` : Prisma.empty}
        AND si."createdAt" <= ${end}
    `,

    // 6. Aggregate Service Parts Cost (Bug 3 fix: Service parts COGS)
    prisma.$queryRaw<{ servicePartsCogs: number }[]>`
      SELECT COALESCE(SUM(sjp.quantity * COALESCE(NULLIF(p."costPrice", 0), sjp."unitCost", 0)), 0) as "servicePartsCogs"
      FROM "ServiceJobPart" sjp
      JOIN "ServiceJob" sj ON sjp."jobId" = sj.id
      JOIN "ServiceInvoice" si ON si."jobId" = sj.id
      LEFT JOIN "Product" p ON sjp."productId" = p.id
      WHERE 1=1
        ${outletId ? Prisma.sql`AND sj."outletId" = ${outletId}` : Prisma.empty}
        ${start ? Prisma.sql`AND si."createdAt" >= ${start}` : Prisma.empty}
        AND si."createdAt" <= ${end}
    `,
  ])

  const netSalesGross = Number(salesRows[0]?.netSales || 0)
  const totalCogsGross = Number(cogsRows[0]?.totalCogs || 0)
  const totalReturns = Number(returnsRows[0]?.totalReturns || 0)
  const returnedCogs = Number(returnedCogsRows[0]?.returnedCogs || 0)
  const serviceSales = Number(serviceRows[0]?.serviceSales || 0)
  const serviceCogs = Number(serviceCogsRows[0]?.servicePartsCogs || 0)

  return {
    netSalesGross: netSalesGross + serviceSales,
    totalCogsGross: totalCogsGross + serviceCogs,
    netSales: netSalesGross + serviceSales - totalReturns,
    totalCogs: totalCogsGross + serviceCogs - returnedCogs,
    totalReturns,
    returnedCogs,
    serviceSales,
    serviceCogs,
  }
}
