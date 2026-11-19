'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import type {
  ExecutiveNotificationDTO,
  NotificationCategoryType,
  NotificationPriorityType,
} from '@/lib/notifications/types'

export interface HeaderNotificationItem {
  id: string
  title: string
  description: string
  type: 'INVOICE' | 'EXPENSE' | 'CLIENT' | 'SYSTEM'
  timestamp: string
  timeAgo: string
  url: string
  isRead?: boolean
}

export interface HeaderMessageItem {
  id: string
  recipient: string
  phone?: string
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL'
  snippet: string
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'UNCONFIGURED'
  timestamp: string
  timeAgo: string
  url: string
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function serializeNotification(n: {
  id: string
  recipientId: string
  actorId: string | null
  actorName: string | null
  actorBadge: string | null
  actorImage: string | null
  category: string
  priority: string
  eventKey: string
  title: string
  body: string
  url: string
  metadata: unknown
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}): ExecutiveNotificationDTO {
  return {
    id: n.id,
    recipientId: n.recipientId,
    actorId: n.actorId,
    actorName: n.actorName,
    actorBadge: n.actorBadge,
    actorImage: n.actorImage,
    category: n.category as NotificationCategoryType,
    priority: n.priority as NotificationPriorityType,
    eventKey: n.eventKey,
    title: n.title,
    body: n.body,
    url: n.url,
    metadata: (n.metadata as Record<string, unknown> | null) || null,
    isRead: n.isRead,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    tag: `artyx-notif-${n.id}`,
    requireInteraction: n.priority === 'URGENT' || n.priority === 'HIGH',
  }
}

/**
 * Fetches the authenticated user's persistent executive/team notification inbox
 * plus live unread count.
 */
export async function getUserNotificationsInbox(limit = 40): Promise<{
  unreadCount: number
  notifications: ExecutiveNotificationDTO[]
  serverTime: string
}> {
  try {
    const user = await requireAuth()

    const [rows, unreadCount] = await Promise.all([
      prisma.userNotification.findMany({
        where: { recipientId: user.id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 5), 100),
      }),
      prisma.userNotification.count({
        where: { recipientId: user.id, isRead: false },
      }),
    ])

    const items = rows.map(serializeNotification)

    // Also include active overdue invoices as subtle read-only reminders if user has few alerts
    if (items.length < 15) {
      const overdueInvoices = await prisma.agencyInvoice.findMany({
        where: {
          status: { in: ['OVERDUE', 'SENT', 'PARTIAL', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
          dueAmount: { gt: 0 },
        },
        orderBy: { dueDate: 'asc' },
        take: 4,
        include: {
          client: { select: { companyName: true } },
        },
      })

      for (const inv of overdueInvoices) {
        const amount = Number(inv.dueAmount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
        items.push({
          id: `synthetic-overdue-${inv.id}`,
          recipientId: user.id,
          actorId: null,
          actorName: 'Billing Monitor',
          actorBadge: 'SYSTEM',
          actorImage: null,
          category: 'INVOICE',
          priority: 'HIGH',
          eventKey: 'invoice.overdue_reminder',
          title: `Overdue Invoice: ${inv.invoiceNumber}`,
          body: `৳ ${amount} due from ${inv.client.companyName}`,
          url: `/invoices/${inv.id}`,
          metadata: { invoiceId: inv.id },
          isRead: true,
          readAt: null,
          createdAt: inv.dueDate.toISOString(),
          isSynthetic: true,
        })
      }
    }

    return {
      unreadCount,
      notifications: items,
      serverTime: new Date().toISOString(),
    }
  } catch (err) {
    console.error('[NotificationsInbox] Error fetching inbox:', err)
    return {
      unreadCount: 0,
      notifications: [],
      serverTime: new Date().toISOString(),
    }
  }
}

/**
 * Lightweight polling endpoint used ONLY as a resilient fallback when Socket.io is offline.
 * Returns notifications created strictly after `sinceIso`.
 */
export async function pollNewNotifications(sinceIso: string): Promise<{
  notifications: ExecutiveNotificationDTO[]
  unreadCount: number
  serverTime: string
}> {
  try {
    const user = await requireAuth()
    const sinceDate = new Date(sinceIso)
    if (Number.isNaN(sinceDate.getTime())) {
      return { notifications: [], unreadCount: 0, serverTime: new Date().toISOString() }
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.userNotification.findMany({
        where: {
          recipientId: user.id,
          createdAt: { gt: sinceDate },
        },
        orderBy: { createdAt: 'asc' },
        take: 15,
      }),
      prisma.userNotification.count({
        where: { recipientId: user.id, isRead: false },
      }),
    ])

    return {
      notifications: rows.map(serializeNotification),
      unreadCount,
      serverTime: new Date().toISOString(),
    }
  } catch {
    return {
      notifications: [],
      unreadCount: 0,
      serverTime: new Date().toISOString(),
    }
  }
}

export async function markNotificationAsRead(notificationId: string): Promise<{
  success: boolean
}> {
  try {
    const user = await requireAuth()
    if (!notificationId || notificationId.startsWith('synthetic-')) {
      return { success: true }
    }

    await prisma.userNotification.updateMany({
      where: {
        id: notificationId,
        recipientId: user.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })

    return { success: true }
  } catch (err) {
    console.error('[NotificationsInbox] Error marking read:', err)
    return { success: false }
  }
}

export async function markAllNotificationsAsRead(): Promise<{
  success: boolean
}> {
  try {
    const user = await requireAuth()
    await prisma.userNotification.updateMany({
      where: {
        recipientId: user.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
    return { success: true }
  } catch (err) {
    console.error('[NotificationsInbox] Error marking all read:', err)
    return { success: false }
  }
}

export async function deleteUserNotification(notificationId: string): Promise<{
  success: boolean
}> {
  try {
    const user = await requireAuth()
    if (!notificationId || notificationId.startsWith('synthetic-')) {
      return { success: true }
    }
    await prisma.userNotification.deleteMany({
      where: {
        id: notificationId,
        recipientId: user.id,
      },
    })
    return { success: true }
  } catch (err) {
    console.error('[NotificationsInbox] Error deleting notification:', err)
    return { success: false }
  }
}

/**
 * Legacy compatibility feed helper.
 */
export async function getHeaderNotificationsFeed(): Promise<{
  unreadCount: number
  notifications: HeaderNotificationItem[]
}> {
  try {
    const inbox = await getUserNotificationsInbox(20)
    return {
      unreadCount: inbox.unreadCount,
      notifications: inbox.notifications.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.body,
        type:
          n.category === 'INVOICE' || n.category === 'PAYMENT'
            ? 'INVOICE'
            : n.category === 'EXPENSE'
              ? 'EXPENSE'
              : n.category === 'CLIENT' || n.category === 'PROJECT'
                ? 'CLIENT'
                : 'SYSTEM',
        timestamp: n.createdAt,
        timeAgo: formatRelativeTime(new Date(n.createdAt)),
        url: n.url,
        isRead: n.isRead,
      })),
    }
  } catch (err) {
    console.error('[HeaderFeed] Error fetching notifications feed:', err)
    return { unreadCount: 0, notifications: [] }
  }
}

/**
 * Message dispatch helper (kept for compatibility)
 */
export async function getHeaderMessagesFeed(): Promise<{
  isConfigured: boolean
  unreadCount: number
  messages: HeaderMessageItem[]
}> {
  return { isConfigured: false, unreadCount: 0, messages: [] }
}
