// Client-side Web Push Utilities

export function isPushNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushNotificationSupported()) return 'unsupported'
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

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!isPushNotificationSupported()) {
    throw new Error('Push notifications are not supported in this browser.')
  }

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
  })

  await navigator.serviceWorker.ready
  return registration
}

export async function subscribeToPush(vapidPublicKey: string): Promise<{
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
}> {
  if (!vapidPublicKey) {
    throw new Error('VAPID public key is missing.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notification permission was denied. Please enable notifications in your browser settings.'
        : 'Notification permission was not granted.'
    )
  }

  const registration = await registerPushServiceWorker()

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const convertedKey = urlBase64ToUint8Array(vapidPublicKey)
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey.buffer as ArrayBuffer,
    })
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Failed to extract push subscription keys.')
  }

  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent,
  }
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

export async function getActivePushSubscriptionEndpoint(): Promise<string | null> {
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
