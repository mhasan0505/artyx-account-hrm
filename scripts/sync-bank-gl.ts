import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function syncBankOpeningBalances() {
  const coa = await prisma.chartOfAccount.findMany({
    where: { code: { in: ['1200', '3200', '1100'] } },
  })
  const coaMap = new Map(coa.map((c) => [c.code, c.id]))
  const bankAccId = coaMap.get('1200')
  const obeAccId = coaMap.get('3200')

  if (!bankAccId || !obeAccId) {
    console.error('Missing COA 1200 or 3200')
    return
  }

  const banks = await prisma.bankAccount.findMany({
    include: { transactions: true },
  })

  console.log(`Found ${banks.length} bank accounts. Checking transactions & opening balances...`)

  for (const b of banks) {
    console.log(`\nBank: ${b.bankName} (Current: ৳${b.currentBalance}, Trans Count: ${b.transactions.length})`)
    const transSum = b.transactions.reduce((sum, t) => {
      return sum + (t.type === 'DEPOSIT' ? Number(t.amount) : -Number(t.amount))
    }, 0)

    const diff = Number(b.currentBalance) - transSum
    console.log(`  - Sum of Transactions: ৳${transSum}`)
    console.log(`  - Untracked Initial Balance: ৳${diff}`)

    if (diff > 0) {
      console.log(`  ➕ Injecting Opening Balance DEPOSIT transaction & GL entry for ৳${diff}...`)
      await prisma.$transaction(async (tx) => {
        const trans = await tx.bankTransaction.create({
          data: {
            bankAccountId: b.id,
            type: 'DEPOSIT',
            amount: diff,
            description: `Opening Balance — ${b.bankName} (${b.accountNumber})`,
            referenceType: 'OPENING_BALANCE',
          },
        })

        await tx.accountLedgerEntry.createMany({
          data: [
            {
              accountId: bankAccId,
              type: 'DEBIT',
              amount: diff,
              description: `Opening Balance — ${b.bankName} (${b.accountNumber})`,
              referenceId: trans.id,
              referenceType: 'BankTransaction',
            },
            {
              accountId: obeAccId,
              type: 'CREDIT',
              amount: diff,
              description: `Opening Balance Equity — ${b.bankName} (${b.accountNumber})`,
              referenceId: trans.id,
              referenceType: 'BankTransaction',
            },
          ],
        })
      })
    }
  }

  console.log('\n✅ Bank balances & GL synchronized!')
}

syncBankOpeningBalances().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
