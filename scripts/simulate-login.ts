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

async function simulateLogin(email: string, passwordAttempt: string) {
  console.log(`[sim] Attempting login for: ${email}`)
  
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
    include: {
      outlet: { select: { id: true, name: true, code: true } },
    },
  })

  if (!user) {
    console.log('[sim] User not found')
    return
  }

  console.log('[sim] User found, isActive:', user.isActive)
  
  const match = await bcrypt.compare(passwordAttempt, user.password)
  console.log('[sim] Password match:', match)

  if (match) {
    const sessionObj = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      outletId: user.outletId,
      outletName: user.outlet.name,
      outletCode: user.outlet.code,
    }
    console.log('[sim] Session object:', JSON.stringify(sessionObj, null, 2))
  }
}

async function main() {
  // Test with the newly reset password
  await simulateLogin('admin@artyxdigital.com', 'cashier2026')
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
