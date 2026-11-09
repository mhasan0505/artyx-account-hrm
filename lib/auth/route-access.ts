export type UserRoleString =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'TECHNICIAN'
  | 'ACCOUNTANT'
  | 'HR'

export function normalizeRole(role: unknown): UserRoleString | '' {
  if (typeof role !== 'string') return ''
  const trimmed = role.trim().toUpperCase().replace(/\s+/g, '_')
  const validRoles: UserRoleString[] = [
    'SUPER_ADMIN',
    'ADMIN',
    'MANAGER',
    'CASHIER',
    'TECHNICIAN',
    'ACCOUNTANT',
    'HR',
  ]
  return validRoles.includes(trimmed as UserRoleString)
    ? (trimmed as UserRoleString)
    : ''
}

export const ALL_AUTHENTICATED_ROLES: UserRoleString[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'HR',
]

export const OPERATIONAL_ROLES: UserRoleString[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'TECHNICIAN',
  'ACCOUNTANT',
]

/**
 * Explicit allowlist of routes open to any authenticated user.
 * Each entry matches the exact route or its direct dynamic child ([param]) only.
 * Any other nested page must have its own ROUTE_ACCESS rule or its own PUBLIC entry.
 */
export const PUBLIC_TO_AUTHENTICATED: readonly string[] = [
  '/',
  '/profile',
  '/search',
  '/team',
  '/team/chat',
] as const

/**
 * Route access configuration ordered by most-specific prefix first.
 * Longest matching prefix wins.
 * Unknown routes default to any authenticated user.
 */
export const ROUTE_ACCESS: Array<{ prefix: string; roles: UserRoleString[] }> = [
  {
    prefix: '/clients',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/projects',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/invoices',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/equity',
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
  },
  {
    prefix: '/accounts-payable-receivable',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/accounts-receivable',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/accounts-payable',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/expenses',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/finances',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/ledger',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/hr',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'],
  },
  {
    prefix: '/payroll',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'],
  },
  {
    prefix: '/employees',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'],
  },
  {
    prefix: '/employee',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'],
  },
  {
    prefix: '/master-setup/chart-of-accounts',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/master-setup/designations',
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  },
  {
    prefix: '/master-setup/departments',
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  },
  {
    prefix: '/master-setup',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'],
  },
  {
    prefix: '/settings',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    prefix: '/users',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    prefix: '/reports/audit',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/reports',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
  },
  {
    prefix: '/dashboard',
    roles: ALL_AUTHENTICATED_ROLES,
  },
  {
    prefix: '/home',
    roles: ALL_AUTHENTICATED_ROLES,
  },
]

/**
 * Checks whether a role has access to a given pathname.
 * Longest matching prefix in ROUTE_ACCESS wins.
 * If no route matches, defaults to true (accessible to any authenticated user).
 */
export function canAccessRoute(
  role: string | null | undefined,
  pathname: string | null | undefined
): boolean {
  if (!pathname || pathname === '#') return true

  // Strip query parameters and trailing slashes for clean matching
  const cleanPath = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'

  // Pick the rule with the longest matching prefix explicitly (don't rely on array order)
  let bestRule: (typeof ROUTE_ACCESS)[number] | null = null

  for (const item of ROUTE_ACCESS) {
    const isMatch =
      cleanPath === item.prefix ||
      (item.prefix === '/' ? true : cleanPath.startsWith(item.prefix + '/'))

    if (isMatch) {
      if (!bestRule || item.prefix.length > bestRule.prefix.length) {
        bestRule = item
      }
    }
  }

  // Unknown route: open to any authenticated user
  if (!bestRule) return true

  const normalized = normalizeRole(role)
  if (!normalized) return false

  return bestRule.roles.includes(normalized)
}
