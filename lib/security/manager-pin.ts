import bcrypt from 'bcryptjs'
import { UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isLockedOutByFailedAttempts } from '@/lib/security/brute-force'
import { getDiscountLimitPct, type DiscountSettings } from '@/lib/sales/discount-policy'

export interface ApproverUserRecord {
  id: string
  name: string
  role: UserRole
  isActive: boolean
  pin: string | null
}

export interface ApproverInfo {
  id: string
  name: string
  role: UserRole
}

export type VerifyApprovalResult =
  | { ok: true; approver: ApproverInfo }
  | { ok: false; error: string }

export interface VerifyManagerApprovalParams {
  approverUserId: string
  pin: string
  actorUserId: string
  failureAction: string
  requiredLimitPct?: number
  tx?: any
  settings?: DiscountSettings | Map<string, string>
  meta?: Record<string, any>
  deps?: {
    findUser?: (id: string, tx?: any) => Promise<ApproverUserRecord | null>
    findRecentFailures?: (
      action: string,
      userId: string,
      since: Date,
      tx?: any
    ) => Promise<Array<{ createdAt: Date }>>
    comparePin?: (pin: string, hash: string) => Promise<boolean>
    logFailure?: (
      action: string,
      userId: string,
      meta: Record<string, any>
    ) => Promise<void>
  }
}

/**
 * Shared server-only validator for Manager PIN approvals.
 * Enforces:
 * 1. Self-approval prevention (actor cannot approve their own action)
 * 2. Active status and manager-tier role (SUPER_ADMIN, ADMIN, MANAGER)
 * 3. Lockout enforcement (>= 5 failures in last 15 minutes)
 * 4. PIN existence and bcrypt verification
 * 5. Approver's discount limit eligibility (when requiredLimitPct is provided)
 * 6. Audit logging of failed attempts (without recording the PIN)
 */
export async function verifyManagerApproval(
  params: VerifyManagerApprovalParams
): Promise<VerifyApprovalResult> {
  const {
    approverUserId,
    pin,
    actorUserId,
    failureAction,
    requiredLimitPct,
    tx,
    settings,
    meta = {},
    deps = {},
  } = params

  // 1. Reject self-approval
  if (approverUserId === actorUserId) {
    return {
      ok: false,
      error: 'You cannot approve your own action. Select a different manager.',
    }
  }

  // 2. Validate PIN input
  if (!pin || !pin.trim()) {
    return { ok: false, error: 'Authorizing manager PIN is required' }
  }

  const findUser =
    deps.findUser ||
    (async (id: string, activeTx?: any) => {
      const client = activeTx || prisma
      return client.user.findUnique({
        where: { id },
        select: { id: true, name: true, role: true, isActive: true, pin: true },
      })
    })

  // 3. Load approver
  const approver = await findUser(approverUserId, tx)
  if (!approver || !approver.isActive) {
    return { ok: false, error: 'Selected manager approver is invalid or inactive' }
  }

  // 4. Role verification
  const managerRoles: UserRole[] = [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
  ]
  if (!managerRoles.includes(approver.role)) {
    return {
      ok: false,
      error: 'Selected approver does not have manager-level permissions',
    }
  }

  // 5. Check if PIN configured
  if (!approver.pin) {
    return {
      ok: false,
      error: `Manager ${approver.name} has not configured an approval PIN. Please set a PIN in Profile.`,
    }
  }

  // 6. Brute-force lockout check (>= 5 failed attempts in last 15 min)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
  const findRecentFailures =
    deps.findRecentFailures ||
    (async (action: string, userId: string, since: Date, activeTx?: any) => {
      const client = activeTx || prisma
      return client.auditLog.findMany({
        where: {
          action,
          entityId: userId,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    })

  const recentFailures = await findRecentFailures(
    failureAction,
    approver.id,
    fifteenMinutesAgo,
    tx
  )

  const lockoutCheck = isLockedOutByFailedAttempts(
    recentFailures,
    15 * 60 * 1000,
    5
  )
  if (lockoutCheck.isLocked) {
    return {
      ok: false,
      error: `Too many failed PIN attempts for ${approver.name}; try again in 15 minutes.`,
    }
  }

  // 7. Verify discount limit if requiredLimitPct specified
  if (requiredLimitPct !== undefined && requiredLimitPct > 0) {
    const approverLimit = getDiscountLimitPct(approver.role, settings)
    if (approverLimit < requiredLimitPct) {
      return {
        ok: false,
        error: `Manager ${approver.name} has a limit of ${approverLimit}%, which is insufficient for a ${requiredLimitPct}% discount.`,
      }
    }
  }

  // 8. Verify PIN with bcrypt
  const comparePin =
    deps.comparePin || ((p: string, h: string) => bcrypt.compare(p, h))
  const isPinValid = await comparePin(pin.trim(), approver.pin)

  if (!isPinValid) {
    const logFailure =
      deps.logFailure ||
      (async (act: string, uId: string, m: Record<string, any>) => {
        try {
          const { logAudit } = await import('@/lib/audit/logger')
          await logAudit(act, 'User', uId, m)
        } catch (err) {
          console.error('[verifyManagerApproval] Failed to log failure audit:', err)
        }
      })

    await logFailure(failureAction, approver.id, {
      approverUserId: approver.id,
      approverName: approver.name,
      attemptedByUserId: actorUserId,
      ...meta,
    })

    return { ok: false, error: 'Invalid manager PIN' }
  }

  return {
    ok: true,
    approver: {
      id: approver.id,
      name: approver.name,
      role: approver.role,
    },
  }
}
