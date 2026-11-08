import { prisma } from '@/lib/db'
import { notifyUsers } from '@/lib/notifications/push-service'
import { UserRole } from '@prisma/client'

/**
 * Checks current stock for given products at an outlet and sends Web Push alerts
 * if any product has fallen to or below the reorder threshold.
 */
export async function checkAndNotifyLowStock(
  productIds: string[],
  outletId: string
): Promise<{ checked: number; alertsSent: number }> {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)))
  if (uniqueProductIds.length === 0 || !outletId) {
    return { checked: 0, alertsSent: 0 }
  }

  try {
    // 1. Fetch configurable threshold (default 5)
    const lowStockSetting = await prisma.setting.findUnique({
      where: { key: 'low_stock_threshold' },
      select: { value: true },
    })
    const lowStockThreshold = Number(lowStockSetting?.value ?? 5)

    // 2. Fetch products details
    const products = await prisma.product.findMany({
      where: { id: { in: uniqueProductIds } },
      select: { id: true, name: true, productCode: true, sku: true },
    })

    let alertsSent = 0

    // 3. Evaluate stock per product at target outlet
    for (const product of products) {
      const stockAggregate = await prisma.stockLedger.aggregate({
        where: {
          productId: product.id,
          outletId,
        },
        _sum: { quantity: true },
      })

      const currentStock = stockAggregate._sum.quantity ?? 0

      if (currentStock <= lowStockThreshold) {
        const searchIdentifier = product.productCode || product.sku || product.name
        const targetUrl = `/products?search=${encodeURIComponent(searchIdentifier)}`

        const res = await notifyUsers({
          roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER],
          outletId,
          cooldownKey: `low-stock-${product.id}-${outletId}`,
          cooldownMinutes: 60,
          title: 'Low Stock Alert',
          body: `"${product.name}" has reached low stock (${currentStock} remaining, threshold: ${lowStockThreshold}).`,
          url: targetUrl,
          data: {
            type: 'LOW_STOCK',
            productId: product.id,
            productName: product.name,
            currentStock,
            threshold: lowStockThreshold,
            outletId,
          },
        })

        if (res.sent > 0 || !res.suppressedByCooldown) {
          alertsSent++
        }
      }
    }

    return { checked: products.length, alertsSent }
  } catch (err) {
    console.error('[LowStockTrigger] Error checking and notifying low stock:', err)
    return { checked: 0, alertsSent: 0 }
  }
}
