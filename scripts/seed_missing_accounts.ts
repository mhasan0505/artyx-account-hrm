import { prisma } from '../lib/db'

async function main() {
  const rev4000 = await prisma.chartOfAccount.findUnique({ where: { code: '4000' } })
  const exp5200 = await prisma.chartOfAccount.findUnique({ where: { code: '5200' } })

  console.log('Parent accounts found:', { rev4000: rev4000?.id, exp5200: exp5200?.id })

  const acc4110 = await prisma.chartOfAccount.upsert({
    where: { code: '4110' },
    update: {
      name: 'Sales Returns & Allowances',
      type: 'INCOME',
      parentId: rev4000?.id,
    },
    create: {
      code: '4110',
      name: 'Sales Returns & Allowances',
      type: 'INCOME',
      parentId: rev4000?.id,
    },
  })
  console.log('Upserted 4110:', acc4110)

  const acc5310 = await prisma.chartOfAccount.upsert({
    where: { code: '5310' },
    update: {
      name: 'Inventory Scrap & Loss',
      type: 'EXPENSE',
      parentId: exp5200?.id,
    },
    create: {
      code: '5310',
      name: 'Inventory Scrap & Loss',
      type: 'EXPENSE',
      parentId: exp5200?.id,
    },
  })
  console.log('Upserted 5310:', acc5310)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
