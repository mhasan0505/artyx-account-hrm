import { notifyUsers } from '@/lib/notifications/push-service'
import { UserRole } from '@prisma/client'

export interface CheckSecurityRejectionParams {
  userId: string
  userName?: string
  userEmail?: string
  userRole: string
  actionName: string
}

/**
 * Sends a security signal alert to SUPER_ADMIN when an unauthorized user attempts
 * a high-sensitivity role-gated action (e.g. wipeSupplierHistory, capital injection).
 * Cooldown is kept short (3 minutes) to ensure bursts of unauthorized attempts are detected.
 */
export async function checkAndNotifySecurityRejection(
  params: CheckSecurityRejectionParams
): Promise<{ triggered: boolean; actionName: string }> {
  const { userId, userName, userEmail, userRole, actionName } = params

  try {
    const displayName = userName || userEmail || `User ${userId}`

    const res = await notifyUsers({
      roles: [UserRole.SUPER_ADMIN],
      cooldownKey: `security-rejection-${userId}-${actionName}`,
      cooldownMinutes: 3,
      title: 'Security Alert: Unauthorized Action Attempt',
      body: `"${displayName}" (${userRole}) attempted unauthorized execution of restricted action: "${actionName}".`,
      url: '/settings/audit-logs',
      data: {
        type: 'SECURITY_REJECTION',
        userId,
        userName: displayName,
        userRole,
        actionName,
        timestamp: new Date().toISOString(),
      },
    })

    return {
      triggered: res.sent > 0 || !res.suppressedByCooldown,
      actionName,
    }
  } catch (err) {
    console.error('[SecurityTrigger] Error notifying security rejection:', err)
    return { triggered: false, actionName }
  }
}
