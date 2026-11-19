// Service Worker for Artyx Digital Advanced Executive & Team Push Notifications

self.addEventListener('install', () => {
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
  } catch {
    payload = {
      title: 'Artyx Executive Alert',
      body: event.data.text(),
    }
  }

  const title = payload.title || 'Artyx Executive Alert'
  const notificationId =
    payload.notificationId || payload.data?.notificationId || null
  const targetUrl = payload.url || payload.data?.url || '/'
  const priority = payload.priority || payload.data?.priority || 'NORMAL'
  const category = payload.category || payload.data?.category || 'SYSTEM'
  const tag =
    payload.tag ||
    (notificationId ? `artyx-notif-${notificationId}` : `artyx-${Date.now()}`)

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/artyx-logo.png',
    badge: payload.badge || '/artyx-logo.png',
    tag,
    renotify: true,
    silent: false,
    timestamp: payload.data?.timestamp || Date.now(),
    requireInteraction:
      payload.requireInteraction ??
      (priority === 'URGENT' || priority === 'HIGH'),
    vibrate: priority === 'URGENT' ? [250, 100, 250, 100, 250] : [180, 80, 180],
    actions: [
      { action: 'open', title: category === 'CHAT' ? 'Reply' : 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    data: {
      url: targetUrl,
      notificationId,
      category,
      priority,
      openChat: payload.data?.openChat || false,
      channelId: payload.data?.channelId || null,
      timestamp: Date.now(),
      ...payload.data,
    },
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windowClients) => {
          for (const client of windowClients) {
            try {
              client.postMessage({
                type: 'ARTYX_PUSH_RECEIVED',
                notificationId,
                tag,
                payload,
              })
            } catch {
              // ignore postMessage errors
            }
          }
        }),
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') {
    return
  }

  const data = event.notification.data || {}
  const rawUrl = data.url || '/'
  const isChatOpen = data.openChat === true || rawUrl === '#open-chat'
  const fallbackUrl = isChatOpen ? '/team/chat' : rawUrl
  const resolvedUrl = new URL(fallbackUrl, self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        // Prefer an existing Artyx window on our origin
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            await client.focus()
            if (isChatOpen) {
              client.postMessage({
                type: 'ARTYX_OPEN_CHAT',
                channelId: data.channelId || null,
                notificationId: data.notificationId || null,
              })
              return client
            }

            client.postMessage({
              type: 'ARTYX_NOTIFICATION_CLICK',
              url: rawUrl,
              notificationId: data.notificationId || null,
            })

            if ('navigate' in client && client.url !== resolvedUrl) {
              try {
                await client.navigate(resolvedUrl)
              } catch {
                // Client-side message handler will navigate via Next router
              }
            }
            return client
          }
        }

        // Otherwise open a new window directly to the target page
        if (self.clients.openWindow) {
          return self.clients.openWindow(resolvedUrl)
        }
      })
  )
})
