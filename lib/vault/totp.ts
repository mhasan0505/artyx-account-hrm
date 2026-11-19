import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Decodes an RFC 4648 Base32 secret string (ignoring spaces, dashes, and padding).
 */
function base32ToBuffer(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (!cleaned) {
    throw new Error('Invalid Base32 TOTP secret.')
  }

  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/**
 * Extracts raw Base32 secret from either a plain secret string or an `otpauth://` URI.
 */
export function normalizeTotpSecret(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed)
      const secret = url.searchParams.get('secret')
      if (secret) return secret.replace(/\s+/g, '').toUpperCase()
    } catch {
      // fall through
    }
  }
  return trimmed.replace(/[\s-]+/g, '').toUpperCase()
}

/**
 * Generates an RFC 6238 6-digit TOTP code (SHA-1, 30s period).
 */
export function generateTotpCode(
  rawSecret: string,
  period = 30,
  digits = 6
): { code: string; remainingSeconds: number; period: number } | null {
  try {
    const secret = normalizeTotpSecret(rawSecret)
    if (!secret || secret.length < 8) return null

    const key = base32ToBuffer(secret)
    if (key.length === 0) return null

    const epochSeconds = Math.floor(Date.now() / 1000)
    const counter = Math.floor(epochSeconds / period)
    const remainingSeconds = period - (epochSeconds % period)

    const counterBuf = Buffer.alloc(8)
    counterBuf.writeBigUInt64BE(BigInt(counter))

    const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest()
    const offset = hmac[hmac.length - 1] & 0x0f
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)

    const otp = (binary % 10 ** digits).toString().padStart(digits, '0')
    return { code: otp, remainingSeconds, period }
  } catch {
    return null
  }
}
