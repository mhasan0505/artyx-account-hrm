import { prisma } from '../lib/db'

/**
 * Read-only script to identify unbalanced journal entry groups and date discrepancies.
 *
 * Section 1: Groups AccountLedgerEntry by (referenceType, referenceId) and reports
 *            groups where Total Debits != Total Credits (outside tolerance).
 * Section 2: Checks Sales whose ledger entries do not all share the same date
 *            in the local Asia/Dhaka timezone.
 */
async function main() {
  console.log('=== UNBALANCED JOURNAL ENTRY & DATE AUDIT ===')
  console.log('Timestamp:', new Date().toISOString())

  // SECTION 1: Unbalanced Journals
  console.log('\n--- Section 1: Unbalanced Journal Groups (Debits != Credits) ---')

  const entries = await prisma.accountLedgerEntry.findMany({
    select: {
      id: true,
      referenceType: true,
      referenceId: true,
      type: true,
      amount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  interface GroupData {
    referenceType: string
    referenceId: string
    debits: number
    credits: number
    dates: Set<string>
  }

  const groups = new Map<string, GroupData>()

  for (const entry of entries) {
    let refType = entry.referenceType || 'UNKNOWN'
    const refId = entry.referenceId || 'NONE'
    // Treat SaleFeeCorrection entries as part of their parent sale's group so corrected sales show as balanced
    if (refType === 'SaleFeeCorrection') {
      refType = 'Sale'
    }
    const key = `${refType}:${refId}`

    if (!groups.has(key)) {
      groups.set(key, {
        referenceType: refType,
        referenceId: refId,
        debits: 0,
        credits: 0,
        dates: new Set(),
      })
    }

    const g = groups.get(key)!
    const amt = Number(entry.amount) || 0
    if (entry.type === 'DEBIT') {
      g.debits += amt
    } else if (entry.type === 'CREDIT') {
      g.credits += amt
    }

    // Convert date to Asia/Dhaka day string (YYYY-MM-DD)
    const dhakaDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(entry.createdAt))
    g.dates.add(dhakaDate)
  }

  const unbalancedList: Array<{
    referenceType: string
    referenceId: string
    saleNumber?: string
    saleDate?: string
    debits: number
    credits: number
    difference: number
    paymentFeeTotal?: number
  }> = []

  const summaryByType = new Map<string, { count: number; totalDiff: number }>()

  // Collect sale IDs to query payments and details
  const saleIdsToLookup: string[] = []
  for (const g of groups.values()) {
    const diff = Math.abs(g.debits - g.credits)
    if (diff > 0.01) {
      if (g.referenceType === 'Sale') {
        saleIdsToLookup.push(g.referenceId)
      }
    }
  }

  const sales =
    saleIdsToLookup.length > 0
      ? await prisma.sale.findMany({
          where: { id: { in: saleIdsToLookup } },
          select: {
            id: true,
            saleNumber: true,
            createdAt: true,
            payments: {
              select: { feeAmount: true },
            },
          },
        })
      : []

  const saleMap = new Map(sales.map(s => [s.id, s]))

  for (const g of groups.values()) {
    const diff = Math.abs(g.debits - g.credits)
    if (diff > 0.01) {
      const saleInfo = saleMap.get(g.referenceId)
      const paymentFeeTotal = saleInfo
        ? saleInfo.payments.reduce((s, p) => s + (Number(p.feeAmount) || 0), 0)
        : undefined

      unbalancedList.push({
        referenceType: g.referenceType,
        referenceId: g.referenceId,
        saleNumber: saleInfo?.saleNumber,
        saleDate: saleInfo ? saleInfo.createdAt.toISOString() : undefined,
        debits: Math.round(g.debits * 100) / 100,
        credits: Math.round(g.credits * 100) / 100,
        difference: Math.round((g.debits - g.credits) * 100) / 100,
        paymentFeeTotal:
          paymentFeeTotal !== undefined ? Math.round(paymentFeeTotal * 100) / 100 : undefined,
      })

      const curr = summaryByType.get(g.referenceType) || { count: 0, totalDiff: 0 }
      curr.count += 1
      curr.totalDiff += diff
      summaryByType.set(g.referenceType, curr)
    }
  }

  if (unbalancedList.length === 0) {
    console.log('✅ All journal entry groups are balanced within ৳0.01 tolerance.')
  } else {
    console.log(`⚠️ Found ${unbalancedList.length} unbalanced journal groups:`)
    console.table(unbalancedList)
  }

  console.log('\n--- Unbalanced Summary by Reference Type ---')
  for (const [refType, data] of summaryByType.entries()) {
    console.log(
      `${refType}: count=${data.count}, totalDifference=৳${data.totalDiff.toFixed(2)}`
    )
  }

  // SECTION 2: Date Discrepancy Audit (Sales with entries across multiple dates)
  console.log('\n--- Section 2: Date Discrepancies in Sales (Asia/Dhaka) ---')

  const multiDateSales: Array<{
    saleId: string
    saleNumber: string
    distinctDates: string[]
  }> = []

  // Check all sales in groups
  const allSaleIdsInGroups = Array.from(groups.values())
    .filter(g => g.referenceType === 'Sale')
    .map(g => g.referenceId)

  const allSales =
    allSaleIdsInGroups.length > 0
      ? await prisma.sale.findMany({
          where: { id: { in: allSaleIdsInGroups } },
          select: { id: true, saleNumber: true },
        })
      : []

  const allSaleMap = new Map(allSales.map(s => [s.id, s.saleNumber]))

  for (const g of groups.values()) {
    if (g.referenceType === 'Sale' && g.dates.size > 1) {
      multiDateSales.push({
        saleId: g.referenceId,
        saleNumber: allSaleMap.get(g.referenceId) || 'UNKNOWN',
        distinctDates: Array.from(g.dates),
      })
    }
  }

  if (multiDateSales.length === 0) {
    console.log('✅ All sale journal entries consistently share the same local date.')
  } else {
    console.log(`⚠️ Found ${multiDateSales.length} sales with ledger entries across multiple dates:`)
    console.table(multiDateSales)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error('Audit failed:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
