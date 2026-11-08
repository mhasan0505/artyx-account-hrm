'use server'

import { requireAuth, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok, type ActionResult } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { generatePdfToken } from '@/lib/security/pdf-token'

/**
 * Server action to generate full shareable signed PDF URL for client components
 */
export async function getSignedPdfShareUrl(
  entityType: 'sale' | 'purchase',
  id: string,
  origin?: string
): Promise<ActionResult<string>> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || origin
  if (!baseUrl || !baseUrl.trim()) {
    return fail('App URL not configured (set NEXT_PUBLIC_APP_URL)')
  }

  if (!id || !id.trim()) {
    return fail('Invalid entity ID')
  }

  try {
    const user = await requireAuth()

    let targetOutletId: string | null = null

    if (entityType === 'sale') {
      const sale = await prisma.sale.findUnique({
        where: { id },
        select: { outletId: true },
      })
      if (!sale) return fail('Sale not found')
      targetOutletId = sale.outletId
    } else if (entityType === 'purchase') {
      const purchase = await prisma.purchaseOrder.findUnique({
        where: { id },
        select: { outletId: true },
      })
      if (!purchase) return fail('Purchase order not found')
      targetOutletId = purchase.outletId
    } else {
      return fail('Invalid entity type')
    }

    if (targetOutletId) {
      validateOutletAccess(user, targetOutletId)
    }

    const token = generatePdfToken(entityType, id)
    const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    return ok(`${cleanBaseUrl}/api/pdf/invoice?type=${entityType}&id=${id}&token=${token}`)
  } catch (err: any) {
    return fail(err.message || 'Failed to generate PDF share URL')
  }
}

