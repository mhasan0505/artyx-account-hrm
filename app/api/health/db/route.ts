import { getPrismaDatabaseErrorMessage, prisma } from '@/lib/db'
import { checkRateLimit, getClientIp } from '@/lib/security/rate-limit'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const ip = getClientIp(req)
  try {
    const rateLimit = await checkRateLimit(`health-db:${ip}`, 30, 60 * 1000)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds ?? 60),
          },
        }
      )
    }

    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        ok: true,
        service: 'database',
      },
      { status: 200 }
    )
  } catch (error) {
    const dbMessage = getPrismaDatabaseErrorMessage(error)
    if (dbMessage) {
      console.error('[Health Check DB Error]', dbMessage)
    } else {
      console.error('[Health Check DB Error]', error)
    }

    return NextResponse.json(
      {
        ok: false,
        service: 'database',
        error: 'Database service unavailable',
      },
      { status: 503 }
    )
  }
}

