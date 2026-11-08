import { prisma } from '@/lib/db'
import { notifyUsers } from '@/lib/notifications/push-service'
import { UserRole } from '@prisma/client'

export interface CheckDrawerVarianceParams {
  drawerId: string
  outletId: string
  variance: number
  closingBalance: number
  runningBalance: number
  closedById: string
  closedAt: Date
}

/**
 * Checks cash drawer variance on close against configurable threshold
 * and sends Web Push alerts to outlet managers and admins if threshold is exceeded.
 */
export async function checkAndNotifyDrawerVariance(
  params: CheckDrawerVarianceParams
): Promise<{ triggered: boolean; variance: number; threshold: number }> {
  const { drawerId, outletId, variance, closedById, closedAt } = params

  try {
    // 1. Fetch configurable threshold (default 500 BDT)
    const thresholdSetting = await prisma.setting.findUnique({
      where: { key: 'cash_drawer_variance_threshold' },
      select: { value: true },
    })
    const threshold = Number(thresholdSetting?.value ?? 500)

    const absVariance = Math.abs(variance)
    if (absVariance <= threshold) {
      return { triggered: false, variance, threshold }
    }

    // 2. Fetch outlet and user names for rich alert message
    const [outlet, closer] = await Promise.all([
      prisma.outlet.findUnique({
        where: { id: outletId },
        select: { name: true, code: true },
      }),
      prisma.user.findUnique({
        where: { id: closedById },
        select: { name: true },
      }),
    ])

    const outletName = outlet?.name || 'Outlet'
    const closerName = closer?.name || 'Staff'
    const varianceType = variance < 0 ? 'Shortage' : 'Overage'
    const formattedVariance = `BDT ${absVariance.toFixed(2)} ${varianceType}`

    const res = await notifyUsers({
      roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER],
      outletId,
      // Use drawerId + timestamp with a 2-minute deduplication window to avoid duplicate fires on network retries
      cooldownKey: `drawer-variance-${drawerId}-${closedAt.toISOString().slice(0, 16)}`,
      cooldownMinutes: 2,
      title: 'Cash Drawer Variance Alert',
      body: `Drawer at ${outletName} closed with ${formattedVariance} by ${closerName}. Threshold: BDT ${threshold}.`,
      url: '/finances',
      data: {
        type: 'DRAWER_VARIANCE',
        drawerId,
        outletId,
        variance,
        absVariance,
        threshold,
        closedById,
        closedAt: closedAt.toISOString(),
      },
    })

    return {
      triggered: res.sent > 0 || !res.suppressedByCooldown,
      variance,
      threshold,
    }
  } catch (err) {
    console.error('[DrawerVarianceTrigger] Error checking drawer variance:', err)
    return { triggered: false, variance, threshold: 500 }
  }
}
