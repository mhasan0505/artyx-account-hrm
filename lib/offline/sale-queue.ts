import { getOfflineDb, deleteOfflineDb, STORES } from './db'

export type OfflineSalePayload = {
  tempId: string
  createdAt: string
  payload: Record<string, unknown>
  retryCount?: number
  lastError?: string
}

export type OfflineSaleConflict = {
  tempId: string
  createdAt: string
  error: string
  payload: Record<string, unknown>
}

const MAX_RETRIES = 5

export async function getOfflineSaleQueue(): Promise<OfflineSalePayload[]> {
  if (typeof window === 'undefined') return []

  const db = await getOfflineDb()
  const all = await db.getAll(STORES.QUEUE)
  return (all as OfflineSalePayload[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}

export async function enqueueOfflineSale(
  payload: Record<string, unknown>
): Promise<OfflineSalePayload> {
  if (typeof window === 'undefined') {
    throw new Error('Offline queue is only available in browser')
  }

  // OFF-003: Manager PIN cannot be queued offline — discretionary discounts requiring override require online manager verification
  if (payload.overridePin || payload.managerOverridePin) {
    throw new Error(
      'Offline checkout cannot be used for sales requiring manager PIN override. Please connect to the internet to authorize manager approval.'
    )
  }

  // Exclude any sensitive keys if accidentally present
  const sanitizedPayload = { ...payload }
  delete sanitizedPayload.overridePin
  delete sanitizedPayload.managerOverridePin

  try {
    const db = await getOfflineDb()
    const item: OfflineSalePayload = {
      tempId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      payload: sanitizedPayload,
    }
    await db.put(STORES.QUEUE, item)
    return item
  } catch (err: any) {
    console.error('[OfflineQueue] Failed to store offline sale:', err)
    throw new Error('Failed to save offline sale to local storage. Storage quota may be full.')
  }
}

export async function removeOfflineSale(tempId: string) {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  await db.delete(STORES.QUEUE, tempId)
}

export async function clearOfflineSaleQueue() {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  await db.clear(STORES.QUEUE)
}

export async function markOfflineSaleConflict(
  item: OfflineSalePayload,
  error: string
) {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  const conflict: OfflineSaleConflict = {
    ...item,
    error,
  }

  try {
    await db.put(STORES.CONFLICTS, conflict)
    await db.delete(STORES.QUEUE, item.tempId)
  } catch (err) {
    console.error('[OfflineQueue] Failed to record offline conflict:', err)
  }
}

export async function incrementRetryCount(
  item: OfflineSalePayload,
  error: string
): Promise<OfflineSalePayload | null> {
  if (typeof window === 'undefined') return null

  const currentRetries = (item.retryCount ?? 0) + 1

  // If max retries exceeded, move to conflicts
  if (currentRetries >= MAX_RETRIES) {
    await markOfflineSaleConflict(
      item,
      `Max retries (${MAX_RETRIES}) exceeded. Last error: ${error}`
    )
    return null
  }

  // Otherwise update the item with new retry count
  const db = await getOfflineDb()
  const updated: OfflineSalePayload = {
    ...item,
    retryCount: currentRetries,
    lastError: error,
  }
  try {
    await db.put(STORES.QUEUE, updated)
    return updated
  } catch (err) {
    console.error('[OfflineQueue] Failed to update retry count:', err)
    return null
  }
}

export async function getOfflineSaleConflicts(): Promise<OfflineSaleConflict[]> {
  if (typeof window === 'undefined') return []
  const db = await getOfflineDb()
  const all = await db.getAll(STORES.CONFLICTS)
  return (all as OfflineSaleConflict[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}

export async function removeOfflineSaleConflict(tempId: string) {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  await db.delete(STORES.CONFLICTS, tempId)
}

export async function clearOfflineSaleConflicts() {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  await db.clear(STORES.CONFLICTS)
}

export async function resetOfflineDb() {
  if (typeof window === 'undefined') return
  await deleteOfflineDb()
}
