'use server'

import { requireAuth, requireRole, requireSensitiveRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit/logger'
import { checkAndNotifyLowStock } from '@/lib/notifications/triggers/low-stock'
import { ProductCondition, PaymentMethod, SerialStatus, StockMovementType, TransactionType, UserRole, Prisma } from '@prisma/client'
import { revalidatePath, revalidateTag } from 'next/cache'

function safeRevalidateTag(tag: string) {
  try {
    ;(revalidateTag as any)(tag, 'max')
  } catch {
    // Ignore outside Next.js request context
  }
}
import { z } from 'zod'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import {
  consumeStockLayers,
  type ConsumedLayerBatch,
} from '@/lib/inventory/stock-layers'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { formatProductFullName } from '@/lib/utils/product-name'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

type ProductListStatus = 'active' | 'archived'

type ProductListFilters = {
  search?: string
  status?: ProductListStatus
  categoryId?: string
  brandId?: string
  condition?: ProductCondition
  stock?: 'all' | 'in_stock' | 'out_of_stock' | string
  inStock?: boolean | string
  page?: number
  pageSize?: number
  includeSerials?: boolean
}

const productSchema = z.object({
  name: z.string().min(2),
  productCode: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  barcode: z.string().optional(),
  parentId: z.string().optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  brandId: z.string().optional(),
  series: z.string().optional(),
  condition: z.nativeEnum(ProductCondition).default(ProductCondition.NEW),
  model: z.string().optional(),
  processorId: z.string().optional(),
  processorGenId: z.string().optional(),
  storageId: z.string().optional(),
  ramId: z.string().optional(),
  ramType: z.string().optional(),
  display: z.string().optional(),
  displayType: z.string().optional(),
  displaySize: z.string().optional(),
  displayResolution: z.string().optional(),
  feature1: z.string().optional(),
  feature2: z.string().optional(),
  color: z.string().optional(),
  costPrice: z.coerce.number().min(0).max(100_000_000, 'Cost price cannot exceed 100,000,000').default(0),
  sellingPrice: z.coerce.number().min(0).max(100_000_000, 'Selling price cannot exceed 100,000,000').default(0),
  warrantyMonths: z.coerce.number().int().min(0).optional(),
  requiresSerial: z.coerce.boolean().default(false),
  imageUrl: z.string().optional(),
  taxRateId: z.string().optional(),
})

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path)
  } catch {
    // Ignore static generation store missing error outside Next.js request context
  }
}

function isNonSerializedLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized.includes('accessor') || normalized.includes('gift')
}

async function shouldForceSerialOff(params: {
  categoryId?: string
  parentId?: string
  name?: string
}) {
  const [category, parent] = await Promise.all([
    params.categoryId
      ? prisma.category.findUnique({
          where: { id: params.categoryId },
          select: { name: true },
        })
      : null,
    params.parentId
      ? prisma.parentProduct.findUnique({
          where: { id: params.parentId },
          select: { name: true },
        })
      : null,
  ])

  return (
    isNonSerializedLabel(category?.name) ||
    isNonSerializedLabel(parent?.name) ||
    isNonSerializedLabel(params.name)
  )
}

async function generateUniqueProductCode(name: string) {
  const prefix =
    name
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'PRD'

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${prefix}-${Date.now().toString().slice(-6)}${attempt}`
    const existing = await prisma.product.findUnique({
      where: { productCode: candidate },
      select: { id: true },
    })

    if (!existing) return candidate
  }

  return `PRD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

function cleanToken(str: string | null | undefined, maxLen = 4): string {
  if (!str) return ''
  return str
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLen)
}

function _extractBrandToken(brandName: string | null | undefined, productName?: string): string {
  const brand = (brandName || '').trim().toUpperCase()
  if (brand) {
    if (brand.includes('DELL')) return 'DEL'
    if (brand.includes('HP') || brand.includes('HEWLETT')) return 'HP'
    if (brand.includes('LENOVO')) return 'LEN'
    if (brand.includes('APPLE') || brand.includes('MACBOOK')) return 'APP'
    if (brand.includes('SAMSUNG')) return 'SAM'
    if (brand.includes('ASUS')) return 'ASU'
    if (brand.includes('ACER')) return 'ACE'
    if (brand.includes('MSI')) return 'MSI'
    if (brand.includes('TOSHIBA')) return 'TOS'
    if (brand.includes('SONY')) return 'SNY'
    if (brand.includes('LOGITECH')) return 'LOG'
    if (brand.includes('RAZER')) return 'RAZ'
    if (brand.includes('CORSAIR')) return 'COR'
    if (brand.includes('GIGABYTE')) return 'GB'
    if (brand.includes('INTEL')) return 'INT'
    if (brand.includes('AMD')) return 'AMD'
    if (brand.includes('CANON')) return 'CAN'
    if (brand.includes('EPSON')) return 'EPS'
    if (brand.includes('BROTHER')) return 'BRO'
    return cleanToken(brand, 3) || 'GEN'
  }

  // Fallback: check productName
  const nameUpper = (productName || '').toUpperCase()
  if (nameUpper.includes('DELL')) return 'DEL'
  if (nameUpper.includes('HP') || nameUpper.includes('HEWLETT')) return 'HP'
  if (nameUpper.includes('LENOVO')) return 'LEN'
  if (nameUpper.includes('APPLE') || nameUpper.includes('MACBOOK')) return 'APP'
  if (nameUpper.includes('SAMSUNG')) return 'SAM'
  if (nameUpper.includes('ASUS')) return 'ASU'
  if (nameUpper.includes('ACER')) return 'ACE'
  if (nameUpper.includes('LOGITECH')) return 'LOG'
  return 'GEN'
}

function extractCategoryToken(categoryName: string | null | undefined, productName?: string): string {
  const cat = (categoryName || '').trim().toUpperCase()
  if (cat) {
    if (cat.includes('LAPTOP') || cat.includes('NOTEBOOK') || cat.includes('ULTRABOOK')) return 'LAP'
    if (cat.includes('ACCESSOR')) return 'ACC'
    if (cat.includes('DESKTOP') || cat.includes('ALL-IN-ONE') || cat.includes('TOWER')) return 'DSK'
    if (cat.includes('MONITOR') || cat.includes('DISPLAY')) return 'MON'
    if (cat.includes('COMPONENT')) return 'CMP'
    if (cat.includes('RAM') || cat.includes('MEMORY')) return 'RAM'
    if (cat.includes('STORAGE') || cat.includes('SSD') || cat.includes('HDD')) return 'STO'
    if (cat.includes('NETWORKING') || cat.includes('ROUTER')) return 'NET'
    if (cat.includes('KEYBOARD')) return 'KBD'
    if (cat.includes('MOUSE')) return 'MOU'
    if (cat.includes('PRINTER')) return 'PRN'
    if (cat.includes('SERVICE')) return 'SRV'
    return cleanToken(cat, 3) || 'GEN'
  }

  // Fallback: check productName
  const nameUpper = (productName || '').toUpperCase()
  if (
    nameUpper.includes('MOUSE') ||
    nameUpper.includes('KEYBOARD') ||
    nameUpper.includes('CABLE') ||
    nameUpper.includes('CHARGER') ||
    nameUpper.includes('ADAPTER') ||
    nameUpper.includes('ACCESSOR') ||
    nameUpper.includes('HEADSET') ||
    nameUpper.includes('EARBUDS') ||
    nameUpper.includes('HEADPHONE') ||
    nameUpper.includes('MICROSD') ||
    nameUpper.includes('SDXC') ||
    nameUpper.includes('CASE') ||
    nameUpper.includes('BAG') ||
    nameUpper.includes('SLEEVE') ||
    nameUpper.includes('HUB') ||
    nameUpper.includes('DOCK') ||
    nameUpper.includes('STAND')
  ) {
    return 'ACC'
  }
  if (
    nameUpper.includes('RAM') ||
    nameUpper.includes('MEMORY') ||
    nameUpper.includes('SSD') ||
    nameUpper.includes('HDD') ||
    nameUpper.includes('NVME') ||
    nameUpper.includes('MOTHERBOARD') ||
    nameUpper.includes('GPU') ||
    nameUpper.includes('PROCESSOR') ||
    nameUpper.includes('CPU') ||
    nameUpper.includes('PSU') ||
    nameUpper.includes('COOLER')
  ) {
    return 'CMP'
  }
  if (nameUpper.includes('ROUTER') || nameUpper.includes('SWITCH') || nameUpper.includes('NETWORKING')) return 'NET'
  if (nameUpper.includes('PRINTER') || nameUpper.includes('SCANNER')) return 'PRN'
  if (nameUpper.includes('MONITOR') || nameUpper.includes('DISPLAY')) return 'MON'
  if (
    nameUpper.includes('DESKTOP') ||
    nameUpper.includes('OPTIPLEX') ||
    nameUpper.includes('PRODESK') ||
    nameUpper.includes('ELITEDESK') ||
    nameUpper.includes('THINKCENTRE') ||
    nameUpper.includes('WORKSTATION') ||
    nameUpper.includes('TOWER')
  ) {
    return 'DSK'
  }
  if (
    nameUpper.includes('LAPTOP') ||
    nameUpper.includes('NOTEBOOK') ||
    nameUpper.includes('ULTRABOOK') ||
    nameUpper.includes('LATITUDE') ||
    nameUpper.includes('THINKPAD') ||
    nameUpper.includes('ELITEBOOK') ||
    nameUpper.includes('MACBOOK') ||
    nameUpper.includes('XPS') ||
    nameUpper.includes('INSPIRON') ||
    nameUpper.includes('PROBOOK') ||
    nameUpper.includes('VOSTRO') ||
    nameUpper.includes('YOGA') ||
    nameUpper.includes('PAVILION') ||
    nameUpper.includes('ENVY') ||
    nameUpper.includes('ZENBOOK') ||
    nameUpper.includes('SWIFT') ||
    nameUpper.includes('SURFACE') ||
    nameUpper.includes('IDEAPAD')
  ) {
    return 'LAP'
  }

  return 'GEN'
}

function _extractModelToken(model: string | null | undefined, name: string): string {
  const modelClean = (model || '').trim().toUpperCase()
  
  if (modelClean) {
    // Check if model contains clear number like 840, 5300, 7490, 3120, 3511, 450, 650, 1030, etc.
    const numMatch = modelClean.match(/\b([A-Z]?\d{3,5}[A-Z\d]?)\b/)
    if (numMatch) {
      return numMatch[1]
    }
    // Check for alphanumeric like T480, X1, G5, M1, M2, M3, G3
    const alphaNum = modelClean.match(/\b([A-Z]\d{2,4}|\d{2,4}[A-Z]{1,2})\b/)
    if (alphaNum) {
      return alphaNum[1]
    }
    // Otherwise clean words
    const words = modelClean.replace(/[^A-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean)
    if (words.length > 0) {
      return words[0].slice(0, 6)
    }
  }

  // Remove RAM (e.g. 16GB) and Storage (e.g. 512GB, 1TB) from name first to avoid false model match
  const nameWithoutSpecs = (name || '')
    .toUpperCase()
    .replace(/\b\d{1,3}\s*GB\b/g, ' ')
    .replace(/\b\d{1,4}\s*(?:GB|TB)\s*(?:SSD|HDD|NVME|M\.2|MICROSDXC|SDXC|CARD)?\b/g, ' ')
    .trim()

  // Check product name for model numbers like 840, 5300, 7490, T480, G5, etc.
  const nameNumMatch = nameWithoutSpecs.match(/\b([A-Z]?\d{3,5}[A-Z\d]?)\b/)
  if (nameNumMatch) {
    return nameNumMatch[1]
  }
  const nameAlphaMatch = nameWithoutSpecs.match(/\b([A-Z]\d{2,4}|\d{2,4}[A-Z]{1,2})\b/)
  if (nameAlphaMatch) {
    return nameAlphaMatch[1]
  }

  const nameWords = nameWithoutSpecs
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => !['DELL', 'HP', 'LENOVO', 'APPLE', 'MACBOOK', 'SAMSUNG', 'ASUS', 'ACER', 'LAPTOP', 'THE', 'CORE', 'INTEL', 'AMD', 'PRO', 'PLUS', 'CARD', 'MICROSD', 'MICROSDXC'].includes(w))

  if (nameWords.length > 0) {
    return nameWords[0].slice(0, 6)
  }

  return 'ITEM'
}

function _extractRamToken(ramName: string | null | undefined, name?: string): string | null {
  if (ramName?.trim()) {
    const match = ramName.toUpperCase().match(/\b(\d{1,3})\s*GB\b/)
    if (match) return match[1]
  }

  // From name: only match if explicitly followed or preceded by RAM/DDR or if paired with storage (e.g. 16GB/512GB)
  const nameUpper = (name || '').toUpperCase()
  const explicitRam = nameUpper.match(/\b(\d{1,2})\s*GB\s*(?:RAM|DDR\d?|MEMORY)\b/)
  if (explicitRam) {
    return explicitRam[1]
  }
  const explicitRamBefore = nameUpper.match(/\b(?:RAM|DDR\d?)\s*[:=]?\s*(\d{1,2})\s*GB\b/)
  if (explicitRamBefore) {
    return explicitRamBefore[1]
  }

  // Paired pattern like "16GB/512GB" or "16GB + 512GB"
  const dualMatch = nameUpper.match(/\b(\d{1,2})\s*GB\s*[\/\+]\s*(\d{2,4})\s*(?:GB|TB)\b/)
  if (dualMatch) {
    return dualMatch[1]
  }

  return null
}

function _extractStorageToken(storageName: string | null | undefined, name?: string): string | null {
  if (storageName?.trim()) {
    const s = storageName.toUpperCase()
    const tbMatch = s.match(/\b(\d)\s*TB\b/)
    if (tbMatch) return `${tbMatch[1]}TB`
    const gbMatch = s.match(/\b(\d{2,4})\s*(?:GB)?\b/)
    if (gbMatch) return gbMatch[1]
  }

  const nameUpper = (name || '').toUpperCase()
  const tbMatch = nameUpper.match(/\b(\d)\s*TB\b/)
  if (tbMatch) {
    return `${tbMatch[1]}TB`
  }

  const dualMatch = nameUpper.match(/\b\d{1,2}\s*GB\s*[\/\+]\s*(\d{2,4})\s*(?:GB|TB)\b/)
  if (dualMatch) {
    return dualMatch[1]
  }

  // Match 64GB, 128GB, 256GB, 512GB, 1024GB, etc.
  const gbMatch = nameUpper.match(/\b(\d{2,4})\s*GB\s*(?:SSD|HDD|NVME|M\.2|ROM|MICROSD|SDXC|CARD|STORAGE)?\b/)
  if (gbMatch) {
    return gbMatch[1]
  }

  return null
}

