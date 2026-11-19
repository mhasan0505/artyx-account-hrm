'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import { getVapidConfigAsync } from '@/lib/notifications/vapid'
import { dispatchNotification } from '@/lib/notifications/executive-notifier'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategoryType,
  type NotificationPreferenceDTO,
} from '@/lib/notifications/types'
import { z } from 'zod'

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional(),
})

const preferenceSchema = z.object({
  desktopPushEnabled: z.boolean().optional(),
  inAppPopupEnabled: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  notifyWhenActive: z.boolean().optional(),
  mutedCategories: z.array(z.string()).optional(),
  dndEnabled: z.boolean().optional(),
})

export async function getVapidPublicKey(): Promise<{
  success: boolean
  publicKey: string
  error?: string
}> {
  try {
    await requireAuth()
    const cfg = await getVapidConfigAsync()
    if (!cfg.isReady || !cfg.publicKey) {
      return {
        success: false,
        publicKey: '',
        error: cfg.error || 'Failed to resolve VAPID public key',
      }
    }
    return { success: true, publicKey: cfg.publicKey }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to load VAPID key'
    return { success: false, publicKey: '', error: message }
  }
}

export async function savePushSubscription(
  input: z.infer<typeof subscribeSchema>
) {
  try {
    const user = await requireAuth()
    const parsed = subscribeSchema.parse(input)

    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.endpoint },
      update: {
        userId: user.id,
        p256dh: parsed.p256dh,
        auth: parsed.auth,
        userAgent: parsed.userAgent,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        endpoint: parsed.endpoint,
        p256dh: parsed.p256dh,
        auth: parsed.auth,
        userAgent: parsed.userAgent,
      },
    })

    return { success: true }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to save push subscription'
    console.error('[PushSubscription] Error saving subscription:', err)
    return { success: false, error: message }
  }
}

export async function deletePushSubscription(endpoint: string) {
  try {
    const user = await requireAuth()
    if (!endpoint) return { success: false, error: 'Endpoint required' }

    await prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        userId: user.id,
      },
    })

    return { success: true }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to remove push subscription'
    console.error('[PushSubscription] Error deleting subscription:', err)
    return { success: false, error: message }
  }
}

export async function getPushSubscriptionStatus(endpoint?: string | null) {
  try {
    const user = await requireAuth()

    const userSubscriptions = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
      select: { endpoint: true, createdAt: true, userAgent: true },
    })

    const isThisDeviceSubscribed = endpoint
      ? userSubscriptions.some((s) => s.endpoint === endpoint)
      : userSubscriptions.length > 0

    return {
      success: true,
      isSubscribed: isThisDeviceSubscribed,
      subscriptionCount: userSubscriptions.length,
      subscriptions: userSubscriptions,
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to get subscription status'
    return {
      success: false,
      isSubscribed: false,
      subscriptionCount: 0,
      error: message,
    }
  }
}

export async function getUserNotificationPreferences(): Promise<{
  success: boolean
  preferences: NotificationPreferenceDTO
}> {
  try {
    const user = await requireAuth()
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: user.id },
    })

    if (!pref) {
      return {
        success: true,
        preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
      }
    }

    return {
      success: true,
      preferences: {
        desktopPushEnabled: pref.desktopPushEnabled,
        inAppPopupEnabled: pref.inAppPopupEnabled,
        soundEnabled: pref.soundEnabled,
        notifyWhenActive: pref.notifyWhenActive,
        mutedCategories: pref.mutedCategories as NotificationCategoryType[],
        dndEnabled: pref.dndEnabled,
      },
    }
  } catch {
    return {
      success: false,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    }
  }
}

export async function updateUserNotificationPreferences(
  input: z.infer<typeof preferenceSchema>
): Promise<{
  success: boolean
  preferences?: NotificationPreferenceDTO
  error?: string
}> {
  try {
    const user = await requireAuth()
    const parsed = preferenceSchema.parse(input)

    const updated = await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: {
        ...(parsed.desktopPushEnabled !== undefined
          ? { desktopPushEnabled: parsed.desktopPushEnabled }
          : {}),
        ...(parsed.inAppPopupEnabled !== undefined
          ? { inAppPopupEnabled: parsed.inAppPopupEnabled }
          : {}),
        ...(parsed.soundEnabled !== undefined
          ? { soundEnabled: parsed.soundEnabled }
          : {}),
        ...(parsed.notifyWhenActive !== undefined
          ? { notifyWhenActive: parsed.notifyWhenActive }
          : {}),
        ...(parsed.mutedCategories !== undefined
          ? { mutedCategories: parsed.mutedCategories }
          : {}),
        ...(parsed.dndEnabled !== undefined
          ? { dndEnabled: parsed.dndEnabled }
          : {}),
      },
      create: {
        userId: user.id,
        desktopPushEnabled: parsed.desktopPushEnabled ?? true,
        inAppPopupEnabled: parsed.inAppPopupEnabled ?? true,
        soundEnabled: parsed.soundEnabled ?? true,
        notifyWhenActive: parsed.notifyWhenActive ?? true,
        mutedCategories: parsed.mutedCategories ?? [],
        dndEnabled: parsed.dndEnabled ?? false,
      },
    })

    return {
      success: true,
      preferences: {
        desktopPushEnabled: updated.desktopPushEnabled,
        inAppPopupEnabled: updated.inAppPopupEnabled,
        soundEnabled: updated.soundEnabled,
        notifyWhenActive: updated.notifyWhenActive,
        mutedCategories: updated.mutedCategories as NotificationCategoryType[],
        dndEnabled: updated.dndEnabled,
      },
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to update notification preferences'
    return { success: false, error: message }
  }
}

export async function sendTestPushToCurrentUser() {
  try {
    const user = await requireAuth()

    const result = await dispatchNotification({
      actorId: user.id,
      recipientIds: [user.id],
      includeActor: true,
      category: 'EXECUTIVE_TASK',
      priority: 'HIGH',
      eventKey: 'system.test_push',
      title: 'Artyx Executive Alert Test',
      body: `Live pop-up & browser push notifications are active for ${user.name}. You will receive alerts even in other tabs or while idle.`,
      url: '/executive-tasks',
      requireInteraction: false,
      metadata: { test: true, triggeredAt: new Date().toISOString() },
    })

    return {
      success: true,
      sent: result.sentWebPush,
      message:
        result.sentWebPush > 0
          ? `Live pop-up & cloud Web Push dispatched to ${result.sentWebPush} subscribed device(s)!`
          : 'Live pop-up & desktop OS notification dispatched!',
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to send test push'
    return { success: false, error: message }
  }
}
