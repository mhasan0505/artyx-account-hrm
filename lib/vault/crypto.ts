import crypto from 'crypto'
import type { VaultSecretPayload } from './types'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const VERSION_PREFIX = 'v1'

/**
 * Returns the 32-byte AES-256 master key derived from VAULT_ENCRYPTION_KEY
 * (or deterministically derived from AUTH_SECRET as a fallback if not yet set).
 */
function getMasterKey(): Buffer {
  const dedicatedKey = process.env.VAULT_ENCRYPTION_KEY?.trim()
  if (dedicatedKey) {
    // If 64 hex chars (32 bytes), decode directly; otherwise hash with SHA-256
    if (/^[0-9a-fA-F]{64}$/.test(dedicatedKey)) {
      return Buffer.from(dedicatedKey, 'hex')
    }
    return crypto.createHash('sha256').update(dedicatedKey).digest()
  }

  const fallback = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!fallback) {
    throw new Error('Missing VAULT_ENCRYPTION_KEY or AUTH_SECRET environment variable.')
  }
  return crypto
    .createHash('sha256')
    .update(`artyx-ceo-vault-v1:${fallback}`)
    .digest()
}

export function hasDedicatedVaultKey(): boolean {
  return Boolean(process.env.VAULT_ENCRYPTION_KEY?.trim())
}

/**
 * Encrypts a VaultSecretPayload JSON object using AES-256-GCM with a unique random IV.
 * Output format: "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 */
export function encryptVaultPayload(payload: VaultSecretPayload): string {
  const key = getMasterKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const plaintext = JSON.stringify(payload || {})
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    VERSION_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/**
 * Decrypts an AES-256-GCM encrypted VaultSecretPayload string.
 */
export function decryptVaultPayload(encoded: string): VaultSecretPayload {
  if (!encoded) return {}

  const parts = encoded.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error('Unsupported or corrupted vault ciphertext format.')
  }

  const [, ivB64, tagB64, dataB64] = parts
  const key = getMasterKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted) as VaultSecretPayload
}

/**
 * Encrypts a portable JSON backup with a user-supplied passphrase using scrypt + AES-256-GCM.
 */
export function encryptBackupWithPassphrase(data: unknown, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 })

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return JSON.stringify(
    {
      format: 'artyx-ceo-vault-backup',
      version: 1,
      kdf: 'scrypt',
      cipher: ALGORITHM,
      exportedAt: new Date().toISOString(),
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      data: encrypted.toString('base64'),
    },
    null,
    2
  )
}

/**
 * Decrypts a portable backup JSON file using the user-supplied passphrase.
 */
export function decryptBackupWithPassphrase<T = unknown>(rawJson: string, passphrase: string): T {
  const parsed = JSON.parse(rawJson)
  if (parsed?.format !== 'artyx-ceo-vault-backup' || parsed?.version !== 1) {
    throw new Error('Invalid backup file format.')
  }

  const salt = Buffer.from(parsed.salt, 'base64')
  const iv = Buffer.from(parsed.iv, 'base64')
  const authTag = Buffer.from(parsed.tag, 'base64')
  const ciphertext = Buffer.from(parsed.data, 'base64')

  const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 })
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted) as T
}

/**
 * Signs a short-lived unlock token stored in an HttpOnly cookie.
 */
export function signUnlockToken(userId: string, ttlSeconds: number): { token: string; expiresAt: number } {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || getMasterKey().toString('hex')
  const expiresAt = Date.now() + ttlSeconds * 1000
  const payload = `${userId}.${expiresAt}`
  const sig = crypto.createHmac('sha256', `vault-cookie:${secret}`).update(payload).digest('base64url')
  return {
    token: `${payload}.${sig}`,
    expiresAt,
  }
}

/**
 * Verifies a signed HttpOnly vault unlock token.
 */
export function verifyUnlockToken(token: string | undefined, expectedUserId: string): { valid: boolean; expiresAt?: number } {
  if (!token) return { valid: false }
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false }

  const [userId, expStr, providedSig] = parts
  if (userId !== expectedUserId) return { valid: false }

  const expiresAt = Number(expStr)
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    return { valid: false }
  }

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || getMasterKey().toString('hex')
  const expectedSig = crypto
    .createHmac('sha256', `vault-cookie:${secret}`)
    .update(`${userId}.${expStr}`)
    .digest('base64url')

  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false }
  }

  return { valid: true, expiresAt }
}
