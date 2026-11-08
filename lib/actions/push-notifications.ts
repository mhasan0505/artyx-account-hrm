'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import { notifyUsers } from '@/lib/notifications/push-service'
import { z } from 'zod'

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional(),
})

export async function savePushSubscription(input: z.infer<typeof subscribeSchema>) {
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
    const message = err instanceof Error ? err.message : 'Failed to save push subscription'
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
    const message = err instanceof Error ? err.message : 'Failed to remove push subscription'
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
    const message = err instanceof Error ? err.message : 'Failed to get subscription status'
    return { success: false, isSubscribed: false, subscriptionCount: 0, error: message }
  }
}

export async function sendTestPushToCurrentUser() {
  try {
    const user = await requireAuth()

    const result = await notifyUsers({
      userIds: [user.id],
      title: 'POS Push Notification Test',
      body: `Web push notifications are working smoothly for ${user.name}!`,
      url: '/profile',
      data: { test: true, triggeredAt: new Date().toISOString() },
    })

    if (result.sent === 0) {
      if (result.targetUsers === 0) {
        return {
          success: false,
          error: 'No active push subscriptions found for your account. Please enable notifications on this device first.',
        }
      }
      return {
        success: false,
        error: result.errors?.join(', ') || 'Failed to dispatch push notification.',
      }
    }

    return {
      success: true,
      sent: result.sent,
      message: `Test push notification successfully sent to ${result.sent} device(s)!`,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send test push'
    return { success: false, error: message }
  }
}
