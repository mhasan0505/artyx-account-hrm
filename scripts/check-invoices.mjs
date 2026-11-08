import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
try {
  const invoices = await prisma.purchaseInvoice.findMany({
    take: 5,
    select: { id: true, invoiceNumber: true, poId: true, status: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log('PurchaseInvoice records:', JSON.stringify(invoices, null, 2))

  const count = await prisma.purchaseInvoice.count()
  console.log('Total count:', count)
} catch (e) {
  console.error('Error:', e.message)
} finally {
  await prisma.$disconnect()
}
