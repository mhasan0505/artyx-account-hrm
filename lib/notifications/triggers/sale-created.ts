import { prisma } from '@/lib/db'
import { notifyUsers } from '@/lib/notifications/push-service'
import { UserRole } from '@prisma/client'

export interface CheckSaleCreatedParams {
  saleId: string
  saleNumber: string
  total: number
  outletId: string
  customerName?: string
  soldByName?: string
  itemCount: number
  paymentMethods?: string[]
}

/**
 * Sends a Web Push notification to managers and admins when a high-value sale
 * or large invoice is created (exceeding `large_sale_alert_threshold`, default 20,000 BDT).
 *
 * This prevents alert fatigue from routine low-value checkouts while alerting
 * management immediately on significant revenue movements.
 */
export async function checkAndNotifySaleCreated(
  params: CheckSaleCreatedParams
): Promise<{ triggered: boolean; saleNumber: string; threshold: number }> {
  const {
    saleId,
    saleNumber,
    total,
    outletId,
    customerName,
    soldByName,
    itemCount,
  } = params

  try {
    // 1. Fetch configurable threshold (default 20,000 BDT)
    const thresholdSetting = await prisma.setting.findUnique({
      where: { key: 'large_sale_alert_threshold' },
      select: { value: true },
    })
    const threshold = Number(thresholdSetting?.value ?? 20000)

    // Only notify if total meets or exceeds the large sale threshold (if threshold > 0)
    if (threshold > 0 && total < threshold) {
      return { triggered: false, saleNumber, threshold }
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { name: true },
    })

    const outletName = outlet?.name || 'Outlet'
    const seller = soldByName ? ` by ${soldByName}` : ''
    const customer =
      customerName && customerName !== 'Walk-in Customer'
        ? ` • ${customerName}`
        : ''
    const formattedTotal = `BDT ${total.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

    const res = await notifyUsers({
      roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER],
      outletId,
      cooldownKey: `sale-created-${saleId}`,
      cooldownMinutes: 2,
      title: `High-Value Sale: #${saleNumber}`,
      body: `${formattedTotal} (${itemCount} item${itemCount !== 1 ? 's' : ''}${customer}) at ${outletName}${seller}.`,
      url: `/receipt/${saleId}`,
      data: {
        type: 'SALE_CREATED',
        saleId,
        saleNumber,
        total,
        threshold,
        outletId,
        itemCount,
        customerName,
      },
    })

    return {
      triggered: res.sent > 0 || !res.suppressedByCooldown,
      saleNumber,
      threshold,
    }
  } catch (err) {
    console.error('[SaleCreatedTrigger] Error notifying sale creation:', err)
    return { triggered: false, saleNumber, threshold: 20000 }
  }
}
