import crypto from 'node:crypto'
import { executeFixedAssetDepreciation } from '@/lib/actions/fixed-assets'

/**
 * Scheduled Cron Endpoint: Monthly Fixed Asset Depreciation Posting
 *
 * Can be triggered periodically (e.g. monthly on the 1st at 00:00 UTC) via Coolify cron,
 * GitHub Actions, AWS EventBridge, Vercel Cron, or a standard curl/fetch runner.
 *
 * Security: Verifies `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`
 * using length-checked crypto.timingSafeEqual comparison.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return Response.json(
        { error: 'Server misconfiguration: CRON_SECRET is not configured' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('Authorization')
    const customHeader = request.headers.get('x-cron-secret')
    const token =
      authHeader?.replace(/^Bearer\s+/i, '').trim() || customHeader?.trim()

    if (!token) {
      return Response.json(
        { error: 'Unauthorized: Missing or invalid cron secret' },
        { status: 401 }
      )
    }

    const tokenBuf = Buffer.from(token)
    const secretBuf = Buffer.from(cronSecret)

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return Response.json(
        { error: 'Unauthorized: Missing or invalid cron secret' },
        { status: 401 }
      )
    }

    const result = await executeFixedAssetDepreciation()

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalDepPosted: result.totalDepPosted,
      assetsDepreciated: result.count,
    })
  } catch (err: any) {
    console.error('[Cron:Depreciation] Unexpected error during depreciation posting:', err)
    return Response.json(
      { success: false, error: err.message || 'Depreciation execution failed' },
      { status: 500 }
    )
  }
}
