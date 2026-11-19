import crypto from 'crypto'
import {
  NotificationCategory,
  NotificationPriority,
  Prisma,
  UserRole,
} from '@prisma/client'
import { prisma } from '@/lib/db'
import { getExecutiveBadgeLabel } from '@/lib/auth/executive-roles'
import {
  getExecutiveMembers,
  resolveUserCustomRole,
} from '@/lib/auth/executive-server'
import { getWebPushAsync } from './vapid'
import type {
  ExecutiveNotificationDTO,
  NotificationCategoryType,
  NotificationPriorityType,
} from './types'

export interface DispatchNotificationParams {
  actorId?: string | null
  actorName?: string | null
  actorBadge?: string | null
  actorImage?: string | null
  recipientIds?: string[]
  notifyAllExecutives?: boolean
  alsoNotifyRoles?: UserRole[]
  includeActor?: boolean
  category: NotificationCategoryType
  priority?: NotificationPriorityType
  eventKey: string
  title: string
  body: string
  url?: string
  metadata?: Record<string, unknown>
  tag?: string
  requireInteraction?: boolean
  skipWebPush?: boolean
}

export function getInternalSocketSecret(): string {
  const base =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'artyx-socket-bridge-secret'
  return crypto
    .createHash('sha256')
    .update(`artyx-notify:${base}`)
    .digest('hex')
}

async function emitRealtimeEvents(
  deliveries: Array<{ userId: string; event: string; payload: unknown }>
): Promise<void> {
  if (deliveries.length === 0) return

  // 1. Try direct in-process Socket.io instance first (0ms latency)
  try {
    const { getSocketIo } = await import('@/server/socket')
    const io = getSocketIo()
    if (io) {
      for (const item of deliveries) {
        io.to(`user:${item.userId}`).emit(item.event, item.payload)
      }
      return
    }
  } catch {
    // Fallback to HTTP bridge below
  }

  // 2. Fallback: HTTP bridge to local Socket.io server (works across processes/workers)
  const port = process.env.SOCKET_PORT || '3001'
  const bridgeUrl =
    process.env.SOCKET_INTERNAL_URL || `http://127.0.0.1:${port}/internal/notify`

  try {
    await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': getInternalSocketSecret(),
      },
      body: JSON.stringify({ deliveries }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Non-fatal: clients still receive Web Push + fallback polling
  }
}

async function resolveActorInfo(params: DispatchNotificationParams): Promise<{
  id: string | null
  name: string | null
  badge: string | null
  image: string | null
}> {
  if (!params.actorId) {
    return {
      id: null,
      name: params.actorName || null,
      badge: params.actorBadge || null,
      image: params.actorImage || null,
    }
  }

  if (params.actorName && params.actorBadge !== undefined && params.actorImage !== undefined) {
    return {
      id: params.actorId,
      name: params.actorName,
      badge: params.actorBadge,
      image: params.actorImage,
    }
  }

  try {
    const [user, customRole] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.actorId },
        select: { id: true, name: true, role: true, image: true },
      }),
      resolveUserCustomRole(params.actorId),
    ])

    if (!user) {
      return {
        id: params.actorId,
        name: params.actorName || null,
        badge: params.actorBadge || null,
        image: params.actorImage || null,
      }
    }

    const execBadge = getExecutiveBadgeLabel(user.role, customRole)
    return {
      id: user.id,
      name: params.actorName || user.name,
      badge:
        params.actorBadge !== undefined
          ? params.actorBadge
          : execBadge || customRole || user.role,
      image: params.actorImage !== undefined ? params.actorImage : user.image,
    }
  } catch {
    return {
      id: params.actorId,
      name: params.actorName || null,
      badge: params.actorBadge || null,
      image: params.actorImage || null,
    }
  }
}

