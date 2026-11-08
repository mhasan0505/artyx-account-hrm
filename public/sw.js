// Service Worker for POS Web Push Notifications

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch (err) {
    payload = {
      title: 'POS Notification',
      body: event.data.text(),
    }
  }

  const title = payload.title || 'POS Alert'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    tag: payload.tag || undefined,
    data: {
      url: payload.url || payload.data?.url || '/',
      timestamp: Date.now(),
      ...payload.data,
    },
    requireInteraction: payload.requireInteraction ?? false,
    vibrate: [200, 100, 200],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open with the target URL, focus it
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }
      // If a window is open on the same origin, navigate and focus
      for (const client of windowClients) {
        if ('focus' in client && 'navigate' in client) {
          return client.navigate(targetUrl).then((c) => c?.focus())
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
