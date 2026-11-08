'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit/logger'
import { UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const outletSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  invoiceTerms: z.string().optional(),
  salesTerms: z.string().optional(),
  purchaseTerms: z.string().optional(),
  serviceTerms: z.string().optional(),
  warrantyTerms: z.string().optional(),
  logo: z.string().optional(),
  slogan: z.string().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  cashDrawerVarianceThreshold: z.coerce.number().min(0).optional(),
  largeSaleThreshold: z.coerce.number().min(0).optional(),
  returnApprovalThreshold: z.coerce.number().min(0).optional(),
  returnWindowDays: z.coerce.number().int().min(0).optional(),
})

import {
  type InvoiceTermsCategory,
  SALES_TERMS_DEFAULT,
  PURCHASE_TERMS_DEFAULT,
  SERVICE_TERMS_DEFAULT,
  WARRANTY_TERMS_DEFAULT,
  INVOICE_TERMS_DEFAULT,
} from '@/lib/constants/invoice-terms'

function invoiceTermsSettingKey(outletId: string, category?: InvoiceTermsCategory) {
  if (category) {
    return `invoice_terms_${category}_${outletId}`
  }
  return `invoice_terms_${outletId}`
}

export async function getAccessibleOutlets() {
  const user = await requireAuth()
  const normalizedRole = user.role
    ? String(user.role).trim().toUpperCase().replace(/\s+/g, '_')
    : ''

  if (normalizedRole === UserRole.SUPER_ADMIN) {
    return prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    })
  }

  if (user.outletId) {
    return prisma.outlet.findMany({
      where: { id: user.outletId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
      },
    })
  }

  if (normalizedRole === UserRole.ADMIN) {
    return prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    })
  }

  return []
}

function companyLetterheadSettingKey(outletId: string) {
  return `company_letterhead_${outletId}`
}

export async function getCompanyLetterhead(outletId: string) {
  const user = await requireAuth()
  validateOutletAccess(user, outletId)
  const key = companyLetterheadSettingKey(outletId)
  const setting = await prisma.setting.findUnique({
    where: { key },
  })

  if (!setting?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(setting.value)
    return {
      content: String(parsed.content || ''),
      refNumber: String(parsed.refNumber || 'REF-2026-001'),
      updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : null,
      updatedBy: parsed.updatedBy ? String(parsed.updatedBy) : null,
    }
  } catch {
    return {
      content: setting.value,
      refNumber: 'REF-2026-001',
      updatedAt: null,
      updatedBy: null,
    }
  }
}

export async function saveCompanyLetterhead(
  outletId: string,
  data: { content: string; refNumber?: string }
) {
  const user = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  validateOutletAccess(user, outletId)
  const key = companyLetterheadSettingKey(outletId)
  const payload = JSON.stringify({
    content: data.content,
    refNumber: data.refNumber || 'REF-2026-001',
    updatedAt: new Date().toISOString(),
    updatedBy: user.name || user.id,
  })

  await prisma.setting.upsert({
    where: { key },
    update: { value: payload },
    create: { key, value: payload },
  })

  try {
    revalidatePath('/settings/letterhead')
  } catch {
    // ignore outside Next.js request context
  }
  return ok(true)
}

function getDefaultTermsForCategory(category: InvoiceTermsCategory = 'sales'): string[] {
  switch (category) {
    case 'purchase':
      return PURCHASE_TERMS_DEFAULT
    case 'service':
      return SERVICE_TERMS_DEFAULT
    case 'warranty':
      return WARRANTY_TERMS_DEFAULT
    case 'sales':
    default:
      return SALES_TERMS_DEFAULT
  }
}

function normalizeTerms(raw: string | null | undefined, category: InvoiceTermsCategory = 'sales') {
  if (!raw) return getDefaultTermsForCategory(category)
  const terms = raw
    .split('\n')
    .map(term => term.trim())
    .filter(Boolean)
  return terms.length > 0 ? terms : getDefaultTermsForCategory(category)
}

