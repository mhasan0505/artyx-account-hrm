'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { logAudit, logAuditDirect } from '@/lib/audit/logger'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { queueReceiptEmail } from '@/lib/email/mailer'
import { renderReceiptEmailTemplate } from '@/lib/email/templates/receipt'
import {
  buildReceiptSmsBody,
  buildReceiptWhatsappBody,
  sendReceiptSms,
  sendReceiptWhatsapp,
} from '@/lib/sms/twilio'
import { consumeStockLayers } from '@/lib/inventory/stock-layers'
import { aggregateRequiredStockByProduct } from '@/lib/inventory/stock-aggregation'
import { getLocalDateRangeBoundaries, toLocalISODate } from '@/lib/date-utils'
import { checkAndNotifyLowStock } from '@/lib/notifications/triggers/low-stock'
import { checkAndNotifySaleCreated } from '@/lib/notifications/triggers/sale-created'
import {
  DrawerStatus,
  PaymentMethod,
  ReturnCondition,
  SerialStatus,
  ServiceJobStatus,
  StockMovementType,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { generatePdfToken } from '@/lib/security/pdf-token'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { isLockedOutByFailedAttempts } from '@/lib/security/brute-force'
import { distributeOrderDiscount } from '@/lib/actions/discount-utils'
import { formatProductFullName } from '@/lib/utils/product-name'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'
import { getReturnSettings } from '@/lib/actions/settings'
import { validateSalePayments } from '@/lib/sales/payment-validation'
import {
  assertBalancedJournal,
  buildSaleJournalEntries,
} from '@/lib/accounting/journal'
import { verifyManagerApproval } from '@/lib/security/manager-pin'
import {
  getDiscountLimitPct,
  computeDiscretionaryDiscount,
  evaluateDiscountApproval,
  type EvaluateDiscountApprovalResult,
} from '@/lib/sales/discount-policy'
import { nextDocumentNumber } from '@/lib/numbering/next-document-number'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

function safeRevalidatePath(path: string, type?: 'page' | 'layout') {
  try {
    revalidatePath(path, type)
  } catch {
    // Ignore static generation store missing error outside Next.js request context
  }
}

function safeRevalidateTag(tag: string) {
  try {
    ;(revalidateTag as any)(tag, 'max')
  } catch {
    // Ignore static generation store missing error outside Next.js request context
  }
}


const complimentaryGiftOptionSchema = z.enum([
  'bag',
  'mouse',
  'mousePad',
  'dataCable',
  'chargerCable',
])

const saleLineSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  discountAmt: z.coerce.number().min(0).default(0),
  serialNumbers: z.array(z.string()).default([]),
  isGift: z.boolean().default(false),
  note: z.string().optional(),
  cartItemId: z.string().optional(),
  parentCartItemId: z.string().optional(),
  selectedGifts: z.array(complimentaryGiftOptionSchema).optional().default([]),
})

const salePaymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.coerce.number().min(0),
  bankAccountId: z.string().optional(),
  feeAmount: z.coerce.number().min(0).default(0),
  reference: z.string().optional(),
})

export async function ensureWalkInCustomer(
  dbClient: typeof prisma | PrismaTx = prisma
): Promise<string> {
  const walkInSetting = await dbClient.setting.findUnique({
    where: { key: 'walk_in_customer_id' },
    select: { value: true },
  })

  if (walkInSetting?.value) {
    const existing = await dbClient.customer.findUnique({
      where: { id: walkInSetting.value },
      select: { id: true },
    })
    if (existing) {
      return existing.id
    }
  }

  // Check if default ID 'cust-walk-in-default' exists
  let customer = await dbClient.customer.findUnique({
    where: { id: 'cust-walk-in-default' },
    select: { id: true },
  })

  // Or check by name 'Walk-in Customer'
  if (!customer) {
    customer = await dbClient.customer.findFirst({
      where: { name: { equals: 'Walk-in Customer', mode: 'insensitive' } },
      select: { id: true },
    })
  }

  // If not found, safely create it
  if (!customer) {
    const phoneTaken = await dbClient.customer.findUnique({
      where: { phone: '01700000000' },
      select: { id: true },
    })

    customer = await dbClient.customer.create({
      data: {
        id: 'cust-walk-in-default',
        name: 'Walk-in Customer',
        phone: phoneTaken ? null : '01700000000',
      },
      select: { id: true },
    })
  }

  // Update or insert setting to reference valid customer
  await dbClient.setting.upsert({
    where: { key: 'walk_in_customer_id' },
    update: { value: customer.id },
    create: { key: 'walk_in_customer_id', value: customer.id },
  })

  return customer.id
}

export async function getCheckoutPaymentOptions() {
  try {
    const user = await requireAuth()
    const [bankAccounts, walkInSetting, discountSettings, potentialApprovers] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { outletId: user.outletId, isActive: true },
        select: {
          id: true,
          bankName: true,
          accountName: true,
          isMfs: true,
          cashoutChargePct: true,
          transactionChargePct: true,
          chargeType: true,
          currentBalance: true,
        },
        orderBy: { accountName: 'asc' },
      }),
      prisma.setting.findUnique({
        where: { key: 'walk_in_customer_id' },
        select: { value: true },
      }),
      prisma.setting.findMany({
        where: {
          key: { in: ['discount_limit_pct_cashier', 'discount_limit_pct_manager'] },
        },
        select: { key: true, value: true },
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          pin: { not: null },
          role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] },
          id: { not: user.id }, // Self-approval prohibited
        },
        select: {
          id: true,
          name: true,
          role: true,
        },
        orderBy: { name: 'asc' },
      }),
    ])

    const discountSettingMap = new Map(discountSettings.map(s => [s.key, s.value]))
    const actorDiscountLimitPct = getDiscountLimitPct(user.role, discountSettingMap)

    const approvers = potentialApprovers.map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      discountLimitPct: getDiscountLimitPct(u.role, discountSettingMap),
    }))

    const serialized = bankAccounts.map(b => ({
      id: b.id,
      bankName: b.bankName,
      accountName: b.accountName,
      isMfs: b.isMfs,
      cashoutChargePct: Number(b.cashoutChargePct),
      transactionChargePct: Number(b.transactionChargePct),
      chargeType: b.chargeType,
      currentBalance: Number(b.currentBalance),
    }))

    console.log(
      'SERVER ACTION getCheckoutPaymentOptions ->',
      serialized.length,
      'accounts found for outlet',
      user.outletId
    )

    let resolvedWalkInCustomerId = walkInSetting?.value || null
    if (resolvedWalkInCustomerId) {
      const exists = await prisma.customer.findUnique({
        where: { id: resolvedWalkInCustomerId },
        select: { id: true },
      })
      if (!exists) {
        resolvedWalkInCustomerId = await ensureWalkInCustomer(prisma)
      }
    } else {
      resolvedWalkInCustomerId = await ensureWalkInCustomer(prisma)
    }

    return ok({
      bankAccounts: serialized,
      walkInCustomerId: resolvedWalkInCustomerId,
      actorDiscountLimitPct,
      approvers,
    })
  } catch (error: any) {
    console.error('getCheckoutPaymentOptions error:', error)
    return fail(error.message || 'Failed to load bank accounts')
  }
}


const complimentaryGiftLabelMap: Record<
  z.infer<typeof complimentaryGiftOptionSchema>,
  { label: string; terms: string[] }
> = {
  bag: { label: 'Laptop Bag', terms: ['bag', 'sleeve', 'backpack', 'case'] },
  mouse: { label: 'Mouse', terms: ['mouse', 'mice'] },
  mousePad: { label: 'Mouse Pad', terms: ['mouse pad', 'mousepad', 'mouse-pad', 'desk pad'] },
  dataCable: {
    label: 'Data Cable',
    terms: ['data cable', 'usb cable', 'type c cable', 'type-c cable', 'data-cable'],
  },
  chargerCable: {
    label: 'Charger Cable',
    terms: ['charger cable', 'power cable', 'charging cable', 'adapter cable', 'power-cable', 'charger', 'adapter'],
  },
}

async function findBestGiftProduct(
  outletId: string,
  giftKey: z.infer<typeof complimentaryGiftOptionSchema>,
  dbClient: typeof prisma | PrismaTx = prisma
) {
  const rule = complimentaryGiftLabelMap[giftKey]
  if (!rule) return null

  // Fetch candidate active products matching the gift terms in name or category
  const candidateProducts = await dbClient.product.findMany({
    where: {
      outletId,
      isActive: true,
      OR: [
        ...rule.terms.map(term => ({
          name: { contains: term, mode: 'insensitive' as const },
        })),
        ...rule.terms.map(term => ({
          category: { name: { contains: term, mode: 'insensitive' as const } },
        })),
      ],
    },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      requiresSerial: true,
      createdAt: true,
      category: { select: { name: true } },
    },
    orderBy: [
      { sellingPrice: 'asc' }, // ৳0 promotional gifts prioritized
      { createdAt: 'desc' },   // newly created/stocked products next
    ],
  })

  // Filter candidates to ensure only accessory/gift products qualify (not laptops/desktops)
  const filteredCandidates = candidateProducts.filter(p => {
    const catName = p.category?.name?.toLowerCase() ?? ''
    const pName = p.name?.toLowerCase() ?? ''

    // 1. Exclude laptops, desktops, servers, workstations from ever matching gifts
    if (
      (catName.includes('laptop') || catName.includes('desktop') || catName.includes('workstation')) &&
      !pName.includes('bag') &&
      !pName.includes('case') &&
      !pName.includes('sleeve')
    ) {
      return false
    }

    // 2. The product name or its specific category MUST match at least one of rule.terms
    const matchesTerm = rule.terms.some(
      term => pName.includes(term.toLowerCase()) || catName.includes(term.toLowerCase())
    )
    if (!matchesTerm) {
      return false
    }

    // 3. Disambiguate mouse vs mouse pad:
    // If the gift is "mouse", it must NOT be a mouse pad / mat
    if (giftKey === 'mouse' && (pName.includes('pad') || pName.includes('mat'))) {
      return false
    }

    // 4. Disambiguate bag: ensure it contains bag, sleeve, backpack, case, cover, pouch
    if (giftKey === 'bag') {
      const bagTerms = ['bag', 'sleeve', 'backpack', 'case', 'cover', 'pouch']
      if (!bagTerms.some(t => pName.includes(t) || catName.includes(t))) {
        return false
      }
    }

    return true
  })

  if (filteredCandidates.length === 0) {
    return null
  }

  const productIds = filteredCandidates.map(p => p.id)

  // 1. Stock from StockLedger
  const stockTotals = await dbClient.stockLedger.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      outletId,
    },
    _sum: { quantity: true },
  })
  const ledgerStockMap = new Map(
    stockTotals.map(s => [s.productId, Math.max(0, s._sum.quantity ?? 0)])
  )

  // 2. Stock from StockLayer
  const layerTotals = await dbClient.stockLayer.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      outletId,
    },
    _sum: { quantityRemaining: true },
  })
  const layerStockMap = new Map(
    layerTotals.map(l => [l.productId, Math.max(0, l._sum.quantityRemaining ?? 0)])
  )

  // 3. Stock from SerialUnit (if pre-serialized units exist)
  const serialCounts = await dbClient.serialUnit.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      outletId,
      status: SerialStatus.IN_STOCK,
    },
    _count: { id: true },
  })
  const serialStockMap = new Map(
    serialCounts.map(c => [c.productId, c._count.id])
  )

  const getProductStock = (pid: string) => {
    const fromLedger = ledgerStockMap.get(pid) ?? 0
    const fromLayer = layerStockMap.get(pid) ?? 0
    const fromSerial = serialStockMap.get(pid) ?? 0
    return Math.max(fromLedger, fromLayer, fromSerial)
  }

  // Find candidate that actually has available stock
  const inStockCandidate = filteredCandidates.find(
    p => getProductStock(p.id) > 0
  )

  if (inStockCandidate) {
    return {
      product: inStockCandidate,
      stock: getProductStock(inStockCandidate.id),
      rule,
    }
  }

  // Fallback to first candidate with stock = 0
  return {
    product: filteredCandidates[0],
    stock: getProductStock(filteredCandidates[0].id),
    rule,
  }
}

const checkoutSchema = z.object({
  idempotencyKey: z.string().optional(),
  customerId: z.string().min(1, 'Customer is required'),
  lines: z.array(saleLineSchema).min(1),
  complimentaryGifts: z.array(complimentaryGiftOptionSchema).default([]),
  payments: z.array(salePaymentSchema).min(1),
  orderDiscountPct: z.coerce.number().min(0).max(100).default(0),
  isQuotation: z.boolean().default(false),
  managerOverridePin: z.string().optional(),
  managerAuthorizerId: z.string().optional(),
  overrideApproverId: z.string().optional(),
  overridePin: z.string().optional(),
  sendEmailReceipt: z.boolean().optional(),
  sendSmsReceipt: z.boolean().optional(),
  saleDate: z.coerce.date().optional(),
  isOfflineSync: z.boolean().optional(),
  notes: z.string().optional(),
})

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100


const saleReturnRequestLineSchema = z.object({
  saleLineId: z.string(),
  quantity: z.coerce.number().int().min(1),
  condition: z.nativeEnum(ReturnCondition).default(ReturnCondition.RESELLABLE),
})

const saleReturnSerialQualitySchema = z
  .object({
    saleLineId: z.string(),
    serialUnitId: z.string(),
    qualityStatus: z.enum(['IN_STOCK', 'IN_SERVICE', 'DEAD']).optional(),
    condition: z.nativeEnum(ReturnCondition).optional(),
  })
  .refine(
    val => {
      if (
        val.qualityStatus === 'DEAD' &&
        val.condition === ReturnCondition.RESELLABLE
      ) {
        return false
      }
      if (
        val.qualityStatus === 'IN_STOCK' &&
        val.condition === ReturnCondition.DEFECTIVE
      ) {
        return false
      }
      return true
    },
    {
      message:
        'Serial condition and quality status cannot contradict (DEAD serials cannot be RESELLABLE, and IN_STOCK serials cannot be DEFECTIVE)',
    }
  )
  .transform(val => {
    let qualityStatus = val.qualityStatus
    if (!qualityStatus) {
      if (val.condition === ReturnCondition.DEFECTIVE) {
        qualityStatus = 'DEAD'
      } else {
        qualityStatus = 'IN_STOCK'
      }
    }
    const condition =
      val.condition ??
      (qualityStatus === 'DEAD'
        ? ReturnCondition.DEFECTIVE
        : ReturnCondition.RESELLABLE)
    return {
      saleLineId: val.saleLineId,
      serialUnitId: val.serialUnitId,
      qualityStatus: qualityStatus as 'IN_STOCK' | 'IN_SERVICE' | 'DEAD',
      condition,
    }
  })

