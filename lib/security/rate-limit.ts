import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'

let lastCleanupAt = 0
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000
const RETAIN_BUCKETS_MS = 24 * 60 * 60 * 1000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  retryAfterSeconds?: number
}

/**
 * Shared PostgreSQL fixed-window limiter. Hashing avoids persisting raw IPs or
 * user identifiers, and the unique bucket key keeps storage bounded by active
 * identities rather than by individual requests.
 */
export async function checkRateLimit(
  key: string,
  limit: number = 60,
  windowMs: number = 60 * 1000
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStartMs = Math.floor(now / windowMs) * windowMs
  const windowStart = new Date(windowStartMs)
  const bucketKey = createHash('sha256').update(key).digest('hex')

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
    VALUES (${bucketKey}, ${windowStart}, 1, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart"
          THEN "RateLimitBucket"."count" + 1
        ELSE 1
      END,
      "windowStart" = EXCLUDED."windowStart",
      "updatedAt" = NOW()
    RETURNING "count"
  `

  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now
    void prisma.$executeRaw`
      DELETE FROM "RateLimitBucket"
      WHERE "windowStart" < ${new Date(now - RETAIN_BUCKETS_MS)}
    `.catch(error => console.error('[rate-limit] Cleanup failed', error))
  }

  const count = Number(rows[0]?.count ?? 1)
  const allowed = count <= limit
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStartMs + windowMs - now) / 1000)
  )

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    limit,
    ...(allowed ? {} : { retryAfterSeconds }),
  }
}

/** Helper to extract client IP from Next.js / standard Request headers. */
export function getClientIp(req: Request): string {
  const xForwardedFor = req.headers.get('x-forwarded-for')
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim()
  return req.headers.get('x-real-ip') || '127.0.0.1'
}