export async function getOutlet(id: string) {
  const user = await requireAuth()
  validateOutletAccess(user, id)
  const [
    outlet,
    invoiceTermsSetting,
    salesTermsSetting,
    purchaseTermsSetting,
    serviceTermsSetting,
    warrantyTermsSetting,
    lowStockSetting,
    drawerVarianceSetting,
    largeSaleSetting,
    returnApprovalThresholdSetting,
    returnWindowDaysSetting,
  ] = await Promise.all([
    prisma.outlet.findUnique({ where: { id } }),
    prisma.setting.findUnique({ where: { key: invoiceTermsSettingKey(id) } }),
    prisma.setting.findUnique({ where: { key: invoiceTermsSettingKey(id, 'sales') } }),
    prisma.setting.findUnique({ where: { key: invoiceTermsSettingKey(id, 'purchase') } }),
    prisma.setting.findUnique({ where: { key: invoiceTermsSettingKey(id, 'service') } }),
    prisma.setting.findUnique({ where: { key: invoiceTermsSettingKey(id, 'warranty') } }),
    prisma.setting.findUnique({ where: { key: 'low_stock_threshold' } }),
    prisma.setting.findUnique({ where: { key: 'cash_drawer_variance_threshold' } }),
    prisma.setting.findUnique({ where: { key: 'large_sale_alert_threshold' } }),
    prisma.setting.findUnique({ where: { key: 'return_approval_threshold' } }),
    prisma.setting.findUnique({ where: { key: 'return_window_days' } }),
  ])

  if (!outlet) return null

  return {
    ...outlet,
    invoiceTerms: invoiceTermsSetting?.value ?? '',
    salesTerms: salesTermsSetting?.value ?? invoiceTermsSetting?.value ?? '',
    purchaseTerms: purchaseTermsSetting?.value ?? '',
    serviceTerms: serviceTermsSetting?.value ?? '',
    warrantyTerms: warrantyTermsSetting?.value ?? '',
    lowStockThreshold: lowStockSetting?.value ? Number(lowStockSetting.value) : 5,
    cashDrawerVarianceThreshold: drawerVarianceSetting?.value
      ? Number(drawerVarianceSetting.value)
      : 500,
    largeSaleThreshold: largeSaleSetting?.value
      ? Number(largeSaleSetting.value)
      : 20000,
    returnApprovalThreshold: returnApprovalThresholdSetting?.value
      ? Number(returnApprovalThresholdSetting.value)
      : 50000,
    returnWindowDays: returnWindowDaysSetting?.value
      ? Number(returnWindowDaysSetting.value)
      : 30,
  }
}

export async function getInvoiceTerms(
  outletId?: string,
  category: InvoiceTermsCategory = 'sales'
) {
  const user = await requireAuth()
  const resolvedOutletId = outletId || user.outletId
  if (!resolvedOutletId) return getDefaultTermsForCategory(category)

  // 1. Try category-specific setting
  const categorySetting = await prisma.setting.findUnique({
    where: { key: invoiceTermsSettingKey(resolvedOutletId, category) },
  })
  if (categorySetting?.value && categorySetting.value.trim()) {
    return normalizeTerms(categorySetting.value, category)
  }

  // 2. Fall back to generic outlet invoice terms setting
  const genericSetting = await prisma.setting.findUnique({
    where: { key: invoiceTermsSettingKey(resolvedOutletId) },
  })
  if (genericSetting?.value && genericSetting.value.trim()) {
    return normalizeTerms(genericSetting.value, category)
  }

  // 3. Fall back to category defaults
  return getDefaultTermsForCategory(category)
}

