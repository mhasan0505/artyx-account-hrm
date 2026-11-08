import { openDB, deleteDB, IDBPDatabase } from 'idb'

export const DB_NAME = 'pos-offline'
export const DB_VERSION = 2

export const STORES = {
  QUEUE: 'saleQueue',
  CONFLICTS: 'saleConflicts',
  PRODUCTS: 'productCache',
  CUSTOMERS: 'customerCache',
} as const

let dbPromise: Promise<IDBPDatabase> | null = null

export async function getOfflineDb(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is only accessible in browser runtime')
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORES.QUEUE)) {
          db.createObjectStore(STORES.QUEUE, { keyPath: 'tempId' })
        }
        if (!db.objectStoreNames.contains(STORES.CONFLICTS)) {
          db.createObjectStore(STORES.CONFLICTS, { keyPath: 'tempId' })
        }
        if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
          db.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORES.CUSTOMERS)) {
          db.createObjectStore(STORES.CUSTOMERS, { keyPath: 'id' })
        }
      },
      blocked() {
        console.warn('[OfflineDB] Database upgrade blocked by another open tab')
      },
      blocking() {
        console.warn('[OfflineDB] Closing connection to allow database upgrade in another tab')
        dbPromise = null
      },
      terminated() {
        dbPromise = null
      },
    })
  }

  return dbPromise
}

export async function deleteOfflineDb(): Promise<void> {
  if (typeof window === 'undefined') return
  dbPromise = null
  await deleteDB(DB_NAME)
}
