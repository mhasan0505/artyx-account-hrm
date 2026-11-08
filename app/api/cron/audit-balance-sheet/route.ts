import crypto from 'node:crypto'
import { computeBalanceSheet } from '@/lib/reports/balance-sheet'

/**
 * Scheduled Cron Endpoint: Proactive Balance Sheet Audit
 *
 * Can be triggered periodically (e.g. nightly at 00:00 UTC) via Coolify cron,
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

    // crypto.timingSafeEqual throws if buffer lengths do not match
    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return Response.json(
        { error: 'Unauthorized: Missing or invalid cron secret' },
        { status: 401 }
      )
    }

    // Proactively compute balance sheet and trigger notification if unbalanced
    const result = await computeBalanceSheet()

    if (!result.success) {
      return Response.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      isBalanced: result.data.isBalanced,
      discrepancy: result.data.discrepancy,
      assets: result.data.assets.totalAssets,
      liabilities: result.data.liabilities.totalLiabilities,
      equity: result.data.equity.totalEquity,
      auditedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[Cron:BalanceSheetAudit] Unexpected error during audit:', err)
    return Response.json(
      { success: false, error: err.message || 'Audit execution failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return GET(request)
}
