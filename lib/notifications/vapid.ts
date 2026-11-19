import webpush from 'web-push'
import { prisma } from '@/lib/db'

const VAPID_SETTING_KEY = 'web_push_vapid_keys'

interface StoredVapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

const globalForVapid = globalThis as unknown as {
  __artyxVapidKeys?: StoredVapidKeys
  __artyxVapidConfigured?: boolean
}

function applyVapidDetails(keys: StoredVapidKeys) {
  if (!globalForVapid.__artyxVapidConfigured) {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
    globalForVapid.__artyxVapidConfigured = true
  }
}

/**
 * Synchronous config check (uses env vars or in-memory cached DB keys).
 */
export function getVapidConfig() {
  const envPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject =
    process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@artyxdigital.com'

  if (envPublic && envPrivate) {
    const keys: StoredVapidKeys = {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
    }
    globalForVapid.__artyxVapidKeys = keys
    applyVapidDetails(keys)
    return {
      isReady: true,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: keys.subject,
      error: null,
    }
  }

  if (globalForVapid.__artyxVapidKeys) {
    applyVapidDetails(globalForVapid.__artyxVapidKeys)
    return {
      isReady: true,
      publicKey: globalForVapid.__artyxVapidKeys.publicKey,
      privateKey: globalForVapid.__artyxVapidKeys.privateKey,
      subject: globalForVapid.__artyxVapidKeys.subject,
      error: null,
    }
  }

  return {
    isReady: false,
    publicKey: envPublic || '',
    privateKey: envPrivate || '',
    subject,
    error:
      'VAPID keys are not loaded yet. Call getVapidConfigAsync() to initialize.',
  }
}

/**
 * Async VAPID resolver:
 * 1. Uses env vars if configured
 * 2. Otherwise loads from DB Setting (`web_push_vapid_keys`)
 * 3. Otherwise auto-generates a valid VAPID keypair and stores it in DB
 */
export async function getVapidConfigAsync() {
  const syncConfig = getVapidConfig()
  if (syncConfig.isReady) return syncConfig

  const subject =
    process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@artyxdigital.com'

  try {
    const existing = await prisma.setting.findUnique({
      where: { key: VAPID_SETTING_KEY },
    })

    if (existing?.value) {
      const parsed = JSON.parse(existing.value) as Partial<StoredVapidKeys>
      if (parsed.publicKey && parsed.privateKey) {
        const keys: StoredVapidKeys = {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          subject: parsed.subject || subject,
        }
        globalForVapid.__artyxVapidKeys = keys
        applyVapidDetails(keys)
        return {
          isReady: true,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: keys.subject,
          error: null,
        }
      }
    }

    // Generate & persist fresh VAPID keypair automatically
    const generated = webpush.generateVAPIDKeys()
    const keys: StoredVapidKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject,
    }

    await prisma.setting.upsert({
      where: { key: VAPID_SETTING_KEY },
      update: { value: JSON.stringify(keys) },
      create: { key: VAPID_SETTING_KEY, value: JSON.stringify(keys) },
    })

    globalForVapid.__artyxVapidKeys = keys
    applyVapidDetails(keys)

    return {
      isReady: true,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: keys.subject,
      error: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[VAPID] Failed to resolve/generate VAPID keys:', message)
    return {
      isReady: false,
      publicKey: '',
      privateKey: '',
      subject,
      error: message,
    }
  }
}

export function getWebPush() {
  const config = getVapidConfig()
  if (!config.isReady) {
    throw new Error(config.error || 'VAPID is not properly configured')
  }
  return webpush
}

export async function getWebPushAsync() {
  const config = await getVapidConfigAsync()
  if (!config.isReady) {
    throw new Error(config.error || 'VAPID is not properly configured')
  }
  return webpush
}