async function generateUniqueSku(params: {
  name: string
  categoryId?: string
  parentId?: string
  brandId?: string
  model?: string
  ramId?: string
  storageId?: string
  series?: string
}) {
  let categoryName: string | null | undefined = null

  if (params.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: params.categoryId },
      select: { name: true },
    })
    categoryName = category?.name
  } else if (params.parentId) {
    const parent = await prisma.parentProduct.findUnique({
      where: { id: params.parentId },
      select: { name: true },
    })
    categoryName = parent?.name
  }

  const categoryCode = extractCategoryToken(categoryName, params.name)
  const prefix = `TD-${categoryCode}`

  // Query existing products matching prefix to find the highest sequential number
  const existingProducts = await prisma.product.findMany({
    where: {
      sku: {
        startsWith: `${prefix}-`,
      },
    },
    select: { sku: true },
  })

  let maxNum = 0
  const seqRegex = new RegExp(`^${prefix}-(\\d+)`)
  for (const p of existingProducts) {
    if (!p.sku) continue
    const match = p.sku.match(seqRegex)
    if (match) {
      const num = parseInt(match[1], 10)
      if (!isNaN(num) && num > maxNum) {
        maxNum = num
      }
    }
  }

  let nextNum = maxNum + 1
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`
    const existing = await prisma.product.findUnique({
      where: { sku: candidate },
      select: { id: true },
    })

    if (!existing) return candidate
    nextNum += 1
  }

  return `${prefix}-${Date.now().toString().slice(-4)}`
}

export async function createProduct(formData: FormData) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )

  const raw = Object.fromEntries(formData) as Record<string, string>
  raw.costPrice = raw.costPrice || raw.purchasePrice || '0'
  raw.sellingPrice = raw.sellingPrice || '0'

  if (typeof raw.condition === 'string' && raw.condition.trim()) {
    raw.condition = raw.condition.trim().toUpperCase()
  } else {
    delete raw.condition
  }

  // Fix: z.coerce.boolean() treats any non-empty string as true, so normalise explicitly
  raw.requiresSerial = raw.requiresSerial === 'true' ? 'true' : 'false'

  const serialNumber = raw.serialNumber?.trim() || undefined

  const parsed = productSchema.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const cleanId = (val: string | null | undefined) => {
    const trimmed = val?.trim()
    return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : null
  }

  const cleanString = (val: string | null | undefined) => {
    const trimmed = val?.trim()
    return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : null
  }

  const cleanNumber = (val: number | null | undefined, fallback = 0) => {
    if (typeof val === 'number' && !isNaN(val)) return val
    return fallback
  }

  const categoryId = cleanId(parsed.data.categoryId)
  const parentId = cleanId(parsed.data.parentId)

  const forceSerialOffForAccessory = await shouldForceSerialOff({
    categoryId: categoryId ?? undefined,
    parentId: parentId ?? undefined,
    name: parsed.data.name,
  })

  const requiresSerial = forceSerialOffForAccessory
    ? false
    : parsed.data.requiresSerial

  const sku =
    parsed.data.sku?.trim() ||
    (await generateUniqueSku({
      name: parsed.data.name,
      categoryId: categoryId ?? undefined,
      parentId: parentId ?? undefined,
      brandId: cleanId(parsed.data.brandId) ?? undefined,
      model: cleanString(parsed.data.model) ?? undefined,
      ramId: cleanId(parsed.data.ramId) ?? undefined,
      storageId: cleanId(parsed.data.storageId) ?? undefined,
      series: cleanString(parsed.data.series) ?? undefined,
    }))

  const productCode =
    parsed.data.productCode?.trim() ||
    (await generateUniqueProductCode(parsed.data.name))

  const existing = await prisma.product.findUnique({
    where: { productCode },
  })
  if (existing) return fail('Product code already exists')

  const existingSku = await prisma.product.findUnique({
    where: { sku },
    select: { id: true },
  })
  if (existingSku) return fail('SKU already exists')

  const barcode = cleanString(parsed.data.barcode)
  if (barcode) {
    const existingBarcode = await prisma.product.findFirst({
      where: { barcode, isActive: true },
      select: { id: true, name: true },
    })
    if (existingBarcode) {
      return fail(`Barcode "${barcode}" is already assigned to "${existingBarcode.name}"`)
    }
  }

  const product = await prisma.product.create({
    data: {
      name: parsed.data.name.trim(),
      productCode,
      sku,
      barcode: cleanString(parsed.data.barcode),
      parentId,
      categoryId,
      subcategoryId: cleanId(parsed.data.subcategoryId),
      brandId: cleanId(parsed.data.brandId),
      series: cleanString(parsed.data.series),
      condition: parsed.data.condition ?? ProductCondition.NEW,
      model: cleanString(parsed.data.model),
      color: cleanString(parsed.data.color),
      processorId: cleanId(parsed.data.processorId),
      processorGenId: cleanId(parsed.data.processorGenId),
      storageId: cleanId(parsed.data.storageId),
      ramId: cleanId(parsed.data.ramId),
      ramType: cleanString(parsed.data.ramType),
      display: cleanString(parsed.data.display),
      displayType: cleanString(parsed.data.displayType),
      displaySize: cleanString(parsed.data.displaySize),
      displayResolution: cleanString(parsed.data.displayResolution),
      feature1: cleanString(parsed.data.feature1),
      feature2: cleanString(parsed.data.feature2),
      costPrice: cleanNumber(parsed.data.costPrice, 0),
      sellingPrice: cleanNumber(parsed.data.sellingPrice, 0),
      warrantyMonths: typeof parsed.data.warrantyMonths === 'number' ? parsed.data.warrantyMonths : null,
      requiresSerial,
      imageUrl: cleanString(parsed.data.imageUrl),
      taxRateId: cleanId(parsed.data.taxRateId),
      outletId: user.outletId,
    },
  })

  // Allow an initial serial to be stored even for accessory items.
  if (serialNumber) {
    await prisma.serialUnit.create({
      data: {
        serialNumber,
        productId: product.id,
        outletId: user.outletId,
        status: SerialStatus.IN_STOCK,
      },
    })
  }

  revalidatePath('/products')
  revalidatePath('/create-products')
  if (product.outletId) {
    safeRevalidateTag(`dashboard-${product.outletId}`)
  }
  return ok({ id: product.id, name: product.name })
}

export async function updateProduct(id: string, formData: FormData) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )

  const existingProduct = await prisma.product.findFirst({
    where: {
      id,
      outletId: user.outletId,
      isActive: true,
    },
    select: { id: true, name: true, categoryId: true, parentId: true, sellingPrice: true, costPrice: true },
  })

  if (!existingProduct) return fail('Product not found')

  const raw = Object.fromEntries(formData) as Record<string, string>
  if (raw.purchasePrice && !raw.costPrice) {
    raw.costPrice = raw.purchasePrice
  }

  if (typeof raw.condition === 'string' && raw.condition.trim()) {
    raw.condition = raw.condition.trim().toUpperCase()
  } else {
    delete raw.condition
  }

  if (raw.requiresSerial !== undefined) {
    raw.requiresSerial = raw.requiresSerial === 'true' ? 'true' : 'false'
  }

  const parsed = productSchema.partial().safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const cleanId = (val: string | null | undefined) => {
    const trimmed = val?.trim()
    return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : null
  }

  const cleanString = (val: string | null | undefined) => {
    const trimmed = val?.trim()
    return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : null
  }

  const cleanNumber = (val: number | null | undefined, fallback = 0) => {
    if (typeof val === 'number' && !isNaN(val)) return val
    return fallback
  }

  const updates = {
    ...parsed.data,
    ...(parsed.data.sku ? { sku: parsed.data.sku.trim() } : {}),
    ...(parsed.data.productCode
      ? { productCode: parsed.data.productCode.trim() }
      : {}),
  }

  const sellingPriceChanged =
    updates.sellingPrice !== undefined &&
    Number(updates.sellingPrice).toFixed(2) !== Number(existingProduct.sellingPrice).toFixed(2)

  const costPriceChanged =
    updates.costPrice !== undefined &&
    Number(updates.costPrice).toFixed(2) !== Number(existingProduct.costPrice).toFixed(2)

  if (sellingPriceChanged || costPriceChanged) {
    try {
      await requireSensitiveRole(
        'updateProductPrice',
        UserRole.SUPER_ADMIN,
        UserRole.ADMIN,
        UserRole.MANAGER
      )
    } catch {
      return fail('Forbidden: Only managers or admins can update product prices')
    }
  }

  const forceSerialOffForAccessory = await shouldForceSerialOff({
    categoryId: updates.categoryId ? cleanId(updates.categoryId) ?? undefined : existingProduct.categoryId ?? undefined,
    parentId: updates.parentId ? cleanId(updates.parentId) ?? undefined : existingProduct.parentId ?? undefined,
    name: updates.name || existingProduct.name,
  })

  if (forceSerialOffForAccessory) {
    updates.requiresSerial = false
  }

  if (updates.productCode) {
    const duplicateCode = await prisma.product.findFirst({
      where: {
        productCode: updates.productCode,
        id: { not: id },
      },
      select: { id: true },
    })

    if (duplicateCode) return fail('Product code already exists')
  }

  if (updates.sku) {
    const duplicateSku = await prisma.product.findFirst({
      where: {
        sku: updates.sku,
        id: { not: id },
      },
      select: { id: true },
    })

    if (duplicateSku) return fail('SKU already exists')
  }

  const cleanedBarcode = cleanString(updates.barcode)
  if (cleanedBarcode) {
    const duplicateBarcode = await prisma.product.findFirst({
      where: {
        barcode: cleanedBarcode,
        id: { not: id },
        isActive: true,
      },
      select: { id: true, name: true },
    })

    if (duplicateBarcode) {
      return fail(`Barcode "${cleanedBarcode}" is already assigned to "${duplicateBarcode.name}"`)
    }
  }

  const updateData: Prisma.ProductUpdateInput = {
    ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
    ...(updates.productCode ? { productCode: updates.productCode } : {}),
    ...(updates.sku ? { sku: updates.sku } : {}),
    ...(parsed.data.barcode !== undefined ? { barcode: cleanString(parsed.data.barcode) } : {}),
    ...(parsed.data.parentId !== undefined ? { parent: cleanId(parsed.data.parentId) ? { connect: { id: cleanId(parsed.data.parentId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.categoryId !== undefined ? { category: cleanId(parsed.data.categoryId) ? { connect: { id: cleanId(parsed.data.categoryId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.subcategoryId !== undefined ? { subcategory: cleanId(parsed.data.subcategoryId) ? { connect: { id: cleanId(parsed.data.subcategoryId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.brandId !== undefined ? { brand: cleanId(parsed.data.brandId) ? { connect: { id: cleanId(parsed.data.brandId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.series !== undefined ? { series: cleanString(parsed.data.series) } : {}),
    ...(parsed.data.condition !== undefined ? { condition: parsed.data.condition } : {}),
    ...(parsed.data.model !== undefined ? { model: cleanString(parsed.data.model) } : {}),
    ...(parsed.data.color !== undefined ? { color: cleanString(parsed.data.color) } : {}),
    ...(parsed.data.processorId !== undefined ? { processor: cleanId(parsed.data.processorId) ? { connect: { id: cleanId(parsed.data.processorId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.processorGenId !== undefined ? { processorGen: cleanId(parsed.data.processorGenId) ? { connect: { id: cleanId(parsed.data.processorGenId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.storageId !== undefined ? { storage: cleanId(parsed.data.storageId) ? { connect: { id: cleanId(parsed.data.storageId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.ramId !== undefined ? { ram: cleanId(parsed.data.ramId) ? { connect: { id: cleanId(parsed.data.ramId)! } } : { disconnect: true } } : {}),
    ...(parsed.data.ramType !== undefined ? { ramType: cleanString(parsed.data.ramType) } : {}),
    ...(parsed.data.display !== undefined ? { display: cleanString(parsed.data.display) } : {}),
    ...(parsed.data.displayType !== undefined ? { displayType: cleanString(parsed.data.displayType) } : {}),
    ...(parsed.data.displaySize !== undefined ? { displaySize: cleanString(parsed.data.displaySize) } : {}),
    ...(parsed.data.displayResolution !== undefined ? { displayResolution: cleanString(parsed.data.displayResolution) } : {}),
    ...(parsed.data.feature1 !== undefined ? { feature1: cleanString(parsed.data.feature1) } : {}),
    ...(parsed.data.feature2 !== undefined ? { feature2: cleanString(parsed.data.feature2) } : {}),
    ...(parsed.data.costPrice !== undefined ? { costPrice: cleanNumber(parsed.data.costPrice, 0) } : {}),
    ...(parsed.data.sellingPrice !== undefined ? { sellingPrice: cleanNumber(parsed.data.sellingPrice, 0) } : {}),
    ...(parsed.data.warrantyMonths !== undefined ? { warrantyMonths: parsed.data.warrantyMonths } : {}),
    ...(updates.requiresSerial !== undefined ? { requiresSerial: updates.requiresSerial } : {}),
    ...(parsed.data.imageUrl !== undefined ? { imageUrl: cleanString(parsed.data.imageUrl) } : {}),
    ...(parsed.data.taxRateId !== undefined ? { taxRate: cleanId(parsed.data.taxRateId) ? { connect: { id: cleanId(parsed.data.taxRateId)! } } : { disconnect: true } } : {}),
  }

  const product = await prisma.product.update({
    where: { id },
    data: updateData,
  })

  if (sellingPriceChanged || costPriceChanged) {
    await logAudit('PRODUCT_PRICE_UPDATED', 'Product', product.id, {
      oldSellingPrice: Number(existingProduct.sellingPrice),
      newSellingPrice:
        updates.sellingPrice !== undefined
          ? Number(updates.sellingPrice)
          : Number(existingProduct.sellingPrice),
      oldCostPrice: Number(existingProduct.costPrice),
      newCostPrice:
        updates.costPrice !== undefined
          ? Number(updates.costPrice)
          : Number(existingProduct.costPrice),
      outletId: user.outletId,
    })
  }

  revalidatePath('/products')
  revalidatePath('/create-products')
  if (product.outletId) {
    safeRevalidateTag(`dashboard-${product.outletId}`)
  }
  return ok({ id: product.id })
}

export async function getProductById(productId: string) {
  const user = await requireAuth()

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      outletId: user.outletId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      productCode: true,
      sku: true,
      parentId: true,
      categoryId: true,
      subcategoryId: true,
      brandId: true,
      series: true,
      condition: true,
      model: true,
      processorId: true,
      processorGenId: true,
      storageId: true,
      ramId: true,
      ramType: true,
      display: true,
      displayType: true,
      displaySize: true,
      displayResolution: true,
      feature1: true,
      feature2: true,
      color: true,
      costPrice: true,
      sellingPrice: true,
      warrantyMonths: true,
      barcode: true,
      requiresSerial: true,
    },
  })

  if (!product) return null

  return {
    id: product.id,
    name: product.name,
    productCode: product.productCode,
    sku: product.sku ?? '',
    parent: product.parentId ?? '',
    category: product.categoryId ?? '',
    subCategory: product.subcategoryId ?? '',
    brand: product.brandId ?? '',
    series: product.series ?? '',
    condition: product.condition.toLowerCase(),
    model: product.model ?? '',
    color: product.color ?? '',
    processor: product.processorId ?? '',
    processorGen: product.processorGenId ?? '',
    storage: product.storageId ?? '',
    ram: product.ramId ?? '',
    ramType: product.ramType ?? '',
    display: product.display ?? '',
    displayType: product.displayType ?? '',
    displaySize: product.displaySize ?? '',
    displayResolution: product.displayResolution ?? '',
    feature1: product.feature1 ?? '',
    feature2: product.feature2 ?? '',
    purchasePrice: Number(product.costPrice),
    sellingPrice: Number(product.sellingPrice),
    warrantyMonths: product.warrantyMonths ?? 0,
    barcode: product.barcode ?? '',
    requiresSerial: product.requiresSerial,
    serialNumber: '',
  }
}

export async function getProductFormOptions() {
  await requireAuth()

  const [
    parents,
    categories,
    subcategories,
    brands,
    processors,
    processorGens,
    rams,
    storages,
  ] = await Promise.all([
    prisma.parentProduct.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.subCategory.findMany({
      select: {
        id: true,
        name: true,
        categoryId: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.brand.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.processor.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.processorGen.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.ram.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.storage.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    parents,
    categories,
    subcategories,
    brands,
    processors,
    processorGens,
    rams,
    storages,
  }
}

export async function getProductList(
  outletId: string,
  filters: ProductListFilters = {}
) {
  await requireAuth()

  const pageSize = Math.max(1, Math.min(filters.pageSize ?? 10, 50))
  const page = Math.max(1, filters.page ?? 1)
  const status = filters.status ?? 'active'
  const search = filters.search?.trim()
  const categoryId = filters.categoryId?.trim()
  const brandId = filters.brandId?.trim()
  const condition = filters.condition

  const rawStock = filters.stock ?? filters.inStock
  let stockFilter: 'in_stock' | 'out_of_stock' | undefined = undefined
  if (rawStock !== undefined && rawStock !== null && rawStock !== '') {
    const s = String(rawStock).toLowerCase().trim()
    if (s === 'in_stock' || s === 'instock' || s === 'true' || s === '1') {
      stockFilter = 'in_stock'
    } else if (s === 'out_of_stock' || s === 'outofstock' || s === 'false' || s === '0') {
      stockFilter = 'out_of_stock'
    }
  }

  let stockWhere: any = undefined

  if (stockFilter === 'in_stock') {
    const nonSerializedStock = await prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        outletId,
        product: { requiresSerial: false },
      },
      _sum: {
        quantity: true,
      },
      having: {
        quantity: {
          _sum: {
            gt: 0,
          },
        },
      },
    })
    const inStockNonSerializedIds = nonSerializedStock.map(s => s.productId)

    stockWhere = {
      OR: [
        {
          requiresSerial: true,
          serialUnits: {
            some: {
              status: SerialStatus.IN_STOCK,
              outletId,
            },
          },
        },
        {
          requiresSerial: false,
          id: { in: inStockNonSerializedIds },
        },
      ],
    }
  } else if (stockFilter === 'out_of_stock') {
    const nonSerializedStock = await prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        outletId,
        product: { requiresSerial: false },
      },
      _sum: {
        quantity: true,
      },
      having: {
        quantity: {
          _sum: {
            gt: 0,
          },
        },
      },
    })
    const inStockNonSerializedIds = nonSerializedStock.map(s => s.productId)

    stockWhere = {
      OR: [
        {
          requiresSerial: true,
          serialUnits: {
            none: {
              status: SerialStatus.IN_STOCK,
              outletId,
            },
          },
        },
        {
          requiresSerial: false,
          ...(inStockNonSerializedIds.length > 0
            ? { id: { notIn: inStockNonSerializedIds } }
            : {}),
        },
      ],
    }
  }

  const conditions: any[] = [
    { outletId },
    { isActive: status === 'active' },
  ]

  if (categoryId) conditions.push({ categoryId })
  if (brandId) conditions.push({ brandId })
  if (condition) conditions.push({ condition })
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        {
          sku: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
        {
          productCode: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
        {
          barcode: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
        {
          display: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
        {
          processor: {
            name: { contains: search, mode: 'insensitive' as const },
          },
        },
        {
          processorGen: {
            name: { contains: search, mode: 'insensitive' as const },
          },
        },
        {
          ram: {
            name: { contains: search, mode: 'insensitive' as const },
          },
        },
        {
          storage: {
            name: { contains: search, mode: 'insensitive' as const },
          },
        },
      ],
    })
  }

  if (stockWhere) {
    conditions.push(stockWhere)
  }

  const where = conditions.length === 1 ? conditions[0] : { AND: conditions }

  const includeQuery = {
    category: { select: { name: true } },
    brand: { select: { name: true } },
    processor: { select: { name: true } },
    processorGen: { select: { name: true } },
    ram: { select: { name: true } },
    storage: { select: { name: true } },
    ...(filters.includeSerials
      ? { serialUnits: { select: { serialNumber: true } } }
      : {
          _count: {
            select: {
              serialUnits: {
                where: {
                  status: 'IN_STOCK' as const,
                  outletId,
                },
              },
            },
          },
        }),
  }

  const [rawItems, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: includeQuery,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ])

  // Non-serialized products track inventory in StockLedger rather than SerialUnit (DB-04)
  const nonSerializedIds = rawItems
    .filter((p: any) => !p.requiresSerial)
    .map((p: any) => p.id)

  const nonSerializedStock =
    nonSerializedIds.length > 0
      ? await prisma.stockLedger.groupBy({
          by: ['productId'],
          where: {
            outletId,
            productId: { in: nonSerializedIds },
          },
          _sum: {
            quantity: true,
          },
        })
      : []

  const nonSerializedStockMap = new Map(
    nonSerializedStock.map(s => [
      s.productId,
      Math.max(0, s._sum.quantity ?? 0),
    ])
  )

  const items = rawItems.map((item: any) => ({
    ...item,
    name: formatProductFullName(item),
    stockCount: item.requiresSerial
      ? (filters.includeSerials
          ? item.serialUnits?.length || 0
          : item._count?.serialUnits || 0)
      : (nonSerializedStockMap.get(item.id) ?? 0),
  }))

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function getProducts(outletId: string) {
  await requireAuth()
  const rawProducts = await prisma.product.findMany({
    where: { outletId, isActive: true },
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
      processor: { select: { name: true } },
      processorGen: { select: { name: true } },
      ram: { select: { name: true } },
      storage: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return rawProducts.map(p => ({
    ...p,
    name: formatProductFullName({
      ...p,
      processor: p.processor?.name,
      processorGen: p.processorGen?.name,
      ram: p.ram?.name,
      storage: p.storage?.name,
      display: p.display,
    }),
  }))
}

export async function getProductsForPos(
  outletId: string,
  search?: string,
  categoryId?: string
) {
  const user = await requireAuth()
  const effectiveOutletId = user.outletId || outletId

  const conditions: any[] = [
    { isActive: true },
    {
      OR: [
        {
          requiresSerial: true,
          serialUnits: {
            some: {
              outletId: effectiveOutletId,
              status: SerialStatus.IN_STOCK,
            },
          },
        },
        {
          requiresSerial: false,
          stockLedger: {
            some: {
              outletId: effectiveOutletId,
            },
          },
        },
        {
          // Services do not track physical inventory and are always available
          OR: [
            { category: { is: { name: { contains: 'service', mode: 'insensitive' } } } },
            { parent: { is: { name: { contains: 'service', mode: 'insensitive' } } } },
            { name: { contains: 'service', mode: 'insensitive' } },
          ],
        },
      ],
    },
  ]

  if (search?.trim()) {
    const term = search.trim()
    conditions.push({
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { productCode: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
        {
          serialUnits: {
            some: {
              serialNumber: { contains: term, mode: 'insensitive' },
              status: SerialStatus.IN_STOCK,
              outletId: effectiveOutletId,
            },
          },
        },
      ],
    })
  }

  if (categoryId && categoryId.toLowerCase() !== 'all') {
    const catTerm = categoryId.trim()
    const singularTerm = catTerm.replace(/s$/i, '')

    if (catTerm.toLowerCase() === 'gifts' || catTerm.toLowerCase() === 'gift') {
      conditions.push({
        OR: [
          { name: { contains: 'gift', mode: 'insensitive' } },
          {
            category: {
              is: {
                name: { contains: 'gift', mode: 'insensitive' },
              },
            },
          },
          {
            parent: {
              is: {
                name: { contains: 'gift', mode: 'insensitive' },
              },
            },
          },
          {
            AND: [
              { requiresSerial: false },
              { sellingPrice: { lte: 0 } },
              {
                OR: [
                  { name: { contains: 'bag', mode: 'insensitive' } },
                  { name: { contains: 'mouse', mode: 'insensitive' } },
                  { name: { contains: 'cable', mode: 'insensitive' } },
                  { name: { contains: 'pad', mode: 'insensitive' } },
                  { category: { is: { name: { contains: 'accessor', mode: 'insensitive' } } } },
                ],
              },
            ],
          },
        ],
      })
    } else {
      conditions.push({
        OR: [
          { categoryId: catTerm },
          {
            category: {
              is: {
                OR: [
                  { id: catTerm },
                  { name: { contains: catTerm, mode: 'insensitive' } },
                  { name: { contains: singularTerm, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            parent: {
              is: {
                OR: [
                  { name: { contains: catTerm, mode: 'insensitive' } },
                  { name: { contains: singularTerm, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      })
    }
  }

  const where = { AND: conditions }

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      condition: true,
      sku: true,
      productCode: true,
      barcode: true,
      sellingPrice: true,
      costPrice: true,
      requiresSerial: true,
      imageUrl: true,
      processor: { select: { name: true } },
      processorGen: { select: { name: true } },
      ram: { select: { name: true } },
      storage: { select: { name: true } },
      display: true,
      serialUnits: {
        where: {
          status: SerialStatus.IN_STOCK,
          outletId: effectiveOutletId,
        },
        select: { serialNumber: true },
      },
      category: { select: { id: true, name: true } },
      parent: { select: { id: true, name: true } },
      brand: { select: { name: true } },
      _count: {
        select: {
          serialUnits: {
            where: {
              status: SerialStatus.IN_STOCK,
              outletId: effectiveOutletId,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const productIds = products.map(product => product.id)
  const stockTotals = productIds.length
    ? await prisma.stockLedger.groupBy({
        by: ['productId'],
        where: {
          outletId: effectiveOutletId,
          productId: { in: productIds },
        },
        _sum: {
          quantity: true,
        },
      })
    : []

  const stockByProductId = new Map(
    stockTotals.map(stock => [
      stock.productId,
      Math.max(0, stock._sum.quantity ?? 0),
    ])
  )

  const productsWithStock = products.map(product => {
    const isService =
      product.category?.name?.toLowerCase().includes('service') ||
      product.parent?.name?.toLowerCase().includes('service') ||
      product.name?.toLowerCase().includes('service')

    const forceSerialOff =
      isService ||
      product.category?.name?.toLowerCase().includes('accessor') ||
      product.parent?.name?.toLowerCase().includes('accessor') ||
      product.category?.name?.toLowerCase().includes('gift') ||
      product.parent?.name?.toLowerCase().includes('gift') ||
      product.name?.toLowerCase().includes('gift')

    const effectiveRequiresSerial = forceSerialOff ? false : product.requiresSerial

    let availableStock = 0
    if (isService) {
      availableStock = 999999
    } else if (effectiveRequiresSerial) {
      availableStock = product.serialUnits.length
    } else {
      availableStock = stockByProductId.get(product.id) ?? 0
    }

    return {
      ...product,
      name: formatProductFullName({
        ...product,
        processor: product.processor?.name,
        processorGen: product.processorGen?.name,
        ram: product.ram?.name,
        storage: product.storage?.name,
        display: product.display,
      }),
      sellingPrice: Number(product.sellingPrice),
      processor: product.processor?.name ?? null,
      processorGen: product.processorGen?.name ?? null,
      ram: product.ram?.name ?? null,
      storage: product.storage?.name ?? null,
      availableStock,
      requiresSerial: effectiveRequiresSerial,
    }
  })

  // Strict ACID Inventory filter: Only return products with strictly positive available stock (> 0)
  return productsWithStock.filter(product => product.availableStock > 0)
}

export async function searchProductByBarcode(
  barcode: string,
  outletId: string
) {
  const user = await requireAuth()
  const effectiveOutletId = user.outletId || outletId
  const query = barcode.trim()
  if (!query) return null

  // 1. Check if the scanned barcode matches an exact SerialUnit at this outlet with status 'IN_STOCK'
  const matchingSerial = await prisma.serialUnit.findFirst({
    where: {
      serialNumber: query,
      status: SerialStatus.IN_STOCK,
      outletId: effectiveOutletId,
      product: {
        isActive: true,
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
          condition: true,
          sku: true,
          productCode: true,
          barcode: true,
          sellingPrice: true,
          requiresSerial: true,
          imageUrl: true,
          processor: { select: { name: true } },
          processorGen: { select: { name: true } },
          ram: { select: { name: true } },
          storage: { select: { name: true } },
          display: true,
          category: { select: { id: true, name: true } },
          parent: { select: { id: true, name: true } },
          brand: { select: { name: true } },
        },
      },
    },
  })

  if (matchingSerial && matchingSerial.product) {
    const product = matchingSerial.product
    const forceSerialOff =
      product.category?.name?.toLowerCase().includes('accessor') ||
      product.parent?.name?.toLowerCase().includes('accessor') ||
      product.category?.name?.toLowerCase().includes('gift') ||
      product.parent?.name?.toLowerCase().includes('gift') ||
      product.name?.toLowerCase().includes('gift')

    // Fetch all IN_STOCK serials for this product at this outlet
    const inStockSerials = await prisma.serialUnit.findMany({
      where: {
        productId: product.id,
        status: SerialStatus.IN_STOCK,
        outletId: effectiveOutletId,
      },
      select: { serialNumber: true },
    })

    const availableStock = inStockSerials.length
    if (availableStock <= 0) return null

    return {
      ...product,
      name: formatProductFullName({
        ...product,
        processor: product.processor?.name,
        processorGen: product.processorGen?.name,
        ram: product.ram?.name,
        storage: product.storage?.name,
        display: product.display,
      }),
      sellingPrice:
        matchingSerial.sellingPrice !== null && Number(matchingSerial.sellingPrice) > 0
          ? Number(matchingSerial.sellingPrice)
          : Number(product.sellingPrice),
      availableStock,
      requiresSerial: forceSerialOff ? false : product.requiresSerial,
      serialUnits: inStockSerials,
      scannedSerialNumber: matchingSerial.serialNumber,
    }
  }

  // 2. If not a serial, search by Product barcode, productCode, or sku
  const product = await prisma.product.findFirst({
    where: {
      isActive: true,
      OR: [{ barcode: query }, { productCode: query }, { sku: query }],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      condition: true,
      sku: true,
      productCode: true,
      barcode: true,
      sellingPrice: true,
      requiresSerial: true,
      imageUrl: true,
      processor: { select: { name: true } },
      processorGen: { select: { name: true } },
      ram: { select: { name: true } },
      storage: { select: { name: true } },
      display: true,
      serialUnits: {
        where: {
          status: SerialStatus.IN_STOCK,
          outletId: effectiveOutletId,
        },
        select: { serialNumber: true },
      },
      category: { select: { id: true, name: true } },
      parent: { select: { id: true, name: true } },
      brand: { select: { name: true } },
    },
  })

  if (!product) return null

  const isService =
    product.category?.name?.toLowerCase().includes('service') ||
    product.parent?.name?.toLowerCase().includes('service') ||
    product.name?.toLowerCase().includes('service')

  const forceSerialOff =
    isService ||
    product.category?.name?.toLowerCase().includes('accessor') ||
    product.parent?.name?.toLowerCase().includes('accessor') ||
    product.category?.name?.toLowerCase().includes('gift') ||
    product.parent?.name?.toLowerCase().includes('gift') ||
    product.name?.toLowerCase().includes('gift')

  const effectiveRequiresSerial = forceSerialOff ? false : product.requiresSerial

  let availableStock = 0
  if (isService) {
    availableStock = 999999
  } else if (effectiveRequiresSerial) {
    availableStock = product.serialUnits.length
  } else {
    availableStock = await getAvailableStock(product.id, effectiveOutletId)
  }

  // Strict check: if stock <= 0, do not return product for POS checkout
  if (!isService && availableStock <= 0) return null

  return {
    ...product,
    name: formatProductFullName({
      ...product,
      processor: product.processor?.name,
      processorGen: product.processorGen?.name,
      ram: product.ram?.name,
      storage: product.storage?.name,
      display: product.display,
    }),
    sellingPrice: Number(product.sellingPrice),
    availableStock,
    requiresSerial: effectiveRequiresSerial,
  }
}

export async function restoreProduct(id: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )

  const existingProduct = await prisma.product.findFirst({
    where: {
      id,
      outletId: user.outletId,
      isActive: false,
    },
    select: { id: true },
  })

  if (!existingProduct) return fail('Product not found')

  await prisma.product.update({
    where: { id },
    data: { isActive: true },
  })

  await logAudit('PRODUCT_RESTORED', 'Product', id, {
    outletId: user.outletId,
  })

  revalidatePath('/products')
  return ok({ id })
}

/**
 * Internal stock availability calculation helper.
 * Note: Does not enforce user auth because it is called internally by server actions
 * and transaction routines where auth context is already asserted.
 */
export async function getAvailableStock(productId: string, outletId: string) {
  await requireAuth()
  const stockSummary = await prisma.stockLedger.aggregate({
    where: { productId, outletId },
    _sum: { quantity: true },
  })

  const totalStock = stockSummary._sum.quantity ?? 0

  return Math.max(0, totalStock)
}

export async function getInStockSerialsForProduct(productId: string) {
  const user = await requireAuth()
  const units = await prisma.serialUnit.findMany({
    where: {
      productId,
      status: SerialStatus.IN_STOCK,
      ...(user.outletId ? { outletId: user.outletId } : {}),
      product: {
        isActive: true,
      },
    },
    select: { serialNumber: true, sellingPrice: true },
    orderBy: { serialNumber: 'asc' },
  })
  return units.map(u => ({
    serialNumber: u.serialNumber,
    sellingPrice: u.sellingPrice ? Number(u.sellingPrice) : null,
  }))
}

export async function validateSerial(serialNumber: string) {
  const user = await requireAuth()
  const query = serialNumber.trim()
  const serial = await prisma.serialUnit.findFirst({
    where: {
      serialNumber: query,
      status: SerialStatus.IN_STOCK,
      ...(user.outletId ? { outletId: user.outletId } : {}),
      product: {
        isActive: true,
      },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!serial) {
    return { valid: false, message: 'Serial number not found or not in stock' }
  }

  return {
    valid: true,
    serial: {
      id: serial.id,
      serialNumber: serial.serialNumber,
      productId: serial.productId,
      productName: serial.product.name,
    },
  }
}

export async function getSerialTrackingRows(params?: {
  outletId?: string
  status?: SerialStatus | 'ALL'
  search?: string
  from?: string
  to?: string
}) {
  const user = await requireAuth()
  const outletId = params?.outletId ?? user.outletId
  if (params?.outletId) {
    validateOutletAccess(user, params.outletId)
  }

  const fromDate = params?.from ? getLocalDateRangeBoundaries(params.from, params.from, 6).start : null
  const toDate = params?.to ? getLocalDateRangeBoundaries(params.to, params.to, 6).end : null

  const rows = await prisma.serialUnit.findMany({
    where: {
      ...(outletId ? { outletId } : {}),
      ...(params?.status && params.status !== 'ALL'
        ? { status: params.status }
        : {}),
      ...(fromDate || toDate
        ? {
            updatedAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(params?.search
        ? {
            OR: [
              {
                serialNumber: {
                  contains: params.search,
                  mode: 'insensitive',
                },
              },
              {
                product: {
                  name: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          display: true,
          processor: { select: { name: true } },
          processorGen: { select: { name: true } },
          ram: { select: { name: true } },
          storage: { select: { name: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })

  return ok(
    rows.map(row => ({
      id: row.id,
      serialNumber: row.serialNumber,
      notes: row.notes,
      product: row.product
        ? formatProductFullName({
            ...row.product,
            processor: row.product.processor?.name,
            processorGen: row.product.processorGen?.name,
            ram: row.product.ram?.name,
            storage: row.product.storage?.name,
            display: row.product.display,
          })
        : 'Unknown Product',
      status: row.status,
      assignedTo:
        row.status === 'SOLD'
          ? 'Customer'
          : row.status === 'IN_SERVICE'
            ? 'Service Desk'
            : '-',
      updatedAt: row.updatedAt.toISOString().slice(0, 10),
    }))
  )
}

const updateSerialNumberSchema = z.object({
  serialUnitId: z.string().min(1),
  serialNumber: z.string().trim().min(3, 'Serial number is too short'),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
})

export async function updateSerialNumber(
  data: z.infer<typeof updateSerialNumberSchema>
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = updateSerialNumberSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const current = await prisma.serialUnit.findUnique({
    where: { id: parsed.data.serialUnitId },
    include: {
      product: {
        select: { outletId: true },
      },
    },
  })

  if (!current) return fail('Serial record not found')
  if (current.product.outletId !== user.outletId) {
    return fail('Unauthorized access to this serial record')
  }

  const nextSerial = parsed.data.serialNumber.toUpperCase()
  if (current.serialNumber === nextSerial) {
    return fail('Serial number is unchanged')
  }

  const duplicate = await prisma.serialUnit.findUnique({
    where: { serialNumber: nextSerial },
    select: { id: true },
  })
  if (duplicate) {
    return fail('This serial number already exists')
  }

  const timestamp = new Date().toISOString().slice(0, 10)
  const noteLine = `[${timestamp}] Serial corrected by ${user.name}: ${current.serialNumber} -> ${nextSerial} (${parsed.data.reason})`

  await prisma.serialUnit.update({
    where: { id: current.id },
    data: {
      serialNumber: nextSerial,
      notes: current.notes ? `${current.notes}\n${noteLine}` : noteLine,
    },
  })

  revalidatePath('/serial-tracking')
  return ok({ id: current.id, serialNumber: nextSerial })
}

// Categories
export async function createParent(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  const description = formData.get('description') as string | null
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.parentProduct.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Parent already exists')

  const parent = await prisma.parentProduct.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
    },
  })
  revalidatePath('/create-products')
  revalidatePath('/products/parents')
  return ok({ id: parent.id, name: parent.name })
}

export async function createCategory(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.category.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Category already exists')

  const cat = await prisma.category.create({ data: { name: name.trim() } })
  revalidatePath('/create-products')
  revalidatePath('/products/categories')
  return ok({ id: cat.id, name: cat.name })
}

export async function createBrand(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.brand.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Brand already exists')

  const brand = await prisma.brand.create({ data: { name: name.trim() } })
  revalidatePath('/create-products')
  revalidatePath('/products/brands')
  return ok({ id: brand.id, name: brand.name })
}

export async function createProcessor(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.processor.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Processor already exists')

  const processor = await prisma.processor.create({
    data: { name: name.trim() },
  })
  revalidatePath('/create-products')
  return ok({ id: processor.id, name: processor.name })
}

export async function createProcessorGen(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.processorGen.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Processor Generation already exists')

  const processorGen = await prisma.processorGen.create({
    data: { name: name.trim() },
  })
  revalidatePath('/create-products')
  return ok({ id: processorGen.id, name: processorGen.name })
}

export async function createRam(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.ram.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('RAM already exists')

  const ram = await prisma.ram.create({ data: { name: name.trim() } })
  revalidatePath('/create-products')
  return ok({ id: ram.id, name: ram.name })
}

export async function createStorage(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  if (!name?.trim()) return fail('Name is required')

  const existing = await prisma.storage.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return fail('Storage already exists')

  const storage = await prisma.storage.create({ data: { name: name.trim() } })
  revalidatePath('/create-products')
  return ok({ id: storage.id, name: storage.name })
}

export async function createSubCategory(formData: FormData) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const name = formData.get('name') as string
  const categoryId = formData.get('categoryId') as string
  if (!name?.trim()) return fail('Name is required')
  if (!categoryId) return fail('Category is required')

  const existing = await prisma.subCategory.findFirst({
    where: {
      name: { equals: name.trim(), mode: 'insensitive' },
      categoryId,
    },
    select: { id: true },
  })
  if (existing) return fail('Sub-category already exists')

  const sub = await prisma.subCategory.create({
    data: { name: name.trim(), categoryId },
  })
  revalidatePath('/create-products')
  revalidatePath('/products/subcategories')
  return ok({ id: sub.id, name: sub.name })
}

export async function updateCategory(id: string, name: string) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const cleanName = name.trim()
  if (!cleanName) return fail('Category name is required')

  const existing = await prisma.category.findFirst({
    where: {
      name: { equals: cleanName, mode: 'insensitive' },
      id: { not: id },
    },
    select: { id: true },
  })
  if (existing) return fail('Another category with this name already exists')

  const category = await prisma.category.update({
    where: { id },
    data: { name: cleanName },
  })

  revalidatePath('/create-products')
  revalidatePath('/products/categories')
  revalidatePath('/categories-brands')
  revalidatePath('/master-setup')
  return ok({ id: category.id, name: category.name })
}

export async function updateBrand(id: string, name: string) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const cleanName = name.trim()
  if (!cleanName) return fail('Brand name is required')

  const existing = await prisma.brand.findFirst({
    where: {
      name: { equals: cleanName, mode: 'insensitive' },
      id: { not: id },
    },
    select: { id: true },
  })
  if (existing) return fail('Another brand with this name already exists')

  const brand = await prisma.brand.update({
    where: { id },
    data: { name: cleanName },
  })

  revalidatePath('/create-products')
  revalidatePath('/products/brands')
  revalidatePath('/categories-brands')
  revalidatePath('/master-setup')
  return ok({ id: brand.id, name: brand.name })
}

export async function updateSubCategory(
  id: string,
  name: string,
  categoryId?: string
) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const cleanName = name.trim()
  if (!cleanName) return fail('Sub-category name is required')

  const current = await prisma.subCategory.findUnique({
    where: { id },
    select: { categoryId: true },
  })
  if (!current) return fail('Sub-category not found')

  const targetCategoryId = categoryId || current.categoryId

  const existing = await prisma.subCategory.findFirst({
    where: {
      name: { equals: cleanName, mode: 'insensitive' },
      categoryId: targetCategoryId,
      id: { not: id },
    },
    select: { id: true },
  })
  if (existing)
    return fail('Another sub-category with this name already exists in this category')

  const sub = await prisma.subCategory.update({
    where: { id },
    data: {
      name: cleanName,
      ...(categoryId ? { categoryId } : {}),
    },
  })

  revalidatePath('/create-products')
  revalidatePath('/products/subcategories')
  revalidatePath('/categories-brands')
  revalidatePath('/master-setup')
  return ok({ id: sub.id, name: sub.name })
}

export async function updateParent(
  id: string,
  name: string,
  description?: string | null
) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  const cleanName = name.trim()
  if (!cleanName) return fail('Parent model name is required')

  const existing = await prisma.parentProduct.findFirst({
    where: {
      name: { equals: cleanName, mode: 'insensitive' },
      id: { not: id },
    },
    select: { id: true },
  })
  if (existing) return fail('Another parent model with this name already exists')

  const parent = await prisma.parentProduct.update({
    where: { id },
    data: {
      name: cleanName,
      description: description !== undefined ? (description?.trim() || null) : undefined,
    },
  })

  revalidatePath('/create-products')
  revalidatePath('/products/parents')
  revalidatePath('/master-setup')
  return ok({ id: parent.id, name: parent.name })
}

export async function getParentProducts() {
  await requireAuth()
  return prisma.parentProduct.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getCategories() {
  await requireAuth()
  return prisma.category.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getBrands() {
  await requireAuth()
  return prisma.brand.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSubCategories() {
  await requireAuth()
  return prisma.subCategory.findMany({
    select: {
      id: true,
      name: true,
      categoryId: true,
      createdAt: true,
      category: { select: { id: true, name: true } },
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getStockReport(outletId: string) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const lowStockSetting = await prisma.setting.findUnique({
    where: { key: 'low_stock_threshold' },
    select: { value: true },
  })
  const lowStockThreshold = Number(lowStockSetting?.value ?? 0)

  const [products, stockLayers] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, outletId },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        processor: { select: { name: true } },
        processorGen: { select: { name: true } },
        ram: { select: { name: true } },
        storage: { select: { name: true } },
        serialUnits: {
          where: { status: 'IN_STOCK' },
          select: {
            id: true,
            serialNumber: true,
            purchasedAt: true,
            status: true,
            costPrice: true,
          },
          orderBy: { purchasedAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<{ productId: string; totalQty: number; fifoValue: number }[]>`
      SELECT 
        "productId",
        COALESCE(SUM("quantityRemaining"), 0) as "totalQty",
        COALESCE(SUM("quantityRemaining" * "unitCost"), 0) as "fifoValue"
      FROM "StockLayer"
      WHERE "outletId" = ${outletId}
        AND "quantityRemaining" > 0
      GROUP BY "productId"
    `,
  ])

  const stockMap = new Map(
    stockLayers.map(s => [
      s.productId,
      { qty: Number(s.totalQty), value: Number(s.fifoValue) },
    ])
  )

  const rows = products
    .map(p => {
      let onHandQty = 0
      let costValue = 0
      let buyingPrice = 0

      if (p.requiresSerial) {
        // Serialized product: on-hand quantity is the count of verified IN_STOCK serials
        onHandQty = p.serialUnits.length
        costValue = p.serialUnits.reduce(
          (sum, su) => sum + Number(su.costPrice != null ? su.costPrice : p.costPrice),
          0
        )
        buyingPrice = onHandQty > 0 ? costValue / onHandQty : Number(p.costPrice)
      } else {
        // Non-serialized product: use FIFO StockLayers
        const layer = stockMap.get(p.id) ?? { qty: 0, value: 0 }
        onHandQty = layer.qty
        costValue = layer.value
        buyingPrice = layer.qty > 0 ? layer.value / layer.qty : Number(p.costPrice)
      }

      return {
        id: p.id,
        name: formatProductFullName({
          ...p,
          processor: p.processor?.name,
          processorGen: p.processorGen?.name,
          ram: p.ram?.name,
          storage: p.storage?.name,
          display: p.display,
        }),
        sku: p.sku,
        category: p.category?.name ?? 'Uncategorized',
        onHandQty,
        costValue,
        buyingPrice,
        serialCount: p.serialUnits.length,
        isLowStock: onHandQty <= lowStockThreshold,
        serials: p.serialUnits.map(su => ({
          id: su.id,
          serialNumber: su.serialNumber,
          status: su.status,
          purchasedAt: su.purchasedAt?.toISOString() ?? null,
          ageDays: su.purchasedAt
            ? Math.floor(
                (Date.now() - su.purchasedAt.getTime()) / (1000 * 60 * 60 * 24)
              )
            : 0,
        })),
      }
    })
    .filter(row => row.onHandQty > 0)

  return ok(rows)
}

const updateInventorySerialStatusSchema = z.object({
  serialUnitId: z.string().min(1),
  targetStatus: z.enum([
    'IN_STOCK',
    'IN_SERVICE',
    'DEAD',
    'FAULT',
    'RETURNED_TO_SUPPLIER',
  ]),
  reason: z.string().trim().min(3).optional(),
})

export async function updateInventorySerialStatus(
  data: z.infer<typeof updateInventorySerialStatusSchema>
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const parsed = updateInventorySerialStatusSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const status =
    parsed.data.targetStatus === 'FAULT'
      ? SerialStatus.DEAD
      : (parsed.data.targetStatus as SerialStatus)

  const serial = await prisma.serialUnit.findUnique({
    where: { id: parsed.data.serialUnitId },
    include: {
      product: { select: { id: true, outletId: true, name: true, costPrice: true } },
    },
  })

  if (!serial) return fail('Serial record not found')
  if (serial.product.outletId !== user.outletId) {
    return fail('Unauthorized access to this serial')
  }

  if (serial.status === status) {
    return fail('Serial is already in the selected status')
  }

  const reasonText =
    parsed.data.reason?.trim() || 'Updated from Inventory Report'
  const note = `[${new Date().toISOString().slice(0, 10)}] Status ${serial.status} -> ${status} by ${user.name}: ${reasonText}`

  try {
    // Create stock ledger entry if marking as DEAD or RETURNED_TO_SUPPLIER (removes from available stock)
    if (
      (status === SerialStatus.DEAD || status === SerialStatus.RETURNED_TO_SUPPLIER) &&
      serial.status === SerialStatus.IN_STOCK
    ) {
      await prisma.$transaction(async tx => {
        await tx.serialUnit.update({
          where: { id: serial.id },
          data: {
            status,
            notes: serial.notes ? `${serial.notes}\n${note}` : note,
          },
        })
        const batches = await consumeStockLayers(tx, {
          productId: serial.product.id,
          outletId: serial.product.outletId,
          quantityNeeded: 1,
          allowSyntheticLayer: false,
        })
        const consumedValue =
          batches.length > 0
            ? batches.reduce((sum, b) => sum + b.quantityConsumed * Number(b.unitCost), 0)
            : Number(serial.costPrice ?? serial.product.costPrice ?? 0)
        await tx.stockLedger.create({
          data: {
            productId: serial.product.id,
            outletId: serial.product.outletId,
            movementType: 'ADJUSTMENT_OUT',
            quantity: -1,
            referenceId: serial.id,
            referenceType: 'SerialStatusChange',
            notes: `Serial ${serial.serialNumber} marked as ${status}: ${reasonText}`,
          },
        })
        if (consumedValue > 0) {
          const [inventoryAcct, shrinkAcct] = await Promise.all([
            tx.chartOfAccount.findUnique({ where: { code: '1400' } }),
            tx.chartOfAccount.findUnique({ where: { code: '5300' } }),
          ])
          if (inventoryAcct && shrinkAcct) {
            const gl = [
              {
                accountId: shrinkAcct.id,
                type: 'DEBIT' as const,
                amount: consumedValue,
                referenceId: serial.id,
                referenceType: 'SerialStatusChange',
                description: `Serial ${serial.serialNumber} marked as ${status} (${serial.product.name})`,
              },
              {
                accountId: inventoryAcct.id,
                type: 'CREDIT' as const,
                amount: consumedValue,
                referenceId: serial.id,
                referenceType: 'SerialStatusChange',
                description: `Serial ${serial.serialNumber} marked as ${status} (${serial.product.name})`,
              },
            ]
            assertBalancedJournal(gl)
            await tx.accountLedgerEntry.createMany({ data: gl })
          }
        }
      })
    } else if (
      status === SerialStatus.IN_STOCK &&
      (serial.status === SerialStatus.DEAD || serial.status === SerialStatus.RETURNED_TO_SUPPLIER)
    ) {
      // Restoring to IN_STOCK from DEAD or RETURNED_TO_SUPPLIER
      const unitCost = Number(serial.costPrice ?? serial.product.costPrice ?? 0)
      await prisma.$transaction(async tx => {
        await tx.serialUnit.update({
          where: { id: serial.id },
          data: {
            status,
            notes: serial.notes ? `${serial.notes}\n${note}` : note,
          },
        })
        await tx.stockLayer.create({
          data: {
            productId: serial.product.id,
            outletId: serial.product.outletId,
            quantityReceived: 1,
            quantityRemaining: 1,
            unitCost,
            receivedAt: new Date(),
          },
        })
        await tx.stockLedger.create({
          data: {
            productId: serial.product.id,
            outletId: serial.product.outletId,
            movementType: 'ADJUSTMENT_IN',
            quantity: 1,
            referenceId: serial.id,
            referenceType: 'SerialStatusChange',
            notes: `Serial ${serial.serialNumber} restored to IN_STOCK: ${reasonText}`,
          },
        })
        if (unitCost > 0) {
          const [inventoryAcct, gainAcct] = await Promise.all([
            tx.chartOfAccount.findUnique({ where: { code: '1400' } }),
            tx.chartOfAccount.findUnique({ where: { code: '4400' } }),
          ])
          if (inventoryAcct && gainAcct) {
            const gl = [
              {
                accountId: inventoryAcct.id,
                type: 'DEBIT' as const,
                amount: unitCost,
                referenceId: serial.id,
                referenceType: 'SerialStatusChange',
                description: `Serial ${serial.serialNumber} restored to IN_STOCK (${serial.product.name})`,
              },
              {
                accountId: gainAcct.id,
                type: 'CREDIT' as const,
                amount: unitCost,
                referenceId: serial.id,
                referenceType: 'SerialStatusChange',
                description: `Serial ${serial.serialNumber} restored to IN_STOCK (${serial.product.name})`,
              },
            ]
            assertBalancedJournal(gl)
            await tx.accountLedgerEntry.createMany({ data: gl })
          }
        }
      })
    } else {
      // Status update without direct inventory decrement (e.g. IN_SERVICE, RETURNED_TO_SUPPLIER)
      await prisma.serialUnit.update({
        where: { id: serial.id },
        data: {
          status,
          notes: serial.notes ? `${serial.notes}\n${note}` : note,
        },
      })
    }
  } catch (error: any) {
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error.message || 'Failed to update serial status')
  }

  revalidatePath('/reports/inventory')
  revalidatePath('/serial-tracking')

  return ok({ id: serial.id, status })
}

export type DefectiveItem = {
  id: string
  serialNumber: string
  productId: string
  productName: string
  sku: string | null
  category: string
  status: SerialStatus
  unitCost: number
  purchasedAt: string | null
  updatedAt: string
  ageDays: number
  notes: string | null
  warrantyExpiry: string | null
  activeServiceJob: {
    jobNumber: string
    status: string
    issue: string | null
  } | null
}

export type DefectiveReportSummary = {
  totalUnits: number
  totalCostValue: number
  inServiceCount: number
  inServiceValue: number
  deadCount: number
  deadValue: number
  rmaCount: number
  rmaValue: number
}

export async function getDefectiveAndInServiceReport(outletId?: string) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.ACCOUNTANT
    )
    const targetOutletId = outletId || user.outletId

    if (targetOutletId) {
      validateOutletAccess(user, targetOutletId)
    }

    const whereClause: {
      status: { in: SerialStatus[] }
      outletId?: string
    } = {
      status: {
        in: [
          SerialStatus.IN_SERVICE,
          SerialStatus.DEAD,
          SerialStatus.RETURNED_TO_SUPPLIER,
        ],
      },
    }

    if (targetOutletId) {
      whereClause.outletId = targetOutletId
    }

    const serials = await prisma.serialUnit.findMany({
      where: whereClause,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            costPrice: true,
            display: true,
            category: { select: { id: true, name: true } },
            brand: { select: { name: true } },
            processor: { select: { name: true } },
            processorGen: { select: { name: true } },
            ram: { select: { name: true } },
            storage: { select: { name: true } },
          },
        },
        serviceJobSerials: {
          select: {
            id: true,
            jobNumber: true,
            status: true,
            issue: true,
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })

    let totalCostValue = 0
    let inServiceCount = 0
    let inServiceValue = 0
    let deadCount = 0
    let deadValue = 0
    let rmaCount = 0
    let rmaValue = 0

    const items: DefectiveItem[] = serials.map(s => {
      const unitCost = Number(s.costPrice != null ? s.costPrice : s.product.costPrice || 0)
      totalCostValue += unitCost

      if (s.status === SerialStatus.IN_SERVICE) {
        inServiceCount++
        inServiceValue += unitCost
      } else if (s.status === SerialStatus.DEAD) {
        deadCount++
        deadValue += unitCost
      } else if (s.status === SerialStatus.RETURNED_TO_SUPPLIER) {
        rmaCount++
        rmaValue += unitCost
      }

      const lastUpdated = s.updatedAt || s.createdAt
      const ageDays = Math.floor(
        (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
      )

      return {
        id: s.id,
        serialNumber: s.serialNumber,
        productId: s.product.id,
        productName: formatProductFullName({
          ...s.product,
          processor: s.product.processor?.name,
          processorGen: s.product.processorGen?.name,
          ram: s.product.ram?.name,
          storage: s.product.storage?.name,
          display: s.product.display,
        }),
        sku: s.product.sku,
        category: s.product.category?.name ?? 'Uncategorized',
        status: s.status,
        unitCost,
        purchasedAt: s.purchasedAt?.toISOString() ?? null,
        updatedAt: s.updatedAt.toISOString(),
        ageDays,
        notes: s.notes,
        warrantyExpiry: s.warrantyExpiry?.toISOString() ?? null,
        activeServiceJob: s.serviceJobSerials[0]
          ? {
              jobNumber: s.serviceJobSerials[0].jobNumber,
              status: s.serviceJobSerials[0].status,
              issue: s.serviceJobSerials[0].issue,
            }
          : null,
      }
    })

    const summary: DefectiveReportSummary = {
      totalUnits: items.length,
      totalCostValue,
      inServiceCount,
      inServiceValue,
      deadCount,
      deadValue,
      rmaCount,
      rmaValue,
    }

    return ok({ items, summary })
  } catch (error: any) {
    console.error('Failed to generate Defective & In-Service report:', error)
    return fail(error?.message || 'Failed to generate Defective & In-Service report')
  }
}

export async function createStockAdjustment(
  data: {
    productId: string
    outletId: string
    movementType: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
    quantity: number
    reason: string
    serialNumbers?: string[] // Required for ADJUSTMENT_OUT of serialized products
  },
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const product = await prisma.product.findFirst({
    where: { id: data.productId, outletId: data.outletId },
    select: { id: true, name: true, requiresSerial: true, costPrice: true },
  })

  if (!product) return fail('Product not found')

  const _qty = data.movementType === 'ADJUSTMENT_OUT' ? -Math.abs(data.quantity) : Math.abs(data.quantity)

  // Validate serial numbers for ADJUSTMENT_OUT
  if (data.movementType === 'ADJUSTMENT_OUT' && product.requiresSerial) {
    const providedSerials = (data.serialNumbers || []).filter(Boolean)
    if (providedSerials.length !== data.quantity) {
      return fail(`"${product.name}" requires serial numbers. Please provide exactly ${data.quantity} serial number(s). Got ${providedSerials.length}.`)
    }
    const uniqueSerials = new Set(providedSerials)
    if (uniqueSerials.size !== providedSerials.length) {
      return fail('Duplicate serial numbers provided')
    }
    const serialUnits = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: providedSerials }, productId: data.productId },
      select: { id: true, serialNumber: true, status: true },
    })
    if (serialUnits.length !== providedSerials.length) return fail(`Serial number(s) not found`)
    const notInStock = serialUnits.filter(s => s.status !== 'IN_STOCK')
    if (notInStock.length > 0) return fail(`Serial number(s) not available.`)
  }

  // Validate serial numbers for ADJUSTMENT_IN
  if (data.movementType === 'ADJUSTMENT_IN' && product.requiresSerial) {
    const providedSerials = (data.serialNumbers || []).filter(Boolean)
    if (providedSerials.length !== data.quantity) {
      return fail(`"${product.name}" requires serial numbers. Please provide exactly ${data.quantity} serial number(s). Got ${providedSerials.length}.`)
    }
    const uniqueSerials = new Set(providedSerials)
    if (uniqueSerials.size !== providedSerials.length) {
      return fail('Duplicate serial numbers provided')
    }
    const existingSerials = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: providedSerials } },
      select: { serialNumber: true },
    })
    if (existingSerials.length > 0) return fail(`Serial number(s) already exist`)
  }

  try {
    let createdAdjustmentId: string | null = null
    const executeAdjustment = async (activeTx: PrismaTx) => {
      await activeTx.$executeRaw`SELECT id FROM "Product" WHERE id = ${data.productId} FOR UPDATE`

      const adjustment = await activeTx.stockAdjustment.create({
        data: {
          productId: data.productId,
          type: data.movementType as import('@prisma/client').StockMovementType,
          quantity: Math.abs(data.quantity),
          reason: data.reason,
          adjustedBy: user.id,
        },
      })
      createdAdjustmentId = adjustment.id

      // Account references
      const inventoryAcct = await activeTx.chartOfAccount.findUnique({ where: { code: '1400' } })
      const gainAcct = await activeTx.chartOfAccount.findUnique({ where: { code: '4400' } })
      const shrinkAcct = await activeTx.chartOfAccount.findUnique({ where: { code: '5300' } })

      let totalFinancialValue = 0

      if (data.movementType === 'ADJUSTMENT_OUT') {
        const batches = await consumeStockLayers(activeTx, {
          productId: data.productId,
          outletId: data.outletId,
          quantityNeeded: Math.abs(data.quantity),
          allowSyntheticLayer: false,
        })

        for (const batch of batches) {
          totalFinancialValue += batch.quantityConsumed * Number(batch.unitCost)
          await activeTx.stockLedger.create({
            data: {
              productId: data.productId,
              outletId: data.outletId,
              supplierId: batch.supplierId,
              purchaseOrderId: batch.purchaseOrderId,
              movementType: 'ADJUSTMENT_OUT',
              quantity: -batch.quantityConsumed,
              referenceType: 'StockAdjustment',
              notes: `${data.reason} (Layer ${batch.layerId})`,
            },
          })
        }

        if (product.requiresSerial) {
          const providedSerials = (data.serialNumbers || []).filter(Boolean)
          for (const sn of providedSerials) {
            const result = await activeTx.serialUnit.updateMany({
              where: { serialNumber: sn, status: { in: ['IN_STOCK', 'IN_SERVICE'] } },
              data: { status: 'DEAD', notes: `Adjusted out: ${data.reason}` },
            })
            if (result.count === 0) throw new Error(`Serial ${sn} not available`)
          }
        }
      } else {
        // ADJUSTMENT_IN
        totalFinancialValue = Math.abs(data.quantity) * Number(product.costPrice)

        await activeTx.stockLayer.create({
          data: {
            productId: data.productId,
            outletId: data.outletId,
            quantityReceived: Math.abs(data.quantity),
            quantityRemaining: Math.abs(data.quantity),
            unitCost: Number(product.costPrice),
            receivedAt: new Date(),
          },
        })

        const providedSerials = (data.serialNumbers || []).filter(Boolean)
        const notesStr = product.requiresSerial ? `${data.reason} | Serials: ${providedSerials.join(', ')}` : data.reason

        await activeTx.stockLedger.create({
          data: {
            productId: data.productId,
            outletId: data.outletId,
            movementType: 'ADJUSTMENT_IN',
            quantity: Math.abs(data.quantity),
            referenceType: 'StockAdjustment',
            notes: notesStr,
          },
        })

        if (product.requiresSerial) {
          await Promise.all(providedSerials.map(sn => activeTx.serialUnit.create({
            data: {
              serialNumber: sn,
              productId: data.productId,
              outletId: data.outletId,
              status: 'IN_STOCK',
              notes: `Adjusted in: ${data.reason}`,
            },
          })))
        }
      }

      // Ledger Entries for Financial Impact
      if (totalFinancialValue > 0) {
        if (!inventoryAcct) {
          throw new Error('Inventory asset account (1400) not found in Chart of Accounts')
        }
        if (data.movementType === 'ADJUSTMENT_OUT') {
          if (!shrinkAcct) {
            throw new Error('Inventory shrinkage account (5300) not found in Chart of Accounts')
          }
          const gl = [
            {
              accountId: shrinkAcct.id,
              type: 'DEBIT' as const,
              amount: totalFinancialValue,
              referenceId: adjustment.id,
              referenceType: 'StockAdjustment',
              description: `Inventory Shrinkage: ${product.name}`,
              createdAt: adjustment.createdAt,
            },
            {
              accountId: inventoryAcct.id,
              type: 'CREDIT' as const,
              amount: totalFinancialValue,
              referenceId: adjustment.id,
              referenceType: 'StockAdjustment',
              description: `Inventory Shrinkage: ${product.name}`,
              createdAt: adjustment.createdAt,
            },
          ]
          assertBalancedJournal(gl)
          await activeTx.accountLedgerEntry.createMany({
            data: gl,
          })
        } else if (data.movementType === 'ADJUSTMENT_IN') {
          if (!gainAcct) {
            throw new Error('Inventory gain account (4400) not found in Chart of Accounts')
          }
          const gl = [
            {
              accountId: inventoryAcct.id,
              type: 'DEBIT' as const,
              amount: totalFinancialValue,
              referenceId: adjustment.id,
              referenceType: 'StockAdjustment',
              description: `Inventory Gain: ${product.name}`,
              createdAt: adjustment.createdAt,
            },
            {
              accountId: gainAcct.id,
              type: 'CREDIT' as const,
              amount: totalFinancialValue,
              referenceId: adjustment.id,
              referenceType: 'StockAdjustment',
              description: `Inventory Gain: ${product.name}`,
              createdAt: adjustment.createdAt,
            },
          ]
          assertBalancedJournal(gl)
          await activeTx.accountLedgerEntry.createMany({
            data: gl,
          })
        }
      }
    }

    if (tx) {
      await executeAdjustment(tx)
    } else {
      await prisma.$transaction(async innerTx => await executeAdjustment(innerTx), {
        timeout: 30000,
      })
    }

    if (createdAdjustmentId) {
      await logAudit('STOCK_ADJUSTMENT', 'StockAdjustment', createdAdjustmentId, {
        productId: data.productId,
        outletId: data.outletId,
        movementType: data.movementType,
        quantity: data.quantity,
        reason: data.reason,
      })
    }
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
    return fail(err.message || 'Failed to adjust stock')
  }

  // Trigger Low-Stock Notification if stock was adjusted out
  if (data.movementType === 'ADJUSTMENT_OUT') {
    checkAndNotifyLowStock([data.productId], data.outletId).catch(err => {
      console.error('[StockAdjustment] Failed to check low stock:', err)
    })
  }

  revalidatePath('/products')
  revalidatePath('/products/adjustments')
  revalidatePath('/serial-tracking')
  return ok(null)
}

const stockTransferLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  serialNumbers: z.array(z.string()).optional(), // Required for serialized products
})

const createStockTransferSchema = z.object({
  fromOutletId: z.string().min(1),
  toOutletId: z.string().min(1),
  notes: z.string().optional(),
  lines: z.array(stockTransferLineSchema).min(1),
})

export async function getTransferOutlets(currentOutletId: string) {
  await requireAuth()
  return prisma.outlet.findMany({
    where: {
      isActive: true,
      id: { not: currentOutletId },
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
    orderBy: { name: 'asc' },
  })
}

export async function createStockTransfer(
  data: z.infer<typeof createStockTransferSchema>
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = createStockTransferSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { fromOutletId, toOutletId, notes, lines } = parsed.data

  if (fromOutletId === toOutletId) {
    return fail('From and To outlets must be different')
  }

  if (user.outletId !== fromOutletId) {
    return fail('You can only transfer stock from your assigned outlet')
  }

  const [fromOutlet, toOutlet] = await Promise.all([
    prisma.outlet.findFirst({
      where: { id: fromOutletId, isActive: true },
      select: { id: true },
    }),
    prisma.outlet.findFirst({
      where: { id: toOutletId, isActive: true },
      select: { id: true },
    }),
  ])

  if (!fromOutlet || !toOutlet) {
    return fail('Invalid outlet selection')
  }

  try {
    const transfer = await prisma.$transaction(async tx => {
      // Validate products, acquire Product FOR UPDATE row locks, and check stock/serials under lock
      for (const line of lines) {
        await tx.$executeRaw`SELECT 1 FROM "Product" WHERE id = ${line.productId} FOR UPDATE`

        const product = await tx.product.findFirst({
          where: {
            id: line.productId,
            isActive: true,
          },
          select: { id: true, name: true, requiresSerial: true },
        })

        if (!product) {
          throw new Error('One or more products are not available in catalog')
        }

        // Validate serial numbers for serialized products
        if (product.requiresSerial) {
          const providedSerials = (line.serialNumbers || []).filter(Boolean)
          if (providedSerials.length !== line.quantity) {
            throw new Error(
              `"${product.name}" requires serial numbers. Please provide exactly ${line.quantity} serial number(s) for transfer. Got ${providedSerials.length}.`
            )
          }

          // Validate all serials exist and are IN_STOCK
          const serialUnits = await tx.serialUnit.findMany({
            where: {
              serialNumber: { in: providedSerials },
              productId: line.productId,
              outletId: fromOutletId,
            },
            select: { serialNumber: true, status: true },
          })

          const foundSerials = new Map(serialUnits.map(s => [s.serialNumber, s]))

          for (const sn of providedSerials) {
            const serial = foundSerials.get(sn)
            if (!serial) {
              throw new Error(`Serial number ${sn} not found in source outlet`)
            }
            if (serial.status !== 'IN_STOCK') {
              throw new Error(
                `Serial ${sn} is not available for transfer (status: ${serial.status})`
              )
            }
          }
        }

        const stats = await tx.stockLedger.aggregate({
          where: { productId: line.productId, outletId: fromOutletId },
          _sum: { quantity: true },
        })
        const available = Number(stats._sum.quantity || 0)
        if (available < line.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${available}`
          )
        }
      }

      const created = await tx.stockTransfer.create({
        data: {
          fromOutletId,
          toOutletId,
          status: 'PENDING',
          notes: notes?.trim() || null,
          lines: {
            create: lines.map(line => ({
              productId: line.productId,
              quantity: line.quantity,
            })),
          },
        },
        include: { lines: true },
      })

    // Create stock ledger entries and update serials
    for (let i = 0; i < created.lines.length; i++) {
      const line = created.lines[i]
      const inputLine = lines[i]

      const batches = await consumeStockLayers(tx, {
        productId: line.productId,
        outletId: fromOutletId,
        quantityNeeded: line.quantity,
        allowSyntheticLayer: false,
      })

      for (const batch of batches) {
        await tx.stockLedger.create({
          data: {
            productId: line.productId,
            outletId: fromOutletId,
            supplierId: batch.supplierId,
            purchaseOrderId: batch.purchaseOrderId,
            movementType: 'TRANSFER_OUT',
            quantity: -batch.quantityConsumed,
            referenceId: created.id,
            referenceType: 'StockTransfer',
            notes: `${notes?.trim() || 'Transfer Out'} (Layer ${batch.layerId})`,
          },
        })
      }

      if (inputLine.serialNumbers && inputLine.serialNumbers.length > 0) {
        for (const sn of inputLine.serialNumbers) {
          await tx.serialUnit.updateMany({
            where: {
              serialNumber: sn,
              productId: line.productId,
              outletId: fromOutletId,
            },
            data: {
              status: 'TRANSFERRED',
              transferId: created.id,
            },
          })
        }
      }
    }

    return created
  })

  // Trigger Low-Stock Notification for transferred products from source outlet
  const transferredProductIds = lines.map(l => l.productId)
  checkAndNotifyLowStock(transferredProductIds, fromOutletId).catch(err => {
    console.error('[StockTransfer] Failed to check low stock:', err)
  })

  safeRevalidatePath('/stock/transfers')
  safeRevalidatePath('/products/transfers')
  safeRevalidatePath('/reports/inventory')
  return ok({ id: transfer.id })
  } catch (error: any) {
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error.message || 'Failed to create stock transfer')
  }
}

