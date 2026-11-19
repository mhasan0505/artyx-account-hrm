// Client-side Web Push & Native Browser Notification Utilities

export type PushActivationMode = 'web_push' | 'browser_realtime' | 'off'

export interface PushSubscriptionPayload {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
}

export interface EnableNotificationsResult {
  mode: PushActivationMode
  permission: NotificationPermission | 'unsupported'
  subscription: PushSubscriptionPayload | null
  pushServiceUnavailable?: boolean
  pushServiceReason?: string
  isBrave?: boolean
}

export function isPushNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isBrowserNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'Notification' in window
}

export async function detectBraveBrowser(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  try {
    const nav = navigator as Navigator & {
      brave?: { isBrave?: () => Promise<boolean> }
    }
    if (nav.brave && typeof nav.brave.isBrave === 'function') {
      return await nav.brave.isBrave()
    }
  } catch {
    // ignore
  }
  return false
}

export function getNotificationPermission():
  | NotificationPermission
  | 'unsupported' {
  if (!isBrowserNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported in this browser.')
  }

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
  })

  await navigator.serviceWorker.ready
  return registration
}

/**
 * Smart two-tier notification activator:
 * 1. Requests native browser Notification permission FIRST (preserving user gesture).
 * 2. Registers `/sw.js` and attempts cloud Web Push (`pushManager.subscribe`) using VAPID.
 *    - Automatically resets stale subscriptions if the VAPID key changed.
 * 3. If the browser's cloud push service is unavailable (e.g. Brave with Google Push off,
 *    private browsing, or blocked FCM), gracefully activates `browser_realtime` mode so
 *    native OS desktop pop-ups still work reliably across other tabs and while idle via
 *    Service Worker + Socket.io!
 */
export async function enableBrowserNotifications(
  getVapidKey: () => Promise<string | null>
): Promise<EnableNotificationsResult> {
  if (!isBrowserNotificationSupported()) {
    throw new Error('Desktop notifications are not supported in this browser.')
  }

  // 1. Request permission immediately inside user click gesture
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notification permission was denied. Please allow notifications in your browser site settings.'
        : 'Notification permission was not granted.'
    )
  }

  const isBrave = await detectBraveBrowser()

  // 2. Register Service Worker if available
  let registration: ServiceWorkerRegistration | null = null
  if ('serviceWorker' in navigator) {
    try {
      registration = await registerPushServiceWorker()
    } catch {
      registration = null
    }
  }

  // 3. Attempt cloud Web Push subscription (for closed-browser background push)
  if (registration && 'PushManager' in window && registration.pushManager) {
    try {
      const vapidPublicKey = await getVapidKey()
      if (vapidPublicKey) {
        const expectedKey = urlBase64ToUint8Array(vapidPublicKey)
        let subscription = await registration.pushManager.getSubscription()

        // If an existing subscription uses an old VAPID key, rotate it cleanly
        if (subscription?.options?.applicationServerKey) {
          const existingKey = new Uint8Array(
            subscription.options.applicationServerKey
          )
          if (!uint8ArraysEqual(existingKey, expectedKey)) {
            await subscription.unsubscribe().catch(() => {})
            subscription = null
          }
        }

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKey.buffer as ArrayBuffer,
          })
        }

        const json = subscription.toJSON()
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          return {
            mode: 'web_push',
            permission: 'granted',
            subscription: {
              endpoint: json.endpoint,
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
              userAgent: navigator.userAgent,
            },
            isBrave,
          }
        }
      }
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : 'Push service unavailable'
      // Graceful fallback: permission IS granted, so native OS pop-ups work via SW + Socket.io
      return {
        mode: 'browser_realtime',
        permission: 'granted',
        subscription: null,
        pushServiceUnavailable: true,
        pushServiceReason: reason,
        isBrave,
      }
    }
  }

  // Fallback when PushManager isn't available (e.g. non-push browser or HTTP LAN)
  return {
    mode: 'browser_realtime',
    permission: 'granted',
    subscription: null,
    pushServiceUnavailable: true,
    pushServiceReason: 'Cloud PushManager unavailable; using live OS notifications.',
    isBrave,
  }
}

export async function subscribeToPush(
  vapidPublicKey: string
): Promise<PushSubscriptionPayload> {
  const result = await enableBrowserNotifications(async () => vapidPublicKey)
  if (!result.subscription) {
    throw new Error(
      result.pushServiceReason || 'Failed to subscribe to cloud push service.'
    )
  }
  return result.subscription
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushNotificationSupported()) return null

  const registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) return null

  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    return endpoint
  }

  return null
}

export async function getActivePushSubscriptionEndpoint(): Promise<
  string | null
> {
  if (!isPushNotificationSupported()) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return null
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? subscription.endpoint : null
  } catch {
    return null
  }
}

/**
 * Displays a native OS/browser desktop pop-up notification using the registered
 * Service Worker (preferred — supports click actions & background tabs) or
 * falls back to `window.Notification`.
 *
 * Uses the exact same `tag` as server Web Push so Chrome/Edge/Brave/OS automatically
 * deduplicate and never display two pop-ups for the same notification.
 */
export async function showNativeBrowserNotification(params: {
  title: string
  body: string
  url?: string
  tag: string
  notificationId?: string
  category?: string
  priority?: string
  requireInteraction?: boolean
  openChat?: boolean
  channelId?: string | null
  onClick?: () => void
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const data = {
    url: params.url || '/',
    notificationId: params.notificationId || null,
    category: params.category || 'SYSTEM',
    priority: params.priority || 'NORMAL',
    openChat: params.openChat || false,
    channelId: params.channelId || null,
    timestamp: Date.now(),
  }

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      if (registration && typeof registration.showNotification === 'function') {
        const swOptions: NotificationOptions & {
          renotify?: boolean
          vibrate?: number[]
          actions?: Array<{ action: string; title: string }>
        } = {
          body: params.body,
          icon: '/artyx-logo.png',
          badge: '/artyx-logo.png',
          tag: params.tag,
          renotify: true,
          requireInteraction: Boolean(params.requireInteraction),
          vibrate:
            params.priority === 'URGENT'
              ? [250, 100, 250, 100, 250]
              : [180, 80, 180],
          actions: [
            {
              action: 'open',
              title: params.category === 'CHAT' ? 'Reply' : 'Open',
            },
            { action: 'dismiss', title: 'Dismiss' },
          ],
          data,
        }
        await registration.showNotification(params.title, swOptions)
        return true
      }
    }
  } catch {
    // Fallback to Window Notification API below
  }

  try {
    const notif = new Notification(params.title, {
      body: params.body,
      icon: '/artyx-logo.png',
      badge: '/artyx-logo.png',
      tag: params.tag,
      requireInteraction: Boolean(params.requireInteraction),
      data,
    })
    notif.onclick = () => {
      try {
        window.focus()
      } catch {}
      notif.close()
      params.onClick?.()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Updates the browser/PWA app badge count when supported (Chrome/Edge desktop & mobile).
 */
export function updateAppBadgeCount(unreadCount: number) {
  if (typeof navigator === 'undefined') return
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (unreadCount > 0 && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(unreadCount).catch(() => {})
    } else if (unreadCount === 0 && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => {})
    }
  } catch {
    // unsupported
  }
}
