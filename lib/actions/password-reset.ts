'use server'

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { fail, ok, type ActionResult } from '@/lib/actions/result'
import { sendPasswordResetEmail } from '@/lib/email/mailer'

const RESET_TOKEN_TTL_MINUTES = 15
const RATE_LIMIT_SECONDS = 60

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function getAppBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    'http://localhost:3000'
  return configured.replace(/\/+$/, '')
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 2) return `${local[0] ?? '*'}*@${domain}`
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(6, local.length - 2))}@${domain}`
}

/**
 * Checks whether a user is a SUPER_ADMIN (either directly via User.role
 * or via an assigned custom role whose baseRole is SUPER_ADMIN).
 */
async function isUserSuperAdmin(userId: string, role: string): Promise<boolean> {
  if (role.toUpperCase() === 'SUPER_ADMIN') {
    return true
  }

  try {
    const [userRolesSetting, customRolesSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'user_custom_roles_map' } }),
      prisma.setting.findUnique({ where: { key: 'system_custom_roles' } }),
    ])

    if (userRolesSetting?.value && customRolesSetting?.value) {
      const map: Record<string, string> = JSON.parse(userRolesSetting.value)
      const assignedRoleId = map[userId]
      if (assignedRoleId) {
        const roles: Array<{ id: string; baseRole?: string }> = JSON.parse(
          customRolesSetting.value
        )
        const matched = roles.find((r) => r.id === assignedRoleId)
        if (matched?.baseRole?.toUpperCase() === 'SUPER_ADMIN') {
          return true
        }
      }
    }
  } catch {
    // ignore parsing errors
  }

  return false
}

async function logResetAudit(
  userId: string,
  action: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'PASSWORD_RESET',
        entityId: userId,
        metadata: metadata ? (metadata as any) : undefined,
      },
    })
  } catch (err) {
    console.error('[PasswordResetAudit] Failed to log audit:', err)
  }
}

export interface RequestResetResponse {
  emailSent: boolean
  message: string
  devPreview?: {
    resetUrl: string
    otpCode: string
  }
}

/**
 * Initiates an email password reset for any active non-SUPER_ADMIN user.
 * SUPER_ADMIN accounts are strictly blocked from email-based password reset.
 */
export async function requestPasswordReset(
  rawEmail: string
): Promise<ActionResult<RequestResetResponse>> {
  const email = rawEmail?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Please enter a valid email address.')
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    return fail('No active user account found with that email address.')
  }

  // Strictly block SUPER_ADMIN accounts from email password reset
  if (await isUserSuperAdmin(user.id, user.role)) {
    await logResetAudit(user.id, 'PASSWORD_RESET_BLOCKED_SUPER_ADMIN', {
      email: user.email,
      role: user.role,
    })
    return fail(
      'Super Admin accounts cannot reset passwords via email for security reasons.'
    )
  }

  // Rate limit: 1 request per 60 seconds per user
  const recentToken = await prisma.passwordResetToken.findFirst({
    where: {
      userId: user.id,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_SECONDS * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (recentToken) {
    const waitSec = Math.max(
      1,
      Math.ceil(
        (recentToken.createdAt.getTime() + RATE_LIMIT_SECONDS * 1000 - Date.now()) / 1000
      )
    )
    return fail(`Please wait ${waitSec} seconds before requesting another reset email.`)
  }

  // Invalidate any previous unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  const rawToken = crypto.randomBytes(32).toString('hex')
  const otpCode = String(crypto.randomInt(100000, 1000000))
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000)

  const record = await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(rawToken),
      codeHash: sha256(otpCode),
      expiresAt,
    },
  })

  const resetUrl = `${getAppBaseUrl()}/reset-password?token=${rawToken}`

  const mailResult = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl,
    otpCode,
    expiresMinutes: RESET_TOKEN_TTL_MINUTES,
  })

  await logResetAudit(user.id, 'PASSWORD_RESET_REQUESTED', {
    email: user.email,
    role: user.role,
    emailSent: mailResult.sent,
  })

  if (mailResult.sent) {
    return ok({
      emailSent: true,
      message: `A password reset link and 6-digit code have been sent to ${maskEmail(user.email)}.`,
    })
  }

  // In local development when SMTP is not yet configured, log & surface a dev preview
  if (!mailResult.smtpConfigured && process.env.NODE_ENV !== 'production') {
    console.log('\n================================================')
    console.log('[DEV PASSWORD RESET] SMTP not configured')
    console.log(`User:       ${user.email} (${user.role})`)
    console.log(`6-Digit OTP: ${otpCode}`)
    console.log(`Reset URL:  ${resetUrl}`)
    console.log('================================================\n')

    return ok({
      emailSent: false,
      message:
        'SMTP is not configured in .env.local yet. Use the development reset code or link below to test.',
      devPreview: {
        resetUrl,
        otpCode,
      },
    })
  }

  // Clean up token if delivery failed in production
  await prisma.passwordResetToken.delete({ where: { id: record.id } }).catch(() => {})
  return fail(
    mailResult.smtpConfigured
      ? `Failed to send reset email: ${mailResult.reason || 'SMTP error'}`
      : 'Email delivery (SMTP) is not configured. Please contact your Super Admin to configure SMTP.'
  )
}

/**
 * Validates a password reset link token before displaying the new password form.
 */
export async function validateResetToken(
  rawToken: string
): Promise<ActionResult<{ email: string; name: string }>> {
  const token = rawToken?.trim()
  if (!token || token.length < 32) {
    return fail('Invalid password reset link.')
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  })

  if (!record || !record.user || !record.user.isActive) {
    return fail('This password reset link is invalid.')
  }

  if (record.usedAt) {
    return fail('This password reset link has already been used.')
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return fail('This password reset link has expired. Please request a new one.')
  }

  if (await isUserSuperAdmin(record.user.id, record.user.role)) {
    return fail('Super Admin accounts cannot reset passwords via email.')
  }

  return ok({
    email: maskEmail(record.user.email),
    name: record.user.name,
  })
}

/**
 * Completes a password reset using the clickable email link token.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<ActionResult<{ reset: boolean }>> {
  const token = rawToken?.trim()
  if (!token) return fail('Reset token is missing.')

  if (!newPassword || newPassword.length < 6) {
    return fail('New password must be at least 6 characters long.')
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, role: true, isActive: true } },
    },
  })

  if (!record || !record.user || !record.user.isActive) {
    return fail('Invalid password reset link.')
  }

  if (record.usedAt) {
    return fail('This password reset link has already been used.')
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return fail('This password reset link has expired. Please request a new one.')
  }

  // Defense-in-depth: re-verify user is NOT a SUPER_ADMIN
  if (await isUserSuperAdmin(record.user.id, record.user.role)) {
    await logResetAudit(record.user.id, 'PASSWORD_RESET_BLOCKED_SUPER_ADMIN', {
      method: 'email_link',
    })
    return fail('Super Admin accounts cannot reset passwords via email.')
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.user.id },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ])

  await logResetAudit(record.user.id, 'PASSWORD_RESET_COMPLETED', {
    method: 'email_link',
    email: record.user.email,
  })

  return ok({ reset: true })
}

/**
 * Completes a password reset using the user's email + 6-digit verification code.
 */
export async function resetPasswordWithEmailCode(
  rawEmail: string,
  rawCode: string,
  newPassword: string
): Promise<ActionResult<{ reset: boolean }>> {
  const email = rawEmail?.trim().toLowerCase()
  const code = rawCode?.trim().replace(/\s+/g, '')

  if (!email) return fail('Email address is required.')
  if (!/^\d{6}$/.test(code)) {
    return fail('Please enter the 6-digit verification code sent to your email.')
  }
  if (!newPassword || newPassword.length < 6) {
    return fail('New password must be at least 6 characters long.')
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    return fail('Invalid email or verification code.')
  }

  if (await isUserSuperAdmin(user.id, user.role)) {
    await logResetAudit(user.id, 'PASSWORD_RESET_BLOCKED_SUPER_ADMIN', {
      method: 'email_otp',
    })
    return fail('Super Admin accounts cannot reset passwords via email.')
  }

  const latestToken = await prisma.passwordResetToken.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!latestToken) {
    return fail('Verification code has expired or is invalid. Please request a new one.')
  }

  const providedHash = Buffer.from(sha256(code))
  const storedHash = Buffer.from(latestToken.codeHash)
  if (
    providedHash.length !== storedHash.length ||
    !crypto.timingSafeEqual(providedHash, storedHash)
  ) {
    return fail('Incorrect 6-digit verification code.')
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ])

  await logResetAudit(user.id, 'PASSWORD_RESET_COMPLETED', {
    method: 'email_otp',
    email: user.email,
  })

  return ok({ reset: true })
}
