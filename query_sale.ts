import 'dotenv/config';
import { prisma } from './lib/db';

async function main() {
  const sale = await prisma.sale.findUnique({
    where: { saleNumber: 'SAL-MQ1AOVOQ' },
    include: { payments: true }
  });
  console.log(JSON.stringify(sale, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