export async function confirmStockTransfer(transferId: string) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const transfer = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    include: { lines: true },
  })

  if (!transfer) return fail('Transfer not found')
  if (transfer.status === 'CONFIRMED') {
    return fail('Transfer already confirmed')
  }

  if (
    user.outletId !== transfer.fromOutletId &&
    user.outletId !== transfer.toOutletId
  ) {
    return fail('Not authorized to confirm this transfer')
  }

  try {
    await prisma.$transaction(async tx => {
      // Lock StockTransfer row to prevent concurrent double-confirmation
      await tx.$executeRaw`SELECT 1 FROM "StockTransfer" WHERE id = ${transferId} FOR UPDATE`

      const txTransfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        select: { status: true },
      })
      if (txTransfer?.status === 'CONFIRMED') {
        throw new Error('Transfer already confirmed')
      }

    // Create stock ledger & layers for transfer in preserving source FIFO cost
    for (const line of transfer.lines) {
      const [product, transferredSerials, outLedgers] = await Promise.all([
        tx.product.findUnique({
          where: { id: line.productId },
          select: { costPrice: true, requiresSerial: true },
        }),
        tx.serialUnit.findMany({
          where: { transferId: transfer.id, productId: line.productId },
          select: { costPrice: true },
        }),
        tx.stockLedger.findMany({
          where: {
            referenceId: transfer.id,
            referenceType: 'StockTransfer',
            productId: line.productId,
            movementType: 'TRANSFER_OUT',
          },
          select: { quantity: true, notes: true },
        }),
      ])

      const fallbackCost = Number(product?.costPrice || 0)
      let effectiveUnitCost = fallbackCost

      if (transferredSerials.length > 0) {
        const totalSerialCost = transferredSerials.reduce(
          (sum, s) => sum + Number(s.costPrice ?? fallbackCost),
          0
        )
        effectiveUnitCost =
          Math.round(((totalSerialCost / transferredSerials.length) + Number.EPSILON) * 100) / 100
      } else if (outLedgers.length > 0) {
        const layerIds: string[] = []
        for (const ol of outLedgers) {
          const match = ol.notes?.match(/\(Layer ([^)]+)\)/)
          if (match?.[1]) layerIds.push(match[1])
        }
        if (layerIds.length > 0) {
          const sourceLayers = await tx.stockLayer.findMany({
            where: { id: { in: layerIds } },
            select: { id: true, unitCost: true },
          })
          const layerCostMap = new Map(
            sourceLayers.map(sl => [sl.id, Number(sl.unitCost)])
          )
          let totalBatchVal = 0
          let totalBatchQty = 0
          for (const ol of outLedgers) {
            const qty = Math.abs(ol.quantity)
            const match = ol.notes?.match(/\(Layer ([^)]+)\)/)
            const layerCost =
              (match?.[1] ? layerCostMap.get(match[1]) : undefined) ?? fallbackCost
            totalBatchVal += qty * layerCost
            totalBatchQty += qty
          }
          if (totalBatchQty > 0) {
            effectiveUnitCost =
              Math.round(((totalBatchVal / totalBatchQty) + Number.EPSILON) * 100) / 100
          }
        }
      }

      await tx.stockLayer.create({
        data: {
          productId: line.productId,
          outletId: transfer.toOutletId,
          quantityReceived: line.quantity,
          quantityRemaining: line.quantity,
          unitCost: effectiveUnitCost,
          receivedAt: new Date(),
        },
      })

      await tx.stockLedger.create({
        data: {
          productId: line.productId,
          outletId: transfer.toOutletId,
          movementType: 'TRANSFER_IN',
          quantity: line.quantity,
          referenceId: transfer.id,
          referenceType: 'StockTransfer',
          notes: transfer.notes,
        },
      })
    }

    // Update serials: move to new outlet and mark as IN_STOCK
    await tx.serialUnit.updateMany({
      where: {
        transferId: transfer.id,
        status: 'TRANSFERRED',
      },
      data: {
        outletId: transfer.toOutletId,
        status: 'IN_STOCK',
        transferId: null,
      },
    })

    await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    })
  })
} catch (error: any) {
  return fail(error.message || 'Failed to confirm transfer')
}

  safeRevalidatePath('/stock/transfers')
  safeRevalidatePath('/products/transfers')
  safeRevalidatePath('/reports/inventory')
  return ok({ id: transfer.id })
}

