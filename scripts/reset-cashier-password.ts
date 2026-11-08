import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const pool = new Pool({
  connectionString,
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({
  adapter,
})

async function main() {
  const hashedPassword = await bcrypt.hash('cashier2026', 12)
  const user = await prisma.user.update({
    where: { email: 'admin@artyxdigital.com' },
    data: { password: hashedPassword }
  })
  console.log(`✅ Reset password for: ${user.email}`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
