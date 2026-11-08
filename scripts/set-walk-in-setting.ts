import { prisma } from '../lib/db'

async function main() {
  console.log('Finding walk-in customer record...')
  const walkInCustomer = await prisma.customer.findFirst({
    where: {
      OR: [
        { name: { contains: 'walk', mode: 'insensitive' } },
        { name: { contains: 'waking', mode: 'insensitive' } },
        { name: { contains: 'oyaking', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  if (!walkInCustomer) {
    console.error('No walk-in customer record found in database!')
    process.exit(1)
  }

  console.log(`Found walk-in customer: ID=${walkInCustomer.id}, Name="${walkInCustomer.name}", Phone="${walkInCustomer.phone}"`)

  const setting = await prisma.setting.upsert({
    where: { key: 'walk_in_customer_id' },
    update: { value: walkInCustomer.id },
    create: {
      key: 'walk_in_customer_id',
      value: walkInCustomer.id,
    },
  })

  console.log(`Successfully stored setting: key=${setting.key}, value=${setting.value}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