export async function checkout(
  data: z.input<typeof checkoutSchema>,
  tx?: PrismaTx
) {
  const user = await requireAuth()
  const parsed = checkoutSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const db = tx ?? prisma

  const {
    idempotencyKey,
    customerId: inputCustomerId,
    lines,
    complimentaryGifts,
    payments,
    orderDiscountPct,
    isQuotation,
    managerOverridePin,
    managerAuthorizerId,
    overrideApproverId,
    overridePin,
    sendEmailReceipt,
    sendSmsReceipt,
    saleDate,
    notes,
  } = parsed.data

  let customerId = inputCustomerId

  // ── IDEMPOTENCY GUARD ──
  if (idempotencyKey?.trim()) {
    const existingSale = await db.sale.findUnique({
      where: { idempotencyKey: idempotencyKey.trim() },
      select: {
        id: true,
        saleNumber: true,
        total: true,
        changeDue: true,
        previousDue: true,
        newBalance: true,
        createdAt: true,
      },
    })
    if (existingSale) {
      return ok({
        id: existingSale.id,
        saleNumber: existingSale.saleNumber,
        total: Number(existingSale.total),
        changeDue: Number(existingSale.changeDue),
        previousDue: existingSale.previousDue
          ? Number(existingSale.previousDue)
          : null,
        newBalance: existingSale.newBalance
          ? Number(existingSale.newBalance)
          : null,
        saleDate: existingSale.createdAt,
      })
    }
  }

  if (saleDate && saleDate.getTime() > Date.now() + 60 * 1000) {
    return fail('Sale date cannot be in the future')
  }

  const canBackdateSale =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    (Boolean(parsed.data.isOfflineSync) &&
      saleDate !== undefined &&
      saleDate.getTime() >= Date.now() - 72 * 60 * 60 * 1000)

  if (saleDate && !canBackdateSale) {
    return fail('Only Admin/Manager can enter backdated sales')
  }

  const effectiveSaleDate = saleDate ?? new Date()

  // Batch all settings + COA accounts in one round-trip
  const [settingsRows, coaAccounts] = await Promise.all([
    db.setting.findMany({
      where: {
        key: {
          in: [
            'default_tax_rate_id',
            'discount_limit_pct_cashier',
            'discount_limit_pct_manager',
            'walk_in_customer_id',
          ],
        },
      },
      select: { key: true, value: true },
    }),
    db.chartOfAccount.findMany({
      where: {
        code: { in: ['1100', '1200', '1300', '1400', '2300', '4100', '5000', '5290'] },
      },
      select: { id: true, code: true },
    }),
  ])

  const settingMap = new Map(settingsRows.map(s => [s.key, s.value]))
  const maxAllowedDiscount = getDiscountLimitPct(user.role, settingMap)
  const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))

  // Resolve tax rate using the batched settings
  const taxRateId = settingMap.get('default_tax_rate_id')
  const taxRate = taxRateId
    ? await db.taxRate.findUnique({
        where: { id: taxRateId },
        select: { rate: true },
      })
    : null
  const taxPct = taxRate ? Number(taxRate.rate) : 0

  // Fetch customer group discount if applicable
  let customer = customerId
    ? await db.customer.findUnique({
        where: { id: customerId },
        include: { group: true },
      })
    : null

  if (customerId && !customer) {
    const configuredWalkInId = settingMap.get('walk_in_customer_id')
    if (customerId === configuredWalkInId || customerId === 'cust-walk-in-default') {
      const ensuredId = await ensureWalkInCustomer(db)
      customer = await db.customer.findUnique({
        where: { id: ensuredId },
        include: { group: true },
      })
      if (customer) {
        customerId = customer.id
      }
    }

    if (!customer) {
      return fail('Customer not found')
    }
  }
  const groupDiscountPct = customer?.group?.discountPct
    ? Number(customer.group.discountPct)
    : 0
  const effectiveOrderDiscountPct = Math.max(orderDiscountPct, groupDiscountPct)

  const lineProductIds = Array.from(new Set(lines.map(line => line.productId)))
  // Single batched fetch with all fields needed for validation, totals, and COGS.
  // This replaces two separate product.findMany calls that existed previously.
  const lineProducts = await db.product.findMany({
    where: { id: { in: lineProductIds }, isActive: true },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      costPrice: true,
      requiresSerial: true,
      warrantyMonths: true,
      taxRateId: true,
      taxRate: { select: { rate: true } },
      category: { select: { name: true } },
    },
  })
  const lineProductMap = new Map(
    lineProducts.map(product => [product.id, product])
  )

  if (lineProducts.length !== lineProductIds.length) {
    return fail('Some products in cart are invalid')
  }

  // ── ENFORCE SERIAL NUMBERS for products that require them ──
  for (const line of lines) {
    const product = lineProductMap.get(line.productId)
    if (product?.requiresSerial) {
      const providedSerials = line.serialNumbers.filter(Boolean)
      if (providedSerials.length !== line.quantity) {
        return fail(
          `"${product.name}" requires serial numbers. Please select exactly ${line.quantity} serial number(s). Got ${providedSerials.length}.`
        )
      }
      const uniqueSerials = new Set(providedSerials)
      if (uniqueSerials.size !== providedSerials.length) {
        return fail(
          `"${product.name}" has duplicate serial numbers. Each serial number must be unique.`
        )
      }
    }
  }

  const hasLaptopLine = lines.some(line => {
    const product = lineProductMap.get(line.productId)
    if (!product) return false
    const categoryName = product.category?.name?.toLowerCase() ?? ''
    const productName = product.name.toLowerCase()
    return categoryName.includes('laptop') || productName.includes('laptop')
  })

  const totalGiftsCount = lines.reduce((sum, l) => sum + (l.selectedGifts?.length || 0), 0) + complimentaryGifts.length
  if (totalGiftsCount > 0 && !hasLaptopLine) {
    return fail('Complimentary gifts are only allowed when a laptop is in cart')
  }

  // ── NORMALIZATION: INDIVIDUAL SERIALIZED LINE EXPANSION ──
  // If any line requires serials and has quantity > 1 or multiple serial numbers,
  // expand it into distinct 1-unit lines so each unit receives its exact serial and separate SaleLine.
  const normalizedInputLines: typeof lines = []
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx]
    const baseCartId = l.cartItemId || `cart-item-${idx}`
    const product = lineProductMap.get(l.productId)
    if (product?.requiresSerial && (l.quantity > 1 || (l.serialNumbers && l.serialNumbers.length > 1))) {
      const serialCount = l.serialNumbers?.length ?? 0
      const totalUnits = Math.max(l.quantity, serialCount)
      for (let uIdx = 0; uIdx < totalUnits; uIdx++) {
        const sn = l.serialNumbers?.[uIdx] ? [l.serialNumbers[uIdx]] : []
        const discountCents = Math.max(0, Math.round((l.discountAmt || 0) * 100))
        const baseDiscountCents = Math.floor(discountCents / totalUnits)
        const remainderDiscountCents = discountCents % totalUnits
        const lineUnitDiscountAmt =
          (baseDiscountCents + (uIdx < remainderDiscountCents ? 1 : 0)) / 100
        normalizedInputLines.push({
          ...l,
          quantity: 1,
          discountAmt: lineUnitDiscountAmt,
          serialNumbers: sn,
          cartItemId: `${baseCartId}-${uIdx}`,
          selectedGifts: uIdx === 0 ? (l.selectedGifts ?? []) : [],
        })
      }
    } else {
      normalizedInputLines.push({
        ...l,
        cartItemId: baseCartId,
      })
    }
  }

  // Find qualifying laptop lines to link complimentary gifts
  const laptopLines = normalizedInputLines.filter(line => {
    const product = lineProductMap.get(line.productId)
    if (!product) return false
    const categoryName = product.category?.name?.toLowerCase() ?? ''
    const productName = product.name.toLowerCase()
    return categoryName.includes('laptop') || productName.includes('laptop')
  })

  const hasPerLineGifts = normalizedInputLines.some(
    l => l.selectedGifts && l.selectedGifts.length > 0
  )

  const effectiveLines: Array<(typeof normalizedInputLines)[number]> = []
  const resolvedGiftProducts: any[] = []

  if (hasPerLineGifts) {
    // Process gifts item-wise: strictly linked to the specific line they were selected on
    for (const parentLine of normalizedInputLines) {
      effectiveLines.push(parentLine)

      if (parentLine.selectedGifts && parentLine.selectedGifts.length > 0) {
        for (const gift of parentLine.selectedGifts) {
          const resolved = await findBestGiftProduct(user.outletId!, gift, db)
          const rule = resolved?.rule || complimentaryGiftLabelMap[gift]
          const giftProduct = resolved?.product
          const stock = resolved?.stock ?? 0

          if (!giftProduct || stock <= 0) {
            return fail(
              `${rule.label} gift is currently out of stock for this outlet`
            )
          }

          resolvedGiftProducts.push(giftProduct)

          effectiveLines.push({
            productId: giftProduct.id,
            quantity: 1,
            unitPrice: Number(giftProduct.sellingPrice),
            discountPct: 0,
            discountAmt: 0,
            serialNumbers: [],
            isGift: true,
            cartItemId: `gift:${parentLine.cartItemId}:${gift}`,
            parentCartItemId: parentLine.cartItemId,
            selectedGifts: [],
          })
        }
      }
    }
  } else if (complimentaryGifts.length > 0) {
    // Backward-compatible fallback for legacy checkout without per-line selectedGifts
    for (const parentLine of normalizedInputLines) {
      effectiveLines.push(parentLine)
    }

    const giftResults = await Promise.all(
      complimentaryGifts.map(async gift => {
        const resolved = await findBestGiftProduct(user.outletId!, gift, db)
        return {
          gift,
          rule: resolved?.rule || complimentaryGiftLabelMap[gift],
          giftProduct: resolved?.product,
          stock: resolved?.stock ?? 0,
        }
      })
    )

    for (let gIdx = 0; gIdx < giftResults.length; gIdx++) {
      const { gift, rule, giftProduct, stock } = giftResults[gIdx]
      if (!giftProduct || stock <= 0) {
        return fail(
          `${rule.label} gift is currently out of stock for this outlet`
        )
      }
      const parentLaptopLine = laptopLines.length > 0
        ? laptopLines[gIdx % laptopLines.length]
        : null

      if (giftProduct) resolvedGiftProducts.push(giftProduct)

      effectiveLines.push({
        productId: giftProduct.id,
        quantity: 1,
        unitPrice: Number(giftProduct.sellingPrice),
        discountPct: 0,
        discountAmt: 0,
        serialNumbers: [],
        isGift: true,
        cartItemId: `gift:${gift}`,
        parentCartItemId: parentLaptopLine?.cartItemId,
        selectedGifts: [],
      })
    }
  } else {
    for (const line of normalizedInputLines) {
      effectiveLines.push(line)
    }
  }

  // Ensure gift products are available in lineProductMap
  for (const gp of resolvedGiftProducts) {
    if (!lineProductMap.has(gp.id)) {
      lineProductMap.set(gp.id, gp)
    }
  }

  // ── PRE-FETCH STOCK & SERIALS FOR HARD GUARD & PRICE RESOLUTION ──
  const allRequiredSerials = effectiveLines.flatMap(l => l.serialNumbers.filter(Boolean))

  // Run stock groupBy + serial batch-fetch in parallel
  const [stockTotals, serialRows] = await Promise.all([
    isQuotation
      ? Promise.resolve(
          [] as { productId: string; _sum: { quantity: number | null } }[]
        )
      : db.stockLedger.groupBy({
          by: ['productId'],
          where: {
            productId: { in: effectiveLines.map(l => l.productId) },
            outletId: user.outletId,
          },
          _sum: { quantity: true },
        }),
    allRequiredSerials.length > 0
      ? db.serialUnit.findMany({
          where: { serialNumber: { in: allRequiredSerials } },
          select: { serialNumber: true, status: true, productId: true, sellingPrice: true, outletId: true },
        })
      : Promise.resolve(
          [] as { serialNumber: string; status: string; productId: string; sellingPrice: any; outletId: string }[]
        ),
  ])

  const stockByProduct = new Map(
    stockTotals.map(r => [r.productId, r._sum.quantity ?? 0])
  )
  const serialByNumber = new Map(serialRows.map(s => [s.serialNumber, s]))

  // ── VALIDATE STOCK AND SERIALS ──
  if (!isQuotation) {
    const requiredStockByProduct = new Map<string, number>()
    for (const line of effectiveLines) {
      requiredStockByProduct.set(
        line.productId,
        (requiredStockByProduct.get(line.productId) ?? 0) + line.quantity
      )
    }

    for (const [productId, requiredQty] of requiredStockByProduct.entries()) {
      const stockQty = stockByProduct.get(productId) ?? 0
      if (stockQty < requiredQty) {
        const product = lineProductMap.get(productId)
        return fail(
          `Insufficient stock for "${product?.name ?? productId}". Available: ${stockQty}, Required: ${requiredQty}`
        )
      }
    }
  }

  for (const line of effectiveLines) {

    // Validate serial numbers in-memory
    if (line.serialNumbers.length > 0) {
      for (const sn of line.serialNumbers) {
        const serial = serialByNumber.get(sn)
        if (!serial) return fail(`Serial number ${sn} not found`)
        if (serial.outletId && user.outletId && serial.outletId !== user.outletId)
          return fail(`Serial ${sn} belongs to a different outlet`)
        if (serial.status !== SerialStatus.IN_STOCK)
          return fail(`Serial ${sn} is not available`)
        if (serial.productId !== line.productId)
          return fail(`Serial ${sn} does not match the selected product`)
      }
    }
  }

  // ── SERVER-VERIFIED PRICE CALCULATION & OPEN PRICING ──
  // Priority: Terminal Input Price → Serial Unit Price → Catalog Base Price.
  // DB prices are fallbacks only — a cashier's negotiated price is always honoured.
  // If no price resolves to > 0, checkout is rejected immediately.
  let baseSubtotal = 0
  const lineCalcs: Array<
    (typeof effectiveLines)[number] & {
      unitPrice: number
      discountPct: number
      total: number
    }
  > = []
  for (const l of effectiveLines) {
    const product = lineProductMap.get(l.productId)
    let serverPrice = 0

    if (l.isGift) {
      serverPrice = 0
    } else if (typeof l.unitPrice === 'number' && l.unitPrice > 0) {
      // PRIORITY 1: Terminal Input Price (Cashier's negotiated/edited price)
      serverPrice = round2(l.unitPrice)
    } else if (product?.requiresSerial && l.serialNumbers.length > 0) {
      let totalLinePrice = 0
      for (const sn of l.serialNumbers) {
        const serial = serialByNumber.get(sn)
        const sPrice = Number(serial?.sellingPrice ?? 0)
        const catPrice = Number(product?.sellingPrice ?? 0)

        // PRIORITY 2: Serial Price → Catalog Base Price
        const resolvedUnitPrice = sPrice > 0 ? sPrice : catPrice

        if (resolvedUnitPrice <= 0) {
          return fail(
            `"${product?.name || 'Item'}" (Serial: ${sn}) has no price set — a manager must set a price before it can be sold.`
          )
        }
        totalLinePrice += resolvedUnitPrice
      }
      serverPrice = round2(totalLinePrice / l.quantity)
    } else {
      const catPrice = Number(product?.sellingPrice ?? 0)

      // PRIORITY 3: Catalog Base Price
      serverPrice = catPrice

      if (serverPrice <= 0) {
        return fail(
          `"${product?.name || 'Item'}" has no price set (৳0.00) — a manager must set a price before it can be sold.`
        )
      }
    }

    const lineGross = l.isGift ? 0 : round2(serverPrice * l.quantity)
    // Line-level discount: explicit discountAmt takes precedence, fallback to discountPct if provided
    let lineDiscount = 0
    if (!l.isGift) {
      if (l.discountAmt > 0) {
        lineDiscount = round2(Math.min(lineGross, l.discountAmt))
      } else if (l.discountPct > 0) {
        lineDiscount = round2(lineGross * (l.discountPct / 100))
      }
    }
    const lineNetTotal = Math.max(0, round2(lineGross - lineDiscount))

    if (!l.isGift && product) {
      baseSubtotal = round2(baseSubtotal + lineGross)
    }

    lineCalcs.push({
      ...l,
      unitPrice: serverPrice, // Reflects open pricing — terminal input is honoured
      discountPct: l.discountPct,
      discountAmt: lineDiscount,
      total: lineNetTotal,
    })
  }

  const totalLineDiscounts = round2(lineCalcs.reduce((s, l) => s + l.discountAmt, 0))
  const netSubtotal = Math.max(0, round2(baseSubtotal - totalLineDiscounts))
  const orderDiscount = round2(netSubtotal * (effectiveOrderDiscountPct / 100))
  const afterDiscount = Math.max(0, round2(netSubtotal - orderDiscount))

  const totalDiscountAmt = round2(totalLineDiscounts + orderDiscount)
  const discretionaryCalc = computeDiscretionaryDiscount({
    baseSubtotal,
    netSubtotal,
    totalDiscount: totalDiscountAmt,
    groupDiscountPct,
  })

  let overrideMeta = ''
  let verifiedApprover: { id: string; name: string; role: UserRole } | null = null

  if (discretionaryCalc.discretionaryDiscountPct > maxAllowedDiscount) {
    // Backward compatibility for queued offline sales:
    // If queued payload contains legacy managerOverridePin and needs override, fail with clear message
    if (managerOverridePin && !overrideApproverId && !overridePin) {
      return fail('Discount needs manager approval; re-enter the sale')
    }

    if (!overrideApproverId || !overridePin) {
      return fail(
        `Discount exceeds your limit (${maxAllowedDiscount}%). Authorizing manager approval is required.`
      )
    }

    const approvalResult = await verifyManagerApproval({
      approverUserId: overrideApproverId,
      pin: overridePin,
      actorUserId: user.id,
      failureAction: 'DISCOUNT_OVERRIDE_FAILED',
      requiredLimitPct: discretionaryCalc.discretionaryDiscountPct,
      settings: settingMap,
      tx,
      meta: {
        discretionaryDiscountPct: discretionaryCalc.discretionaryDiscountPct,
        discretionaryDiscountAmt: discretionaryCalc.discretionaryDiscountAmt,
      },
    })

    if (!approvalResult.ok) {
      return fail(approvalResult.error)
    }

    verifiedApprover = approvalResult.approver
    overrideMeta = ` [override:${verifiedApprover.name}]`
  }

  // SAL-001: Cost floor guard — block sales below product costPrice unless approved by Manager
  const canOverrideCostFloor =
    ([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as string[]).includes(user.role) ||
    Boolean(verifiedApprover)

  if (!canOverrideCostFloor) {
    for (const lc of lineCalcs) {
      if (lc.isGift) continue
      const prod = lineProductMap.get(lc.productId)
      const cost = Number(prod?.costPrice || 0)
      if (cost > 0) {
        const effectiveUnitNet = round2(lc.total / lc.quantity)
        if (effectiveUnitNet < cost) {
          return fail(
            `Line price (৳${effectiveUnitNet}) for "${prod?.name || 'Item'}" is below cost price (৳${cost}). Manager approval required.`
          )
        }
      }
    }
  }

  // SAL-002: Honor Product.taxRateId per line item, falling back to outlet default taxPct
  let totalCalculatedTax = 0
  for (const lc of lineCalcs) {
    if (lc.isGift) continue
    const prod = lineProductMap.get(lc.productId)
    const lineTaxRate =
      prod?.taxRate?.rate != null ? Number(prod.taxRate.rate) : taxPct
    if (lineTaxRate > 0) {
      const lineOrderDiscountShare =
        netSubtotal > 0 ? (lc.total / netSubtotal) * orderDiscount : 0
      const lineTaxableBase = Math.max(0, lc.total - lineOrderDiscountShare)
      totalCalculatedTax = round2(
        totalCalculatedTax + round2(lineTaxableBase * (lineTaxRate / 100))
      )
    }
  }
  const taxAmt = totalCalculatedTax
  const total = round2(afterDiscount + taxAmt)

  // SAL-003 / FIN-F8: Validate and bound MFS/Bank fees against account configuration
  const paymentBankIds = payments
    .map(p => p.bankAccountId)
    .filter((id): id is string => Boolean(id))

  if (paymentBankIds.length > 0) {
    const bankAccountRows = await db.bankAccount.findMany({
      where: { id: { in: paymentBankIds } },
      select: { id: true, isMfs: true, transactionChargePct: true },
    })
    const bankMap = new Map(bankAccountRows.map(b => [b.id, b]))

    for (const p of payments) {
      if (p.bankAccountId) {
        const acc = bankMap.get(p.bankAccountId)
        if (acc && acc.isMfs) {
          const feePct = Number(acc.transactionChargePct || 0)
          const expectedFee = round2((p.amount * feePct) / 100)
          if (p.feeAmount > expectedFee + 1.0) {
            return fail(
              `Bank fee of ৳${p.feeAmount} exceeds maximum configured charge for this account (৳${expectedFee}).`
            )
          }
          p.feeAmount = expectedFee
        } else {
          p.feeAmount = 0
        }
      }
    }
  }

  const paymentValidation = validateSalePayments({
    total,
    payments,
    customer,
    walkInCustomerId: settingMap.get('walk_in_customer_id'),
    isQuotation,
  })
  if (!paymentValidation.isValid) {
    return fail(paymentValidation.error!)
  }

  const totalPaid = round2(payments.reduce((s, p) => s + p.amount, 0))
  const creditPaid = round2(
    payments
      .filter(p => p.method === PaymentMethod.CREDIT)
      .reduce((sum, p) => sum + p.amount, 0)
  )
  const cashPaid = round2(
    payments
      .filter(p => p.method === PaymentMethod.CASH)
      .reduce((s, p) => s + p.amount, 0)
  )
  const nonCashPaid = round2(
    payments
      .filter(p => p.method !== PaymentMethod.CASH)
      .reduce((s, p) => s + p.amount, 0)
  )
  const requiredFromCash = Math.max(0, round2(total - nonCashPaid))
  const changeDue = Math.max(0, round2(cashPaid - requiredFromCash))

  // Build cost map from the already-fetched lineProductMap (no extra DB call needed)
  const costMap = new Map(
    lineCalcs.map(l => [
      l.productId,
      Number(lineProductMap.get(l.productId)?.costPrice ?? 0),
    ])
  )

  // Execute in a transaction with proper isolation to prevent race conditions
  let sale: import('@prisma/client').Sale & { lines: import('@prisma/client').SaleLine[]; payments: import('@prisma/client').SalePayment[] }
  try {
    const executeInsideTx = async (tx: PrismaTx) => {
      // ── RE-VALIDATE STOCK INSIDE TRANSACTION with ordered locking to prevent deadlocks ──
      const uniqueProductIds = Array.from(new Set(lineCalcs.map(l => l.productId))).sort()
      if (uniqueProductIds.length > 0) {
        await tx.$executeRaw`SELECT id FROM "Product" WHERE id = ANY(${uniqueProductIds}) FOR UPDATE`
      }

      // Batch serial unit validations across all lines into a single findMany (DB-03)
      const allSerialNumbers = Array.from(
        new Set(lineCalcs.flatMap(l => l.serialNumbers || []).filter(Boolean))
      )
      const serialMap = new Map<
        string,
        {
          id: string
          serialNumber: string
          status: SerialStatus
          productId: string
          costPrice: any
          outletId: string
        }
      >()
      if (allSerialNumbers.length > 0) {
        const foundSerials = await tx.serialUnit.findMany({
          where: { serialNumber: { in: allSerialNumbers } },
          select: {
            id: true,
            serialNumber: true,
            status: true,
            productId: true,
            costPrice: true,
            outletId: true,
          },
        })
        for (const s of foundSerials) {
          serialMap.set(s.serialNumber, s)
        }
      }

      // Fix 5: Aggregate quantities by productId across lines to prevent non-serialized overselling
      const aggregatedStockDemand = aggregateRequiredStockByProduct(lineCalcs)
      const demandedProductIds = Array.from(aggregatedStockDemand.keys())

      if (demandedProductIds.length > 0) {
        const stockLedgerSums = await tx.stockLedger.groupBy({
          by: ['productId'],
          where: {
            productId: { in: demandedProductIds },
            outletId: user.outletId,
          },
          _sum: { quantity: true },
        })

        const availableStockMap = new Map<string, number>()
        for (const s of stockLedgerSums) {
          availableStockMap.set(s.productId, s._sum.quantity ?? 0)
        }

        for (const [pId, reqQty] of aggregatedStockDemand.entries()) {
          const availableStock = availableStockMap.get(pId) ?? 0
          if (availableStock < reqQty) {
            const product = lineProductMap.get(pId)
            throw new Error(
              `INSUFFICIENT_STOCK:"${product?.name ?? pId}"|${availableStock}|${reqQty}`
            )
          }
        }
      }

      // Validate serials using the batched map
      for (const line of lineCalcs) {
        if (line.serialNumbers && line.serialNumbers.length > 0) {
          for (const sn of line.serialNumbers) {
            const serial = serialMap.get(sn)
            if (!serial) throw new Error(`SERIAL_NOT_FOUND:${sn}`)
            if (serial.outletId && user.outletId && serial.outletId !== user.outletId)
              throw new Error(`SERIAL_WRONG_OUTLET:${sn}`)
            if (serial.status !== SerialStatus.IN_STOCK)
              throw new Error(`SERIAL_UNAVAILABLE:${sn}|${serial.status}`)
            if (serial.productId !== line.productId)
              throw new Error(`SERIAL_MISMATCH:${sn}`)
          }
        }
      }

      // Snapshot Customer previousDue and newBalance if customerId provided
      let prevDueVal: number | null = null
      let newBalVal: number | null = null

      if (customerId) {
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
        const customerForSnap = await tx.customer.findUnique({
          where: { id: customerId },
          select: {
            outstandingBalance: true,
            linkedSupplierId: true,
            linkedSupplier: { select: { id: true, outstandingBalance: true } },
          },
        })

        if (customerForSnap?.linkedSupplierId) {
          await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${customerForSnap.linkedSupplierId} FOR UPDATE`
        }

        const custAr = Number(customerForSnap?.outstandingBalance || 0)
        const supAp = customerForSnap?.linkedSupplier ? Number(customerForSnap.linkedSupplier.outstandingBalance || 0) : 0

        if (customerForSnap?.linkedSupplier) {
          prevDueVal = custAr - supAp
        } else {
          prevDueVal = custAr
        }

        const actualPaid = totalPaid - creditPaid
        const saleCreditDue = Math.max(0, total - actualPaid)
        newBalVal = prevDueVal + saleCreditDue
      }

      // Create sale
      const newSale = await tx.sale.create({
        data: {
          saleNumber: await nextDocumentNumber(tx, isQuotation ? 'quotation' : 'sale'),
          idempotencyKey: idempotencyKey?.trim() || undefined,
          customerId: customerId || undefined,
          outletId: user.outletId,
          cashierId: user.id,
          subtotal: baseSubtotal,
          discountAmt: totalDiscountAmt,
          taxAmt,
          total,
          amountPaid: round2(totalPaid - creditPaid),
          changeDue,
          previousDue: prevDueVal,
          newBalance: newBalVal,
          isQuotation,
          createdAt: effectiveSaleDate,
          notes: `${notes ?? ''}${overrideMeta}`.trim() || undefined,
          status: isQuotation ? 'DRAFT' : 'COMPLETED',
        lines: {
          create: lineCalcs.map(l => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.isGift ? 0 : l.unitPrice,
            unitCost: costMap.get(l.productId) ?? 0,
            discountPct: l.isGift ? 0 : l.discountPct,
            discountAmt: l.isGift ? 0 : l.discountAmt,
            total: l.total,
            isGift: l.isGift,
            note: l.note?.trim() || undefined,
          })),
        },
        payments: {
          create: payments.map(p => ({
            method: p.method,
            amount: round2(p.amount),
            bankAccountId: p.bankAccountId,
            reference: p.reference,
            feeAmount: round2(p.feeAmount),
          })),
        },
      },
      include: { lines: true, payments: true },
    })

    // Notes are now persisted directly via Prisma create (note field in lines.create)

    // Build cartItemId → DB line ID map for parent-child linking
    const cartIdToLineId = new Map<string, string>()
    for (let i = 0; i < lineCalcs.length; i++) {
      const cartItemId = lineCalcs[i].cartItemId
      if (cartItemId) cartIdToLineId.set(cartItemId, newSale.lines[i].id)
    }

    // Link upgrade/accessory lines to their parent
    for (let i = 0; i < lineCalcs.length; i++) {
      const parentCartItemId = lineCalcs[i].parentCartItemId
      if (parentCartItemId) {
        const parentLineId = cartIdToLineId.get(parentCartItemId)
        if (parentLineId) {
          await tx.saleLine.update({
            where: { id: newSale.lines[i].id },
            data: { parentLineId },
          })
        }
      }
    }

    if (!isQuotation) {
      // Process Bank Transactions for MFS/Bank payments
      for (const payment of newSale.payments) {
        if (payment.bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
          const netAmount = Number(payment.amount) - Number(payment.feeAmount)
          await tx.bankTransaction.create({
            data: {
              bankAccountId: payment.bankAccountId,
              type: 'DEPOSIT',
              amount: netAmount, // Merchant receives amount minus fee
              description: `Sale ${newSale.saleNumber}`,
              referenceId: newSale.id,
              referenceType: 'Sale',
            },
          })
          await tx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { increment: netAmount } },
          })
        }
      }

      // Process Credit Sale updates to customer outstanding balance and customer ledger

      if (creditPaid > 0) {
        if (!customerId) {
          throw new Error('Customer is required for credit payments')
        }
        await tx.customer.update({
          where: { id: customerId },
          data: {
            outstandingBalance: {
              increment: creditPaid,
            },
          },
        })

        await tx.customerLedger.create({
          data: {
            customerId,
            type: TransactionType.DEBIT,
            amount: creditPaid,
            description: `Credit Sale ${newSale.saleNumber}`,
            referenceId: newSale.id,
            createdAt: effectiveSaleDate,
          },
        })
      }

      // Process Cash Drawer Transactions
      const cashPaymentsTotal = newSale.payments
        .filter(p => p.method === 'CASH')
        .reduce((sum, p) => sum + Number(p.amount), 0)

      if (cashPaymentsTotal > 0) {
        const netCash = cashPaymentsTotal - Number(newSale.changeDue)
        const drawer = await ensureOpenDrawer(tx, user.outletId)
        // Bug 3 fix: fail loudly rather than silently skipping the drawer entry.
        // A cash sale with no open drawer creates an undetectable discrepancy
        // between physical cash and the drawer's expected balance.
        if (!drawer) {
          throw new Error(
            'No open cash drawer found. Please open a cash drawer before processing a cash sale.'
          )
        }
        await tx.drawerTransaction.create({
          data: {
            drawerId: drawer.id,
            type: 'SALE',
            amount: netCash,
            description: `Sale ${newSale.saleNumber}`,
            referenceId: newSale.id,
            referenceType: 'Sale',
            createdAt: effectiveSaleDate,
          },
        })
      }

      // Deduct stock & update serials for each line
      let totalTransactionCogs = 0
      const stockLedgerInserts: Array<{
        productId: string
        outletId: string
        supplierId: string | null
        purchaseOrderId: string | null
        movementType: StockMovementType
        quantity: number
        referenceId: string
        referenceType: string
        notes: string
      }> = []
      const saleLineSerialInserts: Array<{
        saleLineId: string
        serialUnitId: string
      }> = []
      const serialsToMarkSold: string[] = []

      for (let i = 0; i < lineCalcs.length; i++) {
        const line = lineCalcs[i]
        const saleLine = newSale.lines[i]
        let lineExactCogs = 0

        // BOTH Serialized and Non-Serialized consume StockLayers for financial accuracy (FIFO)
        const batches = await consumeStockLayers(tx, {
          productId: line.productId,
          outletId: user.outletId,
          quantityNeeded: line.quantity,
          allowSyntheticLayer: false,
        })

        for (const batch of batches) {
          stockLedgerInserts.push({
            productId: line.productId,
            outletId: user.outletId,
            supplierId: batch.supplierId,
            purchaseOrderId: batch.purchaseOrderId,
            movementType: StockMovementType.SALE_OUT,
            quantity: -batch.quantityConsumed,
            referenceId: newSale.id,
            referenceType: 'Sale',
            notes: `Sale ${newSale.saleNumber} (Layer ${batch.layerId})`,
          })

          if (!line.serialNumbers || line.serialNumbers.length === 0) {
            lineExactCogs += Number(batch.quantityConsumed) * Number(batch.unitCost)
          }
        }

        if (line.serialNumbers && line.serialNumbers.length > 0) {
          for (const sn of line.serialNumbers) {
            serialsToMarkSold.push(sn)
            const serial = serialMap.get(sn)
            if (!serial) {
              throw new Error(`Serial number ${sn} not found`)
            }

            const fallbackCost = costMap.get(line.productId) ?? 0
            lineExactCogs += Number(serial.costPrice ?? fallbackCost)

            saleLineSerialInserts.push({
              saleLineId: saleLine.id,
              serialUnitId: serial.id,
            })
          }
        }

        await tx.saleLine.update({
          where: { id: saleLine.id },
          data: { totalCogs: round2(lineExactCogs) },
        })

        totalTransactionCogs += lineExactCogs
      }

      // Batch insert StockLedger rows (DB-03)
      if (stockLedgerInserts.length > 0) {
        await tx.stockLedger.createMany({
          data: stockLedgerInserts,
        })
      }

      // SAL-005: Batch update serial units status to SOLD and set warrantyExpiry
      if (serialsToMarkSold.length > 0) {
        // Group serial numbers by product warranty months
        const serialWarrantyMap = new Map<number, string[]>()
        for (const line of lineCalcs) {
          if (!line.serialNumbers || line.serialNumbers.length === 0) continue
          const prod = lineProductMap.get(line.productId)
          const wMonths = Number(prod?.warrantyMonths || 0)
          if (!serialWarrantyMap.has(wMonths)) {
            serialWarrantyMap.set(wMonths, [])
          }
          serialWarrantyMap.get(wMonths)!.push(...line.serialNumbers)
        }

        let totalUpdated = 0
        for (const [wMonths, sns] of serialWarrantyMap.entries()) {
          let warrantyExpiry: Date | null = null
          if (wMonths > 0) {
            warrantyExpiry = new Date(effectiveSaleDate)
            warrantyExpiry.setMonth(warrantyExpiry.getMonth() + wMonths)
          }
          const updateResult = await tx.serialUnit.updateMany({
            where: { serialNumber: { in: sns }, status: SerialStatus.IN_STOCK },
            data: {
              status: SerialStatus.SOLD,
              soldAt: effectiveSaleDate,
              warrantyExpiry,
            },
          })
          totalUpdated += updateResult.count
        }

        if (totalUpdated !== serialsToMarkSold.length) {
          throw new Error('One or more serial numbers are no longer in stock or available')
        }
      }

      // Batch insert SaleLineSerial mappings (DB-03)
      if (saleLineSerialInserts.length > 0) {
        await tx.saleLineSerial.createMany({
          data: saleLineSerialInserts,
        })
      }

      // COGS accounting auto-post (TICKET-704)
      const cogsTotal = round2(totalTransactionCogs)

      const cashAccountId = coaMap.get('1100')
      const bankAssetAccountId = coaMap.get('1200')
      const accountsReceivableAccountId = coaMap.get('1300')
      const revenueAccountId = coaMap.get('4100')
      const cogsAccountId = coaMap.get('5000')
      const inventoryAccountId = coaMap.get('1400')
      const taxPayableAccountId = coaMap.get('2300')

      if (
        (cashAccountId || bankAssetAccountId) &&
        revenueAccountId &&
        cogsAccountId &&
        inventoryAccountId
      ) {
        const actualCashPaid = Math.max(
          0,
          round2(
            payments
              .filter(p => p.method === PaymentMethod.CASH)
              .reduce((s, p) => s + p.amount, 0) - changeDue
          )
        )
        const totalFeeAmount = payments.reduce(
          (sum, p) => sum + (p.feeAmount || 0),
          0
        )
        const actualBankPaid = Math.max(
          0,
          round2(
            payments
              .filter(
                p =>
                  p.method !== PaymentMethod.CASH &&
                  p.method !== PaymentMethod.CREDIT
              )
              .reduce((s, p) => s + (p.amount - (p.feeAmount || 0)), 0)
          )
        )

        const expenseAccountId = coaMap.get('5290') // Miscellaneous Expense

        const ledgerEntries = buildSaleJournalEntries({
          saleId: newSale.id,
          saleNumber: newSale.saleNumber,
          effectiveSaleDate,
          afterDiscount,
          cogsTotal,
          taxAmt,
          actualCashPaid,
          actualBankPaid,
          creditPaid,
          totalFeeAmount,
          accounts: {
            revenueAccountId,
            cogsAccountId,
            inventoryAccountId,
            cashAccountId,
            bankAssetAccountId,
            accountsReceivableAccountId,
            taxPayableAccountId,
            expenseAccountId,
          },
        })

        if (totalFeeAmount > 0 && expenseAccountId) {
          // Auto-create an approved Expense record
          await tx.expense.create({
            data: {
              description: `MFS/Bank Transaction Fee (Sale ${newSale.saleNumber})`,
              amount: totalFeeAmount,
              accountId: expenseAccountId,
              status: 'APPROVED',
              outletId: user.outletId,
              createdById: user.id,
              approvedById: user.id,
              expenseDate: effectiveSaleDate,
              createdAt: effectiveSaleDate,
            },
          })
        }

        assertBalancedJournal(ledgerEntries)
        await tx.accountLedgerEntry.createMany({ data: ledgerEntries as any })
      }
    }

    return newSale
  }

  if (tx) {
    sale = await executeInsideTx(tx)
  } else {
    sale = await prisma.$transaction(async innerTx => await executeInsideTx(innerTx), {
      maxWait: 5000,
      timeout: 10000,
    })
  }
  } catch (txError: any) {
    if (txError?.code === 'P2028' || txError?.message?.toLowerCase().includes('timed out')) {
      return fail('Checkout transaction timed out. Please retry checkout.')
    }
    // Handle transaction errors from stock/serial validation
    if (txError?.message?.startsWith('JOURNAL_UNBALANCED:')) {
      return fail(
        'Financial journal entry is unbalanced. Transaction aborted to protect ledger integrity.'
      )
    }
    if (txError?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = txError.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    if (txError?.message?.startsWith('INSUFFICIENT_STOCK:')) {
      const parts = txError.message.split('|')
      const productName = parts[0].replace('INSUFFICIENT_STOCK:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Insufficient stock for ${productName}. Available: ${available}, Required: ${required}. Another transaction may have reserved this stock.`
      )
    }
    if (txError?.message?.startsWith('SERIAL_NOT_FOUND:')) {
      const sn = txError.message.replace('SERIAL_NOT_FOUND:', '')
      return fail(`Serial number ${sn} not found. It may have been sold or removed.`)
    }
    if (txError?.message?.startsWith('SERIAL_WRONG_OUTLET:')) {
      const sn = txError.message.replace('SERIAL_WRONG_OUTLET:', '')
      return fail(`Serial ${sn} belongs to a different outlet.`)
    }
    if (txError?.message?.startsWith('SERIAL_UNAVAILABLE:')) {
      const parts = txError.message.split('|')
      const sn = parts[0].replace('SERIAL_UNAVAILABLE:', '')
      const status = parts[1]
      return fail(`Serial ${sn} is no longer available (status: ${status}). Another transaction may have reserved it.`)
    }
    if (txError?.message?.startsWith('SERIAL_MISMATCH:')) {
      const sn = txError.message.replace('SERIAL_MISMATCH:', '')
      return fail(`Serial ${sn} does not match the selected product.`)
    }
    // ── IDEMPOTENCY RACE: two truly concurrent requests with same key ──
    // PostgreSQL unique constraint violation on idempotencyKey (Prisma code P2002).
    // Both requests passed the pre-check; the loser hits the constraint. Instead
    // of letting this surface as an unhandled 500, re-fetch and return the winner's
    // sale — identical outcome to the sequential-retry path above.
    if (
      txError?.code === 'P2002' &&
      idempotencyKey?.trim() &&
      txError?.meta?.target?.includes?.('idempotencyKey')
    ) {
      const raceSale = await db.sale.findUnique({
        where: { idempotencyKey: idempotencyKey.trim() },
        select: {
          id: true,
          saleNumber: true,
          total: true,
          changeDue: true,
          previousDue: true,
          newBalance: true,
          createdAt: true,
        },
      })
      if (raceSale) {
        return ok({
          id: raceSale.id,
          saleNumber: raceSale.saleNumber,
          total: Number(raceSale.total),
          changeDue: Number(raceSale.changeDue),
          previousDue: raceSale.previousDue ? Number(raceSale.previousDue) : null,
          newBalance: raceSale.newBalance ? Number(raceSale.newBalance) : null,
          saleDate: raceSale.createdAt,
        })
      }
    }
    // Return formatted failure instead of unhandled 500 error
    return fail(txError?.message || 'Checkout transaction failed. Please try again.')
  }

  await logAudit('SALE_CHECKOUT', 'Sale', sale.id, {
    saleNumber: sale.saleNumber,
    total: Number(sale.total),
    isQuotation,
    orderDiscountPct,
    managerAuthorizerId: verifiedApprover ? verifiedApprover.id : null,
    managerAuthorizerName: verifiedApprover ? verifiedApprover.name : null,
  })

  if (verifiedApprover) {
    await logAuditDirect(user.id, 'DISCOUNT_OVERRIDE', 'Sale', sale.id, {
      saleNumber: sale.saleNumber,
      approverId: verifiedApprover.id,
      approverName: verifiedApprover.name,
      approverRole: verifiedApprover.role,
      discountPct: discretionaryCalc.discretionaryDiscountPct,
      discountAmt: discretionaryCalc.discretionaryDiscountAmt,
      maxAllowedDiscount,
    })
  }

  const priceOverriddenLines = effectiveLines.filter(l => {
    const product = lineProductMap.get(l.productId)
    const catPrice = Number(product?.sellingPrice ?? 0)
    return catPrice > 0 && l.unitPrice < catPrice
  })
  if (priceOverriddenLines.length > 0) {
    await logAuditDirect(user.id, 'PRICE_OVERRIDE', 'Sale', sale.id, {
      saleNumber: sale.saleNumber,
      overriddenLines: priceOverriddenLines.map(l => ({
        productId: l.productId,
        catalogPrice: Number(lineProductMap.get(l.productId)?.sellingPrice ?? 0),
        sellingPrice: l.unitPrice,
      })),
      approverId: verifiedApprover ? verifiedApprover.id : null,
      approverName: verifiedApprover ? verifiedApprover.name : null,
    })
  }

  if (!isQuotation && (sendEmailReceipt || sendSmsReceipt) && customerId) {
    db.customer
      .findUnique({
        where: { id: customerId },
        select: { name: true, email: true, phone: true },
      })
      .then(customer => {
        if (!customer) return
        if (sendEmailReceipt && customer.email) {
          queueReceiptEmail({
            to: customer.email,
            subject: `Receipt ${sale.saleNumber}`,
            html: renderReceiptEmailTemplate({
              customerName: customer.name,
              saleNumber: sale.saleNumber,
              total: Number(sale.total),
              paidAt: sale.createdAt.toISOString().slice(0, 19).replace('T', ' '),
            }),
            saleNumber: sale.saleNumber,
          }).catch(err => {
            console.error('[Sales] Failed to send receipt email:', err)
          })
        }

        if (sendSmsReceipt && customer.phone) {
          const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL)?.replace(/\/+$/, '')
          if (appBaseUrl) {
            const receiptToken = generatePdfToken('sale', sale.id)
            sendReceiptSms({
              to: customer.phone,
              body: buildReceiptSmsBody({
                customerName: customer.name,
                saleNumber: sale.saleNumber,
                total: Number(sale.total),
                receiptUrl: `${appBaseUrl}/receipt/${sale.id}?token=${receiptToken}`,
              }),
            }).catch(err => {
              console.error('[Sales] Failed to send receipt SMS:', err)
            })
          } else {
            console.warn('[Sales] SMS receipt skipped: App URL not configured (set NEXT_PUBLIC_APP_URL)')
          }
        }
      })
      .catch(err => {
        console.error('[Sales] Failed to process receipt notification dispatch:', err)
      })
  }

  // Trigger Low-Stock and Sale-Created Notifications
  if (!isQuotation) {
    const soldProductIds = lines.map(line => line.productId)
    checkAndNotifyLowStock(soldProductIds, sale.outletId).catch(err => {
      console.error('[Sales] Failed to check low stock after checkout:', err)
    })

    const fetchCustomerPromise = customerId
      ? prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
      : Promise.resolve(null)

    fetchCustomerPromise
      .then(cust => {
        checkAndNotifySaleCreated({
          saleId: sale.id,
          saleNumber: sale.saleNumber,
          total: Number(sale.total),
          outletId: sale.outletId,
          customerName: cust?.name || 'Walk-in Customer',
          soldByName: user.name || undefined,
          itemCount: lines.reduce((acc, l) => acc + l.quantity, 0),
        }).catch(err => {
          console.error('[Sales] Failed to send sale created notification:', err)
        })
      })
      .catch(err => {
        console.error('[Sales] Error resolving customer for notification:', err)
      })
  }

  safeRevalidateTag(`dashboard-${sale.outletId}`)
  safeRevalidatePath('/', 'page')
  safeRevalidatePath('/sales')
  safeRevalidatePath('/products')
  safeRevalidatePath('/reports/sales')
  safeRevalidatePath('/reports/inventory')
  safeRevalidatePath('/finances/drawer')
  safeRevalidatePath('/orders')
  safeRevalidatePath('/sales-orders/invoices')
  return ok({
    id: sale.id,
    saleNumber: sale.saleNumber,
    total: sale.total,
    changeDue: sale.changeDue,
  })
}

