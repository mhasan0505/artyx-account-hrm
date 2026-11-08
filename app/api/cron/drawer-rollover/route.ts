import { runAllOutletsRollover } from '@/lib/finance/drawer-rollover'
import crypto from 'node:crypto'

/**
 * Scheduled Cron Endpoint: Midnight Cash Drawer Rollover
 *
 * Runs nightly at 00:00 Asia/Dhaka (18:00 UTC) via cron runner (Coolify, Vercel Cron,
 * GitHub Actions, crontab, etc.).
 *
 * Behavior:
 *  - Closes each outlet's open drawer at its exact calculated balance up to midnight.
 *  - Opens a new drawer session for the new calendar day carrying forward that exact balance.
 *  - If an outlet had multi-day gaps, rolls forward day-by-day so reporting remains contiguous.
 *  - Self-healing: even if cron misses, ensureOpenDrawer lazy-rolls on the first transaction.
 *
 * Security: Verifies `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`
 * using length-checked crypto.timingSafeEqual comparison.
 */
function verifyCronAuth(request: Request): {
  authorized: boolean
  errorResponse?: Response
} {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { error: 'Server misconfiguration: CRON_SECRET is not configured' },
        { status: 500 }
      ),
    }
  }

  const authHeader = request.headers.get('Authorization')
  const customHeader = request.headers.get('x-cron-secret')
  const token =
    authHeader?.replace(/^Bearer\s+/i, '').trim() || customHeader?.trim()

  if (!token) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { error: 'Unauthorized: Missing or invalid cron secret' },
        { status: 401 }
      ),
    }
  }

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(cronSecret)

  if (
    tokenBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(tokenBuf, secretBuf)
  ) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { error: 'Unauthorized: Missing or invalid cron secret' },
        { status: 401 }
      ),
    }
  }

  return { authorized: true }
}

async function handleRollover(request: Request) {
  const auth = verifyCronAuth(request)
  if (!auth.authorized) {
    return auth.errorResponse!
  }

  try {
    const results = await runAllOutletsRollover('CRON')
    const hasError = results.some(r => r.status === 'error')

    return Response.json({
      success: !hasError,
      timestamp: new Date().toISOString(),
      outletsProcessed: results.length,
      results,
    })
  } catch (err: any) {
    console.error(
      '[Cron:DrawerRollover] Unexpected error during drawer rollover:',
      err
    )
    return Response.json(
      { success: false, error: err.message || 'Drawer rollover failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handleRollover(request)
}

export async function POST(request: Request) {
  return handleRollover(request)
}
