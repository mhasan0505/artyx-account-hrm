import { config } from 'dotenv'
config({ path: '.env.local' })
import { prisma } from '../lib/db'

async function main() {
  // Check the stock ledger detail and layer detail for these 5 POs
  const poIds = [
    'cmsr6dr33001jiku4zfb67wcn', // PO-MSR6DR31 (note: poNumber doesn't match! check)
    'cmsr6b6fo001jusu41rvyybbn', // PO-MSR6B6FM
    'cmsr6c3wy001jlcu4kh5k1nmm', // PO-MSR6C3WX
    'cmsr6cvtv001j5ou472x6hres', // PO-MSR6CVTU
    'cmsr6fsnr001jwou4p35igbxo', // PO-MSR6FSNO
  ]

  for (const poId of poIds) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { poNumber: true, status: true, total: true }
    })
    if (!po) { console.log(`NOT FOUND: ${poId}`); continue }
    
    const entries = await prisma.stockLedger.findMany({
      where: { purchaseOrderId: poId },
      select: { id: true, movementType: true, quantity: true, referenceId: true, referenceType: true, notes: true, createdAt: true }
    })

    const layers = await prisma.stockLayer.findMany({
      where: { purchaseOrderId: poId },
      select: { id: true, quantityReceived: true, quantityRemaining: true, unitCost: true }
    })

    console.log(`\n${po.poNumber} (id=${poId}):`)
    console.log(`  StockLedger entries (${entries.length}):`)
    for (const e of entries) {
      console.log(`    ${e.movementType} qty=${e.quantity} ref=${e.referenceType}:${e.referenceId} notes="${e.notes?.substring(0,60)}"`)
    }
    console.log(`  StockLayers (${layers.length}):`)
    for (const l of layers) {
      console.log(`    id=${l.id} received=${l.quantityReceived} remaining=${l.quantityRemaining} cost=${l.unitCost}`)
    }
  }
}

main().finally(() => prisma.$disconnect())
