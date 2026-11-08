import { usePosCartStore } from '@/lib/stores/pos-cart'
import { getOfflineSaleQueue, clearOfflineSaleQueue } from '@/lib/offline/sale-queue'

/**
 * CACHE-007: Cleans up sensitive state on logout / session timeout for shared till security.
 * - Always clears the active POS cart and removes the unscoped pos-cart localStorage item.
 * - Cleans offline sale queue if empty or safely preserves pending offline sales so internet
 *   disruptions across shift changes do not lead to dropped customer transactions.
 */
export async function performLogoutCleanup(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // 1. Reset POS Cart Zustand state
    usePosCartStore.getState().clearCart()

    // 2. Remove persisted cart from localStorage
    localStorage.removeItem('pos-cart')

    // 3. Inspect offline queue - if no pending sales waiting for sync, clean up queue
    const pending = await getOfflineSaleQueue().catch(() => [])
    if (pending.length === 0) {
      await clearOfflineSaleQueue().catch(() => {})
    } else {
      console.warn(
        `[LogoutCleanup] Preserving ${pending.length} unsynced offline sale(s) across cashier shift change.`
      )
    }
  } catch (error) {
    console.error('[LogoutCleanup] Error during logout cleanup:', error)
  }
}
