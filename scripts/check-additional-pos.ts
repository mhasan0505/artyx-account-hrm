import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

async function main() {
  // The additional PO numbers we discovered
  const poNumbers = ['PO-MSR6DR33', 'PO-MSR6B6FM', 'PO-MSR6C3WX', 'PO-MSR6CVTU', 'PO-MSR6FSNO']
  
  for (const poNumber of poNumbers) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNumber },
      include: {
        supplier: { select: { name: true, outstandingBalance: true } },
        lines: {
          include: {
            product: { select: { name: true } },
            serialUnits: { select: { id: true } },
          }
        },
        purchaseInvoices: {
          select: { id: true, invoiceNumber: true, total: true, amountPaid: true }
        },
        stockLayers: { select: { id: true, quantityRemaining: true, quantityReceived: true, productId: true } },
        stockLedgerEntries: { select: { id: true, movementType: true, quantity: true } },
        _count: { select: { stockLedgerEntries: true } },
      }
    })
    if (!po) { console.log(`NOT FOUND: ${poNumber}`); continue }
    console.log(`\nPO: ${po.poNumber} (${po.status})  id=${po.id}`)
    console.log(`  Supplier: ${po.supplier.name}  (supplierBalance=${po.supplier.outstandingBalance})`)
    console.log(`  Total: ${po.total}`)
    console.log(`  Lines: ${po.lines.length}`)
    for (const l of po.lines) {
      console.log(`    Product: ${l.product.name} | qty=${l.quantity} | cost=${l.unitCost}`)
    }
    console.log(`  Invoices: ${po.purchaseInvoices.length}`)
    for (const inv of po.purchaseInvoices) {
      console.log(`    ${inv.invoiceNumber} total=${inv.total} amtPaid=${inv.amountPaid}  id=${inv.id}`)
    }
    console.log(`  StockLayers: ${po.stockLayers.length}`)
    for (const sl of po.stockLayers) {
      console.log(`    Layer ${sl.id}: received=${sl.quantityReceived} remaining=${sl.quantityRemaining}`)
    }
    const ledgerEntries = po.stockLedgerEntries
    const total = ledgerEntries.reduce((s, e) => s + e.quantity, 0)
    console.log(`  StockLedger entries: ${ledgerEntries.length}  netQty=${total}`)
  }
}

main().finally(() => prisma.$disconnect())
