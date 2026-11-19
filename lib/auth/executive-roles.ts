/**
 * Pure client-safe helpers for matching Executive Task access roles:
 * ONLY SUPER_ADMIN, CEO, COO (Chief Operating Officer), and CMO (Chief Marketing Officer).
 */

function normalizeRoleString(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function getExecutiveBadgeLabel(
  role?: string | null,
  customRole?: string | null
): 'CEO' | 'COO' | 'CMO' | 'SUPER ADMIN' | null {
  const custom = normalizeRoleString(customRole)

  if (
    custom === 'CEO' ||
    custom.includes('CHIEF EXECUTIVE') ||
    custom.includes('CHEIF EXECUTIVE')
  ) {
    return 'CEO'
  }
  if (
    custom === 'COO' ||
    custom.includes('CHIEF OPERATING') ||
    custom.includes('CHEIF OPERATING')
  ) {
    return 'COO'
  }
  if (
    custom === 'CMO' ||
    custom.includes('CHIEF MARKETING') ||
    custom.includes('CHEIF MARKETING')
  ) {
    return 'CMO'
  }

  const base = normalizeRoleString(role)
  if (base === 'SUPER ADMIN') {
    return 'SUPER ADMIN'
  }

  return null
}

/**
 * Returns true ONLY for SUPER_ADMIN, CEO, COO, or CMO.
 */
export function hasExecutiveTaskAccess(
  role?: string | null,
  customRole?: string | null
): boolean {
  return getExecutiveBadgeLabel(role, customRole) !== null
}
