import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

async function main() {
  const products = [
    'cmsr6dquf001iiku4fx1364r3', // Non-Serialized Part 1786604821285
    'cmsr6b66o001iusu4qwjzs15v', // Non-Serialized Part 1786604701199
    'cmsr6c3na001ilcu446rnb505', // Non-Serialized Part 1786604744565
    'cmsr6cvl4001i5ou4gempotze', // Non-Serialized Part 1786604780775
    'cmsr6fseu001iwou4uzrbafp2', // Non-Serialized Part 1786604916629
  ]

  for (const id of products) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        purchaseOrderLines: { include: { po: { select: { id: true, poNumber: true, status: true } } } },
        saleLines: { select: { id: true } },
        serialUnits: { select: { id: true, status: true } },
        stockLayers: { select: { id: true, quantityRemaining: true, quantityReceived: true, purchaseOrderId: true } },
      }
    })
    if (!p) { console.log(`NOT FOUND: ${id}`); continue }
    console.log(`\nProduct: ${p.name}`)
    console.log(`  saleLines: ${p.saleLines.length}`)
    console.log(`  serialUnits: ${p.serialUnits.length}`)
    for (const pol of p.purchaseOrderLines) {
      console.log(`  PO line: ${pol.po.poNumber} (${pol.po.status}) poLineId=${pol.id}`)
    }
    for (const sl of p.stockLayers) {
      console.log(`  StockLayer: id=${sl.id} received=${sl.quantityReceived} remaining=${sl.quantityRemaining} po=${sl.purchaseOrderId}`)
    }
  }
}

main().finally(() => prisma.$disconnect())
