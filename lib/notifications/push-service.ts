import { prisma } from '@/lib/db'
import { getWebPush } from './vapid'
import { UserRole } from '@prisma/client'

export interface NotifyUsersParams {
  roles?: UserRole[]
  outletId?: string
  userIds?: string[]
  title: string
  body: string
  url?: string
  data?: Record<string, unknown>
  cooldownKey?: string
  cooldownMinutes?: number
  tag?: string
  icon?: string
  badge?: string
  requireInteraction?: boolean
}

export interface NotifyUsersResult {
  success: boolean
  sent: number
  targetUsers: number
  failedCount: number
  suppressedByCooldown: boolean
  prunedSubscriptions: number
  errors?: string[]
}

/**
 * Central Push Notification Dispatcher
 * Dispatches notifications scoped by Role, Outlet, and User IDs,
 * with automatic rate-limit cooldown and stale subscription auto-pruning.
 */
export async function notifyUsers(params: NotifyUsersParams): Promise<NotifyUsersResult> {
  const {
    roles,
    outletId,
    userIds,
    title,
    body,
    url = '/',
    data = {},
    cooldownKey,
    cooldownMinutes = 60,
    tag,
    icon = '/favicon.ico',
    badge = '/favicon.ico',
    requireInteraction = false,
  } = params

  const targetOutletId = outletId || 'GLOBAL'

  // 1. Check & Apply Rate-Limit Cooldown
  if (cooldownKey) {
    const existingCooldown = await prisma.notificationCooldown.findUnique({
      where: {
        alertKey_outletId: {
          alertKey: cooldownKey,
          outletId: targetOutletId,
        },
      },
    })

    if (existingCooldown) {
      const elapsedMs = Date.now() - new Date(existingCooldown.lastSentAt).getTime()
      const cooldownMs = cooldownMinutes * 60 * 1000

      if (elapsedMs < cooldownMs) {
        return {
          success: true,
          sent: 0,
          targetUsers: 0,
          failedCount: 0,
          suppressedByCooldown: true,
          prunedSubscriptions: 0,
        }
      }
    }

    // Update or insert cooldown timestamp
    await prisma.notificationCooldown.upsert({
      where: {
        alertKey_outletId: {
          alertKey: cooldownKey,
          outletId: targetOutletId,
        },
      },
      update: {
        lastSentAt: new Date(),
        metadata: { title, body, url, ...data },
      },
      create: {
        alertKey: cooldownKey,
        outletId: targetOutletId,
        lastSentAt: new Date(),
        metadata: { title, body, url, ...data },
      },
    })
  }

  // 2. Resolve Target Users (Role + Outlet RBAC Scoping)
  // Building where filter matching the application's RBAC model
  // (SUPER_ADMIN has global outlet access; others are strictly outlet-scoped)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereFilter: any = {
    isActive: true,
  }

  if (userIds && userIds.length > 0) {
    whereFilter.id = { in: userIds }
  }

  if (roles && roles.length > 0) {
    whereFilter.role = { in: roles }
  }

  if (outletId) {
    // If SUPER_ADMIN is allowed in roles (or roles not specified),
    // SUPER_ADMIN receives notifications across all outlets
    const superAdminAllowed = !roles || roles.includes(UserRole.SUPER_ADMIN)

    if (superAdminAllowed) {
      whereFilter.OR = [
        { outletId },
        { role: UserRole.SUPER_ADMIN },
      ]
    } else {
      whereFilter.outletId = outletId
    }
  }

  const targetUsers = await prisma.user.findMany({
    where: whereFilter,
    select: {
      id: true,
      role: true,
      outletId: true,
      pushSubscriptions: {
        select: {
          id: true,
          endpoint: true,
          p256dh: true,
          auth: true,
        },
      },
    },
  })

  // Collect all unique active subscriptions
  const allSubscriptions = targetUsers.flatMap((u) => u.pushSubscriptions)

  if (allSubscriptions.length === 0) {
    return {
      success: true,
      sent: 0,
      targetUsers: targetUsers.length,
      failedCount: 0,
      suppressedByCooldown: false,
      prunedSubscriptions: 0,
    }
  }

  // 3. Prepare Web Push Client and Payload
  let webpushClient
  try {
    webpushClient = getWebPush()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[WebPush] Configuration error:', message)
    return {
      success: false,
      sent: 0,
      targetUsers: targetUsers.length,
      failedCount: allSubscriptions.length,
      suppressedByCooldown: false,
      prunedSubscriptions: 0,
      errors: [message],
    }
  }

  const payloadString = JSON.stringify({
    title,
    body,
    icon,
    badge,
    url,
    tag,
    requireInteraction,
    data: {
      url,
      outletId,
      timestamp: Date.now(),
      ...data,
    },
  })

  let sentCount = 0
  let failedCount = 0
  let prunedCount = 0
  const errors: string[] = []

  // 4. Dispatch Push Notifications Concurrently
  await Promise.all(
    allSubscriptions.map(async (sub) => {
      try {
        await webpushClient.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payloadString
        )
        sentCount++
      } catch (err: unknown) {
        failedCount++
        // Check for HTTP 410 (Gone) or 404 (Not Found) to prune expired subscription
        const status =
          err && typeof err === 'object' && 'statusCode' in err
            ? (err as { statusCode: number }).statusCode
            : null

        if (status === 410 || status === 404) {
          try {
            await prisma.pushSubscription.delete({
              where: { endpoint: sub.endpoint },
            })
            prunedCount++
          } catch (deleteErr) {
            console.error('[WebPush] Failed to auto-prune subscription:', deleteErr)
          }
        } else {
          const errMsg = err instanceof Error ? err.message : String(err)
          errors.push(errMsg)
          console.error(`[WebPush] Failed sending push to endpoint:`, errMsg)
        }
      }
    })
  )

  return {
    success: failedCount === 0 || sentCount > 0,
    sent: sentCount,
    targetUsers: targetUsers.length,
    failedCount,
    suppressedByCooldown: false,
    prunedSubscriptions: prunedCount,
    errors: errors.length > 0 ? errors : undefined,
  }
}
