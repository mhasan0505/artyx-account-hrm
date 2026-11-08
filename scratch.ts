import { prisma } from './lib/db'

async function main() {
  const bankAccounts = await prisma.bankAccount.findMany({ take: 5 })
  console.log('Bank Accounts:', bankAccounts)

  const expenses = await prisma.expense.findMany({ take: 5 })
  console.log('Expenses:', expenses)

  const cashDrawers = await prisma.cashDrawer.findMany({ take: 5 })
  console.log('Cash Drawers:', cashDrawers)
}

main().catch(console.error)
