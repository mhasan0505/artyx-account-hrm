import { getPrismaDatabaseErrorMessage, prisma } from '@/lib/db'
import { isLockedOutByFailedAttempts } from '@/lib/security/brute-force'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
})

export async function authorizeUser(credentials: any) {
  try {
    const parsed = loginSchema.safeParse(credentials)
    if (!parsed.success) return null

    const normalizedEmail = parsed.data.email.trim().toLowerCase()

    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      include: {
        outlet: { select: { id: true, name: true, code: true } },
      },
    })

    if (!user || !user.isActive) return null

    // Brute-force lockout check: >= 5 failed attempts in last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
    const recentFailures = await prisma.auditLog.findMany({
      where: {
        action: 'LOGIN_FAILED',
        entityId: user.id,
        createdAt: { gte: fifteenMinutesAgo },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    const lockout = isLockedOutByFailedAttempts(
      recentFailures,
      15 * 60 * 1000,
      5
    )
    if (lockout.isLocked) {
      console.warn(
        `[auth] User ${user.email} is locked out for ${lockout.remainingLockoutSeconds}s due to too many failed login attempts.`
      )
      return null
    }

    const passwordMatch = await bcrypt.compare(
      parsed.data.password,
      user.password
    )
    if (!passwordMatch) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'LOGIN_FAILED',
            entity: 'User',
            entityId: user.id,
            metadata: {
              email: user.email,
              reason: 'Invalid credentials',
            },
          },
        })
      } catch (auditErr) {
        console.error('[auth] Failed to log failed login attempt:', auditErr)
      }
      return null
    }

    // Keep auth resilient: login should fail safely when DB is flaky.
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    const safeImage =
      user.image && !user.image.startsWith('data:') && user.image.length < 500
        ? user.image
        : null

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: safeImage,
      role: user.role,
      outletId: user.outletId,
      outletName: user.outlet.name,
      outletCode: user.outlet.code,
    }
  } catch (error) {
    const dbMessage = getPrismaDatabaseErrorMessage(error)
    if (dbMessage) {
      console.error('[auth] Database unavailable during authorize', error)
      return null
    }

    throw error
  }
}
