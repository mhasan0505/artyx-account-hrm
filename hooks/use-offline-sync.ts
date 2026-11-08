'use client'

import {
  getOfflineSaleQueue,
  incrementRetryCount,
  markOfflineSaleConflict,
  removeOfflineSale,
} from '@/lib/offline/sale-queue'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

export function useOfflineSync() {
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isLocalOfflineHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'

    if ('serviceWorker' in navigator && isLocalOfflineHost) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(error =>
          console.error('Service worker registration failed', error)
        )
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister().catch(() => undefined)
        })
      })

      if ('caches' in window) {
        caches.keys().then(keys => {
          keys
            .filter(key => key.startsWith('pos-tech-drive-'))
            .forEach(key => {
              caches.delete(key).catch(() => undefined)
            })
        })
      }
    }

    const syncQueuedSales = async () => {
      if (isSyncingRef.current) return
      if (!navigator.onLine) return

      const runSync = async () => {
        isSyncingRef.current = true
        try {
          const queue = await getOfflineSaleQueue()
          if (queue.length === 0) return

          let successCount = 0
          let conflictCount = 0

          for (const item of queue) {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            try {
              const response = await fetch('/api/offline/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...item.payload,
                  createdAt: item.createdAt,
                }),
                signal: controller.signal,
              })

              if (!response.ok) {
                // 409: Stock/serial conflict - move to conflicts
                if (response.status === 409) {
                  const body = await response
                    .json()
                    .catch(() => ({ error: 'Stock conflict' }))
                  await markOfflineSaleConflict(
                    item,
                    body.error ?? 'Stock conflict'
                  )
                  conflictCount += 1
                  continue
                }

                // 400: Bad request (validation error) - move to conflicts, don't retry
                if (response.status === 400) {
                  const body = await response
                    .json()
                    .catch(() => ({ error: 'Validation failed' }))
                  await markOfflineSaleConflict(
                    item,
                    body.error ?? 'Validation failed - manual review required'
                  )
                  conflictCount += 1
                  continue
                }

                // 401/403: Auth error - stop processing, will retry on next sync
                if (response.status === 401 || response.status === 403) {
                  console.error(
                    `Auth error syncing sale ${item.tempId}: ${response.status}`
                  )
                  break // Stop processing queue, auth issues need re-login
                }

                // 500+: Server error - increment retry count
                if (response.status >= 500) {
                  console.warn(
                    `Server error ${response.status} for sale ${item.tempId}, incrementing retry`
                  )
                  await incrementRetryCount(
                    item,
                    `Server error ${response.status}`
                  )
                  continue
                }

                // Other 4xx errors - move to conflicts
                const body = await response
                  .json()
                  .catch(() => ({ error: `Error ${response.status}` }))
                await markOfflineSaleConflict(
                  item,
                  body.error ?? `Request failed with status ${response.status}`
                )
                conflictCount += 1
                continue
              }

              await removeOfflineSale(item.tempId)
              successCount += 1
            } catch (networkError) {
              // Network errors (incl. abort timeout) - keep item in queue for next retry
              console.warn(
                `Network error syncing sale ${item.tempId}, will retry`,
                networkError
              )
            } finally {
              clearTimeout(timeout)
            }
          }

          if (successCount > 0) {
            toast.success(`${successCount} offline sale(s) synced`)
          }
          if (conflictCount > 0) {
            toast.warning(
              `${conflictCount} offline sale(s) moved to conflicts due to stock/serial mismatch`
            )
          }
        } finally {
          isSyncingRef.current = false
        }
      }

      // OFF-006: Cross-tab coordination via Web Locks API so only one tab executes the sync loop
      if (typeof navigator !== 'undefined' && 'locks' in navigator && (navigator as any).locks?.request) {
        try {
          await (navigator as any).locks.request(
            'pos-offline-sale-sync',
            { ifAvailable: true },
            async (lock: any) => {
              if (!lock) {
                // Another browser tab is currently syncing
                return
              }
              await runSync()
            }
          )
        } catch {
          await runSync()
        }
      } else {
        await runSync()
      }
    }

    syncQueuedSales()
    window.addEventListener('online', syncQueuedSales)

    // Periodic retry every 30 seconds while online
    const intervalId = setInterval(() => {
      if (navigator.onLine) {
        syncQueuedSales()
      }
    }, 30000)

    return () => {
      window.removeEventListener('online', syncQueuedSales)
      clearInterval(intervalId)
    }
  }, [])
}
