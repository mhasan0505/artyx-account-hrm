import { auth } from '@/auth'
import { cache } from 'react'
import { UserRole } from '@prisma/client'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { checkAndNotifySecurityRejection } from '@/lib/notifications/triggers/security'

function normalizeRole(role: unknown): UserRole | null {
  if (typeof role !== 'string') return null
  const normalized = role.trim().toUpperCase().replace(/\s+/g, '_')
  return Object.values(UserRole).includes(normalized as UserRole)
    ? (normalized as UserRole)
    : null
}

import { canAccessRoute, ROUTE_ACCESS } from '@/lib/auth/route-access'

export function canRoleAccessPath(role: UserRole, path: string): boolean {
  return canAccessRoute(role, path)
}

export function getRoleProtectedPrefixes() {
  return ROUTE_ACCESS
}

export const requireAuth = cache(async () => {
  if (
    process.env.SKIP_AUTH_CHECK === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const adminUser = await prisma.user.findFirst()
    const defaultOutlet = await prisma.outlet.findFirst()
    return {
      id: process.env.MOCK_USER_ID || adminUser?.id || 'test-admin-id',
      name: adminUser?.name || 'Test System Admin',
      role: (process.env.MOCK_USER_ROLE as UserRole) || UserRole.SUPER_ADMIN,
      outletId: adminUser?.outletId || defaultOutlet?.id || 'cmsk39nw00000a0u4ibswwzow',
    }
  }

  let session
  try {
    session = await auth()
  } catch (err) {
    // auth() can throw if AUTH_SECRET is misconfigured or the JWT is malformed.
    // Redirect to login instead of crashing the page.
    const isRedirect =
      err instanceof Error && err.message.startsWith('NEXT_REDIRECT')
    const isDynamicServer =
      (err as any)?.digest === 'DYNAMIC_SERVER_USAGE' ||
      (err as any)?.message?.includes('Dynamic server usage')
    if (isRedirect || isDynamicServer) throw err
    console.error('[auth] session read failed', err)
    redirect('/login')
  }
  if (!session?.user) {
    redirect('/login')
  }

  // CACHE-002: Re-derive live user role and isActive status from DB (memoized per-request by React cache)
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, outletId: true, role: true },
  })

  if (!dbUser || !dbUser.isActive) {
    redirect('/login')
  }

  // Authoritative live role from database overrides any stale JWT claim
  if (dbUser.role) {
    session.user.role = dbUser.role
  }

  // Ensure session.user.outletId points to an existing Outlet in the database
  if (session.user.outletId) {
    const outletExists = await prisma.outlet.findUnique({
      where: { id: session.user.outletId },
      select: { id: true },
    })
    if (!outletExists) {
      if (dbUser.outletId) {
        session.user.outletId = dbUser.outletId
      } else {
        const fallbackOutlet = await prisma.outlet.findFirst({
          where: { isActive: true },
          select: { id: true },
        })
        if (fallbackOutlet) {
          session.user.outletId = fallbackOutlet.id
        }
      }
    }
  } else {
    if (dbUser.outletId) {
      session.user.outletId = dbUser.outletId
    } else {
      const fallbackOutlet = await prisma.outlet.findFirst({
        where: { isActive: true },
        select: { id: true },
      })
      if (fallbackOutlet) {
        session.user.outletId = fallbackOutlet.id
      }
    }
  }

  return session.user
})

export async function requireRole(...roles: UserRole[]) {
  const user = await requireAuth()
  const normalizedRole = normalizeRole(user.role)
  if (!normalizedRole || !roles.includes(normalizedRole)) {
    throw new Error('Forbidden')
  }
  return user
}

export async function requireSensitiveRole(
  actionName: string,
  ...roles: UserRole[]
) {
  const user = await requireAuth()
  const normalizedRole = normalizeRole(user.role)
  if (!normalizedRole || !roles.includes(normalizedRole)) {
    // Send security alert signal to SUPER_ADMIN asynchronously
    checkAndNotifySecurityRejection({
      userId: user.id,
      userName: user.name || undefined,
      userRole: user.role,
      actionName,
    }).catch(err => {
      console.error('[SecurityAlert] Failed to send rejection alert:', err)
    })
    throw new Error('Forbidden')
  }
  return user
}

export function validateOutletAccess(
  user: { role: string; outletId?: string | null },
  targetOutletId: string
) {
  const normalizedRole = normalizeRole(user.role)
  if (normalizedRole === UserRole.SUPER_ADMIN) {
    return true // SUPER_ADMIN has global access across all outlets
  }
  if (!user.outletId || user.outletId !== targetOutletId) {
    throw new Error('Forbidden: Outlet access denied')
  }
  return true
}

export async function requireOutletAccess(
  targetOutletId: string,
  ...roles: UserRole[]
) {
  const user = await requireRole(...roles)
  validateOutletAccess(user, targetOutletId)
  return user
}