export async function getStockTransfers(outletId: string) {
  await requireAuth()

  const transfers = await prisma.stockTransfer.findMany({
    where: {
      OR: [{ fromOutletId: outletId }, { toOutletId: outletId }],
    },
    include: {
      fromOutlet: { select: { id: true, name: true, code: true } },
      toOutlet: { select: { id: true, name: true, code: true } },
      lines: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const productIds = Array.from(
    new Set(transfers.flatMap(t => t.lines.map(l => l.productId)))
  )

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true },
  })

  const productMap = new Map(products.map(p => [p.id, p]))

  return ok(
    transfers.map(t => ({
      id: t.id,
      status: t.status,
      notes: t.notes,
      createdAt: t.createdAt,
      confirmedAt: t.confirmedAt,
      fromOutlet: t.fromOutlet,
      toOutlet: t.toOutlet,
      lines: t.lines.map(line => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        productName: productMap.get(line.productId)?.name ?? 'Unknown',
        productSku: productMap.get(line.productId)?.sku ?? null,
      })),
    }))
  )
}

// ─────────────────────────────────────────────
// PRODUCTS LEDGER ACTIONS
// ─────────────────────────────────────────────

export interface ProductLedgerRow {
  id: string
  productId: string
  productName: string
  productCode: string
  sku: string | null
  outletId: string
  movementType: StockMovementType
  quantity: number
  referenceId: string | null
  referenceType: string | null
  notes: string | null
  createdAt: Date
  unitCost: number
  totalCost: number
  runningBalance: number
  fifoCost: number
  cogs: number
}

