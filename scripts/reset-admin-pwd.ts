import bcrypt from 'bcryptjs'
import { prisma } from '../lib/db'

async function main() {
  const hashedPassword = await bcrypt.hash('super@dmin2026', 12)
  const user = await prisma.user.update({
    where: { email: 'admin@artyxdigital.com' },
    data: { password: hashedPassword }
  })
  console.log('✅ Admin password successfully reset to "super@dmin2026" for user:', user.email)
}

main().catch(console.error).finally(() => process.exit(0))