export async function updateOutlet(id: string, formData: FormData) {
  const user = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  validateOutletAccess(user, id)
  const raw = Object.fromEntries(formData)
  const parsed = outletSchema.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const data = {
    ...parsed.data,
    email: parsed.data.email || undefined,
  }

  const salesTermsValue = (parsed.data.salesTerms ?? parsed.data.invoiceTerms ?? '').trim()
  const purchaseTermsValue = (parsed.data.purchaseTerms ?? '').trim()
  const serviceTermsValue = (parsed.data.serviceTerms ?? '').trim()
  const warrantyTermsValue = (parsed.data.warrantyTerms ?? '').trim()

  const txs: any[] = [
    prisma.outlet.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        openTime: data.openTime,
        closeTime: data.closeTime,
        logo: data.logo,
        slogan: data.slogan,
      },
    }),
    prisma.setting.upsert({
      where: { key: invoiceTermsSettingKey(id) },
      update: { value: salesTermsValue },
      create: { key: invoiceTermsSettingKey(id), value: salesTermsValue },
    }),
    prisma.setting.upsert({
      where: { key: invoiceTermsSettingKey(id, 'sales') },
      update: { value: salesTermsValue },
      create: { key: invoiceTermsSettingKey(id, 'sales'), value: salesTermsValue },
    }),
    prisma.setting.upsert({
      where: { key: invoiceTermsSettingKey(id, 'purchase') },
      update: { value: purchaseTermsValue },
      create: { key: invoiceTermsSettingKey(id, 'purchase'), value: purchaseTermsValue },
    }),
    prisma.setting.upsert({
      where: { key: invoiceTermsSettingKey(id, 'service') },
      update: { value: serviceTermsValue },
      create: { key: invoiceTermsSettingKey(id, 'service'), value: serviceTermsValue },
    }),
    prisma.setting.upsert({
      where: { key: invoiceTermsSettingKey(id, 'warranty') },
      update: { value: warrantyTermsValue },
      create: { key: invoiceTermsSettingKey(id, 'warranty'), value: warrantyTermsValue },
    }),
  ]

  if (parsed.data.lowStockThreshold !== undefined && !isNaN(parsed.data.lowStockThreshold)) {
    txs.push(
      prisma.setting.upsert({
        where: { key: 'low_stock_threshold' },
        update: { value: String(parsed.data.lowStockThreshold) },
        create: { key: 'low_stock_threshold', value: String(parsed.data.lowStockThreshold) },
      })
    )
  }

  if (
    parsed.data.cashDrawerVarianceThreshold !== undefined &&
    !isNaN(parsed.data.cashDrawerVarianceThreshold)
  ) {
    txs.push(
      prisma.setting.upsert({
        where: { key: 'cash_drawer_variance_threshold' },
        update: { value: String(parsed.data.cashDrawerVarianceThreshold) },
        create: {
          key: 'cash_drawer_variance_threshold',
          value: String(parsed.data.cashDrawerVarianceThreshold),
        },
      })
    )
  }

  if (
    parsed.data.largeSaleThreshold !== undefined &&
    !isNaN(parsed.data.largeSaleThreshold)
  ) {
    txs.push(
      prisma.setting.upsert({
        where: { key: 'large_sale_alert_threshold' },
        update: { value: String(parsed.data.largeSaleThreshold) },
        create: {
          key: 'large_sale_alert_threshold',
          value: String(parsed.data.largeSaleThreshold),
        },
      })
    )
  }

  if (
    parsed.data.returnApprovalThreshold !== undefined &&
    !isNaN(parsed.data.returnApprovalThreshold)
  ) {
    txs.push(
      prisma.setting.upsert({
        where: { key: 'return_approval_threshold' },
        update: { value: String(parsed.data.returnApprovalThreshold) },
        create: {
          key: 'return_approval_threshold',
          value: String(parsed.data.returnApprovalThreshold),
        },
      })
    )
  }

  if (
    parsed.data.returnWindowDays !== undefined &&
    !isNaN(parsed.data.returnWindowDays)
  ) {
    txs.push(
      prisma.setting.upsert({
        where: { key: 'return_window_days' },
        update: { value: String(parsed.data.returnWindowDays) },
        create: {
          key: 'return_window_days',
          value: String(parsed.data.returnWindowDays),
        },
      })
    )
  }

  await prisma.$transaction(txs)

  try {
    revalidatePath('/settings')
    revalidatePath('/settings/letterhead')
    revalidatePath('/sales-orders/invoices')
    revalidatePath('/purchases/invoices')
  } catch {
    // ignore outside Next.js request context
  }
  return ok(true)
}

