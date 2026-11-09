import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

export const DATABASE_UNAVAILABLE_MESSAGE =
  'Database is currently unavailable. Please try again shortly.'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    if (!process.env.DATABASE_URL_TEST) {
      return new Proxy({} as PrismaClient, {
        get(_target, prop) {
          if (prop === 'then' || prop === Symbol.toStringTag || prop === 'constructor') {
            return undefined
          }
          throw new Error(
            `ABORT: Integration test attempted to access prisma.${String(prop)} without DATABASE_URL_TEST. Integration tests must use DATABASE_URL_TEST containing "test" in host or database name. Never fall back to .env.local's DATABASE_URL.`
          )
        },
      })
    }
  }

  const connectionString =
    (process.env.VITEST || process.env.NODE_ENV === 'test')
      ? process.env.DATABASE_URL_TEST!
      : (process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/postgres')

  // Determine SSL configuration based on the connection string.
  // - Neon / hosted Postgres: requires SSL, skip cert verification.
  // - Local / VPS Postgres without sslmode in URL: disable SSL entirely.
  const needsSsl = /sslmode=require|sslmode=verify-full|neon\.tech|ssl=/.test(
    connectionString
  )

  const poolMax = process.env.DATABASE_POOL_MAX
    ? parseInt(process.env.DATABASE_POOL_MAX, 10)
    : 5

  const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    // Cap connections per instance so we don't exhaust database limits
    // when running across multiple serverless / containerized instances.
    max: poolMax,
    // Release idle connections quickly to allow PgBouncer / Neon pooler reuse.
    idleTimeoutMillis: 10_000,
    // Headroom for database cold starts.
    connectionTimeoutMillis: 15_000,
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

function extractErrorMessages(error: unknown): string[] {
  if (!error || typeof error !== 'object') return []

  const record = error as Record<string, unknown>
  const messages: string[] = []

  if (typeof record.message === 'string') messages.push(record.message)

  const meta = record.meta
  if (meta && typeof meta === 'object') {
    const driverAdapterError = (meta as Record<string, unknown>)
      .driverAdapterError
    if (driverAdapterError && typeof driverAdapterError === 'object') {
      const adapterRecord = driverAdapterError as Record<string, unknown>
      if (typeof adapterRecord.message === 'string') {
        messages.push(adapterRecord.message)
      }

      const cause = adapterRecord.cause
      if (cause && typeof cause === 'object') {
        const causeRecord = cause as Record<string, unknown>
        if (typeof causeRecord.message === 'string') {
          messages.push(causeRecord.message)
        }
        if (typeof causeRecord.code === 'string') {
          messages.push(causeRecord.code)
        }
      }
    }
  }

  return messages
}

export function isPrismaDatabaseUnavailableError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const record = error as Record<string, unknown>
  if (
    record.code === 'P1001' ||
    record.code === 'ECONNREFUSED' ||
    record.code === 'ETIMEDOUT' ||
    record.code === 'ENOTFOUND'
  ) {
    return true
  }

  return extractErrorMessages(error).some(
    message =>
      message.includes("Can't reach database server") ||
      message.includes('DatabaseNotReachable') ||
      message.includes('ENOTFOUND') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      // Neon / pg errors when the server is waking up or the pooler drops the
      // connection mid-flight.
      message.includes('Connection terminated') ||
      message.includes('timeout exceeded when trying to connect') ||
      message.includes('connection timeout')
  )
}

export function getPrismaDatabaseErrorMessage(error: unknown) {
  return isPrismaDatabaseUnavailableError(error)
    ? DATABASE_UNAVAILABLE_MESSAGE
    : null
}

export async function withDatabaseReadFallback<T>(
  operation: () => Promise<T>,
  fallback: T,
  context?: string
) {
  // Neon free-tier databases can take 10-15 s to wake from suspend.
  // Retry transient connection errors once before giving up.
  const MAX_RETRIES = 2
  const RETRY_DELAY_MS = 2_000

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const isTransient = isPrismaDatabaseUnavailableError(error)

      if (isTransient && attempt < MAX_RETRIES) {
        console.warn(
          `[db] Attempt ${attempt}/${MAX_RETRIES} failed${context ? ` in ${context}` : ''}, retrying in ${RETRY_DELAY_MS}ms…`
        )
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      if (!isTransient) {
        throw error
      }

      console.error(
        `[db] All ${MAX_RETRIES} attempts failed${context ? ` in ${context}` : ''}, falling back to safe read value`,
        error
      )

      return fallback
    }
  }

  // Unreachable but satisfies TypeScript.
  return fallback
}

// Always cache the singleton in the global — even in production.
// Without this, every module import on Vercel serverless creates a new Pool,
// exhausting Neon connection limits and causing runtime crashes on all pages.
// Also ensure any newly added models (e.g. projectTask) force a refresh if missing from cached global.
if (
  !globalForPrisma.prisma ||
  !('projectTask' in (globalForPrisma.prisma as unknown as Record<string, unknown>)) ||
  !('teamChatMessage' in (globalForPrisma.prisma as unknown as Record<string, unknown>))
) {
  globalForPrisma.prisma = createPrismaClient()
}

export const prisma = globalForPrisma.prisma
