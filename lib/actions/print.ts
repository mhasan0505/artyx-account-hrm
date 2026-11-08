'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_PHONE,
  DEFAULT_COMPANY_EMAIL,
} from '@/components/print/brand-assets'

export async function getReportPrintMeta() {
  try {
    const user = await requireAuth()
    let outlet = null
    if (user.outletId) {
      outlet = await prisma.outlet.findUnique({
        where: { id: user.outletId },
        select: {
          name: true,
          address: true,
          phone: true,
          email: true,
          logo: true,
        },
      })
    }

    return {
      outletName: outlet?.name || DEFAULT_COMPANY_NAME,
      companyAddress: outlet?.address || DEFAULT_COMPANY_ADDRESS,
      companyPhone: outlet?.phone || DEFAULT_COMPANY_PHONE,
      companyEmail: outlet?.email || DEFAULT_COMPANY_EMAIL,
      companyLogo: outlet?.logo || '/logo_icons.png',
    }
  } catch {
    return {
      outletName: DEFAULT_COMPANY_NAME,
      companyAddress: DEFAULT_COMPANY_ADDRESS,
      companyPhone: DEFAULT_COMPANY_PHONE,
      companyEmail: DEFAULT_COMPANY_EMAIL,
      companyLogo: '/logo_icons.png',
    }
  }
}