export async function getReturnSettings() {
  const [thresh, windowDays] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'return_approval_threshold' } }),
    prisma.setting.findUnique({ where: { key: 'return_window_days' } }),
  ])
  return {
    returnApprovalThreshold: thresh?.value ? Number(thresh.value) : 50000,
    returnWindowDays: windowDays?.value ? Number(windowDays.value) : 30,
  }
}

const taxRateSchema = z.object({
  name: z.string().min(1),
  rate: z.coerce.number().min(0).max(100),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})

function serializeTaxRate(rate: {
  id: string
  name: string
  // Prisma Decimal is converted to number for Server Action transport.
  rate: { toNumber(): number } | number
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt?: Date
}) {
  return {
    id: rate.id,
    name: rate.name,
    rate:
      typeof rate.rate === 'number' ? rate.rate : Number(rate.rate.toNumber()),
    isDefault: rate.isDefault,
    isActive: rate.isActive,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: (rate.updatedAt ?? rate.createdAt).toISOString(),
  }
}

export async function getTaxRates() {
  await requireAuth()

  try {
    const taxRates = await prisma.taxRate.findMany({
      select: {
        id: true,
        name: true,
        rate: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })

    return taxRates.map(serializeTaxRate)
  } catch {
    // Compatibility fallback for environments where `updatedAt`
    // has not been migrated yet.
    const taxRates = await prisma.taxRate.findMany({
      select: {
        id: true,
        name: true,
        rate: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })

    return taxRates.map(rate =>
      serializeTaxRate({
        ...rate,
        updatedAt: rate.createdAt,
      })
    )
  }
}

export async function createTaxRate(data: {
  name: string
  rate: number
  isDefault?: boolean
  isActive?: boolean
}) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  const parsed = taxRateSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const created = await prisma.$transaction(async tx => {
    if (parsed.data.isDefault) {
      await tx.taxRate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }

    const taxRate = await tx.taxRate.create({
      data: {
        name: parsed.data.name,
        rate: parsed.data.rate,
        isDefault: parsed.data.isDefault,
        isActive: parsed.data.isActive,
      },
    })

    if (parsed.data.isDefault) {
      await tx.setting.upsert({
        where: { key: 'default_tax_rate_id' },
        update: { value: taxRate.id },
        create: { key: 'default_tax_rate_id', value: taxRate.id },
      })
    }

    return taxRate
  })

  revalidatePath('/settings')
  revalidatePath('/settings/tax')
  return ok(serializeTaxRate(created))
}

export async function updateTaxRate(
  id: string,
  data: {
    name: string
    rate: number
    isDefault?: boolean
    isActive?: boolean
  }
) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  const parsed = taxRateSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const updated = await prisma.$transaction(async tx => {
    if (parsed.data.isDefault) {
      await tx.taxRate.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    const taxRate = await tx.taxRate.update({
      where: { id },
      data: {
        name: parsed.data.name,
        rate: parsed.data.rate,
        isDefault: parsed.data.isDefault,
        isActive: parsed.data.isActive,
      },
    })

    if (parsed.data.isDefault) {
      await tx.setting.upsert({
        where: { key: 'default_tax_rate_id' },
        update: { value: taxRate.id },
        create: { key: 'default_tax_rate_id', value: taxRate.id },
      })
    }

    return taxRate
  })

  revalidatePath('/settings')
  revalidatePath('/settings/tax')
  return ok(serializeTaxRate(updated))
}

export async function deleteTaxRate(id: string) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)

  const taxRate = await prisma.taxRate.findUnique({
    where: { id },
    select: { id: true, isDefault: true },
  })
  if (!taxRate) return fail('Tax rate not found')
  if (taxRate.isDefault) return fail('Cannot delete default tax rate')

  await prisma.taxRate.delete({ where: { id } })
  revalidatePath('/settings')
  revalidatePath('/settings/tax')
  return ok(true)
}