export async function processSaleReturn(
  saleId: string,
  reason: string,
  requestedLines?: Array<{
    saleLineId: string
    quantity: number
    condition?: ReturnCondition | 'RESELLABLE' | 'DEFECTIVE'
  }>,
  serialQualities?: Array<{
    saleLineId: string
    serialUnitId: string
    qualityStatus?: 'IN_STOCK' | 'IN_SERVICE' | 'DEAD'
    condition?: ReturnCondition | 'RESELLABLE' | 'DEFECTIVE'
  }>,
  tx?: PrismaTx | string,
  idempotencyKey?: string,
  options?: {
    refundMethod?: PaymentMethod | 'CASH' | 'BANK_TRANSFER' | 'BANK'
    approverUserId?: string
    approverPin?: string
  }
) {
  const activeTx: PrismaTx | undefined =
    typeof tx === 'object' && tx !== null ? tx : undefined
  const effectiveIdempotencyKey: string | undefined =
    typeof tx === 'string' ? tx : idempotencyKey
  const cleanIdempotencyKey = effectiveIdempotencyKey?.trim() || undefined

  const user = await requireRole(
    UserRole.CASHIER,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  if (!user.outletId) {
    return fail(
      'Processing user must be assigned to an active outlet to process returns'
    )
  }
  const processingOutletId = user.outletId

  // ── IDEMPOTENCY GUARD (Pre-check existing return) ──
  if (cleanIdempotencyKey) {
    const existing = await prisma.saleReturn.findUnique({
      where: { idempotencyKey: cleanIdempotencyKey },
      select: {
        id: true,
        returnNumber: true,
        total: true,
      },
    })
    if (existing) {
      return ok({
        id: existing.id,
        returnNumber: existing.returnNumber,
        total: Number(existing.total),
      })
    }
  }

  const parsedReason = z
    .string({ message: 'Return reason is required' })
    .trim()
    .min(3, 'Return reason must be at least 3 characters')
    .safeParse(reason)
  if (!parsedReason.success) {
    return fail(parsedReason.error.issues[0].message)
  }
  const cleanReason = parsedReason.data

  const parsedRequested = requestedLines
    ? z.array(saleReturnRequestLineSchema).safeParse(requestedLines)
    : null
  if (parsedRequested && !parsedRequested.success) {
    return fail(parsedRequested.error.issues[0].message)
  }

  const parsedSerialQualities = serialQualities
    ? z.array(saleReturnSerialQualitySchema).safeParse(serialQualities)
    : null
  if (parsedSerialQualities && !parsedSerialQualities.success) {
    return fail(parsedSerialQualities.error.issues[0].message)
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: { select: { id: true, outstandingBalance: true } },
      payments: true,
      lines: {
        include: {
          product: { select: { id: true, name: true, requiresSerial: true } },
          serials: {
            include: { serialUnit: { select: { id: true, status: true } } },
          },
        },
      },
    },
  })
  if (!sale) return fail('Sale not found')
  if (user.outletId && sale.outletId !== user.outletId && user.role !== UserRole.SUPER_ADMIN) {
    return fail('You can only process returns for sales in your assigned outlet')
  }
  if (sale.status === 'REFUNDED') return fail('Sale already refunded')

  const previousReturns = await prisma.saleReturnLine.groupBy({
    by: ['saleLineId'],
    _sum: { quantity: true },
    where: {
      return: { saleId },
    },
  })
  const alreadyReturnedByLine = new Map(
    previousReturns.map(r => [r.saleLineId, r._sum.quantity ?? 0])
  )

  const saleLineMap = new Map(sale.lines.map(line => [line.id, line]))
  const normalizedRequested = (parsedRequested?.data ?? [])
    .filter(line => line.quantity > 0)
    .map(line => ({
      saleLineId: line.saleLineId,
      quantity: line.quantity,
      condition: line.condition ?? ReturnCondition.RESELLABLE,
    }))

  const requestedReturnLines =
    normalizedRequested.length > 0
      ? normalizedRequested
      : sale.lines
          .map(line => {
            const alreadyReturned = alreadyReturnedByLine.get(line.id) ?? 0
            const remaining = line.quantity - alreadyReturned
            return {
              saleLineId: line.id,
              quantity: remaining,
              condition: ReturnCondition.RESELLABLE,
            }
          })
          .filter(line => line.quantity > 0)

  if (requestedReturnLines.length === 0) {
    return fail('Nothing left to return for this sale')
  }

  // Validate requested quantities against remaining, including the gift-cap rule:
  // a gift line is only returnable up to the parent line's remaining quantity.
  for (const reqLine of requestedReturnLines) {
    const saleLine = saleLineMap.get(reqLine.saleLineId)
    if (!saleLine) return fail('Invalid sale line in return request')
    const alreadyReturned = alreadyReturnedByLine.get(reqLine.saleLineId) ?? 0
    const remaining = saleLine.quantity - alreadyReturned

    if (saleLine.isGift && saleLine.parentLineId) {
      const parentLine = sale.lines.find(l => l.id === saleLine.parentLineId)
      if (parentLine) {
        const parentReturned = alreadyReturnedByLine.get(parentLine.id) ?? 0
        const parentRemaining = Math.max(
          0,
          parentLine.quantity - parentReturned
        )
        if (reqLine.quantity > parentRemaining) {
          return fail(
            `Gift item return qty exceeds parent item's remaining qty. Max: ${parentRemaining}`
          )
        }
      }
    }

    if (reqLine.quantity > remaining) {
      return fail(
        `Return qty exceeds remaining for ${saleLine.productId}. Remaining: ${remaining}`
      )
    }
  }

  // ── Refund math ──
  // Distribute the order-level discount proportionally across non-gift lines
  // based on net total so the refund matches what the customer actually paid.
  const nonGiftLines = sale.lines.filter(l => !l.isGift)
  const orderDiscountByLine = distributeOrderDiscount(
    Number(sale.discountAmt ?? 0),
    nonGiftLines.map(l => ({
      id: l.id,
      total: Number(l.total ?? 0),
      discountAmt: Number(l.discountAmt ?? 0),
    }))
  )

  const refundLines = requestedReturnLines.map(reqLine => {
    const saleLine = saleLineMap.get(reqLine.saleLineId)!
    const alreadyReturned = alreadyReturnedByLine.get(reqLine.saleLineId) ?? 0
    const lineTotal = Number(saleLine.total ?? 0)
    const distributedDiscount = saleLine.isGift
      ? 0
      : (orderDiscountByLine.get(saleLine.id) ?? 0)
    const trueLineValue = Math.max(0, round2(lineTotal - distributedDiscount))
    const perUnitPaid =
      saleLine.quantity > 0 ? round2(trueLineValue / saleLine.quantity) : 0
    const isFinalReturnForLine =
      alreadyReturned + reqLine.quantity === saleLine.quantity
    const refundAmount = isFinalReturnForLine
      ? Math.max(0, round2(trueLineValue - round2(perUnitPaid * alreadyReturned)))
      : round2(perUnitPaid * reqLine.quantity)

    // COGS reversal uses the ORIGINAL FIFO cost basis captured at sale (totalCogs),
    // never the current catalog cost. Both non-gift and gift lines carried real FIFO cost.
    const cogsPerUnit =
      Number(saleLine.totalCogs ?? 0) / Math.max(1, saleLine.quantity)
    const unitCost =
      cogsPerUnit > 0 ? cogsPerUnit : Number(saleLine.unitCost ?? 0)
    const returnedCogs = round2(unitCost * reqLine.quantity)

    return {
      reqLine,
      saleLine,
      perUnitPaid,
      refundAmount,
      returnedCogs,
    }
  })

  const refundTotal = round2(
    refundLines.reduce((sum, l) => sum + l.refundAmount, 0)
  )
  const returnedCogs = round2(
    refundLines.reduce((sum, l) => sum + l.returnedCogs, 0)
  )

  // Calculate proportional VAT reversed on returned lines
  const afterDiscount = Math.max(
    0,
    Number(sale.subtotal ?? 0) - Number(sale.discountAmt ?? 0)
  )
  const returnedTax =
    afterDiscount > 0 && Number(sale.taxAmt ?? 0) > 0
      ? round2((refundTotal / afterDiscount) * Number(sale.taxAmt ?? 0))
      : 0
  const customerRefundTotal = round2(refundTotal + returnedTax)

  // ── APPROVAL POLICY GATE (Threshold & Return Window Check) ──
  const returnSettings = await getReturnSettings()
  const returnApprovalThreshold = returnSettings.returnApprovalThreshold
  const returnWindowDays = returnSettings.returnWindowDays

  const saleCreatedAt = new Date(sale.createdAt)
  const now = new Date()
  const saleAgeDays = Math.floor(
    (now.getTime() - saleCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
  )
  const exceedsThreshold = customerRefundTotal > returnApprovalThreshold
  const exceedsWindow = saleAgeDays > returnWindowDays

  let approvedById: string | null = null
  let approvedAt: Date | null = null

  // ADMIN and SUPER_ADMIN bypass the threshold/window gate entirely.
  // approvedById and approvedAt remain null — no approver record is stamped.
  const isAdminActor =
    user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN

  if (!isAdminActor && (exceedsThreshold || exceedsWindow)) {
    if (!options?.approverUserId) {
      if (exceedsThreshold && exceedsWindow) {
        return fail(
          `Return exceeds threshold (৳${returnApprovalThreshold.toLocaleString()}) and sale is past ${returnWindowDays}-day return window — manager authorization required`
        )
      } else if (exceedsThreshold) {
        return fail(
          `Return exceeds threshold of ৳${returnApprovalThreshold.toLocaleString()} — manager authorization required`
        )
      } else {
        return fail(
          `Sale was completed ${saleAgeDays} days ago (exceeds ${returnWindowDays}-day window) — manager authorization required`
        )
      }
    }

    const approval = await verifyManagerApproval({
      approverUserId: options.approverUserId,
      pin: options.approverPin || '',
      actorUserId: user.id,
      failureAction: 'RETURN_APPROVAL_FAILED',
      tx: activeTx,
      meta: {
        attemptedByUserName: user.name,
        saleId,
      },
    })
    if (!approval.ok) {
      return fail(approval.error)
    }

    approvedById = approval.approver.id
    approvedAt = new Date()
  } else if (isAdminActor && options?.approverUserId) {
    const approval = await verifyManagerApproval({
      approverUserId: options.approverUserId,
      pin: options.approverPin || '',
      actorUserId: user.id,
      failureAction: 'RETURN_APPROVAL_FAILED',
      tx: activeTx,
      meta: {
        attemptedByUserName: user.name,
        saleId,
      },
    })
    if (!approval.ok) {
      return fail(approval.error)
    }

    approvedById = approval.approver.id
    approvedAt = new Date()
  }

  const executeReturnTx = async (tx: PrismaTx) => {
    // 0. In-transaction Idempotency Check
    if (cleanIdempotencyKey) {
      const existingInTx = await tx.saleReturn.findUnique({
        where: { idempotencyKey: cleanIdempotencyKey },
        select: { id: true, returnNumber: true, total: true },
      })
      if (existingInTx) {
        return { ...existingInTx, isExisting: true }
      }
    }

    // 1. Lock parent Sale row + Customer row to prevent concurrent double-returns
    await tx.$executeRaw`SELECT 1 FROM "Sale" WHERE id = ${saleId} FOR UPDATE`
    if (sale.customerId) {
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${sale.customerId} FOR UPDATE`
    }

    // Re-verify remaining return quantities under lock
    const txPreviousReturns = await tx.saleReturnLine.groupBy({
      by: ['saleLineId'],
      _sum: { quantity: true },
      where: {
        return: { saleId },
      },
    })
    const txAlreadyReturned = new Map(
      txPreviousReturns.map(r => [r.saleLineId, r._sum.quantity ?? 0])
    )

    for (const refundLine of refundLines) {
      const { saleLine, reqLine } = refundLine
      const alreadyReturned = txAlreadyReturned.get(saleLine.id) ?? 0
      const remaining = saleLine.quantity - alreadyReturned
      if (reqLine.quantity > remaining) {
        throw new Error(
          `Return qty exceeds remaining for line. Remaining: ${remaining}`
        )
      }
    }

    const qualityByLine = new Map<
      string,
      Array<{
        serialUnitId: string
        qualityStatus: 'IN_STOCK' | 'IN_SERVICE' | 'DEAD'
      }>
    >()
    for (const q of parsedSerialQualities?.data ?? []) {
      const existing = qualityByLine.get(q.saleLineId) ?? []
      existing.push({
        serialUnitId: q.serialUnitId,
        qualityStatus: q.qualityStatus,
      })
      qualityByLine.set(q.saleLineId, existing)
    }

    // ── Refund settlement split (route to chosen refund method) ──
    const salePaymentRows = sale.payments ?? []
    const creditPaidInSale = salePaymentRows
      .filter(p => p.method === 'CREDIT')
      .reduce((s, p) => s + Number(p.amount), 0)
    const unpaidDueInSale = Math.max(0, Number(sale.total) - Number(sale.amountPaid))
    const totalCreditOnSale = creditPaidInSale + unpaidDueInSale

    // AR portion: money that was on credit (or unpaid) gets reversed from the
    // customer's balance instead of being refunded out of a drawer/bank.
    // Ensure we do not push customer's balance below zero if they already paid (Mismatch 2 fix)
    const currentCustomerBalance = sale.customer?.id
      ? Math.max(0, Number(sale.customer.outstandingBalance || 0))
      : totalCreditOnSale
    const arRefundAmount = round2(Math.min(customerRefundTotal, totalCreditOnSale, currentCustomerBalance))
    const liquidRefund = round2(customerRefundTotal - arRefundAmount)

    let cashRefundAmount = 0
    let bankRefundAmount = 0
    let effectiveRefundMethod: PaymentMethod = PaymentMethod.CASH

    const chosenMethod = options?.refundMethod
      ? (options.refundMethod === 'BANK' ? PaymentMethod.BANK_TRANSFER : options.refundMethod as PaymentMethod)
      : undefined

    if (chosenMethod === PaymentMethod.CASH) {
      cashRefundAmount = liquidRefund
      bankRefundAmount = 0
      effectiveRefundMethod = PaymentMethod.CASH
    } else if (chosenMethod === PaymentMethod.BANK_TRANSFER) {
      bankRefundAmount = liquidRefund
      cashRefundAmount = 0
      effectiveRefundMethod = PaymentMethod.BANK_TRANSFER
    } else {
      // Proportional fallback when not explicitly specified
      const cashPaidInSale = salePaymentRows
        .filter(p => p.method === 'CASH')
        .reduce((s, p) => s + Number(p.amount), 0)
      const netCashFromSale = Math.max(0, cashPaidInSale - Number(sale.changeDue ?? 0))
      const totalLiquidFromSale = Math.max(
        0,
        Number(sale.amountPaid) - totalCreditOnSale
      )
      const cashFraction =
        totalLiquidFromSale > 0
          ? Math.min(1, Math.max(0, netCashFromSale / totalLiquidFromSale))
          : 1
      cashRefundAmount = round2(liquidRefund * cashFraction)
      bankRefundAmount = round2(liquidRefund - cashRefundAmount)
      effectiveRefundMethod = bankRefundAmount > 0 ? PaymentMethod.BANK_TRANSFER : PaymentMethod.CASH
    }

    let resolvedBankAccountId: string | null = null
    if (bankRefundAmount > 0) {
      const primaryBankPayment = salePaymentRows.find(
        p => p.method !== 'CASH' && p.method !== 'CREDIT' && p.bankAccountId
      )
      resolvedBankAccountId = primaryBankPayment?.bankAccountId || null
      if (!resolvedBankAccountId) {
        const activeBank = await tx.bankAccount.findFirst({
          where: {
            isActive: true,
            OR: [
              { outletId: processingOutletId },
              { outletId: sale.outletId },
            ],
          },
          orderBy: { currentBalance: 'desc' },
        })
        if (activeBank) {
          resolvedBankAccountId = activeBank.id
        }
      }

      if (!resolvedBankAccountId) {
        throw new Error(
          'No active bank account configured for this outlet for electronic refund'
        )
      }
    }

    // 2. Create SaleReturn + lines + serial links
    const ret = await tx.saleReturn.create({
      data: {
        idempotencyKey: cleanIdempotencyKey,
        returnNumber: await nextDocumentNumber(tx, 'sale_return'),
        saleId,
        outletId: processingOutletId,
        createdById: user.id,
        approvedById,
        approvedAt,
        reason: cleanReason,
        total: customerRefundTotal,
        refundMethod: effectiveRefundMethod,
        cashRefundAmount,
        bankRefundAmount,
        arRefundAmount,
        bankAccountId: resolvedBankAccountId,
        lines: {
          create: refundLines.map(({ reqLine, saleLine, perUnitPaid, returnedCogs }) => {
            const lineSerials = qualityByLine.get(saleLine.id) ?? []
            const isAllDead = lineSerials.length > 0 && lineSerials.every(s => s.qualityStatus === 'DEAD')
            const effectiveCondition = reqLine.condition ?? (isAllDead ? ReturnCondition.DEFECTIVE : ReturnCondition.RESELLABLE)
            return {
              saleLineId: saleLine.id,
              quantity: reqLine.quantity,
              condition: effectiveCondition,
              unitPrice: saleLine.unitPrice,
              refundUnitPrice: perUnitPaid,
              returnedCogs,
            }
          }),
        },
      },
    })

    let totalDeadCogs = 0

    // 3. Restock, re-enter FIFO layers, and update serials
    for (const refundLine of refundLines) {
      const { reqLine, saleLine, returnedCogs } = refundLine

      await tx.stockLedger.create({
        data: {
          productId: saleLine.productId,
          outletId: sale.outletId,
          movementType: StockMovementType.RETURN_IN,
          quantity: reqLine.quantity,
          referenceId: ret.id,
          referenceType: 'SaleReturn',
          notes: `Return ${ret.returnNumber}`,
        },
      })

      // Non-serialized: route inventory according to condition
      if (!saleLine.product?.requiresSerial) {
        if (reqLine.condition === ReturnCondition.DEFECTIVE) {
          // Defective non-serialized items do NOT re-enter sellable StockLayer!
          // Record immediate write-off ADJUSTMENT_OUT to stock ledger and accumulate to totalDeadCogs.
          totalDeadCogs = round2(totalDeadCogs + returnedCogs)
          await tx.stockLedger.create({
            data: {
              productId: saleLine.productId,
              outletId: sale.outletId,
              movementType: StockMovementType.ADJUSTMENT_OUT,
              quantity: -reqLine.quantity,
              referenceId: ret.id,
              referenceType: 'SaleReturn',
              notes: `Defective unit return write-off (${ret.returnNumber})`,
            },
          })
        } else {
          // RESELLABLE non-serialized items re-enter sellable StockLayer
          const unitCost =
            returnedCogs > 0
              ? returnedCogs / reqLine.quantity
              : Number(saleLine.unitCost ?? 0)
          await tx.stockLayer.create({
            data: {
              productId: saleLine.productId,
              outletId: sale.outletId,
              quantityReceived: reqLine.quantity,
              quantityRemaining: reqLine.quantity,
              unitCost: round2(unitCost),
              receivedAt: new Date(),
            },
          })
        }
      }

      // Serialized: re-fetch and lock the candidate serials to avoid race conditions (Finding #6)
      const candidateSerialUnitIds = saleLine.serials.map(sls => sls.serialUnitId)
      let serialsToUpdate: Array<{
        serialUnitId: string
        qualityStatus: SerialStatus
      }> = []

      if (candidateSerialUnitIds.length > 0) {
        // Lock candidate serials with FOR UPDATE to prevent concurrency race conditions
        await tx.$executeRaw`
          SELECT id FROM "SerialUnit"
          WHERE id = ANY(${candidateSerialUnitIds})
          FOR UPDATE
        `

        // Re-read fresh status under lock
        const lockedSoldSerials = await tx.serialUnit.findMany({
          where: {
            id: { in: candidateSerialUnitIds },
            status: SerialStatus.SOLD,
          },
          select: { id: true, serialNumber: true, status: true },
        })
        const lockedSoldIds = lockedSoldSerials.map(s => s.id)

        if (lockedSoldIds.length < reqLine.quantity) {
          throw new Error(
            `Insufficient unreturned serials available for line (requested: ${reqLine.quantity}, available SOLD: ${lockedSoldIds.length}). Serials may have been returned concurrently.`
          )
        }

        const desiredQualities = (qualityByLine.get(saleLine.id) ?? []).filter(
          q => lockedSoldIds.includes(q.serialUnitId)
        )
        const selectedSerialIds = new Set(
          desiredQualities.map(q => q.serialUnitId)
        )
        const fallbackDefaultStatus: SerialStatus =
          reqLine.condition === ReturnCondition.DEFECTIVE
            ? SerialStatus.DEAD
            : SerialStatus.IN_STOCK

        const fallbackSerials = lockedSoldIds
          .filter(id => !selectedSerialIds.has(id))
          .slice(0, Math.max(0, reqLine.quantity - desiredQualities.length))
          .map(id => ({
            serialUnitId: id,
            qualityStatus: fallbackDefaultStatus,
          }))

        serialsToUpdate = [
          ...desiredQualities.map(d => ({
            serialUnitId: d.serialUnitId,
            qualityStatus: d.qualityStatus as SerialStatus,
          })),
          ...fallbackSerials,
        ].slice(0, reqLine.quantity)
      }

      if (serialsToUpdate.length > 0) {
        const retLine = await tx.saleReturnLine.findFirst({
          where: { returnId: ret.id, saleLineId: saleLine.id },
          select: { id: true },
        })
        if (retLine) {
          await tx.saleReturnLineSerial.createMany({
            data: serialsToUpdate.map(s => ({
              returnId: ret.id,
              returnLineId: retLine.id,
              serialUnitId: s.serialUnitId,
              qualityStatus: s.qualityStatus,
            })),
          })
        }

        for (const serialUpdate of serialsToUpdate) {
          const updated = await tx.serialUnit.updateMany({
            where: {
              id: serialUpdate.serialUnitId,
              status: SerialStatus.SOLD,
            },
            data: {
              status: serialUpdate.qualityStatus,
              returnedAt: new Date(),
              ...(serialUpdate.qualityStatus === SerialStatus.IN_STOCK ? { soldAt: null } : {}),
            },
          })
          if (updated.count === 0) {
            throw new Error(`Serial unit ${serialUpdate.serialUnitId} is no longer SOLD`)
          }

          // RET-003: Auto-create RMA ServiceJob when returned serial is routed to IN_SERVICE
          if (serialUpdate.qualityStatus === SerialStatus.IN_SERVICE) {
            await tx.serviceJob.create({
              data: {
                jobNumber: await nextDocumentNumber(tx, 'service_job'),
                customerId: sale.customerId,
                outletId: sale.outletId,
                device: saleLine.product?.name || 'Returned Device',
                issue: `RMA ticket auto-created from Sale Return ${ret.returnNumber}: ${cleanReason}`,
                serialUnitId: serialUpdate.serialUnitId,
                isWarranty: true,
                status: ServiceJobStatus.RECEIVED,
                receivedAt: new Date(),
              },
            })
          }
        }

        // Serialized products returned as IN_STOCK MUST re-enter FIFO StockLayer
        // so they can be sold again without "Insufficient FIFO layer stock" errors!
        const inStockCount = serialsToUpdate.filter(
          s => s.qualityStatus === 'IN_STOCK'
        ).length
        if (inStockCount > 0) {
          const unitCost =
            returnedCogs > 0
              ? returnedCogs / reqLine.quantity
              : Number(saleLine.unitCost ?? 0)
          await tx.stockLayer.create({
            data: {
              productId: saleLine.productId,
              outletId: sale.outletId,
              quantityReceived: inStockCount,
              quantityRemaining: inStockCount,
              unitCost: round2(unitCost),
              receivedAt: new Date(),
            },
          })
        }

        // Bug 3 fix: Dead/Scrap units must not falsely inflate physical sellable stock in StockLedger.
        // Record an immediate write-off ADJUSTMENT_OUT for dead units.
        const deadCount = serialsToUpdate.filter(
          s => s.qualityStatus === 'DEAD'
        ).length
        if (deadCount > 0) {
          const unitCost =
            returnedCogs > 0
              ? returnedCogs / reqLine.quantity
              : Number(saleLine.unitCost ?? 0)
          totalDeadCogs = round2(totalDeadCogs + unitCost * deadCount)
          await tx.stockLedger.create({
            data: {
              productId: saleLine.productId,
              outletId: sale.outletId,
              movementType: StockMovementType.ADJUSTMENT_OUT,
              quantity: -deadCount,
              referenceId: ret.id,
              referenceType: 'SaleReturn',
              notes: `Dead/Scrap unit return write-off (${ret.returnNumber})`,
            },
          })
        }

        // BUG-10 fix: IN_SERVICE units physically leave sellable inventory for repair/service.
        // Record an immediate write-off ADJUSTMENT_OUT to prevent stock count inflation.
        const inServiceCount = serialsToUpdate.filter(
          s => s.qualityStatus === 'IN_SERVICE'
        ).length
        if (inServiceCount > 0) {
          await tx.stockLedger.create({
            data: {
              productId: saleLine.productId,
              outletId: sale.outletId,
              movementType: StockMovementType.ADJUSTMENT_OUT,
              quantity: -inServiceCount,
              referenceId: ret.id,
              referenceType: 'SaleReturn',
              notes: `IN_SERVICE unit return write-off (${ret.returnNumber})`,
            },
          })
        }
      }
    }

    const deadCogs = round2(Math.min(returnedCogs, totalDeadCogs))
    const sellableCogs = round2(returnedCogs - deadCogs)

    // 4. Reverse the general ledger:
    const [cashAcc, bankAcc, salesReturnAcc, cogsAcc, inventoryAcc, arAcc, taxPayableAcc, taxPayableFallbackAcc, scrapLossAcc] =
      await Promise.all([
        tx.chartOfAccount.findUnique({ where: { code: '1100' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '1200' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '4110' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '5000' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '1400' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '1300' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '2300' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '2200' }, select: { id: true } }),
        tx.chartOfAccount.findUnique({ where: { code: '5310' }, select: { id: true } }),
      ])
    const effectiveTaxPayableAcc = taxPayableAcc ?? taxPayableFallbackAcc

    const ledgerEntries: import('@prisma/client').Prisma.AccountLedgerEntryCreateManyInput[] =
      []

    // Dr Sales Returns & Allowances (4110) — contra-revenue debit
    if (refundTotal > 0) {
      if (!salesReturnAcc) {
        throw new Error('Sales Returns & Allowances account (code 4110) not found in Chart of Accounts')
      }
      ledgerEntries.push({
        accountId: salesReturnAcc.id,
        type: TransactionType.DEBIT,
        amount: refundTotal,
        description: `Return ${ret.returnNumber} — Sales Returns & Allowances`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })
    }

    // Dr Tax Payable (2300 / 2200) — reverse VAT collected on the returned portion
    if (effectiveTaxPayableAcc && returnedTax > 0) {
      ledgerEntries.push({
        accountId: effectiveTaxPayableAcc.id,
        type: TransactionType.DEBIT,
        amount: returnedTax,
        description: `Return ${ret.returnNumber} — VAT reversal`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })
    }

    // Cr AR (1300) — reverse the credit portion
    if (arAcc && arRefundAmount > 0) {
      ledgerEntries.push({
        accountId: arAcc.id,
        type: TransactionType.CREDIT,
        amount: arRefundAmount,
        description: `Return ${ret.returnNumber} — Accounts Receivable credit`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })

      if (sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { outstandingBalance: { decrement: arRefundAmount } },
        })
        await tx.customerLedger.create({
          data: {
            customerId: sale.customerId,
            type: TransactionType.CREDIT,
            amount: arRefundAmount,
            description: `Return ${ret.returnNumber} — Credit refund`,
            referenceId: ret.id,
            createdAt: ret.createdAt,
          },
        })
      }
    }

    // Cr Cash (1100) / Cr Bank (1200) — reverse the liquid portion
    if (cashRefundAmount > 0 && cashAcc) {
      ledgerEntries.push({
        accountId: cashAcc.id,
        type: TransactionType.CREDIT,
        amount: cashRefundAmount,
        description: `Return ${ret.returnNumber} — Cash refund`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })
    }
    if (bankRefundAmount > 0 && bankAcc) {
      ledgerEntries.push({
        accountId: bankAcc.id,
        type: TransactionType.CREDIT,
        amount: bankRefundAmount,
        description: `Return ${ret.returnNumber} — Bank refund`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })
    }

    // COGS reversal:
    // Sellable condition items: Dr Inventory (1400)
    // Dead / scrapped items: Dr Inventory Scrap & Loss (5310)
    // Total COGS credited: Cr COGS (5000)
    if (returnedCogs > 0) {
      if (!cogsAcc) {
        throw new Error('Cost of Goods Sold account (code 5000) not found in Chart of Accounts')
      }
      if (sellableCogs > 0) {
        if (!inventoryAcc) {
          throw new Error('Inventory account (code 1400) not found in Chart of Accounts')
        }
        ledgerEntries.push({
          accountId: inventoryAcc.id,
          type: TransactionType.DEBIT,
          amount: sellableCogs,
          description: `Return ${ret.returnNumber} — Inventory back`,
          referenceId: ret.id,
          referenceType: 'SaleReturn',
          saleId,
        })
      }
      if (deadCogs > 0) {
        if (!scrapLossAcc) {
          throw new Error('Inventory Scrap & Loss account (code 5310) not found in Chart of Accounts')
        }
        ledgerEntries.push({
          accountId: scrapLossAcc.id,
          type: TransactionType.DEBIT,
          amount: deadCogs,
          description: `Return ${ret.returnNumber} — Scrapped Item Loss`,
          referenceId: ret.id,
          referenceType: 'SaleReturn',
          saleId,
        })
      }
      ledgerEntries.push({
        accountId: cogsAcc.id,
        type: TransactionType.CREDIT,
        amount: returnedCogs,
        description: `Return ${ret.returnNumber} — COGS reversal`,
        referenceId: ret.id,
        referenceType: 'SaleReturn',
        saleId,
      })
    }

    if (ledgerEntries.length > 0) {
      ledgerEntries.forEach(e => {
        e.createdAt = ret.createdAt
      })
      assertBalancedJournal(ledgerEntries, 0.01)
      await tx.accountLedgerEntry.createMany({ data: ledgerEntries })
    }

    // 5. Update sale status
    const allReturnsAfter = await tx.saleReturnLine.groupBy({
      by: ['saleLineId'],
      _sum: { quantity: true },
      where: { return: { saleId } },
    })
    const returnedMap = new Map(
      allReturnsAfter.map(r => [r.saleLineId, r._sum.quantity ?? 0])
    )
    const fullyReturned = sale.lines.every(
      line => (returnedMap.get(line.id) ?? 0) >= line.quantity
    )

    await tx.sale.update({
      where: { id: saleId },
      data: { status: fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    })

    // 6. Execute the actual refund out of drawer / bank accounts.
    //    Cash requires an OPEN drawer — fail loudly rather than silently skip.
    if (cashRefundAmount > 0) {
      const drawer = await ensureOpenDrawer(tx, processingOutletId)
      if (!drawer) {
        throw new Error(
          `No open cash drawer found for cash refund at processing outlet (${processingOutletId}). Open a drawer first.`
        )
      }
      await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${drawer.id} FOR UPDATE`
      const stats = await tx.drawerTransaction.aggregate({
        where: { drawerId: drawer.id },
        _sum: { amount: true },
      })
      const cashBalance = Number(stats._sum.amount || 0)
      if (cashBalance < cashRefundAmount) {
        throw new Error(
          `Insufficient cash in drawer for refund. Available: ${cashBalance.toLocaleString()}, Required: ${cashRefundAmount.toLocaleString()}`
        )
      }
      await tx.drawerTransaction.create({
        data: {
          drawerId: drawer.id,
          type: 'REFUND',
          amount: -cashRefundAmount,
          description: `Refund for Sale Return ${ret.returnNumber}`,
          referenceId: ret.id,
          referenceType: 'SaleReturn',
          createdAt: ret.createdAt,
        },
      })
    }

    // Bank refund: reverse the original bank/MFS payments proportionally.
    if (bankRefundAmount > 0) {
      let targetBankPayments: Array<{ bankAccountId: string; amount: number }> = []
      if (chosenMethod === PaymentMethod.BANK_TRANSFER && resolvedBankAccountId) {
        targetBankPayments = [{
          bankAccountId: resolvedBankAccountId,
          amount: bankRefundAmount,
        }]
      } else {
        const bankPayments = salePaymentRows.filter(
          p => p.method !== 'CASH' && p.method !== 'CREDIT' && p.bankAccountId
        )
        if (bankPayments.length > 0) {
          targetBankPayments = bankPayments.map(p => ({
            bankAccountId: p.bankAccountId!,
            amount: Number(p.amount),
          }))
        } else if (resolvedBankAccountId) {
          targetBankPayments = [{
            bankAccountId: resolvedBankAccountId,
            amount: bankRefundAmount,
          }]
        }
      }

      if (targetBankPayments.length === 0) {
        throw new Error(
          'No active bank account found for outlet to process bank refund.'
        )
      }

      const bankTotal = targetBankPayments.reduce(
        (s, p) => s + Number(p.amount),
        0
      )
      let remaining = bankRefundAmount
      for (let bi = 0; bi < targetBankPayments.length; bi++) {
        const payment = targetBankPayments[bi]
        if (remaining <= 0) break
        const isLast = bi === targetBankPayments.length - 1
        const proportion =
          bankTotal > 0 ? Number(payment.amount) / bankTotal : 1 / Math.max(1, targetBankPayments.length)
        const deductAmount = isLast
          ? remaining
          : round2(Math.min(remaining, bankRefundAmount * proportion))
        if (deductAmount <= 0) continue

        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId!} FOR UPDATE`
        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: payment.bankAccountId! },
          select: { currentBalance: true },
        })
        if (!bankAccount) throw new Error('Bank account not found')
        if (Number(bankAccount.currentBalance) < deductAmount) {
          throw new Error(
            `Insufficient funds in bank account: available ৳${Number(bankAccount.currentBalance).toLocaleString()}, required ৳${deductAmount.toLocaleString()}`
          )
        }

        await tx.bankAccount.update({
          where: { id: payment.bankAccountId! },
          data: { currentBalance: { decrement: deductAmount } },
        })
        await tx.bankTransaction.create({
          data: {
            bankAccountId: payment.bankAccountId!,
            type: 'WITHDRAWAL',
            amount: deductAmount,
            description: `Refund — Return ${ret.returnNumber}`,
            referenceId: ret.id,
            referenceType: 'SaleReturn',
            createdAt: ret.createdAt,
          },
        })
        remaining = round2(remaining - deductAmount)
      }
    }

    return ret
  }

  let saleReturn: any
  try {
    if (activeTx) {
      saleReturn = await executeReturnTx(activeTx)
    } else {
      saleReturn = await prisma.$transaction(
        async innerTx => await executeReturnTx(innerTx),
        {
          maxWait: 15000,
          timeout: 60000,
        }
      )
    }
  } catch (err: any) {
    if (
      cleanIdempotencyKey &&
      (err?.code === 'P2002' ||
        err?.message?.includes('Unique constraint failed') ||
        err?.message?.includes('idempotencyKey'))
    ) {
      const existing = await prisma.saleReturn.findUnique({
        where: { idempotencyKey: cleanIdempotencyKey },
        select: {
          id: true,
          returnNumber: true,
          total: true,
        },
      })
      if (existing) {
        return ok({
          id: existing.id,
          returnNumber: existing.returnNumber,
          total: Number(existing.total),
        })
      }
    }
    throw err
  }

  if (!saleReturn.isExisting) {
    safeRevalidatePath('/sales')
    safeRevalidatePath('/sales-orders/returns')
    safeRevalidatePath(`/orders/${saleId}`)

    await logAudit('SALE_RETURN', 'Sale', saleId, {
      returnId: saleReturn.id,
      returnNumber: saleReturn.returnNumber,
    })
  }

  return ok({
    id: saleReturn.id,
    returnNumber: saleReturn.returnNumber,
    total: Number(saleReturn.total),
  })
}

export async function searchSalesForReturn(term: string) {
  const user = await requireAuth()
  const query = term.trim()
  if (!query) return ok([] as Array<Record<string, unknown>>)

  const sales = await prisma.sale.findMany({
    where: {
      outletId: user.outletId,
      isQuotation: false,
      status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
      OR: [
        { saleNumber: { contains: query, mode: 'insensitive' } },
        {
          customer: {
            is: {
              name: { contains: query, mode: 'insensitive' },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      saleNumber: true,
      status: true,
      createdAt: true,
      total: true,
      customer: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return ok(
    sales.map(s => ({
      ...s,
      total: Number(s.total),
    }))
  )
}

export async function getSaleReturnPreview(saleId: string) {
  const user = await requireAuth()

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: { select: { name: true, phone: true } },
      payments: { select: { method: true, amount: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              productCode: true,
              sku: true,
              condition: true,
              requiresSerial: true,
            },
          },
          serials: {
            include: {
              serialUnit: {
                select: {
                  id: true,
                  serialNumber: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!sale) return fail('Sale not found')
  validateOutletAccess(user, sale.outletId)

  const groupedReturned = await prisma.saleReturnLine.groupBy({
    by: ['saleLineId'],
    _sum: { quantity: true },
    where: {
      return: { saleId },
    },
  })
  const returnedMap = new Map(
    groupedReturned.map(line => [line.saleLineId, line._sum.quantity ?? 0])
  )

  const nonGiftLines = sale.lines.filter(l => !l.isGift)
  const orderDiscountByLine = distributeOrderDiscount(
    Number(sale.discountAmt ?? 0),
    nonGiftLines.map(l => ({
      id: l.id,
      total: Number(l.total ?? 0),
      discountAmt: Number(l.discountAmt ?? 0),
    }))
  )

  const lines = sale.lines.map(line => {
    const returnedQty = returnedMap.get(line.id) ?? 0
    // Gift items are recovered proportionally to their parent line: a gift is
    // returnable only up to the parent's remaining (un-returned) quantity.
    const parentLine = line.parentLineId
      ? sale.lines.find(l => l.id === line.parentLineId)
      : null
    const parentRemaining = parentLine
      ? Math.max(0, parentLine.quantity - (returnedMap.get(parentLine.id) ?? 0))
      : Infinity
    const maxReturnableQty = line.isGift
      ? Math.max(0, Math.min(line.quantity - returnedQty, parentRemaining))
      : Math.max(0, line.quantity - returnedQty)

    // Match the server refund math: distribute order-level discount across
    // non-gift lines, so the preview matches the actual refund.
    const lineTotal = Number(line.total ?? 0)
    const distributedDiscount = line.isGift
      ? 0
      : (orderDiscountByLine.get(line.id) ?? 0)
    const trueLineValue = Math.max(0, round2(lineTotal - distributedDiscount))
    const perUnitPaid =
      line.quantity > 0 ? trueLineValue / line.quantity : 0

    const soldSerials = line.serials
      .filter(sls => sls.serialUnit.status === SerialStatus.SOLD)
      .map(sls => ({
        id: sls.serialUnit.id,
        serialNumber: sls.serialUnit.serialNumber,
      }))

    return {
      id: line.id,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      refundUnitPrice: round2(perUnitPaid),
      returnedQty,
      maxReturnableQty,
      lineTotal: Number(line.total ?? 0),
      product: line.product,
      soldSerials,
      isGift: line.isGift,
      parentLineId: line.parentLineId,
    }
  })

  // Refund split preview (matches processSaleReturn)
  const returnableRevenue = lines.reduce(
    (sum, line) => sum + line.maxReturnableQty * line.refundUnitPrice,
    0
  )
  const afterDiscount = Math.max(
    0,
    Number(sale.subtotal ?? 0) - Number(sale.discountAmt ?? 0)
  )
  const returnableTax =
    afterDiscount > 0 && Number(sale.taxAmt ?? 0) > 0
      ? round2((returnableRevenue / afterDiscount) * Number(sale.taxAmt ?? 0))
      : 0
  const totalReturnable = round2(returnableRevenue + returnableTax)

  const creditPaidInSale = (sale.payments ?? [])
    .filter(p => p.method === 'CREDIT')
    .reduce((s, p) => s + Number(p.amount), 0)
  const unpaidDueInSale = Math.max(0, Number(sale.total) - Number(sale.amountPaid))
  const totalCreditOnSale = creditPaidInSale + unpaidDueInSale
  const arRefundable = round2(Math.min(totalReturnable, totalCreditOnSale))
  const liquidRefundable = round2(totalReturnable - arRefundable)

  const cashPaidInSale = (sale.payments ?? [])
    .filter(p => p.method === 'CASH')
    .reduce((s, p) => s + Number(p.amount), 0)
  const netCashFromSale = Math.max(
    0,
    cashPaidInSale - Number(sale.changeDue ?? 0)
  )
  const totalLiquidFromSale = Math.max(
    0,
    Number(sale.amountPaid) - totalCreditOnSale
  )
  const cashFraction =
    totalLiquidFromSale > 0
      ? Math.min(1, Math.max(0, netCashFromSale / totalLiquidFromSale))
      : 1
  const cashRefundable = round2(liquidRefundable * cashFraction)
  const bankRefundable = round2(liquidRefundable - cashRefundable)

  const returnSettings = await getReturnSettings()
  const returnApprovalThreshold = returnSettings.returnApprovalThreshold
  const returnWindowDays = returnSettings.returnWindowDays

  const saleCreatedAt = new Date(sale.createdAt)
  const now = new Date()
  const saleAgeDays = Math.floor(
    (now.getTime() - saleCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
  )
  const isWindowExpired = saleAgeDays > returnWindowDays

  const eligibleManagers = prisma.user?.findMany
    ? await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] },
        },
        select: {
          id: true,
          name: true,
          role: true,
        },
        orderBy: { name: 'asc' },
      })
    : []

  return ok({
    sale: {
      id: sale.id,
      saleNumber: sale.saleNumber,
      createdAt: sale.createdAt,
      status: sale.status,
      total: Number(sale.total),
      amountPaid: Number(sale.amountPaid),
      customer: sale.customer,
      payments: (sale.payments ?? []).map(p => ({ method: p.method, amount: Number(p.amount) })),
    },
    lines,
    totalReturnable: round2(totalReturnable),
    refundBreakdown: {
      ar: arRefundable,
      cash: cashRefundable,
      bank: bankRefundable,
    },
    returnApprovalThreshold,
    returnWindowDays,
    saleAgeDays,
    isWindowExpired,
    eligibleManagers,
  })
}

export async function getSaleReturnById(id: string) {
  const user = await requireAuth()

  const ret = await prisma.saleReturn.findUnique({
    where: { id },
    include: {
      outlet: true,
      createdBy: { select: { id: true, name: true, email: true } },
      bankAccount: true,
      sale: {
        include: {
          customer: { select: { name: true, phone: true, email: true, address: true } },
          outlet: true,
          cashier: { select: { name: true } },
        },
      },
      lines: {
        include: {
          saleLine: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  productCode: true,
                  sku: true,
                  condition: true,
                  processor: { select: { name: true } },
                  ram: { select: { name: true } },
                  storage: { select: { name: true } },
                  display: true,
                  requiresSerial: true,
                },
              },
            },
          },
          serials: {
            include: { serialUnit: true },
          },
        },
      },
    },
  })

  if (!ret) return null

  const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'
  const targetOutletId = ret.outletId || ret.sale?.outletId
  if (
    targetOutletId &&
    !isSuperAdmin &&
    user.outletId &&
    targetOutletId !== user.outletId
  ) {
    return null
  }

  return ret
}

export async function getSalesReturns(outletId?: string) {
  const user = await requireAuth()
  const targetOutletId = outletId || user.outletId
  if (targetOutletId) {
    validateOutletAccess(user, targetOutletId)
  }

  const returns = await prisma.saleReturn.findMany({
    where: targetOutletId ? { sale: { outletId: targetOutletId } } : undefined,
    include: {
      sale: {
        include: {
          customer: { select: { name: true, phone: true } },
          cashier: { select: { name: true } },
        },
      },
      createdBy: { select: { name: true } },
      lines: {
        include: {
          saleLine: {
            include: {
              product: { select: { id: true, name: true, sku: true, productCode: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return returns.map(ret => ({
    id: ret.id,
    returnNo: ret.returnNumber,
    customer: ret.sale?.customer?.name ?? 'Walk-in Customer',
    customerPhone: ret.sale?.customer?.phone ?? null,
    invoiceNo: ret.sale?.saleNumber ?? 'N/A',
    saleId: ret.saleId,
    amount: Number(ret.total),
    cashRefundAmount: Number(ret.cashRefundAmount ?? 0),
    bankRefundAmount: Number(ret.bankRefundAmount ?? 0),
    arRefundAmount: Number(ret.arRefundAmount ?? 0),
    reason: ret.reason ?? '—',
    date: ret.createdAt ? new Date(ret.createdAt).toLocaleDateString('en-GB') : '—',
    createdAt: ret.createdAt,
    itemCount: ret.lines.reduce((s, l) => s + l.quantity, 0),
    createdByName: ret.createdBy?.name ?? null,
    lines: ret.lines.map(l => ({
      id: l.id,
      productName: l.saleLine?.product?.name ?? 'Unknown',
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
    })),
  }))
}

function buildSaleFilterWhere(
  outletId: string,
  filters?: {
    from?: Date | string
    to?: Date | string
    customer?: string
    status?: string
    search?: string
    paymentMethod?: string
  }
) {
  let createdAtCondition: { gte?: Date; lte?: Date } | undefined
  if (filters?.from || filters?.to) {
    if (typeof filters.from === 'string' || typeof filters.to === 'string') {
      const fromStr =
        typeof filters.from === 'string'
          ? filters.from
          : filters.from
            ? toLocalISODate(filters.from)
            : undefined
      const toStr =
        typeof filters.to === 'string'
          ? filters.to
          : filters.to
            ? toLocalISODate(filters.to)
            : undefined
      const boundaries = getLocalDateRangeBoundaries(fromStr, toStr)
      createdAtCondition = {
        gte: fromStr ? boundaries.start : undefined,
        lte: toStr ? boundaries.end : undefined,
      }
    } else {
      createdAtCondition = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      }
    }
  }

  const trimmedSearch = filters?.search?.trim()
  const searchLower = trimmedSearch ? trimmedSearch.toLowerCase() : ''
  const isWalkIn = searchLower.includes('walk')

  const searchConditions = trimmedSearch
    ? [
        { saleNumber: { contains: trimmedSearch, mode: 'insensitive' as const } },
        {
          customer: {
            is: {
              name: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
          },
        },
        {
          customer: {
            is: {
              phone: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
          },
        },
        {
          customer: {
            is: {
              email: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
          },
        },
        ...(isWalkIn ? [{ customerId: null }] : []),
        {
          cashier: {
            is: {
              name: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
          },
        },
        {
          payments: {
            some: {
              reference: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
          },
        },
        {
          lines: {
            some: {
              OR: [
                {
                  product: {
                    is: {
                      OR: [
                        { name: { contains: trimmedSearch, mode: 'insensitive' as const } },
                        { productCode: { contains: trimmedSearch, mode: 'insensitive' as const } },
                        { sku: { contains: trimmedSearch, mode: 'insensitive' as const } },
                      ],
                    },
                  },
                },
                {
                  serials: {
                    some: {
                      serialUnit: {
                        is: {
                          serialNumber: { contains: trimmedSearch, mode: 'insensitive' as const },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ]
    : undefined

  return {
    outletId,
    isQuotation: false,
    ...(createdAtCondition ? { createdAt: createdAtCondition } : {}),
    ...(filters?.customer
      ? {
          customer: {
            is: {
              name: { contains: filters.customer, mode: 'insensitive' as const },
            },
          },
        }
      : {}),
    ...(searchConditions ? { OR: searchConditions } : {}),
    ...(filters?.status && filters.status !== 'ALL'
      ? {
          status: filters.status as
            | 'DRAFT'
            | 'COMPLETED'
            | 'REFUNDED'
            | 'PARTIALLY_REFUNDED',
        }
      : {}),
    ...(filters?.paymentMethod && filters.paymentMethod !== 'ALL'
      ? {
          payments: {
            some: {
              method: filters.paymentMethod as PaymentMethod,
            },
          },
        }
      : {}),
  }
}

export async function getSales(filters?: {
  from?: Date | string
  to?: Date | string
  customer?: string
  status?: string
  search?: string
  paymentMethod?: string
  page?: number
  limit?: number
}) {
  const user = await requireAuth()
  const page = filters?.page && filters.page > 0 ? filters.page : undefined
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50
  const skip = page ? (page - 1) * limit : undefined
  const take = filters?.page || filters?.limit ? limit : 200
  const where = buildSaleFilterWhere(user.outletId, filters)

  return prisma.sale.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      cashier: { select: { name: true } },
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
    ...(skip !== undefined ? { skip } : {}),
    take,
  })
}

export async function getSalesPaginated(filters?: {
  from?: Date | string
  to?: Date | string
  customer?: string
  status?: string
  search?: string
  paymentMethod?: string
  page?: number
  limit?: number
}) {
  const user = await requireAuth()
  const page = Math.max(1, filters?.page ?? 1)
  const limit = Math.max(1, filters?.limit ?? 20)
  const skip = (page - 1) * limit
  const where = buildSaleFilterWhere(user.outletId, filters)

  const [sales, total, aggregates] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        cashier: { select: { name: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({
      where,
      _sum: {
        total: true,
        amountPaid: true,
      },
    }),
  ])

  return {
    sales,
    total,
    totalPages: Math.ceil(total / limit),
    page,
    limit,
    summary: {
      totalAmount: Number(aggregates._sum.total ?? 0),
      totalPaid: Number(aggregates._sum.amountPaid ?? 0),
      totalDue: Math.max(
        0,
        Number(aggregates._sum.total ?? 0) - Number(aggregates._sum.amountPaid ?? 0)
      ),
    },
  }
}

export async function getSaleById(id: string) {
  const user = await requireAuth()

  const sale = await prisma.sale.findFirst({
    where: {
      id,
      outletId: user.outletId,
      isQuotation: false,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address: true,
          linkedSupplierId: true,
        },
      },
      outlet: {
        select: {
          id: true,
          name: true,
          slogan: true,
          address: true,
          phone: true,
          email: true,
        },
      },
      cashier: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              productCode: true,
              sku: true,
              condition: true,
              processor: { select: { name: true } },
              processorGen: { select: { name: true } },
              ram: { select: { name: true } },
              storage: { select: { name: true } },
              display: true,
              requiresSerial: true,
            },
          },
          serials: {
            include: {
              serialUnit: {
                select: {
                  id: true,
                  serialNumber: true,
                  status: true,
                  sellingPrice: true,
                  costPrice: true,
                },
              },
            },
          },
        },
      },
      payments: true,
      returns: {
        include: {
          createdBy: { select: { name: true } },
          lines: {
            include: {
              saleLine: {
                include: {
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!sale) return fail('Sale not found')

  const mappedSale = {
    ...sale,
    lines: sale.lines.map(line => ({
      ...line,
      note: line.note ?? null,
      product: {
        ...line.product,
        processor: line.product.processor?.name ?? null,
        processorGen: line.product.processorGen?.name ?? null,
        ram: line.product.ram?.name ?? null,
        storage: line.product.storage?.name ?? null,
      },
    })),
  }

  return ok(mappedSale)
}

export async function resendSaleReceipt(
  saleId: string,
  channel: 'email' | 'sms' | 'whatsapp'
) {
  const user = await requireAuth()

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: {
        select: { name: true, email: true, phone: true },
      },
    },
  })

  if (!sale) return fail('Sale not found')
  validateOutletAccess(user, sale.outletId)
  if (!sale.customer) return fail('Sale has no customer contact')

  const customerName = sale.customer.name ?? 'Customer'
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL)?.replace(/\/+$/, '')
  if (!appBaseUrl && channel === 'sms') {
    return fail('App URL not configured (set NEXT_PUBLIC_APP_URL)')
  }
  const receiptToken = generatePdfToken('sale', sale.id)
  const receiptUrl = appBaseUrl ? `${appBaseUrl}/receipt/${sale.id}?token=${receiptToken}` : ''

  if (channel === 'email') {
    if (!sale.customer.email) return fail('Customer has no email address')
    const sent = await queueReceiptEmail({
      to: sale.customer.email,
      subject: `Receipt ${sale.saleNumber}`,
      html: renderReceiptEmailTemplate({
        customerName,
        saleNumber: sale.saleNumber,
        total: Number(sale.total),
        paidAt: sale.createdAt.toISOString().slice(0, 19).replace('T', ' '),
      }),
      saleNumber: sale.saleNumber,
      text: buildReceiptSmsBody({
        customerName,
        saleNumber: sale.saleNumber,
        total: Number(sale.total),
        receiptUrl,
      }),
    })

    if (!sent.queued) return fail(sent.reason ?? 'Failed to send email')
  }

  if (channel === 'sms') {
    if (!sale.customer.phone) return fail('Customer has no phone number')
    const sent = await sendReceiptSms({
      to: sale.customer.phone,
      body: buildReceiptSmsBody({
        customerName,
        saleNumber: sale.saleNumber,
        total: Number(sale.total),
        receiptUrl,
      }),
    })

    if (!sent.sent) return fail(sent.reason ?? 'Failed to send SMS')
  }

  if (channel === 'whatsapp') {
    if (!sale.customer.phone) return fail('Customer has no phone number')
    const sent = await sendReceiptWhatsapp({
      to: sale.customer.phone,
      body: buildReceiptWhatsappBody({
        customerName,
        saleNumber: sale.saleNumber,
        total: Number(sale.total),
        paidAt: sale.createdAt.toISOString().slice(0, 19).replace('T', ' '),
        receiptUrl,
      }),
    })

    if (!sent.sent) return fail(sent.reason ?? 'Failed to send WhatsApp')
  }

  await logAudit('RECEIPT_RESEND', 'Sale', sale.id, { channel })
  return ok({ channel })
}

export async function getDailySalesReport(
  outletId: string,
  startDateOrDate: string,
  endDateParam?: string
) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.ACCOUNTANT
    )
    let effectiveOutletId = outletId || user.outletId
    if (!effectiveOutletId && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
      const firstOutlet = await prisma.outlet.findFirst({ select: { id: true } })
      effectiveOutletId = firstOutlet?.id || ''
    }
    if (!effectiveOutletId) {
      return fail('No outlet assigned to your account')
    }

    const { start, end, fromStr: startDate, toStr: endDate, isInverted } = getLocalDateRangeBoundaries(startDateOrDate, endDateParam, 6)
    if (isInverted) return fail('Start date cannot be after end date')

    // PERF-003: Server-side cap to prevent memory exhaustion from unbounded multi-month nested query
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays > 31) {
      return fail('Date range cannot exceed 31 days. Please select a shorter date range.')
    }

    const sales = await prisma.sale.findMany({
      where: {
        outletId: effectiveOutletId,
        isQuotation: false,
        status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        createdAt: { gte: start, lte: end },
      },
      include: {
        lines: {
          include: {
            product: {
              select: {
                name: true,
                sku: true,
                productCode: true,
                costPrice: true,
                requiresSerial: true,
                display: true,
                processor: { select: { name: true } },
                processorGen: { select: { name: true } },
                ram: { select: { name: true } },
                storage: { select: { name: true } },
              },
            },
            serials: {
              include: {
                serialUnit: {
                  select: {
                    serialNumber: true,
                  },
                },
              },
            },
          },
        },
        payments: true,
      },
    })

    // Strictly aggregate returns and returned COGS for the outlet in the date window
    const [returnsAgg, returnedCogsAgg, saleReturns] = await Promise.all([
      prisma.saleReturn.aggregate({
        where: {
          createdAt: { gte: start, lte: end },
          OR: [
            { outletId },
            { sale: { outletId } },
          ],
          sale: {
            isQuotation: false,
          },
        },
        _sum: { total: true },
      }),
      prisma.$queryRaw<{ returnedCogs: number }[]>`
        SELECT COALESCE(SUM(
          COALESCE(
            NULLIF(srl."returnedCogs", 0),
            srl.quantity * (sl."totalCogs" / NULLIF(sl.quantity, 0)),
            srl.quantity * sl."unitCost",
            0
          )
        ), 0) as "returnedCogs"
        FROM "SaleReturnLine" srl
        JOIN "SaleReturn" sr ON srl."returnId" = sr.id
        JOIN "Sale" s ON sr."saleId" = s.id
        JOIN "SaleLine" sl ON srl."saleLineId" = sl.id
        WHERE (s."outletId" = ${outletId} OR sr."outletId" = ${outletId})
          AND s."isQuotation" = false
          AND sr."createdAt" >= ${start} AND sr."createdAt" <= ${end}
      `,
      withDatabaseReadFallback(
        () =>
          typeof prisma.saleReturn?.findMany === 'function'
            ? prisma.saleReturn.findMany({
                where: {
                  createdAt: { gte: start, lte: end },
                  OR: [{ outletId }, { sale: { outletId } }],
                  sale: {
                    isQuotation: false,
                  },
                },
                include: {
                  sale: {
                    select: {
                      saleNumber: true,
                    },
                  },
                  lines: {
                    include: {
                      saleLine: {
                        include: {
                          product: {
                            select: {
                              name: true,
                              sku: true,
                              productCode: true,
                              costPrice: true,
                              requiresSerial: true,
                              display: true,
                              processor: { select: { name: true } },
                              processorGen: { select: { name: true } },
                              ram: { select: { name: true } },
                              storage: { select: { name: true } },
                            },
                          },
                        },
                      },
                      serials: {
                        include: {
                          serialUnit: {
                            select: {
                              serialNumber: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
                orderBy: { createdAt: 'desc' },
              })
            : Promise.resolve([]),
        []
      ),
    ])
    const totalReturnsForDay = Number(returnsAgg._sum.total ?? 0)
    const returnedCogsForDay = Number(returnedCogsAgg[0]?.returnedCogs ?? 0)

    const expAgg = await prisma.expense.aggregate({
      where: {
        outletId,
        status: 'APPROVED',
        expenseDate: { gte: start, lte: end },
      },
      _sum: { amount: true },
    })

    const totalExpenses = Number(expAgg._sum.amount || 0)

    let grossSales = 0
    let grossCogs = 0
    let grossPaid = 0
    let totalDue = 0

    // Detailed Ledger Construction with SKU, Discount, Serial Numbers & Returns
    const detailedLedger: Array<{
      invoiceNo: string
      productName: string
      sku: string
      qty: number
      isGift: boolean
      type?: 'Sale' | 'Gift' | 'Return'
      unitBuy: number
      unitSell: number
      discount: number
      totalBuy: number
      totalSell: number
      profit: number
      serialNumbers?: string[]
      requiresSerial: boolean
      invoicePayments?: Record<string, number>
    }> = []

    // Top products by net qty and net revenue (accounting for returns & discounts)
    const productQtyMap = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >()

    for (const sale of sales) {
      grossSales += Number(sale.total)
      const paid = Number(sale.amountPaid)
      grossPaid += paid
      totalDue += Math.max(0, Number(sale.total) - paid)

      const currentInvoicePayments = new Map<string, number>()
      for (const p of sale.payments) {
        currentInvoicePayments.set(
          p.method,
          (currentInvoicePayments.get(p.method) ?? 0) + Number(p.amount)
        )
      }
      const invoicePaymentsObj = Object.fromEntries(currentInvoicePayments)

      const nonGiftLines = sale.lines.filter(l => !l.isGift)
      const orderDiscountMap = distributeOrderDiscount(
        Number(sale.discountAmt ?? 0),
        nonGiftLines.map(l => ({
          id: l.id,
          total: Number(l.total ?? 0),
          discountAmt: Number(l.discountAmt ?? 0),
        }))
      )

      for (let i = 0; i < sale.lines.length; i++) {
        const l = sale.lines[i]
        // Use the ORIGINAL FIFO cost captured at sale time (SaleLine.totalCogs),
        // not the current catalog cost — keeps daily profit consistent with the ledger.
        const lineCogsTotal = Number(l.totalCogs ?? 0)
        const unitBuy =
          lineCogsTotal > 0
            ? lineCogsTotal / Math.max(1, l.quantity)
            : Number(l.product.costPrice)
        const unitSell = l.isGift ? 0 : Number(l.unitPrice)
        const totalBuy = unitBuy * l.quantity

        grossCogs += totalBuy

        const baseLineDiscount = Number(l.discountAmt ?? 0) > 0
          ? Number(l.discountAmt)
          : Math.max(0, (Number(l.unitPrice) * l.quantity) - Number(l.total))
        const orderDiscountShare = orderDiscountMap.get(l.id) ?? 0
        const discount = l.isGift ? 0 : round2(baseLineDiscount + orderDiscountShare)
        const totalSell = l.isGift ? 0 : Math.max(0, round2(Number(l.total) - orderDiscountShare))
        const profit = totalSell - totalBuy

        const fullProdName = formatProductFullName({
          ...l.product,
          processor: l.product.processor?.name,
          processorGen: l.product.processorGen?.name,
          ram: l.product.ram?.name,
          storage: l.product.storage?.name,
          display: l.product.display,
        })

        const existingProd = productQtyMap.get(l.productId) ?? {
          name: fullProdName,
          qty: 0,
          revenue: 0,
        }
        existingProd.qty += l.quantity
        existingProd.revenue += totalSell
        productQtyMap.set(l.productId, existingProd)

        const sku = l.product.sku || l.product.productCode || '—'

        // Extract serial numbers if product requires serial tracking
        const serialNumbers = l.product.requiresSerial
          ? l.serials.map(s => s.serialUnit.serialNumber)
          : undefined

        detailedLedger.push({
          invoiceNo: sale.saleNumber,
          productName: fullProdName,
          sku,
          qty: l.quantity,
          isGift: l.isGift,
          type: (l.isGift ? 'Gift' : 'Sale') as 'Sale' | 'Gift' | 'Return',
          unitBuy,
          unitSell,
          discount,
          totalBuy,
          totalSell,
          profit,
          serialNumbers,
          requiresSerial: l.product.requiresSerial,
          invoicePayments: i === 0 ? invoicePaymentsObj : undefined,
        })
      }
    }

    // Refund tracking
    let totalCashRefund = 0
    let totalBankRefund = 0
    let totalArRefund = 0

    // Append return entries to detailed ledger
    for (const sr of saleReturns || []) {
      const cashRef = Number(sr.cashRefundAmount || 0)
      const bankRef = Number(sr.bankRefundAmount || 0)
      const arRef = Number(sr.arRefundAmount || 0)

      totalCashRefund += cashRef
      totalBankRefund += bankRef
      totalArRefund += arRef

      const returnPayments: Record<string, number> = {}
      if (cashRef > 0) returnPayments['CASH'] = -cashRef
      if (bankRef > 0) returnPayments['BANK'] = -bankRef
      if (arRef > 0) returnPayments['CREDIT'] = -arRef

      for (let i = 0; i < sr.lines.length; i++) {
        const rl = sr.lines[i]
        const prod = rl.saleLine?.product
        const fullReturnProdName = prod
          ? formatProductFullName({
              ...prod,
              processor: prod.processor?.name,
              processorGen: prod.processorGen?.name,
              ram: prod.ram?.name,
              storage: prod.storage?.name,
              display: prod.display,
            })
          : 'Returned Item'
        const unitSell = Number(rl.refundUnitPrice ?? rl.unitPrice ?? 0)
        const totalSell = -(unitSell * rl.quantity)
        const lineCogs = Number(rl.returnedCogs ?? 0)
        const unitBuy = lineCogs > 0 ? lineCogs / Math.max(1, rl.quantity) : Number(prod?.costPrice ?? 0)
        const totalBuy = -(unitBuy * rl.quantity)
        const profit = totalSell - totalBuy
        const sku = prod?.sku || prod?.productCode || '—'

        const serialNumbers = prod?.requiresSerial && rl.serials && rl.serials.length > 0
          ? rl.serials.map(s => s.serialUnit?.serialNumber).filter(Boolean) as string[]
          : undefined

        detailedLedger.push({
          invoiceNo: `${sr.returnNumber} (Sale: ${sr.sale?.saleNumber || '—'})`,
          productName: fullReturnProdName,
          sku,
          qty: -rl.quantity,
          isGift: false,
          type: 'Return' as const,
          unitBuy,
          unitSell,
          discount: 0,
          totalBuy,
          totalSell,
          profit,
          serialNumbers,
          requiresSerial: prod?.requiresSerial ?? false,
          invoicePayments: i === 0 ? returnPayments : undefined,
        })
      }
    }

    // Explicit return netting
    const netSales = grossSales - totalReturnsForDay
    const netCogs = grossCogs - returnedCogsForDay

    const grossProfit = netSales - netCogs
    const netProfit = grossProfit - totalExpenses
    const orderCount = sales.length
    const avgOrderValue = orderCount > 0 ? netSales / orderCount : 0

    // Top products candidate list (populated above with true net revenue after line & order discounts)

    // Deduct returns from product analytics
    for (const sr of saleReturns || []) {
      for (const rl of sr.lines || []) {
        const prodId = rl.saleLine?.productId
        if (!prodId) continue
        const prod = rl.saleLine?.product
        const prodName = prod
          ? formatProductFullName({
              ...prod,
              processor: prod.processor?.name,
              processorGen: prod.processorGen?.name,
              ram: prod.ram?.name,
              storage: prod.storage?.name,
              display: prod.display,
            })
          : 'Returned Item'
        const existing = productQtyMap.get(prodId) ?? {
          name: prodName,
          qty: 0,
          revenue: 0,
        }
        existing.qty -= rl.quantity
        const refundAmt = Number(rl.refundUnitPrice ?? rl.unitPrice ?? 0) * rl.quantity
        existing.revenue -= refundAmt
        productQtyMap.set(prodId, existing)
      }
    }

    const allNetProducts = Array.from(productQtyMap.values()).filter(p => p.qty > 0)
    const revenueProducts = allNetProducts.filter(p => p.revenue > 0)
    const candidateProducts = revenueProducts.length > 0 ? revenueProducts : allNetProducts
    const topProducts = candidateProducts
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
      .slice(0, 5)

    // Gross and Net Payment method breakdown
    const grossPaymentBreakdown = new Map<string, number>()
    for (const sale of sales) {
      for (const p of sale.payments) {
        grossPaymentBreakdown.set(
          p.method,
          (grossPaymentBreakdown.get(p.method) ?? 0) + Number(p.amount)
        )
      }
    }

    const refundPaymentBreakdown = new Map<string, number>()
    if (totalCashRefund > 0) refundPaymentBreakdown.set('CASH', totalCashRefund)
    if (totalBankRefund > 0) refundPaymentBreakdown.set('BANK', totalBankRefund)
    if (totalArRefund > 0) refundPaymentBreakdown.set('CREDIT', totalArRefund)

    const netPaymentBreakdown = new Map<string, number>()
    const allMethods = new Set([...grossPaymentBreakdown.keys(), ...refundPaymentBreakdown.keys()])
    for (const method of allMethods) {
      const gross = grossPaymentBreakdown.get(method) ?? 0
      const ref = refundPaymentBreakdown.get(method) ?? 0
      netPaymentBreakdown.set(method, gross - ref)
    }

    const totalRefundDisbursed = totalCashRefund + totalBankRefund + totalArRefund
    const netPaid = Math.max(0, grossPaid - (totalCashRefund + totalBankRefund))
    const netDue = Math.max(0, totalDue - totalArRefund)

    return ok({
      date: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
      startDate,
      endDate,
      orderCount,
      grossSales,
      totalReturns: totalReturnsForDay,
      grossCogs,
      returnedCogs: returnedCogsForDay,
      totalRevenue: netSales,
      netSales,
      totalCogs: netCogs,
      netCogs,
      grossProfit,
      totalExpenses,
      netProfit,
      grossPaid,
      totalRefundsDisbursed: totalRefundDisbursed,
      netPaid,
      totalPaid: netPaid,
      grossDue: totalDue,
      totalDue: netDue,
      avgOrderValue,
      topProducts,
      detailedLedger,
      returns: (saleReturns || []).map(sr => ({
        id: sr.id,
        returnNumber: sr.returnNumber,
        originalInvoiceNo: sr.sale?.saleNumber ?? '—',
        createdAt: sr.createdAt instanceof Date ? sr.createdAt.toISOString() : String(sr.createdAt),
        reason: sr.reason,
        total: Number(sr.total),
        cashRefundAmount: Number(sr.cashRefundAmount),
        bankRefundAmount: Number(sr.bankRefundAmount),
        arRefundAmount: Number(sr.arRefundAmount),
        lines: (sr.lines || []).map(rl => {
          const prod = rl.saleLine?.product
          const productName = prod
            ? formatProductFullName({
                ...prod,
                processor: prod.processor?.name,
                processorGen: prod.processorGen?.name,
                ram: prod.ram?.name,
                storage: prod.storage?.name,
                display: prod.display,
              })
            : 'Returned Item'
          return {
            id: rl.id,
            productName,
            quantity: rl.quantity,
            refundUnitPrice: Number(rl.refundUnitPrice ?? rl.unitPrice ?? 0),
            totalRefund: Number(rl.refundUnitPrice ?? rl.unitPrice ?? 0) * rl.quantity,
            returnedCogs: Number(rl.returnedCogs ?? 0),
            serialNumbers: (rl.serials || []).map(s => s.serialUnit?.serialNumber).filter(Boolean) as string[],
          }
        }),
      })),
      paymentBreakdown: Object.fromEntries(netPaymentBreakdown),
      grossPaymentBreakdown: Object.fromEntries(grossPaymentBreakdown),
      refundPaymentBreakdown: Object.fromEntries(refundPaymentBreakdown),
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to load daily sales report')
  }
}

export async function getQuotations(filters?: {
  search?: string
  status?: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'DRAFT'
}) {
  const user = await requireAuth()

  const rows = await prisma.sale.findMany({
    where: {
      outletId: user.outletId,
      isQuotation: true,
      ...(filters?.search
        ? {
            OR: [
              {
                saleNumber: {
                  contains: filters.search,
                  mode: 'insensitive',
                },
              },
              {
                customer: {
                  is: {
                    name: {
                      contains: filters.search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  const now = Date.now()
  const mapped = rows.map(quote => {
    const expiresAt = new Date(quote.createdAt)
    expiresAt.setDate(expiresAt.getDate() + 30)
    const isExpired = expiresAt.getTime() < now && quote.status === 'DRAFT'

    const displayStatus =
      quote.status === 'COMPLETED'
        ? 'CONVERTED'
        : isExpired
          ? 'EXPIRED'
          : 'ACTIVE'

    return {
      id: quote.id,
      quoteNo: quote.saleNumber,
      customer: quote.customer?.name ?? 'Walk-in',
      total: Number(quote.total),
      validUntil: expiresAt.toISOString().slice(0, 10),
      status: displayStatus,
      createdAt: quote.createdAt.toISOString().slice(0, 10),
    }
  })

  return ok(
    filters?.status
      ? mapped.filter(item => item.status === filters.status)
      : mapped
  )
}

export async function getQuotationById(id: string) {
  const user = await requireAuth()

  const quotation = await prisma.sale.findFirst({
    where: {
      id,
      outletId: user.outletId,
      isQuotation: true,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              condition: true,
              requiresSerial: true,
            },
          },
          serials: {
            include: {
              serialUnit: {
                select: { id: true, serialNumber: true },
              },
            },
          },
        },
      },
      payments: true,
      cashier: { select: { id: true, name: true } },
    },
  })

  if (!quotation) return fail('Quotation not found')
  return ok(quotation)
}

export async function updateQuotationStatus(
  id: string,
  status: 'DRAFT' | 'COMPLETED'
) {
  const user = await requireAuth()

  const existing = await prisma.sale.findFirst({
    where: {
      id,
      outletId: user.outletId,
      isQuotation: true,
    },
    select: { id: true },
  })
  if (!existing) return fail('Quotation not found')

  await prisma.sale.update({
    where: { id },
    data: { status },
  })

  revalidatePath('/quotations')
  revalidatePath(`/quotations/${id}`)
  revalidatePath('/sales-orders/quotations')
  return ok({ id, status })
}

export async function convertQuotationToSale(
  quotationId: string,
  paymentMethod: PaymentMethod = PaymentMethod.CASH,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.CASHIER,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const executeConvert = async (activeTx: PrismaTx) => {
    // Row lock on the quotation to serialize concurrent conversion attempts
    await activeTx.$executeRaw`SELECT id FROM "Sale" WHERE id = ${quotationId} FOR UPDATE`

    const quotation = await activeTx.sale.findFirst({
      where: {
        id: quotationId,
        outletId: user.outletId,
        isQuotation: true,
      },
      include: {
        lines: {
          include: {
            serials: {
              include: {
                serialUnit: {
                  select: { serialNumber: true },
                },
              },
            },
          },
        },
      },
    })

    if (!quotation) return fail('Quotation not found')
    if (quotation.status === 'COMPLETED') {
      return fail('Quotation is already converted')
    }
    if (!quotation.customerId) {
      return fail(
        'Cannot convert quotation: No customer is associated with this quotation.'
      )
    }

    const lineDiscountsSum = round2(
      quotation.lines.reduce((s, l) => s + Number(l.discountAmt || 0), 0)
    )
    const trueOrderDiscountAmt = Math.max(
      0,
      round2(Number(quotation.discountAmt) - lineDiscountsSum)
    )
    const discountPct =
      Number(quotation.subtotal) > 0
        ? (trueOrderDiscountAmt / Number(quotation.subtotal)) * 100
        : 0

    const checkoutResult = await checkout(
      {
        idempotencyKey: `convert-quotation-${quotation.id}`,
        customerId: quotation.customerId,
        lines: quotation.lines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct),
          discountAmt: Number(line.discountAmt ?? 0),
          serialNumbers: line.serials.map(item => item.serialUnit.serialNumber),
          isGift: line.isGift ?? false,
          cartItemId: line.id,
          parentCartItemId: line.parentLineId ?? undefined,
        })),
        payments: [
          { method: paymentMethod, amount: Number(quotation.total), feeAmount: 0 },
        ],
        complimentaryGifts: [],
        orderDiscountPct: discountPct,
        isQuotation: false,
        notes: `Converted from quotation ${quotation.saleNumber}`,
      },
      activeTx
    )

    if (!checkoutResult.success) return fail(checkoutResult.error)

    await activeTx.sale.update({
      where: { id: quotation.id },
      data: {
        status: 'COMPLETED',
        notes:
          `${quotation.notes ?? ''} Converted to ${checkoutResult.data.saleNumber}`.trim(),
      },
    })

    return ok({
      quotationId,
      saleId: checkoutResult.data.id,
      saleNumber: checkoutResult.data.saleNumber,
    })
  }

  try {
    let result: any
    if (tx) {
      result = await executeConvert(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeConvert(innerTx), {
        timeout: 30000,
      })
    }

    if (result.success) {
      safeRevalidatePath('/quotations')
      safeRevalidatePath(`/quotations/${quotationId}`)
      safeRevalidatePath('/sales-orders/quotations')
    }
    return result
  } catch (error: any) {
    return fail(error?.message || 'Failed to convert quotation')
  }
}

export async function updateSaleNotes(
  saleId: string,
  notes: string,
  reason: string
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  if (!reason.trim() || reason.trim().length < 5) {
    return fail('A reason of at least 5 characters is required to edit a sale')
  }

  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return fail('Sale not found')
  if (user.role !== UserRole.SUPER_ADMIN && sale.outletId !== user.outletId) {
    return fail('Unauthorized access to this sale')
  }

  const oldNotes = sale.notes ?? ''
  const newNotes = notes.trim()

  await prisma.$transaction([
    prisma.sale.update({
      where: { id: saleId },
      data: { notes: newNotes || null },
    }),
    prisma.saleEditLog.create({
      data: {
        saleId,
        editedById: user.id,
        reason: reason.trim(),
        fieldName: 'notes',
        oldValue: oldNotes,
        newValue: newNotes,
      },
    }),
  ])

  await logAudit('SALE_EDIT_NOTES', 'Sale', saleId, { reason })
  revalidatePath(`/sales-orders/invoices/${saleId}`)
  return ok({ saleId })
}

const updateSaleDateSchema = z.object({
  saleId: z.string(),
  saleDate: z.coerce.date(),
  reason: z.string().trim().min(5),
})

export async function updateSaleDate(
  data: z.infer<typeof updateSaleDateSchema>
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = updateSaleDateSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { saleId, saleDate, reason } = parsed.data

  if (saleDate.getTime() > Date.now() + 60 * 1000) {
    return fail('Sale date cannot be in the future')
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      outletId: true,
      saleNumber: true,
      createdAt: true,
    },
  })
  if (!sale) return fail('Sale not found')
  if (sale.outletId !== user.outletId)
    return fail('Unauthorized access to this sale')

  if (sale.createdAt.getTime() === saleDate.getTime()) {
    return fail('No date change detected')
  }

  await prisma.$transaction(async tx => {
    await tx.sale.update({
      where: { id: saleId },
      data: { createdAt: saleDate },
    })

    // Move all related records to maintain date alignment (Fix 7)
    await tx.accountLedgerEntry.updateMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
      data: { createdAt: saleDate },
    })

    await tx.drawerTransaction.updateMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
      data: { createdAt: saleDate },
    })

    await tx.customerLedger.updateMany({
      where: { referenceId: saleId },
      data: { createdAt: saleDate },
    })

    await tx.stockLedger.updateMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
      data: { createdAt: saleDate },
    })

    await tx.bankTransaction.updateMany({
      where: { referenceId: saleId, referenceType: 'Sale' },
      data: { transactionAt: saleDate, createdAt: saleDate },
    })

    await tx.salePayment.updateMany({
      where: { saleId },
      data: { paidAt: saleDate },
    })

    await tx.expense.updateMany({
      where: {
        description: `MFS/Bank Transaction Fee (Sale ${sale.saleNumber})`,
        outletId: sale.outletId,
      },
      data: { expenseDate: saleDate, createdAt: saleDate },
    })

    await tx.saleEditLog.create({
      data: {
        saleId,
        editedById: user.id,
        reason,
        fieldName: 'createdAt',
        oldValue: sale.createdAt.toISOString(),
        newValue: saleDate.toISOString(),
      },
    })
  })

  await logAudit('SALE_EDIT_DATE', 'Sale', saleId, {
    reason,
    oldDate: sale.createdAt.toISOString(),
    newDate: saleDate.toISOString(),
  })
  revalidatePath('/sales-orders/invoices')
  revalidatePath(`/sales-orders/invoices/${saleId}`)
  return ok({ saleId, saleNumber: sale.saleNumber })
}

export async function getSaleEditLogs(saleId: string) {
  const user = await requireAuth()
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { outletId: true },
  })
  if (!sale) return fail('Sale not found')
  validateOutletAccess(user, sale.outletId)
  const logs = await prisma.saleEditLog.findMany({
    where: { saleId },
    include: { editedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return ok(logs)
}



const updateSaleItemsSchema = z.object({
  saleId: z.string(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        discountPct: z.coerce.number().min(0).max(100).default(0),
        discountAmt: z.coerce.number().min(0).default(0),
        serialNumbers: z.array(z.string()).default([]),
        isGift: z.boolean().default(false),
        note: z.string().optional(),
      })
    )
    .min(1),
  orderDiscountPct: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  reason: z.string().min(5),
  overrideApproverId: z.string().optional(),
  overridePin: z.string().optional(),
})

export async function updateSaleItems(
  data: z.input<typeof updateSaleItemsSchema>
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  const parsed = updateSaleItemsSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const {
    saleId,
    lines,
    orderDiscountPct,
    notes,
    amountPaid,
    reason,
    overrideApproverId,
    overridePin,
  } = parsed.data

  const resultSaleId = saleId
  let customerIdForRevalidation: string | null = null
  const auditContext: {
    verifiedApprover: { id: string; name: string; role: UserRole } | null
    evaluatedDiscount: EvaluateDiscountApprovalResult | null
    saleNumber: string
  } = {
    verifiedApprover: null,
    evaluatedDiscount: null,
    saleNumber: '',
  }
  let productMap = new Map<
    string,
    {
      id: string
      costPrice: any
      sellingPrice: any
      name: string
      requiresSerial?: boolean
      warrantyMonths?: number | null
      taxRateId?: string | null
      taxRate?: { rate: any } | null
    }
  >()
  let originalLinePriceMap = new Map<string, number>()

  try {
    // Heavy interactive transaction (stock reversal + serial reassignment + full
    // ledger/bank/drawer re-post). Prisma's default 5000ms interactive timeout is
    // too tight for large orders, which surfaces as
    // "A commit cannot be executed on an expired transaction". Give it the same
    // headroom the create/return/convert transactions already use.
    await prisma.$transaction(async tx => {
      // 1. Acquire FOR UPDATE lock on Sale row first to serialize concurrent edits/returns
      await tx.$executeRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`

      const oldSale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          lines: {
            include: { serials: { include: { serialUnit: true } } },
          },
          payments: true,
          returns: true,
          customer: {
            include: { group: true },
          },
        },
      })

      if (!oldSale) throw new Error('Sale not found')
      if (user.role !== UserRole.SUPER_ADMIN && oldSale.outletId !== user.outletId)
        throw new Error('Unauthorized access to this outlet')
      if (oldSale.returns && oldSale.returns.length > 0)
        throw new Error('Cannot edit a sale invoice that has return records. Please handle adjustments via sales return.')

      // SAL-008: Block edits on a sale whose original drawer session is already CLOSED
      const closedDrawerTx = await tx.drawerTransaction.findFirst({
        where: {
          OR: [
            { referenceId: oldSale.id, referenceType: 'Sale' },
            { description: `Sale ${oldSale.saleNumber}`, referenceId: null },
          ],
          drawer: { status: DrawerStatus.CLOSED },
        },
      })
      if (closedDrawerTx) {
        throw new Error('Cannot edit a sale associated with a closed cash drawer session.')
      }

      // NOTE: COMPLETED sales remain editable through this audited path by design
      // (edit-items-dialog + POS resubmit flow). Every mutation below is wrapped
      // in a single $transaction and fully re-posts stock, serials, customer
      // balance, and double-entry ledger — it never edits in place.
      customerIdForRevalidation = oldSale.customerId

      // 2. Fetch settings and COA
      const [settingsRows, coaAccounts] = await Promise.all([
        tx.setting.findMany({
          where: {
            key: {
              in: [
                'default_tax_rate_id',
                'discount_limit_pct_cashier',
                'discount_limit_pct_manager',
              ],
            },
          },
          select: { key: true, value: true },
        }),
        tx.chartOfAccount.findMany({
          where: {
            code: { in: ['1100', '1200', '1300', '1400', '2300', '4100', '5000', '5290'] },
          },
          select: { id: true, code: true },
        }),
      ])

      const settingMap = new Map(settingsRows.map(s => [s.key, s.value]))
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const taxRateId = settingMap.get('default_tax_rate_id')
      const taxRate = taxRateId
        ? await tx.taxRate.findUnique({
            where: { id: taxRateId },
            select: { rate: true },
          })
        : null
      const taxPct = taxRate ? Number(taxRate.rate) : 0

      // 3. Fetch products
      const productIds = lines.map(l => l.productId)
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          costPrice: true,
          sellingPrice: true,
          name: true,
          requiresSerial: true,
          warrantyMonths: true,
          taxRateId: true,
          taxRate: { select: { rate: true } },
        },
      })
      productMap = new Map(products.map(p => [p.id, p]))

      // Map original sale line unit prices (to detect price cuts on existing lines)
      originalLinePriceMap = new Map<string, number>()
      for (const ol of oldSale.lines) {
        originalLinePriceMap.set(ol.productId, Number(ol.unitPrice))
      }

      // 4. Discount Limit Policy & Manager Approval Verification
      const groupDiscountPct = oldSale.customer?.group?.discountPct
        ? Number(oldSale.customer.group.discountPct)
        : 0

      const discountEvaluation = evaluateDiscountApproval({
        role: user.role,
        lines: lines.map(l => {
          const origPrice = originalLinePriceMap.get(l.productId)
          const product = productMap.get(l.productId)
          const benchmarkPrice = origPrice !== undefined
            ? origPrice
            : Number(product?.sellingPrice ?? 0)
          return {
            ...l,
            originalUnitPrice: benchmarkPrice,
          }
        }),
        orderDiscountPct,
        groupDiscountPct,
        settings: settingMap,
        overrideApproverId,
        overridePin,
      })

      let verifiedApprover: { id: string; name: string; role: UserRole } | null = null

      if (discountEvaluation.requiresOverride) {
        if (!overrideApproverId || !overridePin) {
          throw new Error(
            `Discount (${discountEvaluation.discretionaryDiscountPct}%) exceeds your limit (${discountEvaluation.userDiscountLimitPct}%). Authorizing manager approval is required.`
          )
        }

        const approvalResult = await verifyManagerApproval({
          approverUserId: overrideApproverId,
          pin: overridePin,
          actorUserId: user.id,
          failureAction: 'DISCOUNT_OVERRIDE_FAILED',
          requiredLimitPct: discountEvaluation.discretionaryDiscountPct,
          settings: settingMap,
          tx,
          meta: {
            discretionaryDiscountPct: discountEvaluation.discretionaryDiscountPct,
            discretionaryDiscountAmt: discountEvaluation.discretionaryDiscountAmt,
            saleId: oldSale.id,
            saleNumber: oldSale.saleNumber,
          },
        })

        if (!approvalResult.ok) {
          throw new Error(approvalResult.error)
        }

        verifiedApprover = approvalResult.approver
        auditContext.verifiedApprover = approvalResult.approver
        auditContext.evaluatedDiscount = discountEvaluation
        auditContext.saleNumber = oldSale.saleNumber
      }

      // 5. Recalculate totals
      let baseSubtotal = 0
      const lineCalcs = lines.map(l => {
        const product = productMap.get(l.productId)
        const lineGross = l.isGift ? 0 : round2(l.unitPrice * l.quantity)
        const lineDiscount = l.isGift
          ? 0
          : (l.discountAmt > 0
              ? round2(Math.min(lineGross, l.discountAmt))
              : round2(lineGross * (l.discountPct / 100)))
        const lineNet = Math.max(0, round2(lineGross - lineDiscount))
        baseSubtotal = round2(baseSubtotal + lineGross)
        return {
          ...l,
          discountAmt: lineDiscount,
          finalTotal: lineNet,
          unitCost: Number(product?.costPrice ?? 0),
        }
      })

      // SAL-001: Cost floor guard — block sales below product costPrice unless approved by Manager
      const canOverrideCostFloor =
        ([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as string[]).includes(user.role) ||
        Boolean(verifiedApprover)

      if (!canOverrideCostFloor) {
        for (const lc of lineCalcs) {
          if (lc.isGift) continue
          const prod = productMap.get(lc.productId)
          const cost = Number(prod?.costPrice || 0)
          if (cost > 0) {
            const effectiveUnitNet = round2(lc.finalTotal / lc.quantity)
            if (effectiveUnitNet < cost) {
              throw new Error(
                `Line price (৳${effectiveUnitNet}) for "${prod?.name || 'Item'}" is below cost price (৳${cost}). Manager approval required.`
              )
            }
          }
        }
      }

      const totalLineDiscounts = round2(lineCalcs.reduce((s, l) => s + l.discountAmt, 0))
      const netSubtotal = Math.max(0, round2(baseSubtotal - totalLineDiscounts))
      const effectiveOrderDiscountPct = Math.max(orderDiscountPct, groupDiscountPct)
      const orderDiscount = round2(netSubtotal * (effectiveOrderDiscountPct / 100))
      const aggregateDiscountAmt = round2(totalLineDiscounts + orderDiscount)
      const afterDiscount = Math.max(0, round2(netSubtotal - orderDiscount))

      // SAL-002: Honor Product.taxRateId per line item, falling back to outlet default taxPct
      let calculatedTaxAmt = 0
      for (const lc of lineCalcs) {
        if (lc.isGift) continue
        const prod = productMap.get(lc.productId)
        const lineTaxRate =
          prod?.taxRate?.rate != null ? Number(prod.taxRate.rate) : taxPct
        if (lineTaxRate > 0) {
          const lineOrderDiscountShare =
            netSubtotal > 0 ? (lc.finalTotal / netSubtotal) * orderDiscount : 0
          const lineTaxableBase = Math.max(0, lc.finalTotal - lineOrderDiscountShare)
          calculatedTaxAmt = round2(calculatedTaxAmt + round2(lineTaxableBase * (lineTaxRate / 100)))
        }
      }
      const taxAmt = calculatedTaxAmt
      const total = round2(afterDiscount + taxAmt)

      // A. Reverse Old Stock and Serials
      for (const oldLine of oldSale.lines) {
        // Replenish StockLayers (restore quantityRemaining) under row lock (Finding #21)
        let qtyToRestore = oldLine.quantity
        await tx.$executeRaw`
          SELECT id FROM "StockLayer"
          WHERE "productId" = ${oldLine.productId}
            AND "outletId" = ${oldSale.outletId}
          FOR UPDATE
        `
        const layers = await tx.stockLayer.findMany({
          where: { productId: oldLine.productId, outletId: oldSale.outletId },
          orderBy: { receivedAt: 'desc' },
        })
        for (const layer of layers) {
          if (qtyToRestore <= 0) break
          const deficit = layer.quantityReceived - layer.quantityRemaining
          if (deficit > 0) {
            const restore = Math.min(deficit, qtyToRestore)
            await tx.stockLayer.update({
              where: { id: layer.id },
              data: { quantityRemaining: { increment: restore } },
            })
            qtyToRestore -= restore
          }
        }

        // Create reversal stock entry
        await tx.stockLedger.create({
          data: {
            productId: oldLine.productId,
            outletId: oldSale.outletId,
            movementType: StockMovementType.RETURN_IN,
            quantity: oldLine.quantity,
            referenceId: oldSale.id,
            referenceType: 'SaleEditReversal',
            notes: `Reversal for Sale Edit: ${reason}`,
          },
        })

        // Release serials (only if currently marked as SOLD)
        for (const s of oldLine.serials) {
          if (s.serialUnit.status === SerialStatus.SOLD) {
            await tx.serialUnit.update({
              where: { id: s.serialUnitId },
              data: { status: SerialStatus.IN_STOCK, soldAt: null },
            })
          }
        }
      }

      // B. Delete Old Lines and Serials
      await tx.saleLineSerial.deleteMany({
        where: { saleLineId: { in: oldSale.lines.map(l => l.id) } },
      })
      await tx.saleLine.deleteMany({
        where: { saleId: oldSale.id },
      })

      // C. Validate serial requirements & batch fetch serial units under row lock
      for (const line of lineCalcs) {
        const prod = productMap.get(line.productId)
        const cleanLineSerials = line.serialNumbers.map(s => s.trim()).filter(Boolean)
        if (prod?.requiresSerial && cleanLineSerials.length !== line.quantity) {
          throw new Error(
            `Product "${prod.name}" requires exactly ${line.quantity} serial number(s), but ${cleanLineSerials.length} provided.`
          )
        }
      }

      const allSerialNumbers = lineCalcs.flatMap(l => l.serialNumbers.map(s => s.trim()).filter(Boolean))
      if (new Set(allSerialNumbers).size !== allSerialNumbers.length) {
        throw new Error('Duplicate serial numbers provided in sale edit.')
      }

      if (allSerialNumbers.length > 0) {
        await tx.$executeRaw`
          SELECT id FROM "SerialUnit"
          WHERE "serialNumber" = ANY(${allSerialNumbers})
            AND "outletId" = ${oldSale.outletId}
          FOR UPDATE
        `
      }

      const serialUnits = allSerialNumbers.length > 0
        ? await tx.serialUnit.findMany({
            where: { serialNumber: { in: allSerialNumbers } },
            include: {
              saleLineSerials: {
                include: {
                  saleLine: {
                    include: {
                      sale: { select: { saleNumber: true, id: true } },
                    },
                  },
                },
              },
            },
          })
        : []
      const serialMap = new Map(serialUnits.map(s => [s.serialNumber, s]))

      // Pre-check stock demand across all lines to prevent overselling
      const aggregatedStockDemand = aggregateRequiredStockByProduct(lineCalcs)
      const demandedProductIds = Array.from(aggregatedStockDemand.keys())

      if (demandedProductIds.length > 0) {
        const stockLedgerSums = await tx.stockLedger.groupBy({
          by: ['productId'],
          where: {
            productId: { in: demandedProductIds },
            outletId: oldSale.outletId,
          },
          _sum: { quantity: true },
        })

        const availableStockMap = new Map<string, number>()
        for (const s of stockLedgerSums) {
          availableStockMap.set(s.productId, s._sum.quantity ?? 0)
        }

        for (const [pId, reqQty] of aggregatedStockDemand.entries()) {
          const availableStock = availableStockMap.get(pId) ?? 0
          if (availableStock < reqQty) {
            const product = productMap.get(pId)
            throw new Error(
              `INSUFFICIENT_STOCK:"${product?.name ?? pId}"|${availableStock}|${reqQty}`
            )
          }
        }
      }

      // D. Create New Lines and Apply Stock/Serials
      let calculatedCogsTotal = 0

      for (const line of lineCalcs) {
        const prod = productMap.get(line.productId)
        const cleanLineSerials = line.serialNumbers.map(s => s.trim()).filter(Boolean)

        // Pre-validate serials and compute serial-specific COGS when applicable
        const validatedLineSerials: NonNullable<ReturnType<typeof serialMap.get>>[] = []
        for (const trimmedSn of cleanLineSerials) {
          const serial = serialMap.get(trimmedSn)
          if (!serial) throw new Error(`Serial ${trimmedSn} not found`)
          if (serial.productId !== line.productId) {
            throw new Error(
              `Serial ${trimmedSn} does not belong to product "${prod?.name ?? line.productId}"`
            )
          }
          if (serial.outletId !== oldSale.outletId) {
            throw new Error(`Serial ${trimmedSn} belongs to a different outlet`)
          }
          if (serial.status !== SerialStatus.IN_STOCK) {
            const conflictingSale = serial.saleLineSerials?.[0]?.saleLine?.sale?.saleNumber
            if (conflictingSale) {
              throw new Error(
                `Serial ${trimmedSn} is currently assigned to Sale ${conflictingSale} — release it from that sale before reassigning it here.`
              )
            }
            throw new Error(`Serial ${trimmedSn} is not available in stock (status: ${serial.status})`)
          }
          validatedLineSerials.push(serial)
        }

        // Consume stock layers for FIFO accounting accuracy
        const batches = await consumeStockLayers(tx, {
          productId: line.productId,
          outletId: oldSale.outletId,
          quantityNeeded: line.quantity,
          allowSyntheticLayer: false,
        })

        const fifoUnitCost =
          batches.length > 0
            ? batches.reduce((sum, b) => sum + b.totalCost, 0) / line.quantity
            : line.unitCost

        const lineExactCogs =
          validatedLineSerials.length > 0
            ? round2(
                validatedLineSerials.reduce(
                  (sum, s) => sum + Number(s.costPrice ?? fifoUnitCost),
                  0
                )
              )
            : round2(fifoUnitCost * line.quantity)
        const effectiveUnitCost =
          line.quantity > 0 ? round2(lineExactCogs / line.quantity) : fifoUnitCost
        calculatedCogsTotal = round2(calculatedCogsTotal + lineExactCogs)

        const newLine = await tx.saleLine.create({
          data: {
            saleId: oldSale.id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: effectiveUnitCost,
            totalCogs: lineExactCogs,
            discountPct: line.discountPct,
            discountAmt: line.discountAmt,
            total: line.finalTotal,
            isGift: line.isGift,
            note: line.note?.trim() || undefined,
          },
        })

        // New stock entry
        await tx.stockLedger.create({
          data: {
            productId: line.productId,
            outletId: oldSale.outletId,
            movementType: StockMovementType.SALE_OUT,
            quantity: -line.quantity,
            referenceId: oldSale.id,
            referenceType: 'Sale Edit',
            notes: `Updated Sale: ${reason}`,
          },
        })

        // Assign new serials using validated list & compute warrantyExpiry
        const wMonths = Number(prod?.warrantyMonths || 0)
        let warrantyExpiry: Date | null = null
        if (wMonths > 0) {
          warrantyExpiry = new Date(oldSale.createdAt)
          warrantyExpiry.setMonth(warrantyExpiry.getMonth() + wMonths)
        }

        for (const serial of validatedLineSerials) {
          await tx.serialUnit.update({
            where: { id: serial.id },
            data: {
              status: SerialStatus.SOLD,
              soldAt: oldSale.createdAt,
              warrantyExpiry,
            },
          })
          await tx.saleLineSerial.create({
            data: { saleLineId: newLine.id, serialUnitId: serial.id },
          })
        }
      }

      // E. Update Sale Totals & Recalculate newBalance / newChangeDue
      const effectiveAmountPaid = amountPaid !== undefined ? amountPaid : Number(oldSale.amountPaid)
      const previousDue = Number(oldSale.previousDue ?? 0)

      const newPaymentsData: Array<{
        method: PaymentMethod
        amount: number
        bankAccountId: string | null
        feeAmount: number
        reference: string | null
      }> = []

      if (effectiveAmountPaid > 0) {
        if (!oldSale.payments || oldSale.payments.length === 0) {
          newPaymentsData.push({
            method: PaymentMethod.CASH,
            amount: effectiveAmountPaid,
            bankAccountId: null,
            feeAmount: 0,
            reference: null,
          })
        } else if (oldSale.payments.length === 1) {
          const origP = oldSale.payments[0]
          const oldAmt = Number(origP.amount)
          const oldFee = Number(origP.feeAmount || 0)
          const newFee = oldAmt > 0 ? round2((oldFee / oldAmt) * effectiveAmountPaid) : 0
          newPaymentsData.push({
            method: origP.method,
            amount: effectiveAmountPaid,
            bankAccountId: origP.bankAccountId,
            feeAmount: newFee,
            reference: origP.reference,
          })
        } else {
          const oldTotalPaid = Number(oldSale.amountPaid)
          const ratio = oldTotalPaid > 0 ? effectiveAmountPaid / oldTotalPaid : 1 / oldSale.payments.length
          let allocated = 0
          for (let i = 0; i < oldSale.payments.length; i++) {
            const origP = oldSale.payments[i]
            const isLast = i === oldSale.payments.length - 1
            const newAmt = isLast
              ? round2(effectiveAmountPaid - allocated)
              : round2(Number(origP.amount) * ratio)
            allocated = round2(allocated + newAmt)
            const oldAmt = Number(origP.amount)
            const oldFee = Number(origP.feeAmount || 0)
            const newFee = oldAmt > 0 ? round2((oldFee / oldAmt) * newAmt) : 0
            newPaymentsData.push({
              method: origP.method,
              amount: newAmt,
              bankAccountId: origP.bankAccountId,
              feeAmount: newFee,
              reference: origP.reference,
            })
          }
        }
      }

      const cashTendered = round2(
        newPaymentsData
          .filter(p => p.method === PaymentMethod.CASH)
          .reduce((s, p) => s + p.amount, 0)
      )
      const nonCashPaid = round2(
        newPaymentsData
          .filter(p => p.method !== PaymentMethod.CASH && p.method !== PaymentMethod.CREDIT)
          .reduce((s, p) => s + p.amount, 0)
      )
      const requiredFromCash = Math.max(0, round2(total - nonCashPaid))
      const newChangeDue = round2(Math.max(0, cashTendered - requiredFromCash))
      const netEffectivePaid = round2(Math.max(0, effectiveAmountPaid - newChangeDue))
      const calculatedNewBalance = round2(previousDue + Math.max(0, round2(total - netEffectivePaid)))

      await tx.sale.update({
        where: { id: oldSale.id },
        data: {
          subtotal: baseSubtotal,
          discountAmt: aggregateDiscountAmt,
          taxAmt,
          total,
          notes: notes !== undefined ? notes : oldSale.notes,
          amountPaid: netEffectivePaid,
          changeDue: newChangeDue,
          newBalance: calculatedNewBalance,
        },
      })

      // F. Customer Credit & Outstanding Balance Recalculation
      const oldCredit = Math.max(0, Number(oldSale.total) - Number(oldSale.amountPaid))
      const newCredit = Math.max(0, round2(total - netEffectivePaid))
      const creditDiff = round2(newCredit - oldCredit)

      if (oldSale.customerId && creditDiff !== 0) {
        await tx.customer.update({
          where: { id: oldSale.customerId },
          data: {
            outstandingBalance: {
              increment: creditDiff,
            },
          },
        })
      }

      if (oldSale.customerId) {
        if (newCredit > 0) {
          const existingLedger = await tx.customerLedger.findFirst({
            where: {
              customerId: oldSale.customerId,
              OR: [
                { referenceId: oldSale.id },
                { description: `Credit Sale ${oldSale.saleNumber}` },
              ],
            },
          })

          if (existingLedger) {
            await tx.customerLedger.update({
              where: { id: existingLedger.id },
              data: { amount: newCredit },
            })
          } else {
            await tx.customerLedger.create({
              data: {
                customerId: oldSale.customerId,
                type: TransactionType.DEBIT,
                amount: newCredit,
                description: `Credit Sale ${oldSale.saleNumber}`,
                referenceId: oldSale.id,
                createdAt: oldSale.createdAt,
              },
            })
          }
        } else {
          await tx.customerLedger.deleteMany({
            where: {
              customerId: oldSale.customerId,
              OR: [
                { referenceId: oldSale.id },
                { description: `Credit Sale ${oldSale.saleNumber}` },
              ],
            },
          })
        }
      }

      // G. Re-post Accounting Ledger with proper Cash vs Accounts Receivable split
      await tx.accountLedgerEntry.deleteMany({
        where: { referenceId: oldSale.id, referenceType: 'Sale' },
      })

      // G0. Delete any fee-associated Expense records
      await tx.expense.deleteMany({
        where: {
          description: `MFS/Bank Transaction Fee (Sale ${oldSale.saleNumber})`,
          outletId: oldSale.outletId,
        },
      })

      // G0. Reverse original bank deposit transactions and cash drawer SALE entries
      // NOTE: Sale creation incremented bank balance, so reversing must decrement.
      for (const payment of oldSale.payments) {
        if (payment.bankAccountId) {
          const netAmount = round2(Number(payment.amount) - Number(payment.feeAmount))
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
          await tx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { decrement: netAmount } },
          })
        }
      }
      await tx.bankTransaction.deleteMany({
        where: { referenceId: oldSale.id, referenceType: 'Sale' },
      })
      // Bug 2 fix: delete by referenceId (safe) with description fallback for legacy
      // rows created before the referenceId column was added.
      await tx.drawerTransaction.deleteMany({
        where: {
          OR: [
            { referenceId: oldSale.id, referenceType: 'Sale' },
            { description: `Sale ${oldSale.saleNumber}`, referenceId: null },
          ],
        },
      })

      // G1. Re-post SalePayment records & real Bank/Drawer transactions reflecting new payment amount
      await tx.salePayment.deleteMany({
        where: { saleId: oldSale.id },
      })

      if (effectiveAmountPaid > 0) {
        let remainingChangeToDeduct = newChangeDue

        for (const np of newPaymentsData) {
          if (np.amount <= 0) continue

          await tx.salePayment.create({
            data: {
              saleId: oldSale.id,
              method: np.method,
              amount: np.amount,
              bankAccountId: np.bankAccountId,
              feeAmount: np.feeAmount,
              reference: np.reference,
              createdAt: oldSale.createdAt,
            },
          })

          if (np.bankAccountId) {
            const netBank = round2(np.amount - np.feeAmount)
            if (netBank > 0) {
              await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${np.bankAccountId} FOR UPDATE`
              await tx.bankAccount.update({
                where: { id: np.bankAccountId },
                data: { currentBalance: { increment: netBank } },
              })
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: np.bankAccountId,
                  type: 'DEPOSIT',
                  amount: netBank,
                  description: `Sale ${oldSale.saleNumber} (Edited)`,
                  referenceId: oldSale.id,
                  referenceType: 'Sale',
                  createdAt: oldSale.createdAt,
                },
              })
            }
          } else if (np.method === PaymentMethod.CASH) {
            const changeDeduct = Math.min(np.amount, remainingChangeToDeduct)
            remainingChangeToDeduct = round2(remainingChangeToDeduct - changeDeduct)
            const netCashAmount = round2(np.amount - changeDeduct)
            if (netCashAmount > 0) {
              const drawer = await ensureOpenDrawer(tx, oldSale.outletId)
              if (!drawer) {
                throw new Error(
                  'No open cash drawer found. Cannot re-post cash entry for edited sale. Please open a cash drawer first.'
                )
              }
              await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${drawer.id} FOR UPDATE`
              await tx.drawerTransaction.create({
                data: {
                  drawerId: drawer.id,
                  type: 'SALE',
                  amount: netCashAmount,
                  description: `Sale ${oldSale.saleNumber} (Edited)`,
                  referenceId: oldSale.id,
                  referenceType: 'Sale',
                  createdAt: oldSale.createdAt,
                },
              })
            }
          }
        }
      }

      const cashAccountId = coaMap.get('1100')
      const bankAssetAccountId = coaMap.get('1200')
      const arAccountId = coaMap.get('1300')
      const revenueAccountId = coaMap.get('4100')
      const cogsAccountId = coaMap.get('5000')
      const inventoryAccountId = coaMap.get('1400')
      const taxPayableAccountId = coaMap.get('2300')
      const expenseAccountId = coaMap.get('5290')

      if (revenueAccountId && cogsAccountId && inventoryAccountId) {
        const actualCashPaid = Math.max(
          0,
          round2(cashTendered - newChangeDue)
        )
        const totalFeeAmount = round2(
          newPaymentsData.reduce((sum, p) => sum + (p.feeAmount || 0), 0)
        )
        const actualBankPaid = Math.max(
          0,
          round2(
            newPaymentsData
              .filter(
                p =>
                  p.method !== PaymentMethod.CASH &&
                  p.method !== PaymentMethod.CREDIT
              )
              .reduce((s, p) => s + (p.amount - (p.feeAmount || 0)), 0)
          )
        )
        const totalLiquidPaid = round2(actualCashPaid + actualBankPaid + totalFeeAmount)
        const creditPaid = Math.max(0, round2(total - totalLiquidPaid))

        const ledgerEntries: import('@prisma/client').Prisma.AccountLedgerEntryCreateManyInput[] = [
          {
            accountId: revenueAccountId,
            type: TransactionType.CREDIT,
            amount: afterDiscount,
            description: `Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          },
          {
            accountId: cogsAccountId,
            type: TransactionType.DEBIT,
            amount: calculatedCogsTotal,
            description: `COGS — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          },
          {
            accountId: inventoryAccountId,
            type: TransactionType.CREDIT,
            amount: calculatedCogsTotal,
            description: `COGS — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          },
        ]

        if (cashAccountId && actualCashPaid > 0) {
          ledgerEntries.push({
            accountId: cashAccountId,
            type: TransactionType.DEBIT,
            amount: actualCashPaid,
            description: `Cash Payment — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          })
        }

        if (bankAssetAccountId && actualBankPaid > 0) {
          ledgerEntries.push({
            accountId: bankAssetAccountId,
            type: TransactionType.DEBIT,
            amount: actualBankPaid,
            description: `Bank Payment (Net) — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          })
        }

        if (arAccountId && creditPaid > 0) {
          ledgerEntries.push({
            accountId: arAccountId,
            type: TransactionType.DEBIT,
            amount: creditPaid,
            description: `Accounts Receivable — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          })
        }

        if (taxPayableAccountId && taxAmt > 0) {
          ledgerEntries.push({
            accountId: taxPayableAccountId,
            type: TransactionType.CREDIT,
            amount: taxAmt,
            description: `VAT — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          })
        }

        if (totalFeeAmount > 0 && expenseAccountId) {
          ledgerEntries.push({
            accountId: expenseAccountId,
            type: TransactionType.DEBIT,
            amount: totalFeeAmount,
            description: `Bank/MFS Charges — Sale ${oldSale.saleNumber} (Edited)`,
            referenceId: oldSale.id,
            referenceType: 'Sale',
          })

          await tx.expense.create({
            data: {
              description: `MFS/Bank Transaction Fee (Sale ${oldSale.saleNumber})`,
              amount: totalFeeAmount,
              accountId: expenseAccountId,
              status: 'APPROVED',
              outletId: oldSale.outletId,
              createdById: user.id,
              approvedById: user.id,
              expenseDate: oldSale.createdAt,
              createdAt: oldSale.createdAt,
            },
          })
        }

        ledgerEntries.forEach(e => {
          e.createdAt = oldSale.createdAt
        })
        assertBalancedJournal(ledgerEntries, 0.01)
        await tx.accountLedgerEntry.createMany({ data: ledgerEntries })
      }

      // H. Log the edit
      await tx.saleEditLog.create({
        data: {
          saleId: oldSale.id,
          editedById: user.id,
          reason: verifiedApprover
            ? `${reason.trim()} [Approved by: ${verifiedApprover.name} (${verifiedApprover.id})]`
            : reason.trim(),
          fieldName: 'items',
          oldValue: JSON.stringify(
            oldSale.lines.map(l => ({ p: l.productId, q: l.quantity }))
          ),
          newValue: JSON.stringify({
            lines: lines.map(l => ({ p: l.productId, q: l.quantity })),
            ...(verifiedApprover
              ? {
                  approver: {
                    id: verifiedApprover.id,
                    name: verifiedApprover.name,
                    role: verifiedApprover.role,
                  },
                }
              : {}),
          }),
        },
      })
    }, {
      maxWait: 15000,
      timeout: 60000,
    })
  } catch (err: any) {
    if (err?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = err.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    if (err?.message?.startsWith('INSUFFICIENT_STOCK:')) {
      const parts = err.message.split('|')
      const productName = parts[0].replace('INSUFFICIENT_STOCK:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Insufficient stock for ${productName}. Available: ${available}, Required: ${required}. Another transaction may have reserved this stock.`
      )
    }
    return fail(err.message || 'Failed to update sale')
  }

  if (auditContext.verifiedApprover && auditContext.evaluatedDiscount) {
    const approver = auditContext.verifiedApprover
    const discount = auditContext.evaluatedDiscount
    await logAuditDirect(user.id, 'DISCOUNT_OVERRIDE', 'Sale', resultSaleId, {
      saleNumber: auditContext.saleNumber,
      approverId: approver.id,
      approverName: approver.name,
      approverRole: approver.role,
      discountPct: discount.discretionaryDiscountPct,
      discountAmt: discount.discretionaryDiscountAmt,
      maxAllowedDiscount: discount.userDiscountLimitPct,
      action: 'updateSaleItems',
    })
  }

  const priceOverriddenLines = lines.filter(l => {
    const origPrice = originalLinePriceMap.get(l.productId)
    const product = productMap.get(l.productId)
    const benchmarkPrice = origPrice !== undefined ? origPrice : Number(product?.sellingPrice ?? 0)
    return benchmarkPrice > 0 && l.unitPrice < benchmarkPrice
  })
  if (priceOverriddenLines.length > 0) {
    await logAuditDirect(user.id, 'PRICE_OVERRIDE', 'Sale', resultSaleId, {
      saleNumber: auditContext.saleNumber,
      overriddenLines: priceOverriddenLines.map(l => ({
        productId: l.productId,
        originalPrice: originalLinePriceMap.get(l.productId),
        newPrice: l.unitPrice,
      })),
      approverId: auditContext.verifiedApprover?.id,
      approverName: auditContext.verifiedApprover?.name,
      action: 'updateSaleItems',
    })
  }

  await logAudit('SALE_EDIT_ITEMS', 'Sale', resultSaleId, { reason })
  revalidatePath(`/sales-orders/invoices/${resultSaleId}`)
  revalidatePath('/sales-orders/invoices')
  revalidatePath('/orders')
  if (customerIdForRevalidation) {
    revalidatePath(`/customers/${customerIdForRevalidation}`)
    revalidatePath('/customers')
  }
  safeRevalidateTag(`dashboard-${user.outletId}`)
  safeRevalidatePath('/', 'page')
  safeRevalidatePath('/reports')
  safeRevalidatePath('/reports/sales')
  safeRevalidatePath('/reports/inventory')
  return ok({ saleId: resultSaleId })
}