export interface ProductLedgerData {
  rows: ProductLedgerRow[]
  summary: {
    totalIn: number
    totalOut: number
    netQuantity: number
    totalCogs: number
    totalValue: number
    fifoTotalCost: number
  }
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getProductLedger(filters?: {
  productId?: string
  outletId?: string
  supplierId?: string
  brandId?: string
  brand?: string
  movementType?: string
  from?: string
  to?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const outletId = filters?.outletId || user.outletId
  if (outletId) {
    validateOutletAccess(user, outletId)
  }
  const page = filters?.page ?? 1
  const pageSize = filters?.pageSize ?? 50

  const whereClause: any = { outletId }
  if (filters?.productId) whereClause.productId = filters.productId
  if (filters?.supplierId) whereClause.supplierId = filters.supplierId
  if (filters?.movementType) whereClause.movementType = filters.movementType
  if (filters?.brandId) {
    whereClause.product = { ...(whereClause.product || {}), brandId: filters.brandId }
  }
  if (filters?.brand) {
    whereClause.product = {
      ...(whereClause.product || {}),
      brand: { name: { equals: filters.brand, mode: 'insensitive' } },
    }
  }
  if (filters?.search) {
    whereClause.product = {
      ...(whereClause.product || {}),
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { productCode: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ],
    }
  }
  if (filters?.from || filters?.to) {
    whereClause.createdAt = {}
    if (filters?.from) whereClause.createdAt.gte = getLocalDateRangeBoundaries(filters.from, filters.from, 6).start
    if (filters?.to) whereClause.createdAt.lte = getLocalDateRangeBoundaries(filters.to, filters.to, 6).end
  }

  const [rows, totalCount] = await Promise.all([
    prisma.stockLedger.findMany({
      where: whereClause,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true,
            sku: true,
            costPrice: true,
            display: true,
            category: { select: { name: true } },
            processor: { select: { name: true } },
            processorGen: { select: { name: true } },
            ram: { select: { name: true } },
            storage: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockLedger.count({ where: whereClause }),
  ])

  // Calculate FIFO cost and running balance per product
  const productIds = Array.from(new Set(rows.map(r => r.productId)))
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, costPrice: true, sellingPrice: true },
  })
  const productMap = new Map(products.map(p => [p.id, p]))

  // For FIFO tracking and running balance, fetch all stock ledger entries per product in chronological order
  const fifoRows = await prisma.stockLedger.findMany({
    where: { productId: { in: productIds }, outletId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, productId: true, movementType: true, quantity: true },
  })

  // Build FIFO simulation & running balance per row
  const fifoMap = new Map<string, { totalCost: number; totalQty: number }>()
  const rowRunningBalance = new Map<string, number>()
  const rowFifoCost = new Map<string, number>()

  for (const row of fifoRows) {
    const key = row.productId
    const product = productMap.get(key)
    const unitCost = Number(product?.costPrice ?? 0)
    const existing = fifoMap.get(key) ?? { totalCost: 0, totalQty: 0 }

    if (row.quantity > 0) {
      existing.totalCost += unitCost * row.quantity
      existing.totalQty += row.quantity
    } else if (row.quantity < 0) {
      const outQty = Math.abs(row.quantity)
      const avgCost = existing.totalQty > 0 ? existing.totalCost / existing.totalQty : unitCost
      existing.totalCost = Math.max(0, existing.totalCost - avgCost * outQty)
      existing.totalQty = Math.max(0, existing.totalQty - outQty)
    }

    fifoMap.set(key, existing)
    rowRunningBalance.set(row.id, existing.totalQty)
    rowFifoCost.set(row.id, existing.totalCost)
  }

  const enrichedRows = rows.map(row => {
    const product = productMap.get(row.productId)
    const unitCost = Number(product?.costPrice ?? 0)
    const qty = row.quantity
    const totalCost = unitCost * Math.abs(qty)
    const isOut = qty < 0
    const pointInTimeBalance = rowRunningBalance.get(row.id) ?? 0
    const pointInTimeFifoCost = rowFifoCost.get(row.id) ?? 0

    return {
      id: row.id,
      productId: row.productId,
      productName: row.product
        ? formatProductFullName({
            ...row.product,
            processor: row.product.processor?.name,
            processorGen: row.product.processorGen?.name,
            ram: row.product.ram?.name,
            storage: row.product.storage?.name,
            display: row.product.display,
          })
        : 'Unknown',
      productCode: row.product?.productCode ?? '',
      sku: row.product?.sku ?? null,
      outletId: row.outletId,
      movementType: row.movementType,
      quantity: row.quantity,
      referenceId: row.referenceId,
      referenceType: row.referenceType,
      notes: row.notes,
      createdAt: row.createdAt,
      unitCost,
      totalCost,
      runningBalance: pointInTimeBalance,
      fifoCost: pointInTimeFifoCost,
      cogs: isOut ? totalCost : 0,
    } satisfies ProductLedgerRow
  })

  // Recalculate summary properly
  const summary = enrichedRows.reduce(
    (acc, row) => {
      if (row.quantity > 0) {
        acc.totalIn += row.quantity
        acc.totalValue += row.totalCost
      } else {
        acc.totalOut += Math.abs(row.quantity)
        acc.totalCogs += row.totalCost
      }
      acc.netQuantity += row.quantity
      acc.fifoTotalCost = row.fifoCost
      return acc
    },
    { totalIn: 0, totalOut: 0, netQuantity: 0, totalCogs: 0, totalValue: 0, fifoTotalCost: 0 }
  )

  return ok({
    rows: enrichedRows,
    summary,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  } satisfies ProductLedgerData & { totalCount: number; page: number; pageSize: number; totalPages: number })
}

export interface SupplierLedgerRow {
  id: string
  supplierId: string
  supplierName: string
  supplierPhone: string | null
  transactionType: string | null
  type: TransactionType
  amount: number
  description: string
  referenceId: string | null
  method: PaymentMethod | null
  createdAt: Date
  runningBalance: number
  invoiceId: string | null
  invoiceNumber: string | null
}

export interface SupplierLedgerData {
  rows: SupplierLedgerRow[]
  summary: {
    totalPayable: number
    totalPaid: number
    totalOutstanding: number
    overdueAmount: number
    supplierCount: number
  }
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getSupplierLedger(filters?: {
  supplierId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const page = filters?.page ?? 1
  const pageSize = filters?.pageSize ?? 50

  const whereClause: any = {}
  if (filters?.supplierId) whereClause.supplierId = filters.supplierId
  if (filters?.from || filters?.to) {
    whereClause.createdAt = {}
    if (filters?.from) whereClause.createdAt.gte = getLocalDateRangeBoundaries(filters.from, filters.from, 6).start
    if (filters?.to) whereClause.createdAt.lte = getLocalDateRangeBoundaries(filters.to, filters.to, 6).end
  }

  const [rows, supplierRows] = await Promise.all([
    prisma.supplierLedger.findMany({
      where: whereClause,
      include: {
        supplier: { select: { id: true, name: true, phone: true, outstandingBalance: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
        bankAccount: { select: { bankName: true, accountName: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.findMany({
      where: { outstandingBalance: { gt: 0 } },
      select: { id: true, name: true, phone: true, outstandingBalance: true },
    }),
  ])

  let totalPayable = 0
  let totalPaid = 0
  let totalOutstanding = 0
  let overdueAmount = 0

  const enrichedRows = rows.map(row => {
    const amount = Number(row.amount)
    const isDebit = row.type === 'DEBIT'
    if (isDebit) totalPayable += amount
    else totalPaid += amount

    return {
      id: row.id,
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? 'Unknown',
      supplierPhone: row.supplier?.phone ?? null,
      transactionType: row.transactionType,
      type: row.type,
      amount,
      description: row.description,
      referenceId: row.referenceId,
      method: row.method,
      createdAt: row.createdAt,
      runningBalance: 0,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoice?.invoiceNumber ?? null,
    } satisfies SupplierLedgerRow
  })

  // Compute running balance working backward from authoritative outstandingBalance
  const runningMap = new Map<string, number>()
  for (const row of enrichedRows) {
    if (!runningMap.has(row.supplierId)) {
      const sup = supplierRows.find(s => s.id === row.supplierId)
      const supFromRows = rows.find(r => r.supplierId === row.supplierId)?.supplier
      const currentBal = sup ? Number(sup.outstandingBalance || 0) : Number(supFromRows?.outstandingBalance ?? 0)
      runningMap.set(row.supplierId, currentBal)
    }
    const current = runningMap.get(row.supplierId)!
    row.runningBalance = Math.round((current + Number.EPSILON) * 100) / 100
    // Working backward in time through rows (ordered desc):
    // If this row was DEBIT, prior balance before this debit was current - amount.
    // If this row was CREDIT, prior balance before this credit was current + amount.
    const prev = row.type === 'DEBIT' ? current - row.amount : current + row.amount
    runningMap.set(row.supplierId, Math.round((prev + Number.EPSILON) * 100) / 100)
  }

  if (filters?.supplierId) {
    const sup = supplierRows.find(s => s.id === filters.supplierId)
    if (sup) {
      totalOutstanding = Number(sup.outstandingBalance || 0)
    } else {
      const supFromRows = rows.find(r => r.supplierId === filters.supplierId)?.supplier
      totalOutstanding = supFromRows ? Number(supFromRows.outstandingBalance || 0) : 0
    }
  } else {
    totalOutstanding = supplierRows.reduce((s, sup) => s + Number(sup.outstandingBalance || 0), 0)
  }

  // Calculate overdue (debts older than 30 days with no corresponding payment)
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  overdueAmount = rows
    .filter(r => r.type === 'DEBIT' && new Date(r.createdAt).getTime() < thirtyDaysAgo)
    .reduce((s, r) => s + Number(r.amount), 0)

  const summary = {
    totalPayable,
    totalPaid,
    totalOutstanding,
    overdueAmount,
    supplierCount: supplierRows.length,
  }

  return ok({
    rows: enrichedRows,
    summary,
    totalCount: rows.length,
    page,
    pageSize,
    totalPages: Math.ceil(rows.length / pageSize),
  } satisfies SupplierLedgerData & { totalCount: number; page: number; pageSize: number; totalPages: number })
}

export interface LowStockAlert {
  id: string
  productId: string
  productName: string
  productCode: string
  sku: string | null
  category: string | null
  currentStock: number
  reorderThreshold: number
  costPrice: number
  sellingPrice: number
  stockValue: number
  supplierName: string | null
  needsReorder: boolean
  reorderQuantity: number
}

export async function getLowStockAlerts(outletId?: string) {
  const user = await requireAuth()
  const targetOutletId = outletId || user.outletId

  if (targetOutletId) {
    validateOutletAccess(user, targetOutletId)
  }

  const lowStockSetting = await prisma.setting.findUnique({
    where: { key: 'low_stock_threshold' },
    select: { value: true },
  })
  const lowStockThreshold = Number(lowStockSetting?.value ?? 5)

  const products = await prisma.product.findMany({
    where: {
      outletId: targetOutletId,
      isActive: true,
    },
    include: {
      category: { select: { name: true } },
      processor: { select: { name: true } },
      processorGen: { select: { name: true } },
      ram: { select: { name: true } },
      storage: { select: { name: true } },
      stockLedger: {
        where: { outletId: targetOutletId },
        select: { quantity: true },
      },
      purchaseOrderLines: {
        where: {
          po: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
        },
        select: { quantity: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  const canViewFinancials =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'ACCOUNTANT'

  const alerts: LowStockAlert[] = products
    .map(p => {
      const currentStock = p.stockLedger.reduce((s, sl) => s + sl.quantity, 0)
      const reorderQty = Math.max(lowStockThreshold - currentStock, lowStockThreshold)
      const needsReorder = currentStock <= lowStockThreshold

      return {
        id: p.id,
        productId: p.id,
        productName: formatProductFullName({
          ...p,
          processor: p.processor?.name,
          processorGen: p.processorGen?.name,
          ram: p.ram?.name,
          storage: p.storage?.name,
          display: p.display,
        }),
        productCode: p.productCode,
        sku: p.sku,
        category: p.category?.name ?? null,
        currentStock,
        reorderThreshold: lowStockThreshold,
        costPrice: canViewFinancials ? Number(p.costPrice) : 0,
        sellingPrice: Number(p.sellingPrice),
        stockValue: canViewFinancials ? currentStock * Number(p.costPrice) : 0,
        supplierName: null,
        needsReorder,
        reorderQuantity: needsReorder ? reorderQty : 0,
      } satisfies LowStockAlert
    })
    .filter(a => a.needsReorder || a.currentStock === 0)
    .sort((a, b) => {
      if (a.currentStock === 0 && b.currentStock > 0) return -1
      if (a.currentStock < b.currentStock) return -1
      return 0
    })

  return ok(alerts)
}


export async function getSerialUnitHistory(serialNumber: string) {
  const user = await requireAuth()
  const sn = serialNumber?.trim()
  if (!sn) return fail('Serial number is required')

  try {
    const serialUnit = await prisma.serialUnit.findFirst({
      where: {
        serialNumber: { equals: sn, mode: 'insensitive' },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true,
            sku: true,
            costPrice: true,
            sellingPrice: true,
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
        outlet: {
          select: { id: true, name: true, code: true },
        },
        poLineSerials: {
          include: {
            poLine: {
              include: {
                po: {
                  include: {
                    supplier: {
                      select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        saleLineSerials: {
          include: {
            saleLine: {
              include: {
                sale: {
                  include: {
                    customer: {
                      select: {
                        id: true,
                        name: true,
                        phone: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        serviceJobSerials: {
          include: {
            customer: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    })

    if (!serialUnit) {
      return fail(`Serial number "${sn}" not found`)
    }

    // Enforce outlet scoping (SUPER_ADMIN bypasses, non-super-admin restricted to their outlet)
    validateOutletAccess(user, serialUnit.outletId)

    const purchaseInfo = serialUnit.poLineSerials[0]?.poLine
      ? {
          poId: serialUnit.poLineSerials[0].poLine.po.id,
          poNumber: serialUnit.poLineSerials[0].poLine.po.poNumber,
          orderDate: serialUnit.poLineSerials[0].poLine.po.orderDate,
          supplierId: serialUnit.poLineSerials[0].poLine.po.supplier.id,
          supplierName: serialUnit.poLineSerials[0].poLine.po.supplier.name,
          supplierPhone: serialUnit.poLineSerials[0].poLine.po.supplier.phone,
          supplierEmail: serialUnit.poLineSerials[0].poLine.po.supplier.email,
          unitCost: Number(serialUnit.poLineSerials[0].poLine.unitCost),
        }
      : null

    const saleInfo = serialUnit.saleLineSerials[0]?.saleLine
      ? {
          saleId: serialUnit.saleLineSerials[0].saleLine.sale.id,
          saleNumber: serialUnit.saleLineSerials[0].saleLine.sale.saleNumber,
          saleDate: serialUnit.saleLineSerials[0].saleLine.sale.createdAt,
          customerId: serialUnit.saleLineSerials[0].saleLine.sale.customer?.id ?? null,
          customerName: serialUnit.saleLineSerials[0].saleLine.sale.customer?.name ?? 'Walk-in Customer',
          customerPhone: serialUnit.saleLineSerials[0].saleLine.sale.customer?.phone ?? null,
          unitPrice: Number(serialUnit.saleLineSerials[0].saleLine.unitPrice),
        }
      : null

    const serviceJobs = serialUnit.serviceJobSerials.map(job => ({
      jobId: job.id,
      jobNumber: job.jobNumber,
      issue: job.issue,
      status: job.status,
      receivedAt: job.receivedAt,
      completedAt: job.completedAt,
      customerName: job.customer?.name || 'Internal',
      customerPhone: job.customer?.phone || null,
    }))

    return ok({
      id: serialUnit.id,
      serialNumber: serialUnit.serialNumber,
      status: serialUnit.status,
      purchasedAt: serialUnit.purchasedAt,
      soldAt: serialUnit.soldAt,
      warrantyExpiry: serialUnit.warrantyExpiry,
      sellingPrice: serialUnit.sellingPrice ? Number(serialUnit.sellingPrice) : null,
      notes: serialUnit.notes,
      product: serialUnit.product,
      outlet: serialUnit.outlet,
      purchase: purchaseInfo,
      sale: saleInfo,
      serviceJobs,
    })
  } catch (error: any) {
    return fail(error?.message || 'Failed to fetch serial unit history')
  }
}

export async function searchSerialOrProduct(query: string) {
  const user = await requireAuth()
  const q = query?.trim()
  if (!q) return ok({ isSerial: false, match: null })

  const serialMatch = await prisma.serialUnit.findFirst({
    where: {
      serialNumber: { equals: q, mode: 'insensitive' },
      ...(user.role === UserRole.SUPER_ADMIN ? {} : { outletId: user.outletId }),
    },
    select: {
      id: true,
      serialNumber: true,
      productId: true,
      status: true,
      outletId: true,
      product: { select: { name: true } },
    },
  })

  if (serialMatch) {
    return ok({
      isSerial: true,
      match: serialMatch,
    })
  }

  return ok({
    isSerial: false,
    match: null,
  })
}

export interface FifoRecommendation {
  productId: string
  productName: string
  productCode: string
  sku: string | null
  outletId: string
  layerId: string
  quantityRemaining: number
  unitCost: number
  receivedAt: Date
  ageInDays: number
  supplierName: string | null
  poNumber: string | null
  requiresSerial: boolean
  serialNumbers: string[]
}

export async function getFifoRecommendations(outletId?: string) {
  try {
    const user = await requireAuth()
    const targetOutletId = outletId || user.outletId

    const layers = await prisma.stockLayer.findMany({
      where: {
        ...(targetOutletId ? { outletId: targetOutletId } : {}),
        quantityRemaining: { gt: 0 },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true,
            sku: true,
            requiresSerial: true,
            serialUnits: {
              where: {
                status: 'IN_STOCK',
                ...(targetOutletId ? { outletId: targetOutletId } : {}),
              },
              select: {
                serialNumber: true,
              },
              orderBy: { createdAt: 'asc' },
              take: 10,
            },
          },
        },
        supplier: {
          select: { name: true },
        },
        purchaseOrder: {
          select: { poNumber: true },
        },
      },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    })

    const seenProductIds = new Set<string>()
    const recommendations: FifoRecommendation[] = []
    const now = new Date().getTime()

    for (const layer of layers) {
      if (layer.product && !seenProductIds.has(layer.productId)) {
        seenProductIds.add(layer.productId)
        const diffTime = Math.abs(now - new Date(layer.receivedAt).getTime())
        const ageInDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        const serialNumbers = layer.product.serialUnits?.map(s => s.serialNumber) || []

        recommendations.push({
          productId: layer.productId,
          productName: layer.product.name,
          productCode: layer.product.productCode,
          sku: layer.product.sku,
          outletId: layer.outletId,
          layerId: layer.id,
          quantityRemaining: layer.quantityRemaining,
          unitCost: Number(layer.unitCost),
          receivedAt: layer.receivedAt,
          ageInDays,
          supplierName: layer.supplier?.name ?? null,
          poNumber: layer.purchaseOrder?.poNumber ?? null,
          requiresSerial: layer.product.requiresSerial,
          serialNumbers,
        })
      }
    }

    return ok(recommendations)
  } catch (error: any) {
    return fail(error?.message || 'Failed to fetch FIFO recommendations')
  }
}

// ─────────────────────────────────────────────
// PRODUCT DETAILS — read-only, reporting only.
// All stats are pure SUM/COUNT aggregations over StockLedger rows.
// No layer-consumption logic is touched here.
// Branch-level numbers filter strictly on user.outletId.
// ─────────────────────────────────────────────

export interface ProductDetailInfo {
  id: string
  name: string
  productCode: string
  sku: string | null
  imageUrl: string | null
  categoryName: string | null
  subcategoryName: string | null
  brandName: string | null
  processorName: string | null
  processorGenName: string | null
  ramName: string | null
  storageName: string | null
  display: string | null
  displaySize: string | null
  displayResolution: string | null
  feature1: string | null
  feature2: string | null
  costPrice: number
  sellingPrice: number
  requiresSerial: boolean
  warrantyMonths: number | null
}

export interface ProductPurchaseLine {
  sn: number
  date: Date
  invoiceNumber: string | null
  supplierName: string
  quantity: number
  received: number
  price: number
  discount: number
  total: number
}

export interface ProductSaleLine {
  sn: number
  date: Date
  invoiceNumber: string
  customerName: string
  quantity: number
  delivered: number
  price: number
  discount: number
  total: number
}

export interface ProductReturnLine {
  sn: number
  date: Date
  invoiceNumber: string
  customerName: string
  rQty: number
  price: number
  discount: number
  total: number
}

export interface ProductStats {
  totalPurchase: number
  received: number
  returnQty: number
  internalReceived: number
  internalSend: number
  balance: number
  avgCost: number
  costValue: number
}

export interface ProductSaleStats {
  totalSold: number
  delivered: number
  returnQty: number
  warrantyOut: number
  warrantyIn: number
  disposal: number
  balance: number
  avgPrice: number
  priceValue: number
}

export interface ProductStatementLine {
  sn: number
  id: string
  date: Date
  movementType: StockMovementType
  typeLabel: string
  referenceNumber: string
  referenceType: string | null
  partyName: string
  outletName?: string
  inQty: number
  outQty: number
  balanceQty: number
  unitRate: number
  debitAmount: number
  creditAmount: number
  balanceValue: number
  notes: string | null
}

export interface ProductStatementSummary {
  totalIn: number
  totalOut: number
  netQuantity: number
  totalDebit: number
  totalCredit: number
  closingValue: number
}

export interface ProductStatementData {
  rows: ProductStatementLine[]
  openingBalanceQty: number
  openingBalanceValue: number
  summary: ProductStatementSummary
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  canViewFinancials: boolean
}

export interface ProductSerialRecord {
  sn: number
  id: string
  serialNumber: string
  status: SerialStatus
  outletId: string
  outletName: string
  purchasedAt: Date | null
  soldAt: Date | null
  warrantyExpiry: Date | null
  notes: string | null
  sellingPrice: number | null
  purchase: {
    poId: string
    poNumber: string
    invoiceNumber: string | null
    orderDate: Date
    supplierName: string
    supplierPhone: string | null
    supplierEmail: string | null
    unitCost: number
  } | null
  sale: {
    saleId: string
    saleNumber: string
    saleDate: Date
    customerName: string
    customerPhone: string | null
    unitPrice: number
  } | null
  serviceCount: number
  latestServiceStatus: string | null
}

export interface ProductSerialRecordsData {
  records: ProductSerialRecord[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  statusCounts: {
    total: number
    inStock: number
    sold: number
    inService: number
    other: number
  }
}

export interface ProductDetailsData {
  product: ProductDetailInfo
  purchaseStatsAll: ProductStats
  purchaseStatsBranch: ProductStats
  saleStatsAll: ProductSaleStats
  saleStatsBranch: ProductSaleStats
  finalBalanceAll: number
  finalBalanceBranch: number
  purchaseLines: ProductPurchaseLine[]
  saleLines: ProductSaleLine[]
  returnLines: ProductReturnLine[]
  statementData: ProductStatementData
  serialRecordsData: ProductSerialRecordsData
  canViewFinancials: boolean
  isSuperAdmin: boolean
}

export async function getProductStatement(
  productId: string,
  filters?: {
    page?: number
    pageSize?: number
    from?: string
    to?: string
    movementType?: string
    outletId?: string
  }
) {
  const user = await requireAuth()
  const page = Math.max(1, filters?.page ?? 1)
  const pageSize = Math.max(1, Math.min(200, filters?.pageSize ?? 50))

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN
  const targetOutletId = isSuperAdmin ? filters?.outletId : user.outletId

  const canViewFinancials =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'ACCOUNTANT'

  // Product price info
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, costPrice: true, sellingPrice: true, name: true },
  })
  if (!product) return fail('Product not found')

  const baseCost = canViewFinancials ? Number(product.costPrice) : 0

  // Build where filter for scoped queries
  const baseWhere: Prisma.StockLedgerWhereInput = {
    productId,
    ...(targetOutletId ? { outletId: targetOutletId } : {}),
  }

  const dateFilter: Prisma.DateTimeFilter = {}
  if (filters?.from) {
    dateFilter.gte = getLocalDateRangeBoundaries(filters.from, filters.from, 6).start
  }
  if (filters?.to) {
    dateFilter.lte = getLocalDateRangeBoundaries(filters.to, filters.to, 6).end
  }

  const filteredWhere: Prisma.StockLedgerWhereInput = {
    ...baseWhere,
    ...(filters?.movementType && filters.movementType !== 'ALL'
      ? { movementType: filters.movementType as StockMovementType }
      : {}),
    ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
  }

  // 1. Calculate opening balance: all movements strictly before the start window/page
  let openingQty = 0
  if (filters?.from) {
    const openingAgg = await prisma.stockLedger.aggregate({
      where: {
        ...baseWhere,
        createdAt: { lt: getLocalDateRangeBoundaries(filters.from, filters.from, 6).start },
      },
      _sum: { quantity: true },
    })
    openingQty = openingAgg._sum.quantity ?? 0
  } else if (page > 1) {
    const prevRows = await prisma.stockLedger.findMany({
      where: filteredWhere,
      orderBy: { createdAt: 'asc' },
      take: (page - 1) * pageSize,
      select: { quantity: true },
    })
    openingQty = prevRows.reduce((sum, r) => sum + r.quantity, 0)
  }

  const openingValue = canViewFinancials ? openingQty * baseCost : 0

  // 2. Fetch total count & page rows
  const [totalCount, ledgerRows] = await Promise.all([
    prisma.stockLedger.count({ where: filteredWhere }),
    prisma.stockLedger.findMany({
      where: filteredWhere,
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            purchaseInvoices: { select: { invoiceNumber: true }, take: 1 },
          },
        },
        outlet: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  // 3. Batch resolve referenced entities for rows on this page
  const saleIds: string[] = []
  const saleReturnIds: string[] = []
  const purchaseReturnIds: string[] = []
  const transferIds: string[] = []
  const serviceJobIds: string[] = []

  for (const row of ledgerRows) {
    if (!row.referenceId) continue
    if (row.movementType === 'SALE_OUT' || row.referenceType === 'Sale') {
      saleIds.push(row.referenceId)
    } else if (row.movementType === 'RETURN_IN' || row.referenceType === 'SaleReturn') {
      saleReturnIds.push(row.referenceId)
    } else if (row.movementType === 'RETURN_OUT' || row.referenceType === 'PurchaseReturn') {
      purchaseReturnIds.push(row.referenceId)
    } else if (
      row.movementType === 'TRANSFER_IN' ||
      row.movementType === 'TRANSFER_OUT' ||
      row.referenceType === 'StockTransfer'
    ) {
      transferIds.push(row.referenceId)
    } else if (row.movementType === 'SERVICE_USE' || row.referenceType === 'ServiceJob') {
      serviceJobIds.push(row.referenceId)
    }
  }

  const [sales, saleReturns, purchaseReturns, transfers, serviceJobs] = await Promise.all([
    saleIds.length > 0
      ? prisma.sale.findMany({
          where: { id: { in: [...new Set(saleIds)] } },
          select: {
            id: true,
            saleNumber: true,
            customer: { select: { name: true } },
          },
        })
      : [],
    saleReturnIds.length > 0
      ? prisma.saleReturn.findMany({
          where: { id: { in: [...new Set(saleReturnIds)] } },
          select: {
            id: true,
            returnNumber: true,
            sale: { select: { customer: { select: { name: true } } } },
          },
        })
      : [],
    purchaseReturnIds.length > 0
      ? prisma.purchaseReturn.findMany({
          where: { id: { in: [...new Set(purchaseReturnIds)] } },
          select: {
            id: true,
            returnNumber: true,
            supplier: { select: { name: true } },
          },
        })
      : [],
    transferIds.length > 0
      ? prisma.stockTransfer.findMany({
          where: { id: { in: [...new Set(transferIds)] } },
          select: {
            id: true,
            fromOutlet: { select: { name: true } },
            toOutlet: { select: { name: true } },
          },
        })
      : [],
    serviceJobIds.length > 0
      ? prisma.serviceJob.findMany({
          where: { id: { in: [...new Set(serviceJobIds)] } },
          select: {
            id: true,
            jobNumber: true,
            customer: { select: { name: true } },
          },
        })
      : [],
  ])

  const saleMap = new Map(sales.map(s => [s.id, s]))
  const saleReturnMap = new Map(saleReturns.map(sr => [sr.id, sr]))
  const purchaseReturnMap = new Map(purchaseReturns.map(pr => [pr.id, pr]))
  const transferMap = new Map(transfers.map(t => [t.id, t]))
  const serviceJobMap = new Map(serviceJobs.map(sj => [sj.id, sj]))

  const movementLabels: Record<StockMovementType, string> = {
    PURCHASE_IN: 'Purchase In',
    SALE_OUT: 'Sale Out',
    RETURN_IN: 'Sale Return',
    RETURN_OUT: 'Purchase Return',
    ADJUSTMENT_IN: 'Adjustment In',
    ADJUSTMENT_OUT: 'Adjustment Out',
    TRANSFER_IN: 'Transfer In',
    TRANSFER_OUT: 'Transfer Out',
    SERVICE_USE: 'Service Use',
    OPENING: 'Opening Stock',
    INTERNAL_REPAIR_OUT: 'Internal Repair Out',
    INTERNAL_REPAIR_IN: 'Internal Repair In',
  }

  let runningQty = openingQty
  let runningValue = openingValue

  let pageTotalIn = 0
  let pageTotalOut = 0
  let pageTotalDebit = 0
  let pageTotalCredit = 0

  const rows: ProductStatementLine[] = ledgerRows.map((r, idx) => {
    const qty = r.quantity
    const isPositive = qty > 0
    const inQty = isPositive ? qty : 0
    const outQty = !isPositive ? Math.abs(qty) : 0

    runningQty += qty

    let referenceNumber = r.notes || '—'
    let partyName = 'System'
    let unitRate = baseCost

    if (r.movementType === 'PURCHASE_IN') {
      referenceNumber =
        r.purchaseOrder?.purchaseInvoices[0]?.invoiceNumber ??
        r.purchaseOrder?.poNumber ??
        r.referenceId ??
        'Purchase'
      partyName = r.supplier?.name ?? 'Supplier'
      unitRate = baseCost
    } else if (r.movementType === 'SALE_OUT') {
      const s = r.referenceId ? saleMap.get(r.referenceId) : null
      referenceNumber = s?.saleNumber ?? r.referenceId ?? 'Sale'
      partyName = s?.customer?.name ?? 'Walk-In Customer'
      unitRate = baseCost
    } else if (r.movementType === 'RETURN_IN') {
      const sr = r.referenceId ? saleReturnMap.get(r.referenceId) : null
      referenceNumber = sr?.returnNumber ?? r.referenceId ?? 'Sale Return'
      partyName = sr?.sale?.customer?.name ?? 'Customer Return'
      unitRate = baseCost
    } else if (r.movementType === 'RETURN_OUT') {
      const pr = r.referenceId ? purchaseReturnMap.get(r.referenceId) : null
      referenceNumber = pr?.returnNumber ?? r.referenceId ?? 'Purchase Return'
      partyName = pr?.supplier?.name ?? r.supplier?.name ?? 'Supplier Return'
      unitRate = baseCost
    } else if (r.movementType === 'TRANSFER_IN') {
      const t = r.referenceId ? transferMap.get(r.referenceId) : null
      referenceNumber = 'Transfer In'
      partyName = t ? `From ${t.fromOutlet.name}` : 'Another Outlet'
      unitRate = baseCost
    } else if (r.movementType === 'TRANSFER_OUT') {
      const t = r.referenceId ? transferMap.get(r.referenceId) : null
      referenceNumber = 'Transfer Out'
      partyName = t ? `To ${t.toOutlet.name}` : 'Another Outlet'
      unitRate = baseCost
    } else if (r.movementType === 'SERVICE_USE') {
      const sj = r.referenceId ? serviceJobMap.get(r.referenceId) : null
      referenceNumber = sj?.jobNumber ?? 'Service'
      partyName = sj?.customer?.name ? `Job: ${sj.customer.name}` : 'Repair Service'
      unitRate = baseCost
    } else if (r.movementType === 'OPENING') {
      referenceNumber = 'Opening'
      partyName = 'Initial Stock'
      unitRate = baseCost
    } else if (r.movementType === 'ADJUSTMENT_IN' || r.movementType === 'ADJUSTMENT_OUT') {
      referenceNumber = 'Adjustment'
      partyName = r.notes || 'Stock Adjustment'
      unitRate = baseCost
    }

    const debitAmount = canViewFinancials ? inQty * unitRate : 0
    const creditAmount = canViewFinancials ? outQty * unitRate : 0

    runningValue = canViewFinancials ? runningQty * baseCost : 0

    pageTotalIn += inQty
    pageTotalOut += outQty
    pageTotalDebit += debitAmount
    pageTotalCredit += creditAmount

    return {
      sn: (page - 1) * pageSize + idx + 1,
      id: r.id,
      date: r.createdAt,
      movementType: r.movementType,
      typeLabel: movementLabels[r.movementType] ?? r.movementType,
      referenceNumber,
      referenceType: r.referenceType,
      partyName,
      outletName: isSuperAdmin ? r.outlet.name : undefined,
      inQty,
      outQty,
      balanceQty: runningQty,
      unitRate: canViewFinancials ? unitRate : 0,
      debitAmount,
      creditAmount,
      balanceValue: runningValue,
      notes: r.notes,
    } satisfies ProductStatementLine
  })

  const summary: ProductStatementSummary = {
    totalIn: pageTotalIn,
    totalOut: pageTotalOut,
    netQuantity: runningQty,
    totalDebit: pageTotalDebit,
    totalCredit: pageTotalCredit,
    closingValue: runningValue,
  }

  return ok({
    rows,
    openingBalanceQty: openingQty,
    openingBalanceValue: openingValue,
    summary,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    canViewFinancials,
  } satisfies ProductStatementData)
}

export async function getProductSerialRecords(
  productId: string,
  filters?: {
    page?: number
    pageSize?: number
    status?: SerialStatus
    search?: string
    outletId?: string
  }
) {
  const user = await requireAuth()
  const page = Math.max(1, filters?.page ?? 1)
  const pageSize = Math.max(1, Math.min(200, filters?.pageSize ?? 25))

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN
  const targetOutletId = isSuperAdmin ? filters?.outletId : user.outletId

  const canViewFinancials =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'ACCOUNTANT'

  const whereClause: Prisma.SerialUnitWhereInput = {
    productId,
    ...(targetOutletId ? { outletId: targetOutletId } : {}),
    ...(filters?.status ? { status: filters.status } : {}),
  }

  const q = filters?.search?.trim()
  if (q) {
    whereClause.OR = [
      { serialNumber: { contains: q, mode: 'insensitive' } },
      {
        saleLineSerials: {
          some: {
            saleLine: {
              sale: {
                OR: [
                  { saleNumber: { contains: q, mode: 'insensitive' } },
                  { customer: { name: { contains: q, mode: 'insensitive' } } },
                ],
              },
            },
          },
        },
      },
      {
        poLineSerials: {
          some: {
            poLine: {
              po: {
                OR: [
                  { poNumber: { contains: q, mode: 'insensitive' } },
                  { supplier: { name: { contains: q, mode: 'insensitive' } } },
                  { purchaseInvoices: { some: { invoiceNumber: { contains: q, mode: 'insensitive' } } } },
                ],
              },
            },
          },
        },
      },
    ]
  }

  const baseStatusWhere: Prisma.SerialUnitWhereInput = {
    productId,
    ...(targetOutletId ? { outletId: targetOutletId } : {}),
  }

  const [totalCount, statusAggs, serialUnits] = await Promise.all([
    prisma.serialUnit.count({ where: whereClause }),
    prisma.serialUnit.groupBy({
      by: ['status'],
      where: baseStatusWhere,
      _count: { id: true },
    }),
    prisma.serialUnit.findMany({
      where: whereClause,
      include: {
        outlet: { select: { id: true, name: true, code: true } },
        poLineSerials: {
          include: {
            poLine: {
              include: {
                po: {
                  select: {
                    id: true,
                    poNumber: true,
                    orderDate: true,
                    supplier: { select: { id: true, name: true, phone: true, email: true } },
                    purchaseInvoices: { select: { invoiceNumber: true }, take: 1 },
                  },
                },
              },
            },
          },
        },
        saleLineSerials: {
          include: {
            saleLine: {
              include: {
                sale: {
                  select: {
                    id: true,
                    saleNumber: true,
                    createdAt: true,
                    customer: { select: { id: true, name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
        serviceJobSerials: {
          select: {
            id: true,
            jobNumber: true,
            issue: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  let inStockCount = 0
  let soldCount = 0
  let inServiceCount = 0
  let totalStatusCount = 0

  for (const row of statusAggs) {
    totalStatusCount += row._count.id
    if (row.status === 'IN_STOCK') inStockCount += row._count.id
    else if (row.status === 'SOLD') soldCount += row._count.id
    else if (row.status === 'IN_SERVICE') inServiceCount += row._count.id
  }

  const records: ProductSerialRecord[] = serialUnits.map((s, idx) => {
    const poLine = s.poLineSerials[0]?.poLine
    const saleLine = s.saleLineSerials[0]?.saleLine

    const purchase = poLine
      ? {
          poId: poLine.po.id,
          poNumber: poLine.po.poNumber,
          invoiceNumber: poLine.po.purchaseInvoices[0]?.invoiceNumber ?? poLine.po.poNumber,
          orderDate: poLine.po.orderDate,
          supplierName: poLine.po.supplier.name,
          supplierPhone: poLine.po.supplier.phone,
          supplierEmail: poLine.po.supplier.email,
          unitCost: canViewFinancials ? Number(poLine.unitCost) : 0,
        }
      : null

    const sale = saleLine
      ? {
          saleId: saleLine.sale.id,
          saleNumber: saleLine.sale.saleNumber,
          saleDate: saleLine.sale.createdAt,
          customerName: saleLine.sale.customer?.name ?? 'Walk-In Customer',
          customerPhone: saleLine.sale.customer?.phone ?? null,
          unitPrice: Number(saleLine.unitPrice),
        }
      : null

    return {
      sn: (page - 1) * pageSize + idx + 1,
      id: s.id,
      serialNumber: s.serialNumber,
      status: s.status,
      outletId: s.outletId,
      outletName: s.outlet.name,
      purchasedAt: s.purchasedAt ?? poLine?.po.orderDate ?? null,
      soldAt: s.soldAt ?? saleLine?.sale.createdAt ?? null,
      warrantyExpiry: s.warrantyExpiry,
      notes: s.notes,
      sellingPrice: s.sellingPrice ? Number(s.sellingPrice) : (saleLine ? Number(saleLine.unitPrice) : null),
      purchase,
      sale,
      serviceCount: s.serviceJobSerials.length,
      latestServiceStatus: s.serviceJobSerials[0]?.status ?? null,
    } satisfies ProductSerialRecord
  })

  return ok({
    records,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    statusCounts: {
      total: totalStatusCount,
      inStock: inStockCount,
      sold: soldCount,
      inService: inServiceCount,
      other: totalStatusCount - inStockCount - soldCount - inServiceCount,
    },
  } satisfies ProductSerialRecordsData)
}

export async function getProductDetails(productId: string) {
  const user = await requireAuth()
  const branchOutletId = user.outletId
  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN

  const canViewFinancials =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'ACCOUNTANT'

  // ── 1. Product info ──────────────────────────────────────────────────────
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      ...(isSuperAdmin ? {} : { outletId: branchOutletId }),
    },
    select: {
      id: true,
      name: true,
      productCode: true,
      sku: true,
      imageUrl: true,
      feature1: true,
      feature2: true,
      display: true,
      displaySize: true,
      displayResolution: true,
      costPrice: true,
      sellingPrice: true,
      requiresSerial: true,
      warrantyMonths: true,
      category:     { select: { name: true } },
      subcategory:  { select: { name: true } },
      brand:        { select: { name: true } },
      processor:    { select: { name: true } },
      processorGen: { select: { name: true } },
      ram:          { select: { name: true } },
      storage:      { select: { name: true } },
    },
  })

  if (!product) return fail('Product not found')
  const p = product

  // ── 2. StockLedger aggregations (read-only) ──────────────────────────────
  const allLedger = await prisma.stockLedger.findMany({
    where: {
      productId,
      ...(isSuperAdmin ? {} : { outletId: branchOutletId }),
    },
    select: { outletId: true, movementType: true, quantity: true },
  })

  const branchLedger = allLedger.filter(r => r.outletId === branchOutletId)

  function calcPurchaseStats(rows: typeof allLedger): ProductStats {
    let totalPurchase = 0
    let received = 0
    let returnQty = 0
    let internalReceived = 0
    let internalSend = 0

    for (const r of rows) {
      const qty = Math.abs(r.quantity)
      switch (r.movementType) {
        case 'PURCHASE_IN':
          totalPurchase += qty
          received += qty
          break
        case 'RETURN_OUT':
          returnQty += qty
          break
        case 'TRANSFER_IN':
          internalReceived += qty
          break
        case 'TRANSFER_OUT':
          internalSend += qty
          break
        case 'ADJUSTMENT_IN':
          received += qty
          break
        case 'ADJUSTMENT_OUT':
          returnQty += qty
          break
        default:
          break
      }
    }

    const balance = received - returnQty + internalReceived - internalSend
    const costPrice = canViewFinancials ? Number(p.costPrice) : 0
    const avgCost = costPrice
    const costValue = canViewFinancials ? balance * avgCost : 0

    return { totalPurchase, received, returnQty, internalReceived, internalSend, balance, avgCost, costValue }
  }

  function calcSaleStats(rows: typeof allLedger): ProductSaleStats {
    let totalSold = 0
    let delivered = 0
    let returnQty = 0
    const warrantyOut = 0
    let warrantyIn = 0
    let disposal = 0

    for (const r of rows) {
      const qty = Math.abs(r.quantity)
      switch (r.movementType) {
        case 'SALE_OUT':
          totalSold += qty
          delivered += qty
          break
        case 'RETURN_IN':
          returnQty += qty
          break
        case 'ADJUSTMENT_OUT':
          disposal += qty
          break
        case 'ADJUSTMENT_IN':
          warrantyIn += qty
          break
        default:
          break
      }
    }

    const balance = totalSold - returnQty
    const sellingPrice = Number(p.sellingPrice)
    const avgPrice = sellingPrice
    const priceValue = balance * avgPrice

    return { totalSold, delivered, returnQty, warrantyOut, warrantyIn, disposal, balance, avgPrice, priceValue }
  }

  const purchaseStatsAll    = calcPurchaseStats(allLedger)
  const purchaseStatsBranch = calcPurchaseStats(branchLedger)
  const saleStatsAll        = calcSaleStats(allLedger)
  const saleStatsBranch     = calcSaleStats(branchLedger)

  const finalBalanceAll    = allLedger.reduce((sum, r) => sum + r.quantity, 0)
  const finalBalanceBranch = branchLedger.reduce((sum, r) => sum + r.quantity, 0)

  // ── 3. Purchase transaction lines ────────────────────────────────────────
  const rawPoLines = await prisma.purchaseOrderLine.findMany({
    where: {
      productId,
      ...(isSuperAdmin ? {} : { po: { outletId: branchOutletId } }),
    },
    include: {
      po: {
        select: {
          poNumber: true,
          orderDate: true,
          outletId: true,
          supplier: { select: { name: true } },
          purchaseInvoices: { select: { invoiceNumber: true }, take: 1 },
        },
      },
    },
    orderBy: { po: { orderDate: 'desc' } },
    take: 50,
  })

  const purchasedPoIds = [...new Set(rawPoLines.map(l => l.po.outletId && l.poId).filter(Boolean) as string[])]
  const receivedByPoId = new Map<string, number>()
  if (purchasedPoIds.length > 0) {
    const receivedLedger = await prisma.stockLedger.groupBy({
      by: ['purchaseOrderId'],
      where: {
        productId,
        movementType: 'PURCHASE_IN',
        purchaseOrderId: { in: purchasedPoIds },
        ...(isSuperAdmin ? {} : { outletId: branchOutletId }),
      },
      _sum: { quantity: true },
    })
    for (const r of receivedLedger) {
      if (r.purchaseOrderId) receivedByPoId.set(r.purchaseOrderId, r._sum.quantity ?? 0)
    }
  }

  const purchaseLines: ProductPurchaseLine[] = rawPoLines.map((line, idx) => ({
    sn: idx + 1,
    date: line.po.orderDate,
    invoiceNumber: line.po.purchaseInvoices[0]?.invoiceNumber ?? line.po.poNumber,
    supplierName: line.po.supplier.name,
    quantity: line.quantity,
    received: receivedByPoId.get(line.poId) ?? 0,
    price: canViewFinancials ? Number(line.unitCost) : 0,
    discount: canViewFinancials ? Number(line.discount) : 0,
    total: canViewFinancials ? Number(line.total) : 0,
  }))

  // ── 4. Sales transaction lines ───────────────────────────────────────────
  const rawSaleLines = await prisma.saleLine.findMany({
    where: {
      productId,
      ...(isSuperAdmin ? {} : { sale: { outletId: branchOutletId } }),
    },
    include: {
      sale: {
        select: {
          saleNumber: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: { sale: { createdAt: 'desc' } },
    take: 50,
  })

  const saleLines: ProductSaleLine[] = rawSaleLines.map((line, idx) => ({
    sn: idx + 1,
    date: line.sale.createdAt,
    invoiceNumber: line.sale.saleNumber,
    customerName: line.sale.customer?.name ?? 'Walk-In Customer',
    quantity: line.quantity,
    delivered: line.quantity,
    price: Number(line.unitPrice),
    discount: Number((line as any).discountAmt ?? 0) > 0 ? Number((line as any).discountAmt) : (Number(line.unitPrice) * line.quantity - Number(line.total)),
    total: Number(line.total),
  }))

  // ── 5. Return transaction lines ──────────────────────────────────────────
  const rawReturnLines = await prisma.saleReturnLine.findMany({
    where: {
      saleLine: {
        productId,
        ...(isSuperAdmin ? {} : { sale: { outletId: branchOutletId } }),
      },
    },
    include: {
      return: {
        select: {
          returnNumber: true,
          createdAt: true,
          sale: {
            select: {
              customer: { select: { name: true } },
            },
          },
        },
      },
      saleLine: {
        select: { unitPrice: true },
      },
    },
    orderBy: { return: { createdAt: 'desc' } },
    take: 50,
  })

  const returnLines: ProductReturnLine[] = rawReturnLines.map((line, idx) => ({
    sn: idx + 1,
    date: line.return.createdAt,
    invoiceNumber: line.return.returnNumber,
    customerName: line.return.sale.customer?.name ?? 'Walk-In Customer',
    rQty: line.quantity,
    price: Number(line.unitPrice),
    discount: 0,
    total: Number(line.unitPrice) * line.quantity,
  }))

  // ── 6. Initial Statement & Serial Records ─────────────────────────────────
  const [statementRes, serialsRes] = await Promise.all([
    getProductStatement(productId, { page: 1, pageSize: 50 }),
    getProductSerialRecords(productId, { page: 1, pageSize: 25 }),
  ])

  const statementData = statementRes.success
    ? statementRes.data
    : {
        rows: [],
        openingBalanceQty: 0,
        openingBalanceValue: 0,
        summary: { totalIn: 0, totalOut: 0, netQuantity: 0, totalDebit: 0, totalCredit: 0, closingValue: 0 },
        totalCount: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        canViewFinancials,
      }

  const serialRecordsData = serialsRes.success
    ? serialsRes.data
    : {
        records: [],
        totalCount: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        statusCounts: { total: 0, inStock: 0, sold: 0, inService: 0, other: 0 },
      }

  const info: ProductDetailInfo = {
    id: product.id,
    name: formatProductFullName({
      ...product,
      processor: product.processor?.name,
      processorGen: product.processorGen?.name,
      ram: product.ram?.name,
      storage: product.storage?.name,
      display: product.display,
      displaySize: product.displaySize,
      displayResolution: product.displayResolution,
    }),
    productCode: product.productCode,
    sku: product.sku,
    imageUrl: product.imageUrl,
    categoryName: product.category?.name ?? null,
    subcategoryName: product.subcategory?.name ?? null,
    brandName: product.brand?.name ?? null,
    processorName: product.processor?.name ?? null,
    processorGenName: product.processorGen?.name ?? null,
    ramName: product.ram?.name ?? null,
    storageName: product.storage?.name ?? null,
    display: product.display,
    displaySize: product.displaySize,
    displayResolution: product.displayResolution,
    feature1: product.feature1,
    feature2: product.feature2,
    costPrice: canViewFinancials ? Number(product.costPrice) : 0,
    sellingPrice: Number(product.sellingPrice),
    requiresSerial: product.requiresSerial,
    warrantyMonths: product.warrantyMonths,
  }

  return ok({
    product: info,
    purchaseStatsAll,
    purchaseStatsBranch,
    saleStatsAll,
    saleStatsBranch,
    finalBalanceAll,
    finalBalanceBranch,
    purchaseLines,
    saleLines,
    returnLines,
    statementData,
    serialRecordsData,
    canViewFinancials,
    isSuperAdmin,
  } satisfies ProductDetailsData)
}

const updateSerialSellingPriceSchema = z.object({
  serialUnitId: z.string().optional(),
  serialNumber: z.string().optional(),
  sellingPrice: z.coerce.number().min(0, 'Selling price must be non-negative'),
  notes: z.string().optional(),
})

export async function updateSerialSellingPrice(
  data: z.infer<typeof updateSerialSellingPriceSchema>
) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER
    )
    const parsed = updateSerialSellingPriceSchema.safeParse(data)
    if (!parsed.success) return fail(parsed.error.issues[0].message)

    const { serialUnitId, serialNumber, sellingPrice, notes } = parsed.data

    if (!serialUnitId && !serialNumber) {
      return fail('Either serialUnitId or serialNumber is required')
    }

    const serial = await prisma.serialUnit.findFirst({
      where: serialUnitId
        ? { id: serialUnitId }
        : { serialNumber: serialNumber!.trim() },
      include: { product: true },
    })

    if (!serial) return fail('Serial unit not found')
    validateOutletAccess(user, serial.outletId)

    const updated = await prisma.serialUnit.update({
      where: { id: serial.id },
      data: {
        sellingPrice,
        notes: notes !== undefined ? notes : serial.notes,
      },
    })

    await logAudit(
      'UPDATE_SERIAL_SELLING_PRICE',
      'SerialUnit',
      serial.id,
      {
        serialNumber: serial.serialNumber,
        productId: serial.productId,
        productName: serial.product.name,
        oldPrice: Number(serial.sellingPrice ?? 0),
        newPrice: sellingPrice,
      }
    )

    safeRevalidatePath(`/products/${serial.productId}`)
    safeRevalidatePath('/products')
    safeRevalidatePath('/products-ledger')

    return ok({
      id: updated.id,
      serialNumber: updated.serialNumber,
      sellingPrice: Number(updated.sellingPrice),
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to update serial selling price')
  }
}