/**
 * Central Executive & Real-Time Notification Dispatcher.
 *
 * Atomically:
 * 1. Persists a UserNotification record per recipient (for header inbox & history).
 * 2. Emits a real-time Socket.io event to each recipient's `user:{id}` room
 *    (triggers instant in-app floating pop-up card, chime, badge, & browser fallback popup).
 * 3. Sends true Web Push notifications via VAPID + Service Worker (`public/sw.js`)
 *    so recipients get OS desktop pop-ups even in other tabs, while idle, or offline.
 *
 * Designed to NEVER throw and NEVER break the calling business transaction.
 */
export async function dispatchNotification(
  params: DispatchNotificationParams
): Promise<{
  sentNotifications: number
  sentWebPush: number
  recipientIds: string[]
}> {
  try {
    const priority: NotificationPriorityType = params.priority || 'NORMAL'
    const url = params.url || '/'

    const [actor, execMembers, extraRoleUsers] = await Promise.all([
      resolveActorInfo(params),
      params.notifyAllExecutives ? getExecutiveMembers() : Promise.resolve([]),
      params.alsoNotifyRoles && params.alsoNotifyRoles.length > 0
        ? prisma.user.findMany({
            where: {
              isActive: true,
              role: { in: params.alsoNotifyRoles },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])

    const recipientSet = new Set<string>()
    for (const id of params.recipientIds || []) {
      if (id) recipientSet.add(id)
    }
    for (const m of execMembers) {
      recipientSet.add(m.id)
    }
    for (const u of extraRoleUsers) {
      recipientSet.add(u.id)
    }

    // Never notify the actor of their own action unless explicitly requested (e.g. test push)
    if (actor.id && !params.includeActor) {
      recipientSet.delete(actor.id)
    }

    const candidateIds = Array.from(recipientSet)
    if (candidateIds.length === 0) {
      return { sentNotifications: 0, sentWebPush: 0, recipientIds: [] }
    }

    // Fetch active recipients + preferences + push subscriptions in one query
    const recipients = await prisma.user.findMany({
      where: {
        id: { in: candidateIds },
        isActive: true,
      },
      select: {
        id: true,
        notificationPreference: true,
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

    if (recipients.length === 0) {
      return { sentNotifications: 0, sentWebPush: 0, recipientIds: [] }
    }

    // Filter out users who muted this category (URGENT always persists)
    const eligibleRecipients = recipients.filter((r) => {
      if (priority === 'URGENT') return true
      const muted = r.notificationPreference?.mutedCategories || []
      return !muted.includes(params.category)
    })

    if (eligibleRecipients.length === 0) {
      return { sentNotifications: 0, sentWebPush: 0, recipientIds: [] }
    }

    // 1. Persist UserNotification rows per recipient
    const createdRecords = await Promise.all(
      eligibleRecipients.map((r) =>
        prisma.userNotification.create({
          data: {
            recipientId: r.id,
            actorId: actor.id,
            actorName: actor.name,
            actorBadge: actor.badge,
            actorImage: actor.image,
            category: params.category as NotificationCategory,
            priority: priority as NotificationPriority,
            eventKey: params.eventKey,
            title: params.title,
            body: params.body,
            url,
            metadata: (params.metadata || undefined) as
              | Prisma.InputJsonValue
              | undefined,
          },
        })
      )
    )

    const recordByRecipient = new Map(
      createdRecords.map((rec) => [rec.recipientId, rec])
    )

    // 2. Real-time Socket.io emission (instant in-app popup + header sync + browser fallback)
    const socketDeliveries = createdRecords.map((rec) => {
      const dto: ExecutiveNotificationDTO = {
        id: rec.id,
        recipientId: rec.recipientId,
        actorId: rec.actorId,
        actorName: rec.actorName,
        actorBadge: rec.actorBadge,
        actorImage: rec.actorImage,
        category: rec.category as NotificationCategoryType,
        priority: rec.priority as NotificationPriorityType,
        eventKey: rec.eventKey,
        title: rec.title,
        body: rec.body,
        url: rec.url,
        metadata: (rec.metadata as Record<string, unknown> | null) || null,
        isRead: false,
        readAt: null,
        createdAt: rec.createdAt.toISOString(),
        tag: params.tag || `artyx-notif-${rec.id}`,
        requireInteraction:
          params.requireInteraction ??
          (priority === 'URGENT' || priority === 'HIGH'),
      }

      return {
        userId: rec.recipientId,
        event: 'executive_notification',
        payload: dto,
      }
    })

    await emitRealtimeEvents(socketDeliveries)

    // 3. True Web Push (Service Worker OS Pop-up — works across other tabs, idle, or closed browser)
    let sentWebPush = 0
    if (!params.skipWebPush) {
      const pushTargets: Array<{
        sub: { endpoint: string; p256dh: string; auth: string }
        payloadString: string
      }> = []

      for (const r of eligibleRecipients) {
        const pref = r.notificationPreference
        const desktopEnabled = pref ? pref.desktopPushEnabled : true
        const dnd = pref ? pref.dndEnabled : false
        if (!desktopEnabled || (dnd && priority !== 'URGENT')) continue
        if (!r.pushSubscriptions.length) continue

        const rec = recordByRecipient.get(r.id)
        if (!rec) continue

        const tag = params.tag || `artyx-notif-${rec.id}`
        const pushTitle = actor.badge
          ? `[${actor.badge}] ${params.title}`
          : params.title

        const payloadString = JSON.stringify({
          notificationId: rec.id,
          title: pushTitle,
          body: params.body,
          icon: '/artyx-logo.png',
          badge: '/artyx-logo.png',
          url,
          tag,
          category: params.category,
          priority,
          actorName: actor.name,
          actorBadge: actor.badge,
          requireInteraction:
            params.requireInteraction ??
            (priority === 'URGENT' || priority === 'HIGH'),
          data: {
            url,
            notificationId: rec.id,
            category: params.category,
            priority,
            timestamp: Date.now(),
            ...(params.metadata || {}),
          },
        })

        for (const sub of r.pushSubscriptions) {
          pushTargets.push({ sub, payloadString })
        }
      }

      if (pushTargets.length > 0) {
        try {
          const webpushClient = await getWebPushAsync()
          await Promise.all(
            pushTargets.map(async ({ sub, payloadString }) => {
              try {
                await webpushClient.sendNotification(
                  {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth },
                  },
                  payloadString,
                  {
                    TTL: 86400, // 24 hours so offline executives receive it upon reconnect
                    urgency:
                      priority === 'URGENT' || priority === 'HIGH'
                        ? 'high'
                        : 'normal',
                  }
                )
                sentWebPush++
              } catch (err: unknown) {
                const status =
                  err && typeof err === 'object' && 'statusCode' in err
                    ? (err as { statusCode: number }).statusCode
                    : null
                if (status === 410 || status === 404) {
                  await prisma.pushSubscription
                    .delete({ where: { endpoint: sub.endpoint } })
                    .catch(() => {})
                }
              }
            })
          )
        } catch (err) {
          console.warn('[ExecutiveNotifier] Web Push dispatch warning:', err)
        }
      }
    }

    return {
      sentNotifications: createdRecords.length,
      sentWebPush,
      recipientIds: eligibleRecipients.map((r) => r.id),
    }
  } catch (err) {
    console.error('[ExecutiveNotifier] Unexpected dispatch error:', err)
    return { sentNotifications: 0, sentWebPush: 0, recipientIds: [] }
  }
}

/**
 * Convenience wrapper for notifying all executives (SUPER_ADMIN, CEO, COO, CMO)
 * excluding the acting user.
 */
export async function notifyExecutives(
  params: Omit<DispatchNotificationParams, 'notifyAllExecutives'>
) {
  return dispatchNotification({
    ...params,
    notifyAllExecutives: true,
  })
}

/**
 * Dispatches chat notifications to mentioned users & executives when a team chat message is sent.
 */
export async function notifyChatMessage(params: {
  channelId: string
  channelName?: string
  senderId: string
  senderName: string
  senderImage?: string | null
  content: string
  hasAttachment?: boolean
  attachmentName?: string | null
}) {
  try {
    let channelName = params.channelName
    if (!channelName) {
      const ch = await prisma.teamChatChannel.findUnique({
        where: { id: params.channelId },
        select: { name: true },
      })
      channelName = ch?.name || 'general'
    }

    const previewText = params.content?.trim()
      ? params.content.trim().slice(0, 140)
      : params.attachmentName
        ? `Sent attachment: ${params.attachmentName}`
        : 'Sent an attachment'

    // Detect @mentions (e.g. @all, @exec, @executives, @ceo, @coo, @cmo, or @FirstName)
    const lowerContent = params.content.toLowerCase()
    const isMentionAll =
      /@(all|everyone|here|team|exec|executives)\b/i.test(lowerContent)

    const allActiveUsers = await prisma.user.findMany({
      where: { isActive: true, id: { not: params.senderId } },
      select: { id: true, name: true },
    })

    const mentionedIds = new Set<string>()
    if (isMentionAll) {
      for (const u of allActiveUsers) mentionedIds.add(u.id)
    } else if (lowerContent.includes('@')) {
      for (const u of allActiveUsers) {
        const firstName = u.name.trim().split(/\s+/)[0]?.toLowerCase()
        const fullSlug = u.name.trim().toLowerCase().replace(/\s+/g, '')
        if (
          (firstName && firstName.length >= 2 && lowerContent.includes(`@${firstName}`)) ||
          (fullSlug && lowerContent.includes(`@${fullSlug}`))
        ) {
          mentionedIds.add(u.id)
        }
      }
    }

    const execMembers = await getExecutiveMembers()
    const execIds = new Set(
      execMembers.map((e) => e.id).filter((id) => id !== params.senderId)
    )

    // Also detect @ceo / @coo / @cmo role mentions
    for (const e of execMembers) {
      if (e.id === params.senderId) continue
      const badgeLower = e.badge.toLowerCase().replace(/\s+/g, '')
      if (lowerContent.includes(`@${badgeLower}`)) {
        mentionedIds.add(e.id)
      }
    }

    const nonMentionedExecIds = Array.from(execIds).filter(
      (id) => !mentionedIds.has(id)
    )

    // 1. High-priority notification to explicitly mentioned users
    if (mentionedIds.size > 0) {
      await dispatchNotification({
        actorId: params.senderId,
        actorName: params.senderName,
        actorImage: params.senderImage ?? null,
        recipientIds: Array.from(mentionedIds),
        category: 'CHAT',
        priority: 'HIGH',
        eventKey: 'chat.mention',
        title: `${params.senderName} mentioned you in #${channelName}`,
        body: previewText,
        url: '/team/chat',
        tag: `artyx-chat-${params.channelId}`,
        metadata: {
          openChat: true,
          channelId: params.channelId,
          channelName,
        },
      })
    }

    // 2. Standard real-time & push notification to other executives
    if (nonMentionedExecIds.length > 0) {
      await dispatchNotification({
        actorId: params.senderId,
        actorName: params.senderName,
        actorImage: params.senderImage ?? null,
        recipientIds: nonMentionedExecIds,
        category: 'CHAT',
        priority: 'NORMAL',
        eventKey: 'chat.message',
        title: `New message in #${channelName}`,
        body: `${params.senderName}: ${previewText}`,
        url: '/team/chat',
        tag: `artyx-chat-${params.channelId}`,
        metadata: {
          openChat: true,
          channelId: params.channelId,
          channelName,
        },
      })
    }
  } catch (err) {
    console.error('[ExecutiveNotifier] Chat notification error:', err)
  }
}