export async function checkGiftsStock(gifts: string[]) {
  const user = await requireAuth()
  if (!user.outletId) return fail('No outlet assigned')

  const results: Record<
    string,
    { available: boolean; productName?: string; stock?: number }
  > = {}

  for (const gift of gifts) {
    const giftKey = gift as z.infer<typeof complimentaryGiftOptionSchema>
    const resolved = await findBestGiftProduct(user.outletId, giftKey, prisma)
    if (!resolved || !resolved.product) {
      results[gift] = { available: false, stock: 0 }
      continue
    }

    results[gift] = {
      available: resolved.stock > 0,
      productName: resolved.product.name,
      stock: resolved.stock,
    }
  }

  return ok(results)
}

export async function deleteSale(saleId: string) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  if (!saleId?.trim()) return fail('Invalid sale ID')

  try {
    const sale = await prisma.sale.findFirst({
      where: {
        id: saleId,
        outletId: user.outletId,
      },
      include: {
        lines: {
          include: {
            serials: {
              include: {
                serialUnit: true,
              },
            },
          },
        },
        payments: true,
        returns: true,
      },
    })

    if (!sale) return fail('Sale not found')

    if (sale.returns.length > 0) {
      return fail('Cannot delete a sale that has return records.')
    }

    // SAL-008: Block deletes on a sale whose original drawer session is already CLOSED
    const closedDrawerTx = await prisma.drawerTransaction.findFirst({
      where: {
        OR: [
          { referenceId: saleId, referenceType: 'Sale' },
          { description: `Sale ${sale.saleNumber}`, referenceId: null },
        ],
        drawer: { status: DrawerStatus.CLOSED },
      },
    })
    if (closedDrawerTx) {
      return fail('Cannot delete a sale associated with a closed cash drawer session.')
    }

    // Heavy reversal transaction — same timeout headroom as updateSaleItems to
    // avoid "commit cannot be executed on an expired transaction" for large orders.
    await prisma.$transaction(async tx => {
      // Row lock Sale to prevent concurrent edits or returns during deletion
      await tx.$executeRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`

      // Revert stock & serial units if NOT a quotation
      if (!sale.isQuotation) {
        // 1. Revert bank balances and transactions.
        // NOTE: Bank balance was INCREMENTED when the sale was created (deposit),
        // so deleting the sale must REVERSE (decrement) the net amount back.
        for (const payment of sale.payments) {
          if (payment.bankAccountId) {
            const netAmount = round2(Number(payment.amount) - Number(payment.feeAmount))
            await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
            await tx.bankAccount.update({
              where: { id: payment.bankAccountId },
              data: { currentBalance: { decrement: netAmount } },
            })
          }
        }
        await tx.bankTransaction.deleteMany({
          where: {
            referenceId: saleId,
            referenceType: 'Sale',
          },
        })

        // 2. Revert cash drawer transactions
        // Bug 2 fix: delete by referenceId (safe) with description fallback for legacy
        // rows created before the referenceId column was added.
        await tx.drawerTransaction.deleteMany({
          where: {
            OR: [
              { referenceId: saleId, referenceType: 'Sale' },
              { description: `Sale ${sale.saleNumber}`, referenceId: null },
            ],
          },
        })

        // 3. Revert Serial Units to IN_STOCK and soldAt to null
        const serialUnitIds: string[] = []
        for (const line of sale.lines) {
          for (const s of line.serials) {
            serialUnitIds.push(s.serialUnitId)
          }
        }

        if (serialUnitIds.length > 0) {
          await tx.serialUnit.updateMany({
            where: { id: { in: serialUnitIds } },
            data: {
              status: SerialStatus.IN_STOCK,
              soldAt: null,
            },
          })

          // Delete SaleLineSerial records
          await tx.saleLineSerial.deleteMany({
            where: {
              saleLineId: { in: sale.lines.map(l => l.id) },
            },
          })
        }

        // 3b. Replenish FIFO StockLayers (restore quantityRemaining) under row lock (Finding #21)
        for (const oldLine of sale.lines) {
          let qtyToRestore = oldLine.quantity
          await tx.$executeRaw`
            SELECT id FROM "StockLayer"
            WHERE "productId" = ${oldLine.productId}
              AND "outletId" = ${sale.outletId}
            FOR UPDATE
          `
          const layers = await tx.stockLayer.findMany({
            where: { productId: oldLine.productId, outletId: sale.outletId },
            orderBy: { receivedAt: 'desc' },
          })
          for (const layer of layers) {
            if (qtyToRestore <= 0) break
            const deficit = layer.quantityReceived - layer.quantityRemaining
            if (deficit > 0) {
              const restore = Math.min(deficit, qtyToRestore)
              await tx.stockLayer.update({
                where: { id: layer.id },
                data: { quantityRemaining: { increment: restore } },
              })
              qtyToRestore -= restore
            }
          }
        }

        // 4. Delete Stock Ledger entries
        await tx.stockLedger.deleteMany({
          where: {
            referenceId: saleId,
            referenceType: 'Sale',
          },
        })

        // 5. Delete Account Ledger entries (both the saleId FK column AND the referenceId payload)
        await tx.accountLedgerEntry.deleteMany({
          where: {
            OR: [{ saleId: saleId }, { referenceId: saleId }],
          },
        })

        // 6. Delete any fee-associated Expense records
        await tx.expense.deleteMany({
          where: {
            description: `MFS/Bank Transaction Fee (Sale ${sale.saleNumber})`,
            outletId: sale.outletId,
          },
        })

        // 7. Revert Customer outstanding balance & delete associated CustomerLedger entries for credit sales
        if (sale.customerId) {
          const customerLedgers = await tx.customerLedger.findMany({
            where: {
              customerId: sale.customerId,
              OR: [
                { referenceId: saleId },
                { description: `Credit Sale ${sale.saleNumber}` },
              ],
            },
          })

          const creditAmountToReverse = customerLedgers.reduce((sum, l) => {
            return l.type === 'DEBIT' ? sum + Number(l.amount) : sum - Number(l.amount)
          }, 0)

          const creditPaymentsTotal = sale.payments
            .filter(p => p.method === 'CREDIT')
            .reduce((sum, p) => sum + Number(p.amount), 0)

          const finalCreditToReverse =
            creditAmountToReverse > 0 ? creditAmountToReverse : creditPaymentsTotal

          if (finalCreditToReverse > 0) {
            await tx.customer.update({
              where: { id: sale.customerId },
              data: {
                outstandingBalance: {
                  decrement: finalCreditToReverse,
                },
              },
            })
          }

          await tx.customerLedger.deleteMany({
            where: {
              customerId: sale.customerId,
              OR: [
                { referenceId: saleId },
                { description: `Credit Sale ${sale.saleNumber}` },
              ],
            },
          })
        }
      }

      // 7. Delete payments
      await tx.salePayment.deleteMany({
        where: {
          saleId: saleId,
        },
      })

      // 8. Delete edit logs
      await tx.saleEditLog.deleteMany({
        where: {
          saleId: saleId,
        },
      })

      // 9. Delete sale lines
      await tx.saleLine.deleteMany({
        where: {
          saleId: saleId,
        },
      })

      // 10. Delete the sale itself
      await tx.sale.delete({
        where: {
          id: saleId,
        },
      })
    }, {
      maxWait: 15000,
      timeout: 60000,
    })

    // Log to Audit trail
    await logAudit('SALE_VOID', 'Sale', sale.id, {
      saleNumber: sale.saleNumber,
      total: Number(sale.total),
      isQuotation: sale.isQuotation,
    })
    // SAL-009: Full sale snapshot in AuditLog payload before deletion for financial traceability
    await logAudit('SALE_DELETE', 'Sale', sale.id, {
      saleNumber: sale.saleNumber,
      total: Number(sale.total),
      subtotal: Number(sale.subtotal),
      discountAmt: Number(sale.discountAmt),
      taxAmt: Number(sale.taxAmt),
      amountPaid: Number(sale.amountPaid),
      customerId: sale.customerId,
      outletId: sale.outletId,
      createdAt: sale.createdAt,
      lines: sale.lines.map(l => ({
        id: l.id,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        unitCost: Number(l.unitCost),
        total: Number(l.total),
        discountAmt: Number(l.discountAmt),
        isGift: l.isGift,
        serials: l.serials.map(s => ({
          serialUnitId: s.serialUnitId,
          serialNumber: s.serialUnit?.serialNumber,
        })),
      })),
      payments: sale.payments.map(p => ({
        id: p.id,
        method: p.method,
        amount: Number(p.amount),
        feeAmount: Number(p.feeAmount),
        bankAccountId: p.bankAccountId,
        reference: p.reference,
      })),
    })

    revalidatePath('/sales-orders/invoices')
    revalidatePath('/reports/sales')
    revalidatePath('/orders')

    return ok({ id: saleId })
  } catch (error: any) {
    return fail(error?.message || 'Failed to delete sale invoice')
  }
}

// ── EDIT SALE: fetch existing sale data for the POS terminal ──
export async function getSaleForEdit(saleId: string) {
  const user = await requireAuth()

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, outletId: user.outletId, isQuotation: false },
    select: {
      id: true,
      saleNumber: true,
      customerId: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          group: { select: { discountPct: true, name: true } },
        },
      },
      lines: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          discountPct: true,
          isGift: true,
          note: true,
          product: {
            select: {
              id: true,
              name: true,
              requiresSerial: true,
              sellingPrice: true,
              category: { select: { name: true } },
              condition: true,
            },
          },
          serials: {
            select: { serialUnit: { select: { serialNumber: true } } },
          },
        },
      },
    },
  })

  if (!sale) return fail('Sale not found')

  return ok({
    saleId: sale.id,
    saleNumber: sale.saleNumber,
    customerId: sale.customerId,
    customerName: sale.customer?.name ?? null,
    customerPhone: sale.customer?.phone ?? null,
    groupDiscountPct: sale.customer?.group?.discountPct
      ? Number(sale.customer.group.discountPct)
      : 0,
    groupName: sale.customer?.group?.name ?? null,
    lines: sale.lines.map(line => ({
      productId: line.productId,
      productName: line.product.name,
      productCategory: line.product.category?.name ?? '',
      productCondition: line.product.condition ?? undefined,
      productRequiresSerial: line.product.requiresSerial,
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      quantity: line.quantity,
      isGift: line.isGift,
      note: line.note ?? undefined,
      serials: line.serials.map(s => s.serialUnit.serialNumber),
    })),
  })
}

// ── RESUBMIT SALE EDIT: temporarily restore serials → checkout → delete original ──
const resubmitSaleEditSchema = z.object({
  originalSaleId: z.string().min(1),
  reason: z.string().min(5, 'Please provide a reason (min 5 chars)'),
  customerId: z.string().min(1, 'Customer is required'),
  lines: z.array(saleLineSchema).min(1),
  complimentaryGifts: z.array(complimentaryGiftOptionSchema).default([]),
  payments: z.array(salePaymentSchema).min(1),
  orderDiscountPct: z.coerce.number().min(0).max(100).default(0),
  overrideApproverId: z.string().optional(),
  overridePin: z.string().optional(),
  notes: z.string().optional(),
  saleDate: z.coerce.date().optional(),
})

export async function resubmitSaleEdit(
  data: z.input<typeof resubmitSaleEditSchema>
) {
  try {
    const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    const parsed = resubmitSaleEditSchema.safeParse(data)
    if (!parsed.success) return fail(parsed.error.issues[0].message)

    const {
      originalSaleId,
      reason,
      customerId,
      lines,
      complimentaryGifts,
      payments,
      orderDiscountPct,
      overrideApproverId,
      overridePin,
      notes,
      saleDate,
    } = parsed.data

    let newSaleResult: {
      id: string
      saleNumber: string
      total: number
      changeDue: number
    }

    await prisma.$transaction(
      async tx => {
        // 1. Lock and verify original sale belongs to this outlet
        await tx.$executeRaw`SELECT id FROM "Sale" WHERE id = ${originalSaleId} FOR UPDATE`

        const originalSale = await tx.sale.findFirst({
          where: { id: originalSaleId, outletId: user.outletId, isQuotation: false },
          include: {
            lines: {
              include: {
                serials: { include: { serialUnit: true } },
              },
            },
            payments: true,
            returns: true,
          },
        })
        if (!originalSale) throw new Error('Original sale not found')
        if (originalSale.returns && originalSale.returns.length > 0) {
          throw new Error('Cannot edit a sale invoice that has return records.')
        }

        // SAL-008: Block edits on a sale whose original drawer session is already CLOSED
        const closedDrawerTx = await tx.drawerTransaction.findFirst({
          where: {
            OR: [
              { referenceId: originalSaleId, referenceType: 'Sale' },
              { description: `Sale ${originalSale.saleNumber}`, referenceId: null },
            ],
            drawer: { status: DrawerStatus.CLOSED },
          },
        })
        if (closedDrawerTx) {
          throw new Error('Cannot edit a sale associated with a closed cash drawer session.')
        }

        // 2. Revert Serial Units to IN_STOCK & clear soldAt
        const serialUnitIds: string[] = []
        for (const line of originalSale.lines) {
          for (const s of line.serials) {
            serialUnitIds.push(s.serialUnitId)
          }
        }
        if (serialUnitIds.length > 0) {
          await tx.serialUnit.updateMany({
            where: { id: { in: serialUnitIds } },
            data: { status: SerialStatus.IN_STOCK, soldAt: null },
          })
          await tx.saleLineSerial.deleteMany({
            where: { saleLineId: { in: originalSale.lines.map(l => l.id) } },
          })
        }

        // 3. Replenish FIFO StockLayers (restore quantityRemaining) under row lock
        for (const oldLine of originalSale.lines) {
          let qtyToRestore = oldLine.quantity
          await tx.$executeRaw`
            SELECT id FROM "StockLayer"
            WHERE "productId" = ${oldLine.productId}
              AND "outletId" = ${originalSale.outletId}
            FOR UPDATE
          `
          const layers = await tx.stockLayer.findMany({
            where: { productId: oldLine.productId, outletId: originalSale.outletId },
            orderBy: { receivedAt: 'desc' },
          })
          for (const layer of layers) {
            if (qtyToRestore <= 0) break
            const deficit = layer.quantityReceived - layer.quantityRemaining
            if (deficit > 0) {
              const restore = Math.min(deficit, qtyToRestore)
              await tx.stockLayer.update({
                where: { id: layer.id },
                data: { quantityRemaining: { increment: restore } },
              })
              qtyToRestore -= restore
            }
          }
        }

        // 4. Delete the original sale's StockLedger entries
        await tx.stockLedger.deleteMany({
          where: { referenceId: originalSaleId, referenceType: 'Sale' },
        })

        // 5. Revert Bank balances & transactions
        // NOTE: Bank balance was INCREMENTED when the sale was created (deposit),
        // so reversing the sale must REVERSE (decrement) the net amount back.
        for (const payment of originalSale.payments) {
          if (payment.bankAccountId) {
            const netAmount = round2(Number(payment.amount) - Number(payment.feeAmount))
            await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
            await tx.bankAccount.update({
              where: { id: payment.bankAccountId },
              data: { currentBalance: { decrement: netAmount } },
            })
          }
        }
        await tx.bankTransaction.deleteMany({
          where: { referenceId: originalSaleId, referenceType: 'Sale' },
        })

        // 6. Revert Cash drawer transactions
        // Bug 2 fix: delete by referenceId (safe) with description fallback for legacy
        // rows created before the referenceId column was added.
        await tx.drawerTransaction.deleteMany({
          where: {
            OR: [
              { referenceId: originalSaleId, referenceType: 'Sale' },
              { description: `Sale ${originalSale.saleNumber}`, referenceId: null },
            ],
          },
        })

        // 7. Delete old AccountLedgerEntry, fee Expense, and Customer balance/ledger
        await tx.accountLedgerEntry.deleteMany({
          where: { OR: [{ saleId: originalSaleId }, { referenceId: originalSaleId }] },
        })
        await tx.expense.deleteMany({
          where: {
            description: `MFS/Bank Transaction Fee (Sale ${originalSale.saleNumber})`,
            outletId: originalSale.outletId,
          },
        })
        if (originalSale.customerId) {
          const customerLedgers = await tx.customerLedger.findMany({
            where: {
              customerId: originalSale.customerId,
              OR: [
                { referenceId: originalSaleId },
                { description: `Credit Sale ${originalSale.saleNumber}` },
              ],
            },
          })
          const creditToReverse = customerLedgers.reduce((sum, l) => {
            return l.type === 'DEBIT' ? sum + Number(l.amount) : sum - Number(l.amount)
          }, 0)
          if (creditToReverse > 0) {
            await tx.customer.update({
              where: { id: originalSale.customerId },
              data: { outstandingBalance: { decrement: creditToReverse } },
            })
          }
          await tx.customerLedger.deleteMany({
            where: {
              customerId: originalSale.customerId,
              OR: [
                { referenceId: originalSaleId },
                { description: `Credit Sale ${originalSale.saleNumber}` },
              ],
            },
          })
        }

        // 8. Delete old payments, edit logs, lines, and the sale itself
        await tx.salePayment.deleteMany({ where: { saleId: originalSaleId } })
        await tx.saleEditLog.deleteMany({ where: { saleId: originalSaleId } })
        await tx.saleLine.deleteMany({ where: { saleId: originalSaleId } })
        await tx.sale.delete({ where: { id: originalSaleId } })

        // 9. Execute checkout passing the active transaction `tx`
        const checkoutResult = await checkout(
          {
            customerId,
            lines,
            complimentaryGifts,
            payments,
            orderDiscountPct,
            isQuotation: false,
            overrideApproverId,
            overridePin,
            notes,
            saleDate: saleDate ?? originalSale.createdAt,
          },
          tx
        )

        if (!checkoutResult.success) {
          throw new Error(checkoutResult.error)
        }

        const newSaleId = checkoutResult.data.id

        // 10. Record the edit in the new sale's audit log
        await tx.saleEditLog.create({
          data: {
            saleId: newSaleId,
            editedById: user.id,
            fieldName: 'full_resubmit',
            oldValue: originalSale.saleNumber,
            newValue: checkoutResult.data.saleNumber,
            reason,
          },
        })

        newSaleResult = {
          id: newSaleId,
          saleNumber: checkoutResult.data.saleNumber,
          total: Number(checkoutResult.data.total),
          changeDue: Number(checkoutResult.data.changeDue),
        }
      },
      { timeout: 45000, maxWait: 15000 }
    )

    await logAudit('SALE_EDIT', 'Sale', newSaleResult!.id, {
      originalSaleId,
      newSaleNumber: newSaleResult!.saleNumber,
      reason,
    })

    safeRevalidatePath('/sales-orders/invoices')
    safeRevalidatePath(`/sales-orders/invoices/${newSaleResult!.id}`)
    safeRevalidatePath('/reports/sales')

    return ok(newSaleResult!)
  } catch (error: any) {
    return fail(error?.message || 'Failed to resubmit sale edit')
  }
}
