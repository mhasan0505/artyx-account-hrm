import { prisma } from '../lib/db'

async function main() {
  console.log('Starting AP/AR Ledger Reconciliation...')

  // 1. Heal Accounts Receivable (Customers)
  const customers = await prisma.customer.findMany({
    include: { sales: true },
  })

  let customerFixes = 0
  for (const customer of customers) {
    let trueDue = 0
    for (const sale of customer.sales) {
      if (sale.status !== 'DRAFT') {
        const due = Number(sale.total) - Number(sale.amountPaid)
        if (due > 0) {
          trueDue += due
        }
      }
    }

    const currentBal = Number(customer.outstandingBalance)
    // using small epsilon for floating point issues
    if (Math.abs(currentBal - trueDue) > 0.001) {
      console.log(
        `[Customer] Healing ${customer.name}: ৳${currentBal.toFixed(2)} -> ৳${trueDue.toFixed(2)}`
      )
      await prisma.customer.update({
        where: { id: customer.id },
        data: { outstandingBalance: trueDue },
      })
      customerFixes++
    }
  }
  console.log(`Finished AR healing. ${customerFixes} customers corrected.`)

  // 2. Heal Accounts Payable (Suppliers)
  const suppliers = await prisma.supplier.findMany({
    include: { purchaseInvoices: true },
  })

  let supplierFixes = 0
  for (const supplier of suppliers) {
    let truePayable = 0
    for (const inv of supplier.purchaseInvoices) {
      if (inv.status !== 'VOID') {
        const due = Number(inv.total) - Number(inv.amountPaid)
        if (due > 0) {
          truePayable += due
        }
      }
    }

    const currentBal = Number(supplier.outstandingBalance)
    if (Math.abs(currentBal - truePayable) > 0.001) {
      console.log(
        `[Supplier] Healing ${supplier.name}: ৳${currentBal.toFixed(2)} -> ৳${truePayable.toFixed(2)}`
      )
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { outstandingBalance: truePayable },
      })
      supplierFixes++
    }
  }
  console.log(`Finished AP healing. ${supplierFixes} suppliers corrected.`)

  console.log('Reconciliation complete.')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