export async function getDefaultTaxRate() {
  await requireAuth()

  const defaultTaxSetting = await prisma.setting.findUnique({
    where: { key: 'default_tax_rate_id' },
  })
  const bySetting = defaultTaxSetting
    ? await prisma.taxRate.findUnique({
        where: { id: defaultTaxSetting.value },
        select: {
          id: true,
          name: true,
          rate: true,
        },
      })
    : null
  const fallback = bySetting
    ? null
    : await prisma.taxRate.findFirst({
        where: { isDefault: true },
        select: {
          id: true,
          name: true,
          rate: true,
        },
      })

  const taxRate = bySetting ?? fallback
  return ok({
    id: taxRate?.id ?? null,
    name: taxRate?.name ?? 'No default tax',
    rate: Number(taxRate?.rate ?? 0),
  })
}

const paymentMethodConfigSchema = z.object({
  label: z.string().min(1),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
})

export async function getPaymentMethods() {
  await requireAuth()
  const methods = await prisma.paymentMethodConfig.findMany({
    orderBy: [{ sortOrder: 'asc' }, { method: 'asc' }],
  })

  return ok(methods)
}

export async function updatePaymentMethod(
  id: string,
  data: { label: string; isActive: boolean; sortOrder: number }
) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  const parsed = paymentMethodConfigSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const updated = await prisma.paymentMethodConfig.update({
    where: { id },
    data: parsed.data,
  })

  revalidatePath('/settings')
  revalidatePath('/settings/payment-methods')
  revalidatePath('/sales')
  return ok(updated)
}

const auditLogsFilterSchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function getAuditLogs(
  filters: z.infer<typeof auditLogsFilterSchema>
) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)

  const parsed = auditLogsFilterSchema.safeParse(filters)
  if (!parsed.success) throw new Error('Invalid filters')

  const { userId, action, entity, fromDate, toDate, limit, offset } =
    parsed.data

  const where: any = {}
  if (userId) where.userId = userId
  if (action) where.action = { contains: action, mode: 'insensitive' }
  if (entity) where.entity = { contains: entity, mode: 'insensitive' }
  if (fromDate || toDate) {
    where.createdAt = {}
    if (fromDate) where.createdAt.gte = fromDate
    if (toDate) where.createdAt.lte = toDate
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        userId: true,
        user: { select: { name: true, email: true } },
        action: true,
        entity: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs,
    total,
    limit,
    offset,
  }
}

const discountLimitsSchema = z.object({
  cashierLimitPct: z.coerce.number().min(0).max(100),
  managerLimitPct: z.coerce.number().min(0).max(100),
})

export async function updateDiscountLimitSettings(
  data: z.infer<typeof discountLimitsSchema>
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  const parsed = discountLimitsSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { cashierLimitPct, managerLimitPct } = parsed.data

  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: 'discount_limit_pct_cashier' },
      create: { key: 'discount_limit_pct_cashier', value: String(cashierLimitPct) },
      update: { value: String(cashierLimitPct) },
    }),
    prisma.setting.upsert({
      where: { key: 'discount_limit_pct_manager' },
      create: { key: 'discount_limit_pct_manager', value: String(managerLimitPct) },
      update: { value: String(managerLimitPct) },
    }),
  ])

  await logAudit('UPDATE_DISCOUNT_LIMITS', 'Setting', 'discount_limits', {
    cashierLimitPct,
    managerLimitPct,
    updatedBy: user.id,
  })

  revalidatePath('/settings')
  revalidatePath('/settings/general')
  revalidatePath('/sales')

  return ok({ cashierLimitPct, managerLimitPct })
}

export async function getDiscountLimitSettings() {
  await requireAuth()
  const rows = await prisma.setting.findMany({
    where: {
      key: { in: ['discount_limit_pct_cashier', 'discount_limit_pct_manager'] },
    },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const cashierRaw = map.get('discount_limit_pct_cashier')
  const managerRaw = map.get('discount_limit_pct_manager')

  return ok({
    cashierLimitPct: cashierRaw !== undefined && cashierRaw !== null ? Number(cashierRaw) : 0,
    managerLimitPct: managerRaw !== undefined && managerRaw !== null ? Number(managerRaw) : 10,
  })
}
