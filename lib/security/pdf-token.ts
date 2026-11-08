import crypto from 'node:crypto'

function getPdfSigningSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret || !secret.trim()) {
    throw new Error('AUTH_SECRET environment variable is not configured')
  }
  return secret.trim()
}

/**
 * Generate a short-lived HMAC-signed token for a specific invoice (sale or purchase).
 * Payload signed: `${entityType}:${id}:${expiresAt}`
 */
export function generatePdfToken(
  entityType: 'sale' | 'purchase',
  id: string,
  ttlSeconds = 86400
): string {
  const secret = getPdfSigningSecret()
  const expiresAt = Date.now() + ttlSeconds * 1000
  const payload = `${entityType}:${id}:${expiresAt}`
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  return `${expiresAt}.${signature}`
}

/**
 * Verify a token for a given entityType and ID.
 * Returns true only if signature matches and token is unexpired.
 */
export function verifyPdfToken(
  entityType: 'sale' | 'purchase',
  id: string,
  token: string | null | undefined
): boolean {
  if (!token || typeof token !== 'string') return false

  let secret: string
  try {
    secret = getPdfSigningSecret()
  } catch {
    return false
  }

  const parts = token.split('.')
  if (parts.length !== 2) return false

  const [expiresAtStr, signature] = parts
  const expiresAt = parseInt(expiresAtStr, 10)

  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return false
  }

  const payload = `${entityType}:${id}:${expiresAt}`
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  if (signature.length !== expectedSignature.length) {
    return false
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
  } catch {
    return false
  }
}
