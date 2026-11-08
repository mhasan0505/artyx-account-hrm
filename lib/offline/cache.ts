import { getOfflineDb, STORES } from './db'

export async function cacheProductsOffline(
  products: Array<Record<string, unknown>>,
) {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite')
  await tx.store.clear()
  for (const product of products) {
    if (typeof product.id === 'string') {
      await tx.store.put(product)
    }
  }
  await tx.done
}

export async function cacheCustomersOffline(
  customers: Array<Record<string, unknown>>,
) {
  if (typeof window === 'undefined') return
  const db = await getOfflineDb()
  const tx = db.transaction(STORES.CUSTOMERS, 'readwrite')
  await tx.store.clear()
  for (const customer of customers) {
    if (typeof customer.id === 'string') {
      await tx.store.put(customer)
    }
  }
  await tx.done
}

export async function getCachedProductsOffline() {
  if (typeof window === 'undefined') return []
  const db = await getOfflineDb()
  return db.getAll(STORES.PRODUCTS)
}

export async function getCachedCustomersOffline() {
  if (typeof window === 'undefined') return []
  const db = await getOfflineDb()
  return db.getAll(STORES.CUSTOMERS)
}
