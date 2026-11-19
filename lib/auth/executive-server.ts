import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import {
  getExecutiveBadgeLabel,
  hasExecutiveTaskAccess,
} from './executive-roles'

interface CustomRoleRecord {
  id: string
  name?: string
  label?: string
  baseRole?: string
}

async function getCustomRoleSettings(): Promise<{
  userRoleMap: Record<string, string>
  customRoles: CustomRoleRecord[]
}> {
  try {
    const [userRolesSetting, customRolesSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'user_custom_roles_map' } }),
      prisma.setting.findUnique({ where: { key: 'system_custom_roles' } }),
    ])

    const userRoleMap: Record<string, string> = userRolesSetting?.value
      ? JSON.parse(userRolesSetting.value)
      : {}
    const customRoles: CustomRoleRecord[] = customRolesSetting?.value
      ? JSON.parse(customRolesSetting.value)
      : []

    return { userRoleMap, customRoles }
  } catch {
    return { userRoleMap: {}, customRoles: [] }
  }
}

/**
 * Resolves a user's assigned custom role name/label (e.g. "CEO", "Cheif Operating Officer", "Chief Marketing Officer").
 */
export async function resolveUserCustomRole(userId: string): Promise<string | null> {
  const { userRoleMap, customRoles } = await getCustomRoleSettings()
  const assignedId = userRoleMap[userId]
  if (!assignedId) return null

  const found = customRoles.find(
    (r) => r.id === assignedId || r.name === assignedId || r.label === assignedId
  )
  return found?.label || found?.name || assignedId
}

/**
 * Checks if the currently authenticated user is SUPER_ADMIN, CEO, COO, or CMO.
 */
export async function getCurrentExecutiveUser(): Promise<{
  id: string
  name: string
  email: string
  role: string
  customRole: string | null
  badge: 'CEO' | 'COO' | 'CMO' | 'SUPER ADMIN'
} | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })
  if (!dbUser || !dbUser.isActive) return null

  const customRole = await resolveUserCustomRole(dbUser.id)
  const badge = getExecutiveBadgeLabel(dbUser.role, customRole)
  if (!badge) return null

  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    customRole,
    badge,
  }
}

/**
 * Strict server guard for Executive Tasks:
 * Redirects unauthenticated users to /login and non-executive users to /.
 */
export async function requireExecutivePageAccess() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const execUser = await getCurrentExecutiveUser()
  if (!execUser) {
    redirect('/')
  }

  return execUser
}

/**
 * Returns all active executive members (SUPER_ADMIN, CEO, COO, CMO) for task assignment.
 */
export async function getExecutiveMembers() {
  const [users, { userRoleMap, customRoles }] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true, image: true },
      orderBy: { name: 'asc' },
    }),
    getCustomRoleSettings(),
  ])

  return users
    .map((u) => {
      const assignedId = userRoleMap[u.id]
      const found = assignedId
        ? customRoles.find((r) => r.id === assignedId || r.name === assignedId)
        : undefined
      const customRole = found?.label || found?.name || null
      const badge = getExecutiveBadgeLabel(u.role, customRole)
      if (!badge || !hasExecutiveTaskAccess(u.role, customRole)) return null
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        badge,
      }
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)
}
