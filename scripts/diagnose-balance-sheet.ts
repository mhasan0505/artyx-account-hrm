import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

async function main() {
  const asOfDate = new Date()
  asOfDate.setHours(23, 59, 59, 999)

  // Check what's driving the numbers
  
  // 1. Supplier outstanding balances
  const suppliers = await prisma.supplier.findMany({
    select: { name: true, outstandingBalance: true },
    orderBy: { outstandingBalance: 'desc' }
  })
  console.log('\n=== Supplier Balances ===')
  let apTotal = 0
  for (const s of suppliers) {
    console.log(`  ${s.name}: ${s.outstandingBalance}`)
    apTotal += Number(s.outstandingBalance)
  }
  console.log(`  TOTAL AP: ${apTotal}`)

  // 2. Customer outstanding balances
  const customers = await prisma.customer.findMany({
    select: { name: true, outstandingBalance: true }
  })
  console.log('\n=== Customer Balances ===')
  let arTotal = 0
  for (const c of customers) {
    console.log(`  ${c.name}: ${c.outstandingBalance}`)
    arTotal += Number(c.outstandingBalance)
  }
  console.log(`  TOTAL AR: ${arTotal}`)

  // 3. StockLayer inventory
  const [invSum] = await prisma.$queryRaw<{ totalValue: number }[]>`
    SELECT COALESCE(SUM("quantityRemaining" * "unitCost"), 0) as "totalValue" FROM "StockLayer"
  `
  console.log(`\n=== Inventory Value: ${invSum?.totalValue} ===`)

  const layers = await prisma.stockLayer.findMany({
    select: { id: true, quantityRemaining: true, quantityReceived: true, unitCost: true, purchaseOrderId: true, productId: true },
    include: { product: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } } }
  } as any)
  for (const l of layers as any[]) {
    console.log(`  Layer ${l.id}: product=${l.product?.name} po=${l.purchaseOrder?.poNumber} received=${l.quantityReceived} remaining=${l.quantityRemaining} cost=${l.unitCost} value=${Number(l.quantityRemaining)*Number(l.unitCost)}`)
  }

  // 4. Sales and COGS
  const sales = await prisma.sale.findMany({
    select: { saleNumber: true, total: true, discountAmt: true, customer: { select: { name: true } } }
  })
  console.log('\n=== Sales ===')
  let netSales = 0
  for (const s of sales) {
    const net = Number(s.total) - Number(s.discountAmt)
    console.log(`  ${s.saleNumber}: total=${s.total} discount=${s.discountAmt} net=${net} customer=${(s as any).customer?.name || 'walk-in'}`)
    netSales += net
  }
  console.log(`  NET SALES: ${netSales}`)

  // 5. COGS from AccountLedger
  const [cogsSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN ale.type::text = 'DEBIT' THEN ale.amount ELSE -ale.amount END), 0) as total
    FROM "AccountLedgerEntry" ale JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id WHERE coa.code = '5000'
  `
  console.log(`\n=== COGS (chart 5000): ${cogsSum?.total} ===`)

  // 6. Cash and Bank
  const [cashSum] = await prisma.$queryRaw<{ totalCash: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as "totalCash"
    FROM "DrawerTransaction" dt JOIN "CashDrawer" cd ON dt."drawerId" = cd.id WHERE dt.type::text != 'OPENING'
  `
  const firstDrawers = await prisma.cashDrawer.groupBy({ by: ['outletId'], _min: { openedAt: true } })
  let initCash = 0
  for (const g of firstDrawers) {
    const fd = await prisma.cashDrawer.findFirst({ where: { outletId: g.outletId, openedAt: g._min.openedAt! } })
    if (fd) initCash += Number(fd.openingBalance)
  }
  console.log(`\n=== Cash: txSum=${cashSum?.totalCash} + initialCash=${initCash} = ${Number(cashSum?.totalCash||0)+initCash} ===`)

  const bankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true }, select: { accountName: true, currentBalance: true } })
  let bankTotal = 0
  console.log('\n=== Bank Accounts ===')
  for (const b of bankAccounts) {
    console.log(`  ${b.accountName}: ${b.currentBalance}`)
    bankTotal += Number(b.currentBalance)
  }
  console.log(`  TOTAL: ${bankTotal}`)

  // 7. Capital
  const [capSum] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(amount), 0) as total FROM "CapitalInjection" WHERE status::text = 'APPROVED'
  `
  console.log(`\n=== Capital Injections (approved): ${capSum?.total} ===`)

  // 8. All capital injections status
  const allInj = await prisma.capitalInjection.findMany({ select: { id: true, amount: true, status: true, description: true } })
  for (const inj of allInj) {
    console.log(`  ${inj.description}: ${inj.amount} (${inj.status})`)
  }
}

main().finally(() => prisma.$disconnect())
