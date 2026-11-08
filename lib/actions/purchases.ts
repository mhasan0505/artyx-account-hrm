'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { consumeStockLayers } from '@/lib/inventory/stock-layers'
import { checkAndNotifyLowStock } from '@/lib/notifications/triggers/low-stock'
import { fail, ok } from '@/lib/actions/result'
import { logAudit, logAuditDirect } from '@/lib/audit/logger'
import { prisma } from '@/lib/db'
import {
  FreightPaymentMethod,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
  PurchaseOrderStatus,
  PurchaseReturnSettlementMethod,
  SerialStatus,
  StockMovementType,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { nextDocumentNumber } from '@/lib/numbering/next-document-number'
import {
  allocateLandedCosts,
  getNonSerializedStockLayers,
  round4,
} from '@/lib/purchases/landed-cost'
import {
  applyInvoicePayment,
  requireOpenDrawerForPurchase,
} from '@/lib/purchases/invoice-payment'
export { applyInvoicePayment, requireOpenDrawerForPurchase }

export type PrismaTx = Prisma.TransactionClient

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
    // Ignore outside Next.js request context
  }
}

import { isGiftOrAccessoryProduct } from '@/lib/purchases/gift-policy'
export { isGiftOrAccessoryProduct }

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100

const poLineSchema = z
  .object({
    productId: z.string(),
    quantity: z.coerce.number().int().min(1),
    unitCost: z.coerce.number().min(0),
    sellingPrice: z.coerce.number().optional(),
    discount: z.coerce.number().min(0).default(0),
    note: z.string().optional(),
    serialNumbers: z.array(z.string()).optional(), // Serial numbers for serialized products
  })
  .refine(l => l.discount <= round2(l.quantity * l.unitCost), {
    message: 'Discount cannot exceed line subtotal (quantity * unitCost)',
  })
const createPoSchema = z.object({
  supplierId: z.string(),
  orderDate: z.string().datetime({ offset: true }).optional(),
  expectedDelivery: z.string().datetime({ offset: true }).optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  lines: z.array(poLineSchema).min(1),
})


const poApprovalRoles = new Set<UserRole>([
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
])

function canApprovePurchaseOrders(role: UserRole | string | undefined) {
  return role ? poApprovalRoles.has(role as UserRole) : false
}

async function getScopedPurchaseOrderRecord(id: string, outletId: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, outletId },
    include: {
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
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      sentBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      cancelledBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
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
              ram: { select: { name: true } },
              storage: { select: { name: true } },
              display: true,
              requiresSerial: true,
            },
          },
          serialUnits: {
            include: {
              serialUnit: {
                select: {
                  id: true,
                  serialNumber: true,
                  status: true,
                  sellingPrice: true,
                },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
      },
      _count: {
        select: {
          lines: true,
        },
      },
    },
  })

  if (!po) return null

  return {
    ...po,
    lines: po.lines.map(line => ({
      ...line,
      product: {
        ...line.product,
        processor: line.product.processor?.name ?? null,
        ram: line.product.ram?.name ?? null,
        storage: line.product.storage?.name ?? null,
      },
      serialUnits: line.serialUnits,
    })),
  }
}

export async function createPurchaseOrder(
  data: z.infer<typeof createPoSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  const parsed = createPoSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const cleanIdempotencyKey = parsed.data.idempotencyKey?.trim() || undefined
  if (cleanIdempotencyKey) {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { idempotencyKey: cleanIdempotencyKey },
      select: {
        id: true,
        poNumber: true,
        purchaseInvoices: { select: { id: true, invoiceNumber: true }, take: 1 },
      },
    })
    if (existing) {
      return ok({
        id: existing.id,
        poNumber: existing.poNumber,
        invoiceId: existing.purchaseInvoices[0]?.id || '',
        invoiceNumber: existing.purchaseInvoices[0]?.invoiceNumber || '',
      })
    }
  }

  const lines = parsed.data.lines.map(l => ({
    ...l,
    total: round2(l.quantity * l.unitCost - l.discount),
  }))
  const lineCreateData = lines.map(
    ({ serialNumbers: _serialNumbers, sellingPrice: _sellingPrice, ...line }) => line
  )

  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: parsed.data.supplierId },
    select: { id: true },
  })
  if (!supplier) {
    return fail('Supplier not found')
  }

  const productIds = Array.from(new Set(lines.map(line => line.productId)))
  const existingProducts = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      outletId: user.outletId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      requiresSerial: true,
      category: { select: { name: true } },
      parent: { select: { name: true } },
    },
  })

  if (existingProducts.length !== productIds.length) {
    return fail('One or more selected products are invalid for this outlet')
  }

  const productMap = new Map(existingProducts.map(p => [p.id, p]))

  // ── ENFORCE SERIAL NUMBERS for products that require them (Gifts & Accessories exempt) ──
  for (const line of lines) {
    const product = productMap.get(line.productId)
    const needsSerial =
      Boolean(product?.requiresSerial) &&
      !isGiftOrAccessoryProduct(product, line.note)

    if (needsSerial) {
      const providedSerials =
        line.serialNumbers?.map(s => s.trim()).filter(Boolean) ?? []
      if (providedSerials.length !== line.quantity) {
        return fail(
          `"${product?.name}" requires serial numbers. Please provide exactly ${line.quantity} serial number(s). Got ${providedSerials.length}.`
        )
      }
      const uniqueSerials = new Set(providedSerials)
      if (uniqueSerials.size !== providedSerials.length) {
        return fail(
          `"${product?.name}" has duplicate serial numbers. Each serial number must be unique.`
        )
      }
    }
  }

  // Validate serial numbers are not already in inventory
  const allSerialNumbers = lines
    .filter(l => {
      const p = productMap.get(l.productId)
      return Boolean(p?.requiresSerial) && !isGiftOrAccessoryProduct(p, l.note)
    })
    .flatMap(l => l.serialNumbers ?? [])
    .map(s => s.trim())
    .filter(Boolean)

  if (allSerialNumbers.length > 0) {
    const existingSerials = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: allSerialNumbers } },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        notes: true,
        _count: {
          select: {
            poLineSerials: true,
            saleLineSerials: true,
            serviceJobSerials: true,
          },
        },
      },
    })

    // Cleanup legacy orphan serials left behind by historical PO deletions.
    // These are safe to remove when they are in stock, unattached everywhere,
    // and clearly originated from a purchase note.
    const orphanPurchaseSerials = existingSerials.filter(
      serial =>
        serial.status === 'IN_STOCK' &&
        serial._count.poLineSerials === 0 &&
        serial._count.saleLineSerials === 0 &&
        serial._count.serviceJobSerials === 0 &&
        serial.notes?.startsWith('Purchase ')
    )
    const orphanPurchaseSerialIds = orphanPurchaseSerials.map(serial => serial.id)

    if (orphanPurchaseSerialIds.length > 0) {
      await logAuditDirect(
        user.id,
        'ORPHAN_SERIALS_AUTO_DELETED',
        'SerialUnit',
        orphanPurchaseSerialIds.join(','),
        {
          reason: 'Legacy orphan serials auto-deleted during PO creation',
          deletedSerialNumbers: orphanPurchaseSerials.map(s => s.serialNumber),
          count: orphanPurchaseSerialIds.length,
          outletId: user.outletId,
        }
      )

      await prisma.serialUnit.deleteMany({
        where: { id: { in: orphanPurchaseSerialIds } },
      })
    }

    const blockedSerials = existingSerials.filter(
      serial => !orphanPurchaseSerialIds.includes(serial.id)
    )

    if (blockedSerials.length > 0) {
      const dupes = blockedSerials.map(e => e.serialNumber).join(', ')
      return fail(`Serial number(s) already exist in inventory: ${dupes}`)
    }
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0))
  const total = round2(subtotal)

  const executePoCreate = async (activeTx: PrismaTx) => {
    const po = await activeTx.purchaseOrder.create({
      data: {
        poNumber: await nextDocumentNumber(activeTx, 'purchase_order'),
        idempotencyKey: cleanIdempotencyKey,
        supplierId: parsed.data.supplierId,
        outletId: user.outletId,
        createdById: user.id,
        status: PurchaseOrderStatus.RECEIVED,
        orderDate: parsed.data.orderDate
          ? new Date(parsed.data.orderDate)
          : new Date(),
        expectedDelivery: parsed.data.expectedDelivery
          ? new Date(parsed.data.expectedDelivery)
          : undefined,
        notes: parsed.data.notes,
        subtotal,
        total,
        lines: { create: lineCreateData },
      },
      include: { lines: true },
    })

    // Update products with new cost prices and selling prices sequentially
    // (Promise.all inside a Prisma interactive transaction can deadlock with many items)
    for (const line of lines) {
      const effectiveUnitCost =
        line.quantity > 0
          ? round2(Number(line.unitCost) - Number(line.discount || 0) / line.quantity)
          : Number(line.unitCost)
      await activeTx.product.update({
        where: { id: line.productId },
        data: {
          costPrice: effectiveUnitCost,
          ...(line.sellingPrice !== undefined && line.sellingPrice > 0
            ? { sellingPrice: line.sellingPrice }
            : {}),
        },
      })
    }

    // Create all SerialUnit and PurchaseOrderLineSerial records in order to link them properly
    for (const inputLine of lines) {
      const product = productMap.get(inputLine.productId)
      const needsSerial =
        Boolean(product?.requiresSerial) &&
        !isGiftOrAccessoryProduct(product, inputLine.note)
      if (!needsSerial || !inputLine.serialNumbers || inputLine.serialNumbers.length === 0)
        continue

      // Find the corresponding po line created in the database
      const poLine = po.lines.find(pl => pl.productId === inputLine.productId)
      if (!poLine) continue

      const effectiveUnitCost =
        inputLine.quantity > 0
          ? round2(
              Number(inputLine.unitCost) -
                Number(inputLine.discount || 0) / inputLine.quantity
            )
          : Number(inputLine.unitCost)

      const serials = inputLine.serialNumbers
        .map(s => s.trim())
        .filter(Boolean)

      for (const serialNumber of serials) {
        const serial = await activeTx.serialUnit.create({
          data: {
            serialNumber,
            productId: inputLine.productId,
            outletId: user.outletId,
            status: 'IN_STOCK' as const,
            purchasedAt: po.orderDate,
            notes: `Purchase ${po.poNumber}`,
            costPrice: effectiveUnitCost,
            sellingPrice: inputLine.sellingPrice,
          },
        })

        await activeTx.purchaseOrderLineSerial.create({
          data: {
            poLineId: poLine.id,
            serialUnitId: serial.id,
          },
        })
      }
    }

    // Batch create all stock ledger entries
    const stockLedgerEntries = lines.map(line => ({
      productId: line.productId,
      outletId: user.outletId,
      supplierId: parsed.data.supplierId,
      purchaseOrderId: po.id,
      movementType: StockMovementType.PURCHASE_IN,
      quantity: line.quantity,
      referenceId: po.id,
      referenceType: 'PURCHASE' as const,
      notes: `Purchase ${po.poNumber}`,
    }))

    await activeTx.stockLedger.createMany({
      data: stockLedgerEntries,
    })

    // Create StockLayers for real FIFO tracking
    const stockLayers = lines.map(line => {
      const effectiveUnitCost =
        line.quantity > 0
          ? round2(Number(line.unitCost) - Number(line.discount || 0) / line.quantity)
          : Number(line.unitCost)
      return {
        productId: line.productId,
        outletId: user.outletId,
        supplierId: parsed.data.supplierId,
        purchaseOrderId: po.id,
        quantityReceived: line.quantity,
        quantityRemaining: line.quantity,
        unitCost: effectiveUnitCost,
        receivedAt: po.orderDate ?? new Date(),
      }
    })

    await activeTx.stockLayer.createMany({
      data: stockLayers,
    })

    // Snapshot Supplier previousDue and newBalance
    await activeTx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${parsed.data.supplierId} FOR UPDATE`
    const supplierForSnap = await activeTx.supplier.findUnique({
      where: { id: parsed.data.supplierId },
      select: {
        outstandingBalance: true,
        linkedCustomer: { select: { id: true, outstandingBalance: true } },
      },
    })

    if (supplierForSnap?.linkedCustomer) {
      await activeTx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${supplierForSnap.linkedCustomer.id} FOR UPDATE`
    }

    const supAp = Number(supplierForSnap?.outstandingBalance || 0)
    const custAr = supplierForSnap?.linkedCustomer ? Number(supplierForSnap.linkedCustomer.outstandingBalance || 0) : 0

    let prevDueVal: number
    let newBalVal: number

    if (supplierForSnap?.linkedCustomer) {
      prevDueVal = custAr - supAp
      newBalVal = prevDueVal - total
    } else {
      prevDueVal = supAp
      newBalVal = prevDueVal + total
    }

    const invoice = await activeTx.purchaseInvoice.create({
      data: {
        invoiceNumber: await nextDocumentNumber(activeTx, 'purchase_invoice'),
        supplierId: parsed.data.supplierId,
        poId: po.id,
        subtotal,
        tax: 0,
        total,
        previousDue: prevDueVal,
        newBalance: newBalVal,
        dueDate: undefined,
        notes: parsed.data.notes,
        status: InvoiceStatus.DRAFT,
        createdAt: po.orderDate,
      },
    })

    await activeTx.supplierLedger.create({
      data: {
        supplierId: parsed.data.supplierId,
        type: TransactionType.DEBIT,
        amount: total,
        description: `Invoice ${invoice.invoiceNumber}`,
        referenceId: invoice.id,
        invoiceId: invoice.id,
        outletId: po.outletId,
        purchaseOrderId: po.id,
        transactionType: 'INVOICE_CREATED',
        createdById: user.id,
      },
    })

    await activeTx.supplier.update({
      where: { id: parsed.data.supplierId },
      data: { outstandingBalance: { increment: total } },
    })

    // Double-Entry General Ledger Postings:
    // Dr Inventory (1400): Total purchase value
    // Cr Accounts Payable (2100): Total purchase value
    const coaAccounts = await activeTx.chartOfAccount.findMany({
      where: { code: { in: ['1400', '2100'] } },
      select: { id: true, code: true },
    })
    const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
    const invAccountId = coaMap.get('1400')
    const apAccountId = coaMap.get('2100')

    if (invAccountId && apAccountId && total > 0) {
      const gl = [
        {
          accountId: invAccountId,
          type: TransactionType.DEBIT,
          amount: total,
          description: `Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'PurchaseInvoice',
          createdAt: po.orderDate ?? new Date(),
        },
        {
          accountId: apAccountId,
          type: TransactionType.CREDIT,
          amount: total,
          description: `Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'PurchaseInvoice',
          createdAt: po.orderDate ?? new Date(),
        },
      ]
      assertBalancedJournal(gl)
      await activeTx.accountLedgerEntry.createMany({ data: gl })
    }

    return { po, invoice }
  }

  let po: any
  let invoice: any

  try {
    if (tx) {
      const res = await executePoCreate(tx)
      po = res.po
      invoice = res.invoice
    } else {
      const res = await prisma.$transaction(async innerTx => await executePoCreate(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
      po = res.po
      invoice = res.invoice
    }
  } catch (err: any) {
    if (
      cleanIdempotencyKey &&
      (err?.code === 'P2002' ||
        err?.message?.includes('Unique constraint failed') ||
        err?.message?.includes('idempotencyKey'))
    ) {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { idempotencyKey: cleanIdempotencyKey },
        select: {
          id: true,
          poNumber: true,
          purchaseInvoices: { select: { id: true, invoiceNumber: true }, take: 1 },
        },
      })
      if (existing) {
        return ok({
          id: existing.id,
          poNumber: existing.poNumber,
          invoiceId: existing.purchaseInvoices[0]?.id || '',
          invoiceNumber: existing.purchaseInvoices[0]?.invoiceNumber || '',
        })
      }
    }
    throw err
  }

  safeRevalidateTag(`dashboard-${po.outletId}`)
  safeRevalidatePath('/', 'page')
  safeRevalidatePath('/purchases')
  safeRevalidatePath('/purchases/invoices')
  safeRevalidatePath('/reports/inventory')
  safeRevalidatePath('/products')
  return ok({
    id: po.id,
    poNumber: po.poNumber,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
  })
}

export async function getPurchaseOrderProductOptions() {
  const user = await requireAuth()

  if (!user.outletId) {
    return []
  }

  const products = await prisma.product.findMany({
    where: {
      outletId: user.outletId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      productCode: true,
      costPrice: true,
      requiresSerial: true,
      category: { select: { name: true } },
      parent: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  })

  return products.map(product => ({
    id: product.id,
    name: product.name,
    productCode: product.productCode,
    costPrice: Number(product.costPrice),
    requiresSerial: isGiftOrAccessoryProduct(product)
      ? false
      : product.requiresSerial,
  }))
}

export async function getPurchaseOrders(
  outletId: string,
  filters?: {
    search?: string
    status?: string
    from?: Date
    to?: Date
    page?: number
    limit?: number
  }
) {
  await requireAuth()
  const page = filters?.page && filters.page > 0 ? filters.page : undefined
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : undefined
  const skip = page && limit ? (page - 1) * limit : undefined

  return prisma.purchaseOrder.findMany({
    where: {
      outletId,
      ...(filters?.status && filters.status !== 'ALL'
        ? { status: filters.status as PurchaseOrderStatus }
        : {}),
      ...(filters?.from || filters?.to
        ? {
            orderDate: {
              ...(filters?.from ? { gte: filters.from } : {}),
              ...(filters?.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters?.search
        ? {
            OR: [
              { poNumber: { contains: filters.search, mode: 'insensitive' as const } },
              {
                supplier: {
                  name: { contains: filters.search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: 'desc' },
    ...(skip !== undefined ? { skip } : {}),
    ...(limit !== undefined ? { take: limit } : {}),
  })
}

export async function getPurchaseOrdersPaginated(
  outletId: string,
  filters?: {
    search?: string
    status?: string
    from?: Date
    to?: Date
    page?: number
    limit?: number
  }
) {
  await requireAuth()
  const page = Math.max(1, filters?.page ?? 1)
  const limit = Math.max(1, filters?.limit ?? 20)
  const skip = (page - 1) * limit

  const where = {
    outletId,
    ...(filters?.status && filters.status !== 'ALL'
      ? { status: filters.status as PurchaseOrderStatus }
      : {}),
    ...(filters?.from || filters?.to
      ? {
          orderDate: {
            ...(filters?.from ? { gte: filters.from } : {}),
            ...(filters?.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters?.search
      ? {
          OR: [
            { poNumber: { contains: filters.search, mode: 'insensitive' as const } },
            {
              supplier: {
                name: { contains: filters.search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {}),
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.purchaseOrder.count({ where }),
  ])

  return {
    orders,
    total,
    totalPages: Math.ceil(total / limit),
    page,
    limit,
  }
}

export async function getPurchaseOrderById(id: string) {
  const user = await requireAuth()

  if (!user.outletId) {
    return null
  }

  return getScopedPurchaseOrderRecord(id, user.outletId)
}

export async function deleteDraftPo(id: string, tx?: PrismaTx) {
  const user = await requireAuth()

  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  if (!canApprovePurchaseOrders(user.role)) {
    return fail('Only managers and admins can delete purchase orders')
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, outletId: user.outletId },
    select: { id: true, poNumber: true, status: true, supplierId: true },
  })

  if (!po) {
    return fail('Purchase order not found')
  }

  if (
    po.status === PurchaseOrderStatus.RECEIVED ||
    po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
  ) {
    return fail(
      'Cannot delete a received purchase order — process a Purchase Return instead.'
    )
  }

  // Fetch line IDs and related invoice data before deletion
  const poWithRelations = await prisma.purchaseOrder.findFirst({
    where: { id: po.id },
    select: {
      lines: {
        select: {
          id: true,
          serialUnits: {
            select: {
              serialUnitId: true,
              serialUnit: {
                select: {
                  serialNumber: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      purchaseInvoices: {
        select: { id: true, total: true, amountPaid: true },
      },
    },
  })

  const lineIds = poWithRelations?.lines.map(l => l.id) ?? []
  const invoices = poWithRelations?.purchaseInvoices ?? []
  const invoiceIds = invoices.map(i => i.id)
  const serialLinks =
    poWithRelations?.lines.flatMap(line => line.serialUnits) ?? []
  const serialUnitIds = Array.from(
    new Set(serialLinks.map(link => link.serialUnitId))
  )

  const nonStockSerials = serialLinks
    .filter(link => link.serialUnit.status !== 'IN_STOCK')
    .map(link => link.serialUnit.serialNumber)

  if (nonStockSerials.length > 0) {
    return fail(
      `Cannot delete purchase order because serial(s) are no longer in stock: ${nonStockSerials.join(', ')}`
    )
  }

  // Calculate financial impact for supplier balance reversal
  const totalInvoiceValue = invoices.reduce((s, i) => s + Number(i.total), 0)
  const totalPaymentsMade = invoices.reduce(
    (s, i) => s + Number(i.amountPaid),
    0
  )
  const netBalanceAdjustment = totalInvoiceValue - totalPaymentsMade

  const executeDelete = async (activeTx: PrismaTx) => {
    // 0. Lock Supplier row if present to serialize balance updates
    if (po.supplierId) {
      await activeTx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${po.supplierId} FOR UPDATE`
    }

    // 1. Delete serial links (deepest child of lines)
    if (lineIds.length > 0) {
      await activeTx.purchaseOrderLineSerial.deleteMany({
        where: { poLineId: { in: lineIds } },
      })
    }

    // 2. Delete serial units created for this PO so they can be reused later
    if (serialUnitIds.length > 0) {
      await activeTx.serialUnit.deleteMany({
        where: { id: { in: serialUnitIds } },
      })
    }

    // 3. Delete PO lines
    await activeTx.purchaseOrderLine.deleteMany({ where: { poId: po.id } })

    // 4. Delete stock ledger entries for this PO
    await activeTx.stockLedger.deleteMany({
      where: { referenceId: po.id, referenceType: 'PURCHASE' },
    })

    // 4b. Delete stock layer entries for this PO
    await activeTx.stockLayer.deleteMany({
      where: { purchaseOrderId: po.id },
    })

    if (invoiceIds.length > 0) {
      // 5. Reverse linked purchase payments before deletion (restore bank balances & drawer)
      const payments = await activeTx.purchasePayment.findMany({
        where: { invoiceId: { in: invoiceIds } },
      })

      for (const payment of payments) {
        if (payment.bankAccountId) {
          await activeTx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { increment: payment.amount } },
          })
          await activeTx.bankTransaction.deleteMany({
            where: {
              bankAccountId: payment.bankAccountId,
              referenceId: { in: invoiceIds },
            },
          })
        } else if (payment.method === PaymentMethod.CASH) {
          if (!user.outletId) {
            throw new Error('User is not assigned to an outlet to reverse cash payment')
          }
          const openDrawer = await requireOpenDrawerForPurchase(activeTx, user.outletId)
          await activeTx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: 'CASH_IN',
              amount: Number(payment.amount),
              description: `Reversal for Deleted Purchase Invoice Payment`,
            },
          })
        }
      }

      // 6. Delete invoice edit logs
      await activeTx.purchaseInvoiceEditLog.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      })

      // 7. Delete payments
      await activeTx.purchasePayment.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      })

      // 8. Delete supplier ledger entries referencing these invoices
      await activeTx.supplierLedger.deleteMany({
        where: { referenceId: { in: invoiceIds } },
      })

      // 8b. Delete double-entry General Ledger entries referencing these purchase invoices
      await activeTx.accountLedgerEntry.deleteMany({
        where: {
          referenceId: { in: invoiceIds },
          referenceType: 'PurchaseInvoice',
        },
      })

      // 9. Delete invoices
      await activeTx.purchaseInvoice.deleteMany({
        where: { id: { in: invoiceIds } },
      })
    } else {
      const poPayments =
        (await activeTx.purchasePayment.findMany({
          where: { purchaseOrderId: po.id, cancelledAt: null },
        })) ?? []

      let advanceReversed = 0
      for (const payment of poPayments) {
        advanceReversed = round2(advanceReversed + Number(payment.amount))
        if (payment.bankAccountId) {
          await activeTx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { increment: payment.amount } },
          })
          await activeTx.bankTransaction.deleteMany({
            where: {
              bankAccountId: payment.bankAccountId,
              referenceId: po.id,
            },
          })
        } else if (payment.method === PaymentMethod.CASH) {
          if (!user.outletId) {
            throw new Error('User is not assigned to an outlet to reverse cash payment')
          }
          const openDrawer = await requireOpenDrawerForPurchase(activeTx, user.outletId)
          await activeTx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: 'CASH_IN',
              amount: Number(payment.amount),
              description: `Reversal for Deleted Purchase Order Advance Payment`,
            },
          })
        }
      }

      if (poPayments.length > 0) {
        await activeTx.purchasePayment.deleteMany({
          where: { purchaseOrderId: po.id },
        })
        await activeTx.supplierLedger.deleteMany({
          where: { purchaseOrderId: po.id },
        })
        await activeTx.accountLedgerEntry.deleteMany({
          where: {
            referenceId: po.id,
            referenceType: 'PurchaseOrder',
          },
        })
        if (advanceReversed !== 0 && po.supplierId) {
          await activeTx.supplier.update({
            where: { id: po.supplierId },
            data: {
              outstandingBalance: {
                increment: advanceReversed,
              },
            },
          })
        }
      }
    }

    // 10. Reverse supplier outstanding balance for deleted invoices
    if (netBalanceAdjustment !== 0 && po.supplierId) {
      await activeTx.supplier.update({
        where: { id: po.supplierId },
        data: {
          outstandingBalance: {
            decrement: netBalanceAdjustment,
          },
        },
      })
    }

    // 10. Finally delete the PO itself
    await activeTx.purchaseOrder.delete({ where: { id: po.id } })
  }

  try {
    if (tx) {
      await executeDelete(tx)
    } else {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
      await prisma.$transaction(async innerTx => await executeDelete(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }
  } catch (err: any) {
    return fail(err.message || 'Failed to delete purchase order')
  }

  await logAuditDirect(
    user.id,
    'PURCHASE_ORDER_DELETED',
    'PurchaseOrder',
    po.id,
    {
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      invoicesDeleted: invoiceIds.length,
      totalInvoiceValue,
      totalPaymentsMade,
      netBalanceAdjustment,
    }
  )

  revalidatePath('/purchases')
  return ok({ id: po.id, poNumber: po.poNumber })
}

export async function deletePurchaseOrder(id: string, tx?: PrismaTx) {
  return deleteDraftPo(id, tx)
}

// ─────────────────────────────────────────────
// PURCHASE INVOICES / PAYABLES (TICKET-303)
// ─────────────────────────────────────────────


const createInvoiceSchema = z.object({
  supplierId: z.string(),
  poId: z.string().optional(),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0).default(0),
  dueDate: z.string().datetime({ offset: true }).optional(),
  notes: z.string().optional(),
})

export async function createPurchaseInvoice(
  data: z.infer<typeof createInvoiceSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.ACCOUNTANT,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = createInvoiceSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const total = round2(parsed.data.subtotal + parsed.data.tax)

  const executeInvoiceCreate = async (activeTx: PrismaTx) => {
    await activeTx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${parsed.data.supplierId} FOR UPDATE`

    const supplierForSnap = await activeTx.supplier.findUnique({
      where: { id: parsed.data.supplierId },
      select: {
        outstandingBalance: true,
        linkedCustomer: { select: { id: true, outstandingBalance: true } },
      },
    })

    if (supplierForSnap?.linkedCustomer) {
      await activeTx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${supplierForSnap.linkedCustomer.id} FOR UPDATE`
    }

    const supAp = Number(supplierForSnap?.outstandingBalance || 0)
    const custAr = supplierForSnap?.linkedCustomer ? Number(supplierForSnap.linkedCustomer.outstandingBalance || 0) : 0

    let prevDueVal: number
    let newBalVal: number

    if (supplierForSnap?.linkedCustomer) {
      prevDueVal = custAr - supAp
      newBalVal = prevDueVal - total
    } else {
      prevDueVal = supAp
      newBalVal = prevDueVal + total
    }

    const inv = await activeTx.purchaseInvoice.create({
      data: {
        invoiceNumber: await nextDocumentNumber(activeTx, 'purchase_invoice'),
        supplierId: parsed.data.supplierId,
        poId: parsed.data.poId,
        subtotal: parsed.data.subtotal,
        tax: parsed.data.tax,
        total,
        previousDue: prevDueVal,
        newBalance: newBalVal,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
        notes: parsed.data.notes,
        status: InvoiceStatus.DRAFT,
      },
    })

    await activeTx.supplierLedger.create({
      data: {
        supplierId: parsed.data.supplierId,
        type: TransactionType.DEBIT,
        amount: total,
        description: `Invoice ${inv.invoiceNumber}`,
        referenceId: inv.id,
        transactionType: 'INVOICE_CREATED',
        createdById: user.id,
      },
    })

    await activeTx.supplier.update({
      where: { id: parsed.data.supplierId },
      data: { outstandingBalance: { increment: total } },
    })

    // Double-Entry General Ledger Postings:
    // Dr Inventory (1400): Total purchase value
    // Cr Accounts Payable (2100): Total purchase value
    const coaAccounts = await activeTx.chartOfAccount.findMany({
      where: { code: { in: ['1400', '2100'] } },
      select: { id: true, code: true },
    })
    const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
    const invAccountId = coaMap.get('1400')
    const apAccountId = coaMap.get('2100')

    if (invAccountId && apAccountId && total > 0) {
      const gl = [
        {
          accountId: invAccountId,
          type: TransactionType.DEBIT,
          amount: total,
          description: `Purchase Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'PurchaseInvoice',
          createdAt: new Date(),
        },
        {
          accountId: apAccountId,
          type: TransactionType.CREDIT,
          amount: total,
          description: `Purchase Invoice ${inv.invoiceNumber}`,
          referenceId: inv.id,
          referenceType: 'PurchaseInvoice',
          createdAt: new Date(),
        },
      ]
      assertBalancedJournal(gl)
      await activeTx.accountLedgerEntry.createMany({ data: gl })
    }

    return inv
  }

  let invoice: any
  if (tx) {
    invoice = await executeInvoiceCreate(tx)
  } else {
    invoice = await prisma.$transaction(async innerTx => await executeInvoiceCreate(innerTx), {
      maxWait: 15000,
      timeout: 60000,
    })
  }

  await logAudit('PURCHASE_INVOICE_CREATED', 'PurchaseInvoice', invoice.id, {
    invoiceNumber: invoice.invoiceNumber,
    supplierId: parsed.data.supplierId,
    amount: total,
    poId: parsed.data.poId || null,
  })

  revalidatePath('/purchases/invoices')
  return ok({ id: invoice.id, invoiceNumber: invoice.invoiceNumber })
}

const recordPaymentSchema = z.object({
  invoiceId: z.string(),
  amount: z.coerce.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  chequeDate: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

/**
 * ============================================================================
 * PURCHASE SUBSYSTEM — GLOBAL PESSIMISTIC LOCK ORDER
 * ============================================================================
 * Canonical Lock Hierarchy:
 *   1. PurchaseOrder   (`SELECT ... FROM "PurchaseOrder" WHERE id = ... FOR UPDATE`)
 *   2. Supplier        (`SELECT ... FROM "Supplier" WHERE id = ... FOR UPDATE`)
 *   3. BankAccount     (`SELECT ... FROM "BankAccount" WHERE id = ... FOR UPDATE`)
 *   4. PurchaseInvoice / CashDrawer (serialized by prior PurchaseOrder + Supplier locks)
 *
 * Per-Action Lock Order Summary:
 * - receivePurchaseOrderItemsAction:  PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - payAgainstPurchaseOrderAction:    PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - cancelPurchasePaymentAction:      PurchasePayment -> PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - recordPurchasePayment:            PurchaseOrder -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - recordSupplierPaymentAction:      PurchaseOrder -> Supplier (+ Customer) -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - createPurchaseReturn:             PurchaseOrder -> PurchaseOrderLine -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - createPurchaseOrderAction:        Supplier -> BankAccount -> CashDrawer (creates new PO, no existing invoice)
 * - directPurchaseCheckoutAction:     Supplier -> BankAccount -> CashDrawer (creates new PO and new PurchaseInvoice)
 * - deleteDraftPo / deletePurchaseOrder: Supplier -> CashDrawer
 *
 * Why Drawer-before-Invoice in receive / payAgainst / cancel cannot deadlock against
 * Invoice-before-Drawer in recordPurchasePayment / recordSupplierPayment / createPurchaseReturn:
 * Every transaction that touches a PurchaseOrder or Supplier acquires `FOR UPDATE` on `PurchaseOrder`
 * (when present) and `Supplier` at the very start of the transaction BEFORE touching `CashDrawer` or
 * `PurchaseInvoice`. Consequently, any two transactions contending on the same PO or Supplier serialize
 * at step 1/2 (`PurchaseOrder` / `Supplier`) before either `CashDrawer` or `PurchaseInvoice` is reached,
 * and transactions across different suppliers never contend on the same `PurchaseInvoice`.
 * ============================================================================
 */
export async function recordPurchasePayment(
  data: z.infer<typeof recordPaymentSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.ACCOUNTANT,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = recordPaymentSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  if (parsed.data.method !== PaymentMethod.CASH && !parsed.data.bankAccountId) {
    return fail('Bank account is required for electronic payments')
  }

  const client = tx ?? prisma

  const cleanIdempotencyKey = parsed.data.idempotencyKey?.trim() || undefined
  if (cleanIdempotencyKey) {
    const existing = await client.purchasePayment.findUnique({
      where: { idempotencyKey: cleanIdempotencyKey },
    })
    if (existing) {
      return ok({ success: true, payment: existing })
    }
  }

  const invoice = await client.purchaseInvoice.findUnique({
    where: { id: parsed.data.invoiceId },
    include: { po: { select: { outletId: true } } },
  })
  if (!invoice) return fail('Invoice not found')

  const outletId = user.outletId || invoice.po?.outletId
  if (!outletId) return fail('No outlet identified for this transaction')

  try {
    const executePayment = async (activeTx: PrismaTx) => {
      // Strict lock hierarchy: PurchaseOrder -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
      if (invoice.poId) {
        await activeTx.$executeRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${invoice.poId} FOR UPDATE`
      }
      await activeTx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${invoice.supplierId} FOR UPDATE`

      if (parsed.data.bankAccountId) {
        await activeTx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${parsed.data.bankAccountId} FOR UPDATE`
      }

      await activeTx.$executeRaw`SELECT id FROM "PurchaseInvoice" WHERE id = ${parsed.data.invoiceId} FOR UPDATE`

      // 2. Remaining balance check under exclusive locks
      const txInvoice = await activeTx.purchaseInvoice.findUnique({
        where: { id: parsed.data.invoiceId },
        select: { total: true, amountPaid: true },
      })
      if (!txInvoice) throw new Error('Invoice not found')

      const remainingBalance = round2(Number(txInvoice.total) - Number(txInvoice.amountPaid))
      if (parsed.data.amount > remainingBalance) {
        throw new Error('Payment exceeds invoice total')
      }

      let feeAmount = 0

      // 2. Balance Checks & Deductions
      if (parsed.data.method === PaymentMethod.CASH) {
        const openDrawer = await requireOpenDrawerForPurchase(activeTx, outletId)

        const stats = await activeTx.drawerTransaction.aggregate({
          where: { drawerId: openDrawer.id },
          _sum: { amount: true },
        })

        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < parsed.data.amount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${parsed.data.amount.toLocaleString()}`
          )
        }

        await activeTx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.SUPPLIER_PAYMENT,
            amount: -parsed.data.amount,
            description: `Purchase: ${invoice.invoiceNumber}`,
            referenceId: invoice.id,
            referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
          },
        })
      } else if (parsed.data.bankAccountId) {
        const bankAccount = await activeTx.bankAccount.findUnique({
          where: { id: parsed.data.bankAccountId },
        })
        if (!bankAccount) {
          throw new Error('Selected bank account not found.')
        }

        // Calculate MFS withdrawal fee if applicable
        const chargePct =
          typeof bankAccount.cashoutChargePct?.toNumber === 'function'
            ? bankAccount.cashoutChargePct.toNumber()
            : Number(bankAccount.cashoutChargePct || 0)

        if (bankAccount.isMfs && chargePct > 0) {
          feeAmount = round2((parsed.data.amount * chargePct) / 100)
        }

        const totalDeduction = round2(parsed.data.amount + feeAmount)
        if (Number(bankAccount.currentBalance) < totalDeduction) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        await activeTx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: 'WITHDRAWAL',
            amount: parsed.data.amount,
            description: `Purchase: ${invoice.invoiceNumber}`,
            referenceId: invoice.id,
            referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
          },
        })
        await activeTx.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { decrement: totalDeduction } },
        })
      }

      let finalRef = parsed.data.reference
      if (parsed.data.method === PaymentMethod.CHEQUE && parsed.data.chequeDate) {
        if (!finalRef || !finalRef.includes('[Cheque Matures:')) {
          finalRef = finalRef
            ? `${finalRef} | [Cheque Matures: ${parsed.data.chequeDate}]`
            : `[Cheque Matures: ${parsed.data.chequeDate}]`
        }
      }

      // 2. Create Payment Record and Allocation
      const payment = await activeTx.purchasePayment.create({
        data: {
          invoiceId: parsed.data.invoiceId,
          outletId,
          amount: parsed.data.amount,
          method: parsed.data.method,
          bankAccountId: parsed.data.bankAccountId || null,
          reference: finalRef || null,
          feeAmount,
          idempotencyKey: cleanIdempotencyKey,
        },
      })

      await activeTx.purchasePaymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: parsed.data.invoiceId,
          amount: parsed.data.amount,
        },
      })

      // 3. Update Invoice via single authoritative helper
      await applyInvoicePayment(activeTx, {
        invoiceId: parsed.data.invoiceId,
        deltaAmountPaid: parsed.data.amount,
      })

      // 4. Supplier Ledger Entry
      await activeTx.supplierLedger.create({
        data: {
          supplierId: invoice.supplierId,
          type: TransactionType.CREDIT,
          amount: parsed.data.amount,
          description: `Payment for invoice ${invoice.invoiceNumber}${parsed.data.method === PaymentMethod.CHEQUE && parsed.data.chequeDate ? ` | [Cheque Matures: ${parsed.data.chequeDate}]` : ''}`,
          referenceId: invoice.id,
          invoiceId: invoice.id,
          outletId,
          purchaseOrderId: invoice.poId || null,
          method: parsed.data.method,
          bankAccountId: parsed.data.bankAccountId || null,
          feeAmount,
          reference: finalRef || null,
          transactionType: 'INVOICE_PAYMENT',
          createdById: user.id,
        },
      })

      // 5. Update Supplier Outstanding Balance
      await activeTx.supplier.update({
        where: { id: invoice.supplierId },
        data: { outstandingBalance: { decrement: parsed.data.amount } },
      })

      // 6. Double-Entry General Ledger Postings:
      // Dr Accounts Payable (2100): Payment reduces what we owe
      // Cr Cash in Hand (1100) or Bank Accounts (1200): Outflow of money
      const paymentAccountCode =
        parsed.data.method === PaymentMethod.CASH ? '1100' : '1200'

      const coaAccounts = await activeTx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '2100', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const apAccountId = coaMap.get('2100')
      const paymentAssetAccountId = coaMap.get(paymentAccountCode)
      const feeAccountId = coaMap.get('5290') || coaMap.get('5291')

      if (!apAccountId || !paymentAssetAccountId) {
        throw new Error(
          `Required Chart of Accounts (2100 or ${paymentAccountCode}) not found for purchase payment.`
        )
      }

      if (feeAmount > 0 && !feeAccountId) {
        throw new Error(
          'Required Chart of Accounts fee account (5290 MFS Charges or 5291 Bank Charges) not found for fee posting.'
        )
      }

      const glEntries: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = [
        {
          accountId: apAccountId,
          type: TransactionType.DEBIT,
          amount: parsed.data.amount,
          description: `Payment for Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'PurchasePayment',
          createdAt: new Date(),
        },
        {
          accountId: paymentAssetAccountId,
          type: TransactionType.CREDIT,
          amount: parsed.data.amount,
          description: `Payment for Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'PurchasePayment',
          createdAt: new Date(),
        },
      ]

      if (feeAmount > 0 && feeAccountId) {
        glEntries.push({
          accountId: feeAccountId,
          type: TransactionType.DEBIT,
          amount: feeAmount,
          description: `Payment Fee for Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'PurchasePayment',
          createdAt: new Date(),
        })
        glEntries.push({
          accountId: paymentAssetAccountId,
          type: TransactionType.CREDIT,
          amount: feeAmount,
          description: `Payment Fee for Purchase Invoice ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'PurchasePayment',
          createdAt: new Date(),
        })
      }

      assertBalancedJournal(glEntries)
      await activeTx.accountLedgerEntry.createMany({
        data: glEntries,
      })

      return { payment }
    }

    let result: any
    if (tx) {
      result = await executePayment(tx)
    } else {
      if (parsed.data.method === PaymentMethod.CASH) {
        await requireOpenDrawerForPurchase.rolloverBeforeTx(outletId)
      }
      result = await prisma.$transaction(async innerTx => await executePayment(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    await logAuditDirect(
      user.id,
      'PURCHASE_INVOICE_PAYMENT',
      'PurchaseInvoice',
      parsed.data.invoiceId,
      {
        amount: parsed.data.amount,
        method: parsed.data.method,
        bankAccountId: parsed.data.bankAccountId || null,
        reference: parsed.data.reference || null,
        invoiceNumber: invoice.invoiceNumber,
        supplierId: invoice.supplierId,
      }
    )

    revalidatePath('/purchases')
    revalidatePath('/purchases/invoices')
    revalidatePath(`/purchases/invoices/${parsed.data.invoiceId}`)
    if (invoice.poId) {
      revalidatePath(`/purchases/${invoice.poId}`)
    }
    return ok({ success: true, payment: result.payment })
  } catch (error: any) {
    if (
      cleanIdempotencyKey &&
      (error?.code === 'P2002' ||
        error?.message?.includes('Unique constraint failed') ||
        error?.message?.includes('idempotencyKey'))
    ) {
      const existing = await client.purchasePayment.findUnique({
        where: { idempotencyKey: cleanIdempotencyKey },
      })
      if (existing) {
        return ok({ success: true, payment: existing })
      }
    }
    return fail(error.message || 'An error occurred while recording payment')
  }
}

export async function getPurchaseInvoices(filters?: {
  search?: string
  status?: string
  from?: string
  to?: string
}) {
  const user = await requireAuth()

  let matchedSupplierIds: string[] | undefined = undefined
  if (filters?.search) {
    const search = filters.search.trim()
    const suppliers = await prisma.supplier.findMany({
      where: {
        name: { contains: search, mode: 'insensitive' },
      },
      select: { id: true },
    })
    matchedSupplierIds = suppliers.map(s => s.id)
  }

  const whereClause: any = {
    AND: [],
  }

  const isSuperAdmin =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'

  if (user.outletId && !isSuperAdmin) {
    whereClause.AND.push({
      OR: [{ po: { outletId: user.outletId } }, { poId: null }],
    })
  }

  if (filters?.search) {
    const search = filters.search.trim()
    const searchConditions: any[] = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { po: { poNumber: { contains: search, mode: 'insensitive' } } },
    ]
    if (matchedSupplierIds && matchedSupplierIds.length > 0) {
      searchConditions.push({ supplierId: { in: matchedSupplierIds } })
    }
    whereClause.AND.push({
      OR: searchConditions,
    })
  }

  if (filters?.status && filters.status !== 'ALL') {
    whereClause.AND.push({
      status: filters.status,
    })
  }

  if (filters?.from) {
    const fromDate = new Date(filters.from)
    fromDate.setHours(0, 0, 0, 0)
    // Also include buffer for UTC timezone differences
    const utcStart = new Date(fromDate.getTime() - 6 * 3600 * 1000)
    whereClause.AND.push({
      createdAt: { gte: utcStart },
    })
  }

  if (filters?.to) {
    const toDate = new Date(filters.to)
    toDate.setHours(23, 59, 59, 999)
    const utcEnd = new Date(toDate.getTime() + 6 * 3600 * 1000)
    const existing = whereClause.AND.find((c: any) => c.createdAt)
    if (existing) {
      existing.createdAt.lte = utcEnd
    } else {
      whereClause.AND.push({
        createdAt: { lte: utcEnd },
      })
    }
  }

  const invoices = await prisma.purchaseInvoice.findMany({
    where: whereClause.AND.length > 0 ? whereClause : undefined,
    include: {
      po: {
        select: {
          id: true,
          poNumber: true,
          supplier: { select: { id: true, name: true, phone: true, outstandingBalance: true } },
          lines: {
            include: {
              product: {
                select: { id: true, name: true, sku: true, productCode: true, requiresSerial: true },
              },
            },
          },
        },
      },
      supplier: {
        select: { id: true, name: true, phone: true, outstandingBalance: true },
      },
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const supplierIdsToFetch = Array.from(
    new Set(invoices.map(inv => inv.supplierId))
  )
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: supplierIdsToFetch } },
    select: { id: true, name: true },
  })
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]))

  return invoices.map(inv => {
    const supplierName =
      inv.po?.supplier?.name ??
      supplierMap.get(inv.supplierId) ??
      'Unknown Supplier'
    return {
      ...inv,
      supplierName,
    }
  })
}

export type APAging = 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'NO_DUE'

export interface APInvoiceRow {
  id: string
  invoiceNumber: string
  supplierId: string
  supplierName: string
  supplierPhone: string | null
  poNumber: string | null
  createdAt: Date
  dueDate: Date | null
  total: number
  amountPaid: number
  outstanding: number
  aging: APAging
}

export interface APSupplierRow {
  id: string
  name: string
  phone: string | null
  outstanding: number
  invoiceCount: number
}

export interface AccountsPayableData {
  summary: {
    totalOutstanding: number
    overdueAmount: number
    dueThisWeek: number
    suppliersWithBalance: number
    invoiceCount: number
  }
  invoices: APInvoiceRow[]
  suppliers: APSupplierRow[]
}

// Aggregated Accounts Payable overview: outstanding supplier invoices,
// aging buckets and per-supplier balances, scoped to the user's outlet.
export async function getAccountsPayable(): Promise<AccountsPayableData> {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const outletClause = user.outletId
    ? { OR: [{ po: { outletId: user.outletId } }, { poId: null }] }
    : {}

  const now = Date.now()
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000

  const rawInvoices = await prisma.purchaseInvoice.findMany({
    where: {
      AND: [
        outletClause,
        { status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.VOID] } },
      ],
    },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      po: { select: { poNumber: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  })

  const invoices: APInvoiceRow[] = rawInvoices
    .map(inv => {
      const total = Number(inv.total)
      const paid = Number(inv.amountPaid)
      const outstanding = Math.max(total - paid, 0)
      const due = inv.dueDate ? new Date(inv.dueDate).getTime() : null

      let aging: APAging = 'NO_DUE'
      if (due !== null && outstanding > 0) {
        if (due < now) aging = 'OVERDUE'
        else if (due <= weekAhead) aging = 'DUE_SOON'
        else aging = 'UPCOMING'
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId,
        supplierName: inv.supplier?.name ?? 'Unknown Supplier',
        supplierPhone: inv.supplier?.phone ?? null,
        poNumber: inv.po?.poNumber ?? null,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
        total,
        amountPaid: paid,
        outstanding,
        aging,
      }
    })
    .filter(inv => inv.outstanding > 0)

  const totalOutstanding = invoices.reduce((sum, i) => sum + i.outstanding, 0)
  const overdueAmount = invoices
    .filter(i => i.aging === 'OVERDUE')
    .reduce((sum, i) => sum + i.outstanding, 0)
  const dueThisWeek = invoices
    .filter(i => i.aging === 'DUE_SOON')
    .reduce((sum, i) => sum + i.outstanding, 0)

  const supplierMap = new Map<string, APSupplierRow>()
  for (const inv of invoices) {
    const current =
      supplierMap.get(inv.supplierId) ??
      ({
        id: inv.supplierId,
        name: inv.supplierName,
        phone: inv.supplierPhone,
        outstanding: 0,
        invoiceCount: 0,
      } satisfies APSupplierRow)
    current.outstanding += inv.outstanding
    current.invoiceCount += 1
    supplierMap.set(inv.supplierId, current)
  }
  const suppliers = Array.from(supplierMap.values()).sort(
    (a, b) => b.outstanding - a.outstanding,
  )

  return {
    summary: {
      totalOutstanding,
      overdueAmount,
      dueThisWeek,
      suppliersWithBalance: suppliers.length,
      invoiceCount: invoices.length,
    },
    invoices,
    suppliers,
  }
}

export async function getPurchaseInvoiceById(id: string) {
  const user = await requireAuth()
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      // Fetch supplier directly so SALE invoices (no PO) still have supplier info
      supplier: {
        select: {
          name: true,
          email: true,
          phone: true,
          address: true,
          linkedCustomer: { select: { id: true } },
        },
      },
      po: {
        select: {
          poNumber: true,
          orderDate: true,
          notes: true,
          outletId: true,
          outlet: {
            select: {
              name: true,
              slogan: true,
              address: true,
              phone: true,
              email: true,
            },
          },
          supplier: {
            select: {
              name: true,
              email: true,
              phone: true,
              address: true,
            },
          },
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
                  ram: { select: { name: true } },
                  storage: { select: { name: true } },
                  display: true,
                  requiresSerial: true,
                },
              },
              serialUnits: { include: { serialUnit: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
      },
      payments: { orderBy: { paidAt: 'asc' } },
      // Fetch ledger entries linked to this invoice for SALE invoice item description
      ledgerEntries: {
        select: {
          id: true,
          description: true,
          amount: true,
          transactionType: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!invoice) return null
  if (invoice.po?.outletId) {
    validateOutletAccess(user, invoice.po.outletId)
  }

  // For PURCHASE invoices, recompute previousDue from earlier outstanding
  // purchase invoices — the creation-time snapshot reads the supplier's running
  // balance which is polluted by PO deletions, B2B netting and returns, and can
  // be negative/zero even when earlier invoices are unpaid.
  // For SALE invoices (B2B: the supplier buys from us), keep the stored snapshot:
  // it is captured from the linked customer's running balance at creation.
  if (invoice.invoiceType === 'SALE') {
    return {
      ...invoice,
      currentBill: Number(invoice.total),
      totalDue: Math.max(
        Number(invoice.previousDue ?? 0) +
          Number(invoice.total) -
          Number(invoice.amountPaid),
        0
      ),
      po: invoice.po
        ? {
            ...invoice.po,
            lines: invoice.po.lines.map(line => ({
              ...line,
              product: {
                ...line.product,
                processor: line.product.processor?.name ?? null,
                ram: line.product.ram?.name ?? null,
                storage: line.product.storage?.name ?? null,
              },
            })),
          }
        : null,
    }
  }

  // Compute previousDue from the supplier's live outstandingBalance, removing
  // this invoice's own net contribution (total − amountPaid). This keeps the
  // purchase invoice consistent with the supplier due report (AP/AR dashboard),
  // which shows Supplier.outstandingBalance as the authoritative figure.
  // The invoice-row amountPaid is unreliable for this because supplier-level
  // payments (PAYMENT_OUT without invoiceId) never update it — so we cannot
  // simply sum earlier invoice totals.
  const supplier = await prisma.supplier.findUnique({
    where: { id: invoice.supplierId },
    select: { outstandingBalance: true },
  })

  const currentBill = Number(invoice.total)
  const paidAmount = Number(invoice.amountPaid)
  const liveBalance = Number(supplier?.outstandingBalance ?? 0)
  const previousDue = Math.max(
    liveBalance - currentBill + paidAmount,
    0
  )
  const totalDue = Math.max(previousDue + currentBill - paidAmount, 0)
  // Derive newBalance from the same recomputed values so the printed summary
  // (Previous Due + Current Bill − Paid) is internally consistent. The stored
  // creation-time snapshot can be wrong (negative/zero) because it reads the
  // supplier's running outstandingBalance, which is polluted by PO deletions,
  // B2B netting and returns.
  const newBalance = totalDue

  return {
    ...invoice,
    previousDue,
    currentBill,
    newBalance,
    totalDue,
    po: invoice.po
      ? {
          ...invoice.po,
          lines: invoice.po.lines.map(line => ({
            ...line,
            product: {
              ...line.product,
              processor: line.product.processor?.name ?? null,
              ram: line.product.ram?.name ?? null,
              storage: line.product.storage?.name ?? null,
            },
          })),
        }
      : null,
  }
}

export async function getPurchaseReport(
  outletId?: string,
  from?: string,
  to?: string
) {
  const session = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const targetOutletId = outletId || (session as any)?.outletId

  let dateFilter: { gte?: Date; lte?: Date } | undefined = undefined
  if (from || to) {
    const { start, end, isInverted } = getLocalDateRangeBoundaries(from, to, 6)
    if (isInverted) return fail('From date cannot be after To date')
    dateFilter = { gte: start, lte: end }
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      ...(targetOutletId ? { outletId: targetOutletId } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: {
        select: {
          quantity: true,
          unitCost: true,
        },
      },
    },
  })

  const bySupplier = new Map<
    string,
    {
      supplierId: string
      supplierName: string
      poCount: number
      orderedValue: number
      receivedValue: number
    }
  >()

  for (const po of purchaseOrders) {
    const key = po.supplier.id
    const current = bySupplier.get(key) ?? {
      supplierId: po.supplier.id,
      supplierName: po.supplier.name,
      poCount: 0,
      orderedValue: 0,
      receivedValue: 0,
    }

    const lineValue = po.lines.reduce(
      (sum, line) => sum + line.quantity * Number(line.unitCost),
      0
    )

    current.poCount += 1
    current.orderedValue += lineValue
    // Only count as received if PO is actually received
    if (
      po.status === PurchaseOrderStatus.RECEIVED ||
      po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      current.receivedValue += lineValue
    }
    bySupplier.set(key, current)
  }

  const rows = Array.from(bySupplier.values()).sort(
    (a, b) => b.receivedValue - a.receivedValue
  )

  return ok({
    rows,
    summary: {
      supplierCount: rows.length,
      totalOrderedValue: rows.reduce((s, r) => s + r.orderedValue, 0),
      totalReceivedValue: rows.reduce((s, r) => s + r.receivedValue, 0),
      totalPoCount: rows.reduce((s, r) => s + r.poCount, 0),
    },
  })
}

export async function updatePurchaseInvoiceNotes(
  invoiceId: string,
  notes: string,
  reason: string,
  tx?: PrismaTx
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  if (!reason.trim() || reason.trim().length < 5) {
    return fail(
      'A reason of at least 5 characters is required to edit an invoice'
    )
  }

  const client = tx ?? prisma

  const invoice = await client.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: { po: { select: { outletId: true } } },
  })
  if (!invoice) return fail('Invoice not found')
  if (invoice.po?.outletId) {
    validateOutletAccess(user, invoice.po.outletId)
  }

  const oldNotes = invoice.notes ?? ''
  const newNotes = notes.trim()

  const executeUpdate = async (activeTx: PrismaTx) => {
    await activeTx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: { notes: newNotes || null },
    })
    await activeTx.purchaseInvoiceEditLog.create({
      data: {
        invoiceId,
        editedById: user.id,
        reason: reason.trim(),
        fieldName: 'notes',
        oldValue: oldNotes,
        newValue: newNotes,
      },
    })
  }

  if (tx) {
    await executeUpdate(tx)
  } else {
    await prisma.$transaction(async innerTx => await executeUpdate(innerTx))
  }

  await logAudit('PURCHASE_INVOICE_EDIT_NOTES', 'PurchaseInvoice', invoiceId, {
    reason,
  })
  revalidatePath(`/purchases/invoices/${invoiceId}`)
  return ok({ invoiceId })
}

export async function getPurchaseInvoiceEditLogs(invoiceId: string) {
  const user = await requireAuth()
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: { po: { select: { outletId: true } } },
  })
  if (!invoice) return fail('Invoice not found')
  if (invoice.po?.outletId) {
    validateOutletAccess(user, invoice.po.outletId)
  }
  const logs = await prisma.purchaseInvoiceEditLog.findMany({
    where: { invoiceId },
    include: { editedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return ok(logs)
}

const updatePurchaseItemsSchema = z.object({
  poId: z.string(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.coerce.number().int().min(1),
        unitCost: z.coerce.number().min(0),
        discount: z.coerce.number().min(0).default(0),
        serialNumbers: z.array(z.string()).default([]),
        sellingPrice: z.coerce.number().optional(),
      })
    )
    .min(1),
  reason: z.string().min(5),
  notes: z.string().optional(),
  amountPaid: z.coerce.number().min(0).optional(),
})

export async function updatePurchaseItems(
  data: z.infer<typeof updatePurchaseItemsSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  const parsed = updatePurchaseItemsSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { poId, lines, reason, notes, amountPaid } = parsed.data

  const resultPoId = poId
  let resultInvoiceId = ''
  let supplierIdForRevalidation: string | null = null

  try {
    const executeEdit = async (tx: PrismaTx) => {
      // 0. Row-level lock on PurchaseOrder to serialize edits and prevent concurrent race conditions
      await tx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`

      // 1. Fetch oldPo inside transaction for boundary lock & concurrency protection
      const oldPo = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          lines: {
            include: {
              product: { select: { id: true, name: true, requiresSerial: true } },
              serialUnits: {
                include: {
                  serialUnit: {
                    select: {
                      id: true,
                      serialNumber: true,
                      status: true,
                      sellingPrice: true,
                      _count: {
                        select: {
                          saleLineSerials: true,
                          serviceJobSerials: true,
                          purchaseReturnLineSerials: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          purchaseInvoices: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
          stockLayers: true,
        },
      })

      if (!oldPo) throw new Error('Purchase Order not found')
      if (user.role !== UserRole.SUPER_ADMIN && oldPo.outletId !== user.outletId)
        throw new Error('Unauthorized access to this outlet')

      // NOTE: Unreachable via the current single PO-creation path, which creates POs directly as RECEIVED. Confirmed with product owner (see audit) that instant create-and-receive is the intended behavior. This function/guard is currently dead code — kept for now, pending a decision on whether to remove it.
      // ── IMMUTABLE STATE GUARD ──
      // A RECEIVED/CANCELLED PO has already hit inventory and the General Ledger.
      // Editing it would desync stock layers, supplier balance, and GL postings.
      // No legitimate business flow needs to edit a received PO — create a new one.
      if (
        oldPo.status === PurchaseOrderStatus.RECEIVED ||
        oldPo.status === PurchaseOrderStatus.CANCELLED
      ) {
        throw new Error(
          `Cannot modify a finalized purchase order (status: ${oldPo.status}). Create a new PO instead.`
        )
      }

      const invoice = oldPo.purchaseInvoices[0]
      if (!invoice) throw new Error('Associated Purchase Invoice not found')

      resultInvoiceId = invoice.id
      supplierIdForRevalidation = oldPo.supplierId

      // Calculate new totals
      let subtotal = 0
      for (const l of lines) {
        subtotal = round2(subtotal + round2(l.quantity * l.unitCost - l.discount))
      }
      const total = round2(subtotal)
      const oldTotal = Number(oldPo.total)
      const totalDiff = round2(total - oldTotal)

      // 2. Serials Diff and Reconciliation across the entire PO
      const allOldSerialsMap = new Map<
        string,
        {
          junctionId: string
          serialUnit: {
            id: string
            serialNumber: string
            status: string
            sellingPrice: any
            _count: {
              saleLineSerials: number
              serviceJobSerials: number
              purchaseReturnLineSerials: number
            }
          }
          poLineId: string
          productId: string
        }
      >()

      for (const oldLine of oldPo.lines) {
        for (const su of oldLine.serialUnits) {
          allOldSerialsMap.set(su.serialUnit.serialNumber, {
            junctionId: su.id,
            serialUnit: su.serialUnit,
            poLineId: oldLine.id,
            productId: oldLine.productId,
          })
        }
      }

      const incomingSerialsSet = new Set(
        lines.flatMap(l => l.serialNumbers.map(s => s.trim()).filter(Boolean))
      )

      // A. Check for serials being REMOVED from this PO (Soft-delete to prevent foreign key errors)
      for (const [sn, oldSer] of allOldSerialsMap.entries()) {
        if (!incomingSerialsSet.has(sn)) {
          if (
            oldSer.serialUnit.status !== 'IN_STOCK' ||
            oldSer.serialUnit._count.saleLineSerials > 0 ||
            oldSer.serialUnit._count.serviceJobSerials > 0 ||
            oldSer.serialUnit._count.purchaseReturnLineSerials > 0
          ) {
            throw new Error(
              `Cannot remove serial ${sn} because it has already been processed or sold (status: ${oldSer.serialUnit.status}).`
            )
          }
          // Safe to remove junction & soft-delete serialUnit by setting status to RETURNED_TO_SUPPLIER
          await tx.purchaseOrderLineSerial.delete({ where: { id: oldSer.junctionId } })
          await tx.serialUnit.update({
            where: { id: oldSer.serialUnit.id },
            data: { status: SerialStatus.RETURNED_TO_SUPPLIER },
          })
        }
      }

      // B. Check for serials being ADDED to this PO (not originally on this PO)
      const addedSerials: string[] = []
      for (const line of lines) {
        for (const sn of line.serialNumbers) {
          const trimmedSn = sn.trim()
          if (trimmedSn && !allOldSerialsMap.has(trimmedSn)) {
            addedSerials.push(trimmedSn)
          }
        }
      }

      if (addedSerials.length > 0) {
        const existingSerials = await tx.serialUnit.findMany({
          where: { serialNumber: { in: addedSerials } },
          select: { serialNumber: true, status: true },
        })
        if (existingSerials.length > 0) {
          throw new Error(
            `Serial number ${existingSerials[0].serialNumber} already exists in inventory (status: ${existingSerials[0].status}).`
          )
        }
      }

      // 3. Lines & StockLayers Reconciliation across ALL matching layers for each product
      const incomingProductIds = new Set(lines.map(l => l.productId))

      // A. Handle removed PO lines
      for (const oldLine of oldPo.lines) {
        if (!incomingProductIds.has(oldLine.productId)) {
          const matchingLayers = oldPo.stockLayers.filter(sl => sl.productId === oldLine.productId)
          const totalReceived = matchingLayers.reduce((sum, l) => sum + l.quantityReceived, 0)
          const totalRemaining = matchingLayers.reduce((sum, l) => sum + l.quantityRemaining, 0)
          const totalConsumed = totalReceived - totalRemaining

          if (matchingLayers.length > 0 && totalConsumed > 0) {
            throw new Error(
              `Cannot remove "${oldLine.product.name}" from purchase order because ${totalConsumed} unit(s) have already been sold or consumed.`
            )
          }

          // Delete junctions if any remained
          await tx.purchaseOrderLineSerial.deleteMany({ where: { poLineId: oldLine.id } })
          await tx.purchaseOrderLine.delete({ where: { id: oldLine.id } })

          // Delete all matching stock layers
          if (matchingLayers.length > 0) {
            await tx.stockLayer.deleteMany({
              where: { id: { in: matchingLayers.map(l => l.id) } },
            })
          }

          await tx.stockLedger.create({
            data: {
              productId: oldLine.productId,
              outletId: oldPo.outletId,
              supplierId: oldPo.supplierId,
              purchaseOrderId: oldPo.id,
              movementType: StockMovementType.ADJUSTMENT_OUT,
              quantity: -oldLine.quantity,
              referenceId: oldPo.id,
              referenceType: 'Purchase Edit Line Removed',
              notes: `Removed line on Purchase Edit: ${reason}`,
            },
          })
        }
      }

      // B. Handle updated or newly added lines
      for (const line of lines) {
        const oldLine = oldPo.lines.find(l => l.productId === line.productId)
        const oldQty = oldLine ? oldLine.quantity : 0
        const deltaQty = line.quantity - oldQty
        const lineTotal = round2(line.quantity * line.unitCost - line.discount)

        let targetPoLineId: string

        if (oldLine) {
          // Update line in-place
          targetPoLineId = oldLine.id
          await tx.purchaseOrderLine.update({
            where: { id: oldLine.id },
            data: {
              quantity: line.quantity,
              unitCost: line.unitCost,
              discount: line.discount,
              total: lineTotal,
            },
          })
        } else {
          // Create new line
          const createdLine = await tx.purchaseOrderLine.create({
            data: {
              poId: oldPo.id,
              productId: line.productId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              discount: line.discount,
              total: lineTotal,
            },
          })
          targetPoLineId = createdLine.id
        }

        // Reconcile Serials for this line
        for (const sn of line.serialNumbers) {
          const trimmedSn = sn.trim()
          if (!trimmedSn) continue
          const existingOnPo = allOldSerialsMap.get(trimmedSn)
          if (existingOnPo) {
            await tx.serialUnit.update({
              where: { id: existingOnPo.serialUnit.id },
              data: {
                ...(line.sellingPrice !== undefined ? { sellingPrice: line.sellingPrice } : {}),
                ...(line.unitCost !== undefined ? { costPrice: line.unitCost } : {}),
              },
            })
            if (existingOnPo.poLineId !== targetPoLineId) {
              await tx.purchaseOrderLineSerial.update({
                where: { id: existingOnPo.junctionId },
                data: { poLineId: targetPoLineId },
              })
            }
          } else {
            const createdSerial = await tx.serialUnit.create({
              data: {
                serialNumber: trimmedSn,
                productId: line.productId,
                outletId: oldPo.outletId,
                status: SerialStatus.IN_STOCK,
                purchasedAt: oldPo.orderDate || oldPo.createdAt,
                notes: `Purchase ${oldPo.poNumber} (Edited)`,
                costPrice: line.unitCost,
                sellingPrice: line.sellingPrice,
              },
            })
            await tx.purchaseOrderLineSerial.create({
              data: { poLineId: targetPoLineId, serialUnitId: createdSerial.id },
            })
          }
        }

        // Reconcile StockLayer & StockLedger across ALL matching stock layers for this product
        const matchingLayers = oldPo.stockLayers.filter(sl => sl.productId === line.productId)

        if (deltaQty < 0) {
          const totalReceived = matchingLayers.reduce((sum, l) => sum + l.quantityReceived, 0)
          const totalRemaining = matchingLayers.reduce((sum, l) => sum + l.quantityRemaining, 0)
          const totalConsumed = totalReceived - totalRemaining

          if (line.quantity < totalConsumed) {
            throw new Error(
              `Cannot reduce quantity of "${oldLine?.product.name ?? line.productId}" from ${oldQty} to ${line.quantity} because ${totalConsumed} unit(s) have already been sold.`
            )
          }

          if (matchingLayers.length > 0) {
            let qtyToReduce = Math.abs(deltaQty)
            for (const layer of matchingLayers) {
              if (qtyToReduce <= 0) break
              const reduce = Math.min(layer.quantityRemaining, qtyToReduce)
              await tx.stockLayer.update({
                where: { id: layer.id },
                data: {
                  quantityReceived: Math.max(0, layer.quantityReceived - reduce),
                  quantityRemaining: layer.quantityRemaining - reduce,
                  unitCost: line.unitCost,
                },
              })
              qtyToReduce -= reduce
            }
          }

          await tx.stockLedger.create({
            data: {
              productId: line.productId,
              outletId: oldPo.outletId,
              supplierId: oldPo.supplierId,
              purchaseOrderId: oldPo.id,
              movementType: StockMovementType.ADJUSTMENT_OUT,
              quantity: deltaQty,
              referenceId: oldPo.id,
              referenceType: 'Purchase Edit',
              notes: `Purchase Qty Reduced: ${reason}`,
            },
          })
        } else if (deltaQty > 0) {
          if (matchingLayers.length > 0) {
            const primaryLayer = matchingLayers[0]
            await tx.stockLayer.update({
              where: { id: primaryLayer.id },
              data: {
                quantityReceived: primaryLayer.quantityReceived + deltaQty,
                quantityRemaining: primaryLayer.quantityRemaining + deltaQty,
                unitCost: line.unitCost,
              },
            })
          } else {
            await tx.stockLayer.create({
              data: {
                productId: line.productId,
                outletId: oldPo.outletId,
                supplierId: oldPo.supplierId,
                purchaseOrderId: oldPo.id,
                quantityReceived: line.quantity,
                quantityRemaining: line.quantity,
                unitCost: line.unitCost,
                receivedAt: oldPo.orderDate || oldPo.createdAt,
              },
            })
          }

          await tx.stockLedger.create({
            data: {
              productId: line.productId,
              outletId: oldPo.outletId,
              supplierId: oldPo.supplierId,
              purchaseOrderId: oldPo.id,
              movementType: StockMovementType.PURCHASE_IN,
              quantity: deltaQty,
              referenceId: oldPo.id,
              referenceType: 'Purchase Edit',
              notes: `Purchase Qty Increased: ${reason}`,
            },
          })
        } else {
          // deltaQty === 0: Update unit cost for all matching layers
          for (const layer of matchingLayers) {
            await tx.stockLayer.update({
              where: { id: layer.id },
              data: { unitCost: line.unitCost },
            })
          }
        }

        // Update product cost price
        await tx.product.update({
          where: { id: line.productId },
          data: { costPrice: line.unitCost },
        })
      }

      // 4. Update Purchase Order Totals
      await tx.purchaseOrder.update({
        where: { id: oldPo.id },
        data: { subtotal, total },
      })

      // 5. Update Invoice & Supplier Ledger
      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          subtotal,
          total,
          notes: notes !== undefined ? notes : invoice.notes,
          amountPaid: amountPaid !== undefined ? amountPaid : invoice.amountPaid,
        },
      })

      await tx.supplierLedger.deleteMany({
        where: {
          referenceId: invoice.id,
          description: { startsWith: 'Invoice' },
        },
      })

      await tx.supplierLedger.create({
        data: {
          supplierId: invoice.supplierId,
          type: TransactionType.DEBIT,
          amount: total,
          description: `Invoice ${invoice.invoiceNumber} (Edited)`,
          referenceId: invoice.id,
          invoiceId: invoice.id,
          outletId: oldPo.outletId,
          purchaseOrderId: oldPo.id,
          transactionType: 'INVOICE_CREATED',
          createdById: user.id,
        },
      })

      // Fix Supplier Balance Drift: Increment outstanding balance by totalDiff
      if (oldPo.supplierId && totalDiff !== 0) {
        await tx.supplier.update({
          where: { id: oldPo.supplierId },
          data: {
            outstandingBalance: {
              increment: totalDiff,
            },
          },
        })
      }

      // Fix Missing General Ledger (Accounting) Entries for Purchase Invoice
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1400', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const inventoryAccountId = coaMap.get('1400')
      const apAccountId = coaMap.get('2100')

      await tx.accountLedgerEntry.deleteMany({
        where: { referenceId: invoice.id, referenceType: 'PurchaseInvoice' },
      })

      if (inventoryAccountId && apAccountId) {
        const gl = [
          {
            accountId: inventoryAccountId,
            type: TransactionType.DEBIT,
            amount: total,
            description: `Purchase Invoice ${invoice.invoiceNumber} (Edited)`,
            referenceId: invoice.id,
            referenceType: 'PurchaseInvoice',
          },
          {
            accountId: apAccountId,
            type: TransactionType.CREDIT,
            amount: total,
            description: `Purchase Invoice ${invoice.invoiceNumber} (Edited)`,
            referenceId: invoice.id,
            referenceType: 'PurchaseInvoice',
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })
      }

      // 6. Log Edit
      await tx.purchaseInvoiceEditLog.create({
        data: {
          invoiceId: invoice.id,
          editedById: user.id,
          reason: reason.trim(),
          fieldName: 'items',
          oldValue: JSON.stringify(
            oldPo.lines.map(l => ({ p: l.productId, q: l.quantity, cost: Number(l.unitCost) }))
          ),
          newValue: JSON.stringify(
            lines.map(l => ({ p: l.productId, q: l.quantity, cost: l.unitCost }))
          ),
        },
      })
    }

    if (tx) {
      await executeEdit(tx)
    } else {
      await prisma.$transaction(async innerTx => await executeEdit(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }
  } catch (err: any) {
    return fail(err.message || 'Failed to update purchase items')
  }

  await logAudit('PURCHASE_EDIT_ITEMS', 'PurchaseOrder', resultPoId, { reason })
  revalidatePath(`/purchases/${resultPoId}`)
  revalidatePath('/purchases')
  revalidatePath('/purchases/invoices')
  if (resultInvoiceId) {
    revalidatePath(`/purchases/invoices/${resultInvoiceId}`)
  }
  if (supplierIdForRevalidation) {
    revalidatePath(`/suppliers/${supplierIdForRevalidation}`)
    revalidatePath('/suppliers')
  }
  revalidatePath('/inventory')

  return ok({ poId: resultPoId, invoiceId: resultInvoiceId })
}

// ─────────────────────────────────────────────
// PURCHASE RETURNS / DEBIT NOTES
// ─────────────────────────────────────────────


const purchaseReturnRequestLineSchema = z.object({
  poLineId: z.string(),
  quantity: z.coerce.number().int().min(1),
})

const purchaseReturnSerialSchema = z.object({
  poLineId: z.string(),
  serialUnitId: z.string(),
})

const createPurchaseReturnSchema = z.object({
  purchaseOrderId: z.string().min(1, 'Purchase order ID is required'),
  reason: z.string().min(3, 'Reason must be at least 3 characters'),
  settlementMethod: z
    .nativeEnum(PurchaseReturnSettlementMethod)
    .default(PurchaseReturnSettlementMethod.AP_REDUCTION),
  refundMethod: z.nativeEnum(PaymentMethod).optional(),
  bankAccountId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  lines: z.array(purchaseReturnRequestLineSchema).min(1, 'Select at least one line to return'),
  serials: z.array(purchaseReturnSerialSchema).optional().default([]),
})

export async function createPurchaseReturn(
  purchaseOrderId: string,
  reason: string,
  settlementMethod: PurchaseReturnSettlementMethod = PurchaseReturnSettlementMethod.AP_REDUCTION,
  requestedLines?: Array<{ poLineId: string; quantity: number }>,
  options?: {
    refundMethod?: PaymentMethod
    bankAccountId?: string
    serials?: Array<{ poLineId: string; serialUnitId: string }>
    idempotencyKey?: string
  },
  tx?: PrismaTx
) {
  let user
  try {
    user = await requireRole(
      UserRole.ACCOUNTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN
    )
  } catch (err: any) {
    return fail(err.message || 'Unauthorized')
  }

  const parsed = createPurchaseReturnSchema.safeParse({
    purchaseOrderId,
    reason,
    settlementMethod,
    refundMethod: options?.refundMethod,
    bankAccountId: options?.bankAccountId,
    idempotencyKey: options?.idempotencyKey,
    lines: requestedLines,
    serials: options?.serials,
  })

  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const cleanIdempotencyKey = parsed.data.idempotencyKey?.trim() || undefined
  if (cleanIdempotencyKey) {
    const existing = await prisma.purchaseReturn.findUnique({
      where: { idempotencyKey: cleanIdempotencyKey },
      select: { id: true, returnNumber: true, total: true },
    })
    if (existing) {
      return ok({
        id: existing.id,
        returnNumber: existing.returnNumber,
        total: Number(existing.total),
      })
    }
  }

  const {
    purchaseOrderId: poId,
    reason: trimmedReason,
    settlementMethod: settlement,
    refundMethod,
    bankAccountId,
    lines,
    serials,
  } = parsed.data

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: true,
      lines: {
        include: {
          product: { select: { id: true, name: true, requiresSerial: true, costPrice: true } },
          serialUnits: {
            include: { serialUnit: true },
          },
        },
      },
    },
  })

  if (!po) return fail('Purchase order not found')
  if (user.outletId && po.outletId !== user.outletId && user.role !== UserRole.SUPER_ADMIN) {
    return fail('Purchase order does not belong to your outlet')
  }
  if (
    po.status !== PurchaseOrderStatus.RECEIVED &&
    po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
  ) {
    return fail('Only received or partially received purchase orders can be returned')
  }

  const poLineMap = new Map(po.lines.map(line => [line.id, line]))

  for (const line of lines) {
    const poLine = poLineMap.get(line.poLineId)
    if (!poLine) return fail(`Invalid purchase order line: ${line.poLineId}`)

    // Validate that serialized items have corresponding serials selected
    if (poLine.product.requiresSerial) {
      const lineSerials = (serials ?? []).filter(s => s.poLineId === line.poLineId)
      if (lineSerials.length !== line.quantity) {
        return fail(
          `Please select exactly ${line.quantity} serial number(s) to return for "${poLine.product.name}"`
        )
      }

      const poLineSerialIds = new Set(poLine.serialUnits.map(su => su.serialUnit.id))
      for (const s of lineSerials) {
        if (!poLineSerialIds.has(s.serialUnitId)) {
          return fail(`Selected serial unit does not belong to purchase order line for "${poLine.product.name}"`)
        }
      }
    }
  }

  try {
    const executeReturn = async (activeTx: PrismaTx) => {
      // 1. Strict lock hierarchy: PurchaseOrder -> PurchaseOrderLine -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
      await activeTx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE id = ${po.id} FOR UPDATE`

      for (const line of lines) {
        await activeTx.$executeRaw`SELECT 1 FROM "PurchaseOrderLine" WHERE id = ${line.poLineId} FOR UPDATE`
      }

      await activeTx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${po.supplierId} FOR UPDATE`

      if (settlement === PurchaseReturnSettlementMethod.CASH_REFUND && bankAccountId) {
        await activeTx.$executeRaw`SELECT 1 FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      // 2. Query already returned quantities under transaction lock
      const previousReturns = await activeTx.purchaseReturnLine.groupBy({
        by: ['poLineId'],
        _sum: { quantity: true },
        where: {
          poLineId: { in: lines.map(l => l.poLineId) },
        },
      })

      const alreadyReturnedMap = new Map(
        previousReturns.map(r => [r.poLineId!, r._sum.quantity ?? 0])
      )

      // Bug 5 fix: Check remaining physical FIFO layer stock for non-serialized items
      // to prevent internal "Insufficient FIFO layer stock" crashes when units were already sold.
      const poStockLayers = await activeTx.stockLayer.groupBy({
        by: ['productId'],
        where: {
          purchaseOrderId: po.id,
          quantityRemaining: { gt: 0 },
        },
        _sum: { quantityRemaining: true },
      })
      const stockRemainingByProduct = new Map(
        poStockLayers.map(sl => [sl.productId, sl._sum.quantityRemaining ?? 0])
      )

      let totalReturnAmount = 0
      for (const line of lines) {
        const poLine = poLineMap.get(line.poLineId)!
        const alreadyReturned = alreadyReturnedMap.get(line.poLineId) ?? 0
        const received = poLine.quantityReceived || 0
        const remaining = received - alreadyReturned

        if (line.quantity > remaining) {
          throw new Error(
            `Return quantity (${line.quantity}) exceeds remaining received quantity (${remaining}) for product "${poLine.product.name}"`
          )
        }

        if (!poLine.product.requiresSerial) {
          const availableInLayer = stockRemainingByProduct.get(poLine.productId) ?? 0
          if (line.quantity > availableInLayer) {
            throw new Error(
              `Cannot return ${line.quantity} unit(s) of "${poLine.product.name}" because only ${availableInLayer} unit(s) remain in stock from this purchase. (Some units were already sold or moved).`
            )
          }
        }

        const effectiveUnitCost =
          poLine.quantity > 0
            ? round2(
                Number(poLine.unitCost) -
                  Number(poLine.discount || 0) / poLine.quantity
              )
            : Number(poLine.unitCost)
        const lineAmount = round2(line.quantity * effectiveUnitCost)
        totalReturnAmount = round2(totalReturnAmount + lineAmount)
      }

      // Query all associated PurchaseInvoices for this PO, ordered newest first (LIFO allocation)
      const purchaseInvoices = await activeTx.purchaseInvoice.findMany({
        where: { poId: po.id },
        orderBy: { createdAt: 'desc' },
      })
      const primaryInvoice = purchaseInvoices[0]
      for (const inv of purchaseInvoices) {
        await activeTx.$executeRaw`SELECT 1 FROM "PurchaseInvoice" WHERE id = ${inv.id} FOR UPDATE`
      }

      // Lock open cash drawer via unified helper if CASH_REFUND via CASH (after PurchaseInvoice locks)
      let refundCashDrawer: any = null
      if (
        settlement === PurchaseReturnSettlementMethod.CASH_REFUND &&
        (refundMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH
      ) {
        const refundOutletId = user.outletId
        if (!refundOutletId) {
          throw new Error('User is not assigned to an outlet')
        }
        refundCashDrawer = await requireOpenDrawerForPurchase(activeTx, refundOutletId)
      }

      const returnNumber = await nextDocumentNumber(activeTx, 'purchase_return')

      // Bug 2 fix: Create PurchaseReturn record FIRST so ret.id is available as referenceId on StockLedger
      const ret = await activeTx.purchaseReturn.create({
        data: {
          returnNumber,
          idempotencyKey: cleanIdempotencyKey,
          purchaseOrderId: po.id,
          purchaseInvoiceId: primaryInvoice?.id ?? undefined,
          supplierId: po.supplierId,
          outletId: po.outletId,
          createdById: user.id,
          notes: trimmedReason,
          settlementMethod: settlement,
          refundMethod: refundMethod ? (refundMethod as PaymentMethod) : undefined,
          bankAccountId: bankAccountId || undefined,
          refundAmount: settlement === 'CASH_REFUND' ? totalReturnAmount : undefined,
          total: totalReturnAmount,
          lines: {
            create: lines.map(line => {
              const poLine = poLineMap.get(line.poLineId)!
              const effectiveUnitCost =
                poLine.quantity > 0
                  ? round2(
                      Number(poLine.unitCost) -
                        Number(poLine.discount || 0) / poLine.quantity
                    )
                  : Number(poLine.unitCost)
              return {
                poLineId: line.poLineId,
                productId: poLine.productId,
                quantity: line.quantity,
                unitCost: effectiveUnitCost,
                reason: trimmedReason,
              }
            }),
          },
        },
        include: { lines: true },
      })

      // 3. Consume stock layers targeted at this specific supplier and PO, tracking actual landed cost consumed
      let totalConsumedLandedCost = 0
      for (const reqLine of lines) {
        const poLine = poLineMap.get(reqLine.poLineId)!
        const effectiveUnitCost =
          poLine.quantity > 0
            ? round2(
                Number(poLine.unitCost) -
                  Number(poLine.discount || 0) / poLine.quantity
              )
            : Number(poLine.unitCost)
        const lineBaseAmount = round2(reqLine.quantity * effectiveUnitCost)

        const consumedBatches = await consumeStockLayers(activeTx, {
          productId: poLine.productId,
          outletId: po.outletId,
          quantityNeeded: reqLine.quantity,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
        })

        if (
          Array.isArray(consumedBatches) &&
          consumedBatches.length > 0 &&
          consumedBatches[0]?.quantityConsumed !== undefined
        ) {
          const lineConsumedLanded = round2(
            consumedBatches.reduce(
              (s, b) => s + Number(b.quantityConsumed) * Number(b.unitCost),
              0
            )
          )
          totalConsumedLandedCost = round2(totalConsumedLandedCost + lineConsumedLanded)
        } else {
          totalConsumedLandedCost = round2(totalConsumedLandedCost + lineBaseAmount)
        }

        // 4. Create StockLedger entry with movementType: RETURN_OUT and referenceId: ret.id (Bug 2 fix)
        await activeTx.stockLedger.create({
          data: {
            productId: poLine.productId,
            outletId: po.outletId,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            movementType: StockMovementType.RETURN_OUT,
            quantity: -reqLine.quantity,
            referenceId: ret.id,
            referenceType: 'PurchaseReturn',
            notes: `Purchase Return ${returnNumber}`,
          },
        })
      }

      // 5. Update serial unit statuses to RETURNED_TO_SUPPLIER
      if (serials && serials.length > 0) {
        const serialUnitIds = serials.map(s => s.serialUnitId)
        const units = await activeTx.serialUnit.findMany({
          where: { id: { in: serialUnitIds } },
          select: { id: true, status: true, serialNumber: true },
        })
        const nonInStock = units.filter(u => u.status !== SerialStatus.IN_STOCK)
        if (nonInStock.length > 0) {
          throw new Error(
            `Serial "${nonInStock[0].serialNumber}" cannot be returned because its status is ${nonInStock[0].status}, not IN_STOCK`
          )
        }

        await activeTx.serialUnit.updateMany({
          where: { id: { in: serialUnitIds } },
          data: {
            status: SerialStatus.RETURNED_TO_SUPPLIER,
            notes: `Returned to supplier on PR: ${returnNumber}`,
          },
        })
      }

      // Link return line serials
      if (serials && serials.length > 0) {
        for (const s of serials) {
          const retLine = ret.lines.find(l => l.poLineId === s.poLineId)
          if (retLine) {
            await activeTx.purchaseReturnLineSerial.create({
              data: {
                returnLineId: retLine.id,
                serialUnitId: s.serialUnitId,
              },
            })
          }
        }
      }

      // 6. Update PurchaseInvoice totals and status for BOTH settlement methods via single helper
      // (locks PurchaseInvoice under hierarchy before CashDrawer)
      let unallocatedReturn = totalReturnAmount
      for (const inv of purchaseInvoices) {
        if (unallocatedReturn <= 0) break

        const invTotal = Number(inv.total)
        const invSubtotal = Number(inv.subtotal ?? inv.total)
        const invPaid = Number(inv.amountPaid)

        const deduction = Math.min(unallocatedReturn, invTotal)
        if (deduction <= 0) continue

        const newTotal = round2(invTotal - deduction)
        const newSubtotal = round2(Math.max(0, invSubtotal - deduction))
        let deltaPaid = 0

        // If CASH_REFUND and paid > newTotal, reduce amountPaid by the excess (supplier refunded cash)
        if (settlement === PurchaseReturnSettlementMethod.CASH_REFUND && invPaid > newTotal) {
          const excess = round2(invPaid - newTotal)
          const reduction = Math.min(deduction, excess)
          deltaPaid = -reduction
        }
        // For AP_REDUCTION: deltaPaid is 0. If newTotal < amountPaid, amountPaid is preserved!
        // The negative balance (valid store credit) is maintained and invoice status becomes PAID.

        const returnNote = `[Debit Note ${returnNumber}: -৳${deduction.toLocaleString()}]`
        const notes = inv.notes
          ? `${inv.notes}\n${returnNote}`
          : returnNote

        await applyInvoicePayment(activeTx, {
          invoiceId: inv.id,
          deltaAmountPaid: deltaPaid,
          newTotal,
          newSubtotal,
          notes,
        })

        unallocatedReturn = round2(unallocatedReturn - deduction)
      }

      // 7. Process settlement: AP_REDUCTION or CASH/BANK REFUND
      if (settlement === PurchaseReturnSettlementMethod.AP_REDUCTION) {
        await activeTx.supplier.update({
          where: { id: po.supplierId },
          data: {
            outstandingBalance: {
              decrement: totalReturnAmount,
            },
          },
        })

        await activeTx.supplierLedger.create({
          data: {
            supplierId: po.supplierId,
            type: TransactionType.CREDIT,
            amount: totalReturnAmount,
            description: `Purchase Return ${returnNumber} (AP Reduction)`,
            referenceId: ret.id,
            transactionType: 'PURCHASE_RETURN',
            invoiceId: primaryInvoice?.id ?? null,
            outletId: po.outletId,
            purchaseOrderId: po.id,
            purchaseReturnId: ret.id,
            createdById: user.id,
          },
        })
      } else if (settlement === PurchaseReturnSettlementMethod.CASH_REFUND) {
        const method = refundMethod ?? PaymentMethod.CASH

        if (method !== PaymentMethod.CASH && totalReturnAmount > 0 && !bankAccountId) {
          throw new Error('Bank account is required for electronic refunds')
        }

        if (method === PaymentMethod.CASH && refundCashDrawer) {
          await activeTx.drawerTransaction.create({
            data: {
              drawerId: refundCashDrawer.id,
              type: DRAWER_TX_TYPE.PURCHASE_REFUND,
              amount: totalReturnAmount,
              description: `Purchase Return ${returnNumber} (Cash Refund)`,
              referenceId: ret.id,
              referenceType: BANK_TX_REF_TYPE.PURCHASE_RETURN,
            },
          })
        } else if (bankAccountId) {
          await activeTx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: { increment: totalReturnAmount } },
          })
          await activeTx.bankTransaction.create({
            data: {
              bankAccountId,
              type: 'DEPOSIT',
              amount: totalReturnAmount,
              description: `Purchase Return ${returnNumber} (Bank Refund)`,
              referenceId: ret.id,
              referenceType: BANK_TX_REF_TYPE.PURCHASE_RETURN,
            },
          })
        }

        // Write return credit
        await activeTx.supplierLedger.create({
          data: {
            supplierId: po.supplierId,
            type: TransactionType.CREDIT,
            amount: totalReturnAmount,
            method,
            bankAccountId: bankAccountId ?? null,
            description: `Purchase Return ${returnNumber} (Refund)`,
            invoiceId: primaryInvoice?.id ?? null,
            purchaseReturnId: ret.id,
            purchaseOrderId: po.id,
            outletId: po.outletId,
            referenceId: ret.id,
            transactionType: 'PURCHASE_RETURN',
            createdById: user.id,
          },
        })

        // Immediate cash settlement entry in supplier ledger so net supplier balance effect is 0
        await activeTx.supplierLedger.create({
          data: {
            supplierId: po.supplierId,
            type: TransactionType.DEBIT,
            amount: totalReturnAmount,
            method,
            bankAccountId: bankAccountId ?? null,
            description: `Cash Refund Received for ${returnNumber}`,
            invoiceId: primaryInvoice?.id ?? null,
            purchaseReturnId: ret.id,
            purchaseOrderId: po.id,
            outletId: po.outletId,
            referenceId: ret.id,
            transactionType: 'PURCHASE_REFUND',
            createdById: user.id,
          },
        })
      }

      // 8. General Ledger Postings for Purchase Return
      // Reverse Inventory (1400) at landed cost, AP (2100) / Cash (1100) / Bank (1200) at base return amount,
      // and post freight difference to 5270 Transportation
      const freightDifference = round2(totalConsumedLandedCost - totalReturnAmount)
      const neededCoaCodes = ['1400', '2100', '1100', '1200']
      if (Math.abs(freightDifference) >= 0.01) {
        neededCoaCodes.push('5270')
      }

      const coaAccounts = await activeTx.chartOfAccount.findMany({
        where: { code: { in: neededCoaCodes } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccountId = coaMap.get('1400')
      const apAccountId = coaMap.get('2100')
      const cashAccountId = coaMap.get('1100')
      const bankAssetAccountId = coaMap.get('1200')
      const transportAccountId = coaMap.get('5270')

      if (!invAccountId) {
        throw new Error('Required Chart of Accounts (1400 Inventory) not found for purchase return.')
      }

      if (settlement === 'AP_REDUCTION' && !apAccountId) {
        throw new Error('Required Chart of Accounts (2100 Accounts Payable) not found for purchase return AP reduction.')
      }

      if (settlement === 'CASH_REFUND') {
        const method = refundMethod ?? PaymentMethod.CASH
        if (method === PaymentMethod.CASH && !cashAccountId) {
          throw new Error('Required Chart of Accounts (1100 Cash in Hand) not found for purchase return cash refund.')
        } else if (method !== PaymentMethod.CASH && !bankAssetAccountId) {
          throw new Error('Required Chart of Accounts (1200 Bank Accounts) not found for purchase return bank refund.')
        }
      }

      if (Math.abs(freightDifference) >= 0.01 && !transportAccountId) {
        throw new Error('Required Chart of Accounts (5270 Transportation) not found for purchase return freight write-off.')
      }

      const glEntries: import('@prisma/client').Prisma.AccountLedgerEntryCreateManyInput[] = []

      // Cr Inventory (1400) — merchandise leaving inventory at consumed landed cost
      if (totalConsumedLandedCost > 0) {
        glEntries.push({
          accountId: invAccountId,
          type: TransactionType.CREDIT,
          amount: totalConsumedLandedCost,
          description: `Purchase Return ${returnNumber} — Inventory reduction`,
          referenceId: ret.id,
          referenceType: 'PurchaseReturn',
          outletId: po.outletId,
        })
      }

      // Dr settlement account at base return amount
      if (settlement === 'AP_REDUCTION' && apAccountId && totalReturnAmount > 0) {
        // Dr Accounts Payable (2100) — liability to supplier reduced
        glEntries.push({
          accountId: apAccountId,
          type: TransactionType.DEBIT,
          amount: totalReturnAmount,
          description: `Purchase Return ${returnNumber} — Accounts Payable reduced`,
          referenceId: ret.id,
          referenceType: 'PurchaseReturn',
          outletId: po.outletId,
        })
      } else if (settlement === 'CASH_REFUND' && totalReturnAmount > 0) {
        const method = refundMethod ?? PaymentMethod.CASH
        if (method === PaymentMethod.CASH && cashAccountId) {
          // Dr Cash in Hand (1100) — cash received from supplier
          glEntries.push({
            accountId: cashAccountId,
            type: TransactionType.DEBIT,
            amount: totalReturnAmount,
            description: `Purchase Return ${returnNumber} — Cash refund received`,
            referenceId: ret.id,
            referenceType: 'PurchaseReturn',
            outletId: po.outletId,
          })
        } else if (bankAssetAccountId) {
          // Dr Bank Asset (1200) — bank deposit received from supplier
          glEntries.push({
            accountId: bankAssetAccountId,
            type: TransactionType.DEBIT,
            amount: totalReturnAmount,
            description: `Purchase Return ${returnNumber} — Bank refund received`,
            referenceId: ret.id,
            referenceType: 'PurchaseReturn',
            outletId: po.outletId,
          })
        }
      }

      // Dr 5270 Transportation for unrecoverable freight difference on returned units
      if (freightDifference >= 0.01 && transportAccountId) {
        glEntries.push({
          accountId: transportAccountId,
          type: TransactionType.DEBIT,
          amount: freightDifference,
          description: `Purchase Return ${returnNumber} — Freight write-off on returned goods`,
          referenceId: ret.id,
          referenceType: 'PurchaseReturn',
          outletId: po.outletId,
        })
      } else if (freightDifference <= -0.01 && transportAccountId) {
        glEntries.push({
          accountId: transportAccountId,
          type: TransactionType.CREDIT,
          amount: Math.abs(freightDifference),
          description: `Purchase Return ${returnNumber} — Freight adjustment on returned goods`,
          referenceId: ret.id,
          referenceType: 'PurchaseReturn',
          outletId: po.outletId,
        })
      }

      if (glEntries.length > 0) {
        assertBalancedJournal(glEntries)
        await activeTx.accountLedgerEntry.createMany({ data: glEntries })
      }

      return ret
    }

    let purchaseReturn: any
    if (tx) {
      purchaseReturn = await executeReturn(tx)
    } else {
      if (
        settlement === PurchaseReturnSettlementMethod.CASH_REFUND &&
        (refundMethod ?? PaymentMethod.CASH) === PaymentMethod.CASH
      ) {
        await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
      }
      purchaseReturn = await prisma.$transaction(async innerTx => await executeReturn(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    await logAuditDirect(
      user.id,
      'PURCHASE_RETURN_PROCESSED',
      'PurchaseReturn',
      purchaseReturn.id,
      {
        returnNumber: purchaseReturn.returnNumber,
        poId: po.id,
        supplierId: po.supplierId,
        total: purchaseReturn.total,
        settlementMethod: settlement,
      }
    )

    safeRevalidateTag(`dashboard-${po.outletId}`)
    safeRevalidatePath('/', 'page')
    safeRevalidatePath('/purchases/returns')
    safeRevalidatePath('/purchases')
    safeRevalidatePath(`/purchases/${po.id}`)
    safeRevalidatePath('/products')
    safeRevalidatePath('/reports')
    safeRevalidatePath('/reports/inventory')

    // INV-007: Trigger low-stock notifications after purchase return stock reduction
    const returnedProductIds = lines
      .map(l => poLineMap.get(l.poLineId)?.product.id)
      .filter((id): id is string => Boolean(id))
    if (returnedProductIds.length > 0) {
      checkAndNotifyLowStock(returnedProductIds, po.outletId).catch(err => {
        console.error('[createPurchaseReturn] Low stock notification check failed:', err)
      })
    }

    return ok({
      id: purchaseReturn.id,
      returnNumber: purchaseReturn.returnNumber,
      total: Number(purchaseReturn.total),
    })
  } catch (error: any) {
    if (
      cleanIdempotencyKey &&
      (error?.code === 'P2002' ||
        error?.message?.includes('Unique constraint failed') ||
        error?.message?.includes('idempotencyKey'))
    ) {
      const existing = await prisma.purchaseReturn.findUnique({
        where: { idempotencyKey: cleanIdempotencyKey },
        select: { id: true, returnNumber: true, total: true },
      })
      if (existing) {
        return ok({
          id: existing.id,
          returnNumber: existing.returnNumber,
          total: Number(existing.total),
        })
      }
    }
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error.message || 'Failed to process purchase return')
  }
}

export async function getPurchaseReturnPreview(purchaseOrderId: string) {
  const user = await requireAuth()

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplier: {
        select: { id: true, name: true, phone: true, outstandingBalance: true },
      },
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
          serialUnits: {
            include: {
              serialUnit: {
                select: { id: true, serialNumber: true, status: true },
              },
            },
          },
        },
      },
    },
  })

  if (!po) return fail('Purchase order not found')
  if (user.outletId && po.outletId !== user.outletId && user.role !== UserRole.SUPER_ADMIN) {
    return fail('Purchase order not accessible in your outlet')
  }
  if (
    po.status !== PurchaseOrderStatus.RECEIVED &&
    po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
  ) {
    return fail('Only received or partially received purchase orders can be returned')
  }

  const [previousReturns, poStockLayers] = await Promise.all([
    prisma.purchaseReturnLine.groupBy({
      by: ['poLineId'],
      _sum: { quantity: true },
      where: {
        poLineId: { in: po.lines.map(l => l.id) },
      },
    }),
    prisma.stockLayer.groupBy({
      by: ['productId'],
      where: {
        purchaseOrderId: po.id,
        quantityRemaining: { gt: 0 },
      },
      _sum: { quantityRemaining: true },
    }),
  ])

  const returnedMap = new Map(
    previousReturns.map(r => [r.poLineId!, r._sum.quantity ?? 0])
  )
  const stockRemainingByProduct = new Map(
    poStockLayers.map(sl => [sl.productId, sl._sum.quantityRemaining ?? 0])
  )

  const lines = po.lines.map(line => {
    const returnedQty = returnedMap.get(line.id) ?? 0
    const unreturnedQty = Math.max(0, line.quantity - returnedQty)
    const inStockSerials = line.serialUnits
      .filter(su => su.serialUnit.status === SerialStatus.IN_STOCK)
      .map(su => ({
        id: su.serialUnit.id,
        serialNumber: su.serialUnit.serialNumber,
      }))

    const layerQty = stockRemainingByProduct.get(line.productId) ?? 0
    const physicalAvailable = line.product.requiresSerial
      ? inStockSerials.length
      : layerQty
    const maxReturnableQty = Math.max(0, Math.min(unreturnedQty, physicalAvailable))

    const effectiveUnitCost =
      line.quantity > 0
        ? round2(
            Number(line.unitCost) -
              Number(line.discount || 0) / line.quantity
          )
        : Number(line.unitCost)

    return {
      id: line.id,
      quantity: line.quantity,
      unitCost: effectiveUnitCost,
      returnedQty,
      maxReturnableQty,
      lineTotal: Number(line.total),
      product: line.product,
      inStockSerials,
    }
  })

  const totalReturnable = lines.reduce(
    (sum, l) => sum + l.maxReturnableQty * l.unitCost,
    0
  )

  return ok({
    po: {
      id: po.id,
      poNumber: po.poNumber,
      orderDate: po.orderDate,
      status: po.status,
      total: Number(po.total),
      supplier: po.supplier,
    },
    lines,
    totalReturnable,
  })
}

export async function searchPurchaseOrdersForReturn(query: string) {
  const user = await requireAuth()
  const trimmed = query.trim()
  if (!trimmed) return ok([])

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...(user.outletId ? { outletId: user.outletId } : {}),
      status: { in: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
      OR: [
        { poNumber: { contains: trimmed, mode: 'insensitive' } },
        { supplier: { name: { contains: trimmed, mode: 'insensitive' } } },
      ],
    },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      lines: { select: { id: true, quantity: true, unitCost: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  const poLineIds = pos.flatMap(p => p.lines.map(l => l.id))
  const previousReturns = await prisma.purchaseReturnLine.groupBy({
    by: ['poLineId'],
    _sum: { quantity: true },
    where: {
      poLineId: { in: poLineIds },
    },
  })

  const returnedMap = new Map(
    previousReturns.map(r => [r.poLineId!, r._sum.quantity ?? 0])
  )

  const results = pos
    .map(po => {
      const hasReturnableStock = po.lines.some(line => {
        const returnedQty = returnedMap.get(line.id) ?? 0
        return line.quantity > returnedQty
      })

      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        createdAt: po.orderDate,
        total: Number(po.total),
        supplier: po.supplier,
        hasReturnableStock,
      }
    })
    .filter(po => po.hasReturnableStock)

  return ok(results)
}

export async function getPurchaseReturns(outletId?: string) {
  const user = await requireAuth()
  const targetOutletId = outletId || user.outletId
  if (targetOutletId) {
    validateOutletAccess(user, targetOutletId)
  }

  const returns = await prisma.purchaseReturn.findMany({
    where: targetOutletId ? { outletId: targetOutletId } : undefined,
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      createdBy: { select: { id: true, name: true } },
      bankAccount: { select: { id: true, bankName: true, accountName: true } },
      lines: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return returns.map(ret => ({
    id: ret.id,
    returnNumber: ret.returnNumber,
    poNumber: ret.purchaseOrder?.poNumber ?? 'N/A',
    poId: ret.purchaseOrderId,
    supplierName: ret.supplier?.name ?? 'Unknown',
    supplierId: ret.supplierId,
    total: Number(ret.total),
    settlementMethod: ret.settlementMethod,
    refundMethod: ret.refundMethod,
    bankAccountName: ret.bankAccount ? `${ret.bankAccount.bankName} - ${ret.bankAccount.accountName}` : null,
    reason: ret.notes ?? '',
    createdByName: ret.createdBy?.name ?? 'System',
    itemCount: ret.lines.reduce((s, l) => s + l.quantity, 0),
    lines: ret.lines.map(l => ({
      id: l.id,
      productId: l.productId,
      productName: l.product?.name ?? 'Unknown',
      quantity: l.quantity,
      unitCost: Number(l.unitCost),
      reason: l.reason,
    })),
    createdAt: ret.createdAt,
  }))
}

export async function getPurchaseReturnById(id: string) {
  const user = await requireAuth()

  const ret = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: true,
      outlet: true,
      purchaseOrder: {
        include: {
          outlet: true,
          supplier: true,
        },
      },
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      bankAccount: true,
      lines: {
        include: {
          product: true,
          serials: {
            include: {
              serialUnit: true,
            },
          },
        },
      },
    },
  })

  if (!ret) return null

  const isSuperAdmin =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'
  const targetOutletId = ret.outletId || ret.purchaseOrder?.outletId
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

// ─────────────────────────────────────────────────────────────────────────────
// NEW PURCHASE SYSTEM ACTIONS (PHASE 2)
// ─────────────────────────────────────────────────────────────────────────────

const directPurchaseInputSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  orderDate: z.string().optional(),
  supplierBillRef: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
        unitCost: z.number().min(0),
        sellingPrice: z.number().optional(),
        discount: z.number().min(0).default(0),
        serialNumbers: z.array(z.string()).optional(),
        note: z.string().optional(),
      })
    )
    .min(1, 'At least one product is required'),
  payment: z.object({
    method: z.nativeEnum(PaymentMethod),
    amount: z.number().min(0),
    bankAccountId: z.string().optional(),
    reference: z.string().optional(),
  }),
})

export type DirectPurchaseInput = z.infer<typeof directPurchaseInputSchema>

/**
 * ============================================================================
 * PURCHASE ACTION GROUP (Direct Purchase, Create PO, Receive GRN, Pay PO, Cancel)
 * ============================================================================
 * Per-Action Lock Order Summary:
 * - receivePurchaseOrderItemsAction:  PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - payAgainstPurchaseOrderAction:    PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - cancelPurchasePaymentAction:      PurchasePayment -> PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice (via applyInvoicePayment)
 * - recordPurchasePayment:            PurchaseOrder -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - recordSupplierPaymentAction:      PurchaseOrder -> Supplier (+ Customer) -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - createPurchaseReturn:             PurchaseOrder -> PurchaseOrderLine -> Supplier -> BankAccount -> PurchaseInvoice -> CashDrawer
 * - createPurchaseOrderAction:        Supplier -> BankAccount -> CashDrawer
 * - directPurchaseCheckoutAction:     Supplier -> BankAccount -> CashDrawer
 * - deleteDraftPo / deletePurchaseOrder: Supplier -> CashDrawer
 *
 * Why Drawer-before-Invoice in receive / payAgainst / cancel cannot deadlock against
 * Invoice-before-Drawer in recordPurchasePayment / recordSupplierPayment / createPurchaseReturn:
 *   Every transaction in this group acquires `FOR UPDATE` on `PurchaseOrder` (when present)
 *   and `Supplier` at the start of the transaction before touching `CashDrawer` or
 *   `PurchaseInvoice`. Thus any contending transactions on the same PO or Supplier serialize
 *   at the `PurchaseOrder` / `Supplier` lock before either `CashDrawer` or `PurchaseInvoice`
 *   is reached.
 *
 * 1. Direct Purchase Terminal Checkout (Instant Purchase + Stock In + Invoice)
 * - Strict NO TAX / VAT enforcement (tax = 0)
 * - Atomic transaction with assertBalancedJournal
 * - Creates StockLayer (FIFO), StockLedger (PURCHASE_IN), SerialUnit (IN_STOCK)
 */
export async function directPurchaseCheckoutAction(rawInput: DirectPurchaseInput) {
  const user = await requireAuth()
  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const parsed = directPurchaseInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const { supplierId, orderDate, supplierBillRef, notes, lines, payment } = parsed.data

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, outstandingBalance: true },
  })
  if (!supplier) {
    return fail('Supplier not found')
  }

  const productIds = Array.from(new Set(lines.map(l => l.productId)))
  const existingProducts = await prisma.product.findMany({
    where: { id: { in: productIds }, outletId: user.outletId, isActive: true },
    select: {
      id: true,
      name: true,
      requiresSerial: true,
      category: { select: { name: true } },
      parent: { select: { name: true } },
    },
  })
  if (existingProducts.length !== productIds.length) {
    return fail('One or more selected products are invalid for this outlet')
  }
  const productMap = new Map(existingProducts.map(p => [p.id, p]))

  // Validate serial numbers for serialized products (Gifts & Accessories exempt)
  for (const line of lines) {
    const prod = productMap.get(line.productId)
    const needsSerial =
      Boolean(prod?.requiresSerial) &&
      !isGiftOrAccessoryProduct(prod, (line as any).note)
    if (needsSerial) {
      const serials = line.serialNumbers?.map(s => s.trim()).filter(Boolean) ?? []
      if (serials.length !== line.quantity) {
        return fail(
          `"${prod?.name}" requires serial numbers. Please provide exactly ${line.quantity} serial(s). Got ${serials.length}.`
        )
      }
      const uniqueSerials = new Set(serials)
      if (uniqueSerials.size !== serials.length) {
        return fail(`"${prod?.name}" has duplicate serial numbers in input.`)
      }
    }
  }

  const allSerials = lines
    .filter(l => {
      const p = productMap.get(l.productId)
      return (
        Boolean(p?.requiresSerial) &&
        !isGiftOrAccessoryProduct(p, (l as any).note)
      )
    })
    .flatMap(l => l.serialNumbers ?? [])
    .map(s => s.trim())
    .filter(Boolean)

  if (allSerials.length > 0) {
    const existingSerials = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: allSerials } },
      select: { id: true, serialNumber: true },
    })
    if (existingSerials.length > 0) {
      const dupes = existingSerials.map(s => s.serialNumber).join(', ')
      return fail(`Serial number(s) already exist in inventory: ${dupes}`)
    }
  }

  // Calculate totals - NO TAX / VAT
  const lineCalcs = lines.map(l => {
    const lineDiscount = l.discount || 0
    const total = round2(l.quantity * l.unitCost - lineDiscount)
    const effectiveCost = l.quantity > 0 ? round2(total / l.quantity) : l.unitCost
    return {
      ...l,
      discount: lineDiscount,
      total,
      effectiveCost,
    }
  })

  const subtotal = round2(lineCalcs.reduce((s, l) => s + l.total, 0))
  const tax = 0 // NO TAX / VAT
  const total = subtotal
  const paidAmount = round2(Math.min(total, Math.max(0, payment.amount)))
  const remainingDue = round2(total - paidAmount)
  const purchaseDate = orderDate ? new Date(orderDate) : new Date()

  try {
    if (paidAmount > 0 && payment.method === PaymentMethod.CASH) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    return await prisma.$transaction(
      async tx => {
      // 1. Create PurchaseOrder as RECEIVED
      const poNumber = await nextDocumentNumber(tx, 'purchase_order')
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          outletId: user.outletId!,
          createdById: user.id,
          status: PurchaseOrderStatus.RECEIVED,
          orderDate: purchaseDate,
          notes,
          subtotal,
          tax: 0,
          total,
          lines: {
            create: lineCalcs.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              quantityReceived: l.quantity,
              unitCost: l.unitCost,
              discount: l.discount,
              total: l.total,
              note: l.note?.trim() || null,
            })),
          },
        },
        include: { lines: true },
      })

      // 2. Create GoodsReceivedNote (GRN)
      const grnNumber = await nextDocumentNumber(tx, 'goods_received_note')
      const grn = await tx.goodsReceivedNote.create({
        data: {
          grnNumber,
          poId: po.id,
          outletId: user.outletId!,
          receivedById: user.id,
          receivedAt: purchaseDate,
          supplierChallanNo: supplierBillRef,
          supplierNote: notes,
        },
      })

      // 3. Create GoodsReceivedNoteLine, StockLayer (FIFO), StockLedger, and SerialUnits
      for (const calc of lineCalcs) {
        const poLine = po.lines.find(pl => pl.productId === calc.productId)!

        const grnLine = await tx.goodsReceivedNoteLine.create({
          data: {
            grnId: grn.id,
            poLineId: poLine.id,
            productId: calc.productId,
            quantityReceived: calc.quantity,
            unitCost: calc.effectiveCost,
            serialNumbers: calc.serialNumbers || [],
          },
        })

        // StockLayer (FIFO)
        await tx.stockLayer.create({
          data: {
            productId: calc.productId,
            outletId: user.outletId!,
            supplierId,
            purchaseOrderId: po.id,
            grnLineId: grnLine.id,
            quantityReceived: calc.quantity,
            quantityRemaining: calc.quantity,
            unitCost: calc.effectiveCost,
            receivedAt: purchaseDate,
          },
        })

        // StockLedger
        await tx.stockLedger.create({
          data: {
            productId: calc.productId,
            outletId: user.outletId!,
            supplierId,
            purchaseOrderId: po.id,
            movementType: StockMovementType.PURCHASE_IN,
            quantity: calc.quantity,
            referenceId: grn.id,
            referenceType: 'GoodsReceivedNote',
            notes: `Direct Purchase ${po.poNumber} (${grn.grnNumber})`,
          },
        })

        // Serial Units
        if (calc.serialNumbers && calc.serialNumbers.length > 0) {
          for (const sn of calc.serialNumbers) {
            const serial = await tx.serialUnit.create({
              data: {
                serialNumber: sn.trim(),
                productId: calc.productId,
                outletId: user.outletId!,
                status: SerialStatus.IN_STOCK,
                purchasedAt: purchaseDate,
                costPrice: calc.effectiveCost,
                sellingPrice: calc.sellingPrice,
                grnLineId: grnLine.id,
                notes: `Direct Purchase ${po.poNumber}`,
              },
            })

            await tx.purchaseOrderLineSerial.create({
              data: {
                poLineId: poLine.id,
                serialUnitId: serial.id,
              },
            })
          }
        }

        // Update product cost price (and selling price if provided)
        await tx.product.update({
          where: { id: calc.productId },
          data: {
            costPrice: calc.effectiveCost,
            ...(calc.sellingPrice && calc.sellingPrice > 0
              ? { sellingPrice: calc.sellingPrice }
              : {}),
          },
        })
      }

      // 4. Create PurchaseInvoice
      const invoiceNumber = await nextDocumentNumber(tx, 'purchase_invoice')
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId,
          poId: po.id,
          subtotal,
          tax: 0,
          total,
          amountPaid: paidAmount,
          status:
            paidAmount >= total
              ? InvoiceStatus.PAID
              : paidAmount > 0
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.SENT, // Direct purchase unpaid is SENT, never DRAFT
          notes,
          createdAt: purchaseDate,
        },
      })

      // Link GRN to PurchaseInvoice
      await tx.goodsReceivedNote.update({
        where: { id: grn.id },
        data: { purchaseInvoiceId: invoice.id },
      })

      // 5. Lock Supplier first (under hierarchy Supplier -> BankAccount -> CashDrawer)
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

      // 6. Record Payment if paidAmount > 0
      if (paidAmount > 0) {
        if (payment.method === PaymentMethod.CASH) {
          const openDrawer = await requireOpenDrawerForPurchase(tx, user.outletId)
          const stats = await tx.drawerTransaction.aggregate({
            where: { drawerId: openDrawer.id },
            _sum: { amount: true },
          })
          const cashBalance = Number(stats._sum.amount || 0)
          if (cashBalance < paidAmount) {
            throw new Error(
              `Insufficient cash in drawer. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${paidAmount.toLocaleString()}`
            )
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.PURCHASE_PAYMENT,
              amount: -paidAmount,
              description: `Direct Purchase ${po.poNumber}`,
              referenceId: invoice.id,
              referenceType: 'PurchaseInvoice',
            },
          })
        } else if (payment.bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
          const bank = await tx.bankAccount.findUnique({
            where: { id: payment.bankAccountId },
          })
          if (!bank) {
            throw new Error('Selected bank account not found.')
          }
          if (Number(bank.currentBalance) < paidAmount) {
            throw new Error(
              `Insufficient funds: Transaction amount (৳${paidAmount.toLocaleString()}) exceeds available bank balance (৳${Number(bank.currentBalance).toLocaleString()}).`
            )
          }
          await tx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { decrement: paidAmount } },
          })
          await tx.bankTransaction.create({
            data: {
              bankAccountId: payment.bankAccountId,
              type: 'WITHDRAWAL',
              amount: paidAmount,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
              description: `Direct Purchase ${po.poNumber} (${invoice.invoiceNumber})`,
              date: purchaseDate,
            },
          })
        }

        const directPayment = await tx.purchasePayment.create({
          data: {
            invoiceId: invoice.id,
            purchaseOrderId: po.id,
            outletId: user.outletId,
            amount: paidAmount,
            method: payment.method,
            bankAccountId: payment.bankAccountId,
            reference: payment.reference,
            paidAt: purchaseDate,
          },
        })

        await tx.purchasePaymentAllocation.create({
          data: {
            paymentId: directPayment.id,
            invoiceId: invoice.id,
            amount: paidAmount,
          },
        })
      }

      // 7. Update Supplier Ledger and Outstanding Balance

      await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.DEBIT,
          amount: total,
          description: `Direct Purchase ${po.poNumber} (${invoice.invoiceNumber})`,
          referenceId: invoice.id,
          invoiceId: invoice.id,
          outletId: user.outletId!,
          purchaseOrderId: po.id,
          transactionType: 'INVOICE_CREATED',
          createdById: user.id,
        },
      })

      if (paidAmount > 0) {
        await tx.supplierLedger.create({
          data: {
            supplierId,
            type: TransactionType.CREDIT,
            amount: paidAmount,
            description: `Payment for ${invoice.invoiceNumber} via ${payment.method}`,
            referenceId: invoice.id,
            invoiceId: invoice.id,
            outletId: user.outletId!,
            purchaseOrderId: po.id,
            transactionType: 'PAYMENT',
            createdById: user.id,
          },
        })
      }

      if (remainingDue !== 0) {
        await tx.supplier.update({
          where: { id: supplierId },
          data: { outstandingBalance: { increment: remainingDue } },
        })
      }

      // 7. Double-Entry General Ledger Postings
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1400', '2100', '1100', '1200', '1110'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccId = coaMap.get('1400')
      const apAccId = coaMap.get('2100')
      const cashAccId = coaMap.get('1100')
      const bankAccId = coaMap.get('1200')

      const glEntries: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        outletId: string
      }> = []

      // Dr 1400 Merchandise Inventory
      if (invAccId && total > 0) {
        glEntries.push({
          accountId: invAccId,
          type: TransactionType.DEBIT,
          amount: total,
          description: `Direct Purchase ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'PurchaseInvoice',
          outletId: user.outletId!,
        })
      }

      // Cr 1100 Cash / 1200 Bank for paid amount
      if (paidAmount > 0) {
        const payAccId = payment.method === PaymentMethod.CASH ? cashAccId : bankAccId
        if (payAccId) {
          glEntries.push({
            accountId: payAccId,
            type: TransactionType.CREDIT,
            amount: paidAmount,
            description: `Payment for ${invoice.invoiceNumber} (${payment.method})`,
            referenceId: invoice.id,
            referenceType: 'PurchaseInvoice',
            outletId: user.outletId!,
          })
        }
      }

      // Cr 2100 Accounts Payable for remaining balance
      if (apAccId && remainingDue > 0) {
        glEntries.push({
          accountId: apAccId,
          type: TransactionType.CREDIT,
          amount: remainingDue,
          description: `Payable for ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'PurchaseInvoice',
          outletId: user.outletId!,
        })
      }

      if (glEntries.length > 0) {
        assertBalancedJournal(glEntries)
        await tx.accountLedgerEntry.createMany({ data: glEntries })
      }

      safeRevalidatePath('/purchases')
      safeRevalidatePath('/purchase-terminal')
      safeRevalidatePath('/purchases/invoices')

      return ok({
        success: true,
        poId: po.id,
        poNumber: po.poNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      })
      },
      { timeout: 35000 }
    )
  } catch (error: any) {
    return fail(error.message || 'Failed to complete direct purchase checkout')
  }
}

const createPurchaseOrderInputSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  orderDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  transportCost: z.coerce.number().min(0).optional().default(0),
  otherCost: z.coerce.number().min(0).optional().default(0),
  otherCostNote: z.string().optional(),
  costAllocationMethod: z.enum(['VALUE', 'QUANTITY']).optional().default('VALUE'),
  status: z.nativeEnum(PurchaseOrderStatus).optional().default(PurchaseOrderStatus.SENT),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
        unitCost: z.number().min(0),
        sellingPrice: z.number().optional(),
        discount: z.number().min(0).optional().default(0),
        note: z.string().optional(),
      })
    )
    .min(1, 'At least one item is required'),
  advanceAmount: z.number().min(0).optional().default(0),
  advancePaymentMethod: z.nativeEnum(PaymentMethod).optional(),
  advanceBankAccountId: z.string().optional(),
  advanceChequeDate: z.string().optional(),
})

export type CreatePurchaseOrderInput = z.input<typeof createPurchaseOrderInputSchema>

/**
 * 2. Create Purchase Order (Draft / Sent with optional Advance Payment)
 * - NO stock layers created (stock hasn't arrived)
 * - quantityReceived = 0 on all lines
 * - If advanceAmount > 0, tracks supplier payment and posts GL: Dr 2100 AP / Cr Cash/Bank
 */
export async function createPurchaseOrderAction(rawInput: CreatePurchaseOrderInput) {
  const user = await requireAuth()
  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const parsed = createPurchaseOrderInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const {
    supplierId,
    orderDate,
    expectedDeliveryDate,
    notes,
    transportCost = 0,
    otherCost = 0,
    otherCostNote,
    costAllocationMethod = 'VALUE',
    status,
    lines,
    advanceAmount,
    advancePaymentMethod,
    advanceBankAccountId,
    advanceChequeDate,
  } = parsed.data

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true },
  })
  if (!supplier) {
    return fail('Supplier not found')
  }

  // Transport and other landed costs are ignored at PO creation (belong strictly on receipt / GRN)
  const lineCalcs = lines.map(l => ({
    ...l,
    unitCost: round2(l.unitCost),
    total: round2(l.quantity * l.unitCost - (l.discount || 0)),
  }))

  const subtotal = round2(lineCalcs.reduce((s, l) => s + l.total, 0))
  const tax = 0 // NO TAX / VAT
  const total = subtotal
  const advance = round2(Math.max(0, advanceAmount || 0))
  const poDate = orderDate ? new Date(orderDate) : new Date()

  const effectivePoNotes = notes?.trim() || undefined

  if (advance > 0 && !advancePaymentMethod) {
    return fail('Advance payment method is required when advance amount is specified')
  }

  if (
    advance > 0 &&
    advancePaymentMethod !== PaymentMethod.CASH &&
    !advanceBankAccountId
  ) {
    return fail('Bank account is required for non-cash advance payment')
  }

  try {
    if (advance > 0 && advancePaymentMethod === PaymentMethod.CASH) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    return await prisma.$transaction(
      async tx => {
      const poNumber = await nextDocumentNumber(tx, 'purchase_order')

      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          outletId: user.outletId!,
          createdById: user.id,
          status,
          orderDate: poDate,
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
          advanceAmount: advance,
          advancePaymentMethod: advance > 0 ? advancePaymentMethod : null,
          advanceBankAccountId: advance > 0 ? advanceBankAccountId : null,
          advanceChequeDate: advanceChequeDate ? new Date(advanceChequeDate) : null,
          notes: effectivePoNotes,
          subtotal,
          tax: 0,
          total,
          lines: {
            create: lineCalcs.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              quantityReceived: 0,
              unitCost: l.unitCost,
              discount: l.discount || 0,
              total: l.total,
              note: l.note?.trim() || null,
            })),
          },
        },
      })

      // Update product selling price if specified in line items
      for (const l of lineCalcs) {
        if (l.sellingPrice && l.sellingPrice > 0) {
          await tx.product.update({
            where: { id: l.productId },
            data: { sellingPrice: l.sellingPrice },
          })
        }
      }

      // Handle Advance Payment if advance > 0
      if (advance > 0 && advancePaymentMethod) {
        // Lock Supplier first (under hierarchy Supplier -> BankAccount -> CashDrawer)
        await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

        if (advancePaymentMethod === PaymentMethod.CASH) {
          const openDrawer = await requireOpenDrawerForPurchase(tx, user.outletId)
          const stats = await tx.drawerTransaction.aggregate({
            where: { drawerId: openDrawer.id },
            _sum: { amount: true },
          })
          const cashBalance = Number(stats._sum.amount || 0)
          if (cashBalance < advance) {
            throw new Error(
              `Insufficient cash in drawer for advance payment. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${advance.toLocaleString()}`
            )
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.PURCHASE_PAYMENT,
              amount: -advance,
              description: `Advance Payment for PO ${po.poNumber}`,
              referenceId: po.id,
              referenceType: 'PurchaseOrder',
            },
          })
        } else if (advanceBankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${advanceBankAccountId} FOR UPDATE`
          const bank = await tx.bankAccount.findUnique({
            where: { id: advanceBankAccountId },
          })
          if (!bank) {
            throw new Error('Selected bank account for advance payment not found.')
          }
          if (Number(bank.currentBalance) < advance) {
            throw new Error(
              `Insufficient funds: Advance payment amount (৳${advance.toLocaleString()}) exceeds available bank balance (৳${Number(bank.currentBalance).toLocaleString()}).`
            )
          }
          await tx.bankAccount.update({
            where: { id: advanceBankAccountId },
            data: { currentBalance: { decrement: advance } },
          })

          await tx.bankTransaction.create({
            data: {
              bankAccountId: advanceBankAccountId,
              type: 'WITHDRAWAL',
              amount: advance,
              referenceId: po.id,
              referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
              description: `Advance Payment for PO ${po.poNumber}`,
              date: poDate,
            },
          })
        }

        await tx.purchasePayment.create({
          data: {
            purchaseOrderId: po.id,
            outletId: user.outletId,
            amount: advance,
            method: advancePaymentMethod,
            bankAccountId: advanceBankAccountId,
            paidAt: poDate,
            reference: `Advance payment for PO ${po.poNumber}`,
          },
        })

        // Supplier Ledger (Payment)
        await tx.supplierLedger.create({
          data: {
            supplierId,
            type: TransactionType.CREDIT,
            amount: advance,
            description: `Advance Payment for PO ${po.poNumber}`,
            referenceId: po.id,
            outletId: user.outletId!,
            purchaseOrderId: po.id,
            transactionType: 'PAYMENT',
            createdById: user.id,
          },
        })

        await tx.supplier.update({
          where: { id: supplierId },
          data: { outstandingBalance: { decrement: advance } },
        })

        // GL Posting: Dr 2100 Accounts Payable / Cr 1100 Cash or 1200 Bank
        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: ['2100', '1100', '1200'] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const apAccId = coaMap.get('2100')
        const cashAccId = coaMap.get('1100')
        const bankAccId = coaMap.get('1200')
        const payAccId = advancePaymentMethod === PaymentMethod.CASH ? cashAccId : bankAccId

        if (apAccId && payAccId) {
          const gl = [
            {
              accountId: apAccId,
              type: TransactionType.DEBIT,
              amount: advance,
              description: `Advance Payment for PO ${po.poNumber}`,
              referenceId: po.id,
              referenceType: 'PurchaseOrder',
              outletId: user.outletId!,
            },
            {
              accountId: payAccId,
              type: TransactionType.CREDIT,
              amount: advance,
              description: `Advance Payment for PO ${po.poNumber} (${advancePaymentMethod})`,
              referenceId: po.id,
              referenceType: 'PurchaseOrder',
              outletId: user.outletId!,
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({ data: gl })
        }
      }

      safeRevalidatePath('/purchases')
      return ok({
        success: true,
        poId: po.id,
        poNumber: po.poNumber,
      })
      },
      { timeout: 30000 }
    )
  } catch (error: any) {
    return fail(error.message || 'Failed to create purchase order')
  }
}

const receivePurchaseOrderItemsInputSchema = z
  .object({
    poId: z.string().min(1, 'Purchase Order ID is required'),
    supplierChallanNo: z.string().optional(),
    supplierNote: z.string().optional(),
    transportCost: z.coerce.number().min(0).default(0),
    otherCost: z.coerce.number().min(0).default(0),
    otherCostNote: z.string().optional(),
    costAllocationMethod: z.enum(['VALUE', 'QUANTITY']).default('VALUE'),
    freightPaymentMethod: z.nativeEnum(FreightPaymentMethod).optional(),
    freightBankAccountId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    lines: z
      .array(
        z.object({
          poLineId: z.string().min(1),
          quantityToReceive: z.number().int().min(1),
          serialNumbers: z.array(z.string()).optional(),
        })
      )
      .min(1, 'At least one item must be received')
      .refine(
        items => {
          const ids = items.map(i => i.poLineId)
          return new Set(ids).size === ids.length
        },
        { message: 'Duplicate PO line IDs in receive input are not allowed' }
      ),
  })
  .refine(
    data => {
      const totalFreight = (data.transportCost || 0) + (data.otherCost || 0)
      if (totalFreight > 0 && !data.freightPaymentMethod) {
        return false
      }
      return true
    },
    { message: 'Freight payment method is required when freight or other cost is greater than 0' }
  )
  .refine(
    data => {
      const totalFreight = (data.transportCost || 0) + (data.otherCost || 0)
      if (
        totalFreight > 0 &&
        data.freightPaymentMethod === FreightPaymentMethod.BANK &&
        !data.freightBankAccountId
      ) {
        return false
      }
      return true
    },
    { message: 'Bank account is required when freight payment method is BANK' }
  )

export type ReceivePurchaseOrderItemsInput = z.infer<typeof receivePurchaseOrderItemsInputSchema>

/**
 * 3. Step-by-Step Delivery Receiving (Partial & Full Receive)
 * - Strict row locking: PO then Supplier FOR UPDATE
 * - Idempotency: duplicate submission returns existing GRN
 * - Landed cost allocation via allocateLandedCosts (value-based with quantity fallback and penny reconciliation)
 * - Non-serialized lines: split fractional unit costs into up to 2 StockLayers
 * - Serialized lines: stamp individual costPrice onto SerialUnit
 * - Contract price immutability: PO line unitCost and header total are NEVER modified
 * - Invoices created as SENT / PARTIALLY_PAID / PAID (never DRAFT)
 * - Freight GL & payment handling: CASH_DRAWER (enforce open drawer), BANK (enforce balance), SUPPLIER_BILL
 * - Unapplied advances auto-applied FIFO to generated invoice via allocations
 * - Product.costPrice updated to weighted average of remaining StockLayers
 */
export async function receivePurchaseOrderItemsAction(rawInput: ReceivePurchaseOrderItemsInput) {
  let user
  try {
    user = await requireRole(
      UserRole.ACCOUNTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN
    )
  } catch (err: any) {
    return fail(err.message || 'Unauthorized')
  }
  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const parsed = receivePurchaseOrderItemsInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const {
    poId,
    supplierChallanNo,
    supplierNote,
    transportCost = 0,
    otherCost = 0,
    otherCostNote,
    costAllocationMethod = 'VALUE',
    freightPaymentMethod,
    freightBankAccountId,
    idempotencyKey,
    lines,
  } = parsed.data

  const cleanTransportCost = round2(Math.max(0, transportCost))
  const cleanOtherCost = round2(Math.max(0, otherCost))
  const totalFreight = round2(cleanTransportCost + cleanOtherCost)
  const receiveDate = new Date()

  try {
    if (totalFreight > 0 && freightPaymentMethod === FreightPaymentMethod.CASH_DRAWER) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    const result = await prisma.$transaction(
      async tx => {
        // 1. Lock PO row first (consistent locking order across subsystem)
        await tx.$executeRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`

        // Check idempotency under lock
        if (idempotencyKey) {
          const existingGrn = await tx.goodsReceivedNote.findUnique({
            where: { idempotencyKey },
            include: { purchaseInvoice: true },
          })
          if (existingGrn) {
            if (existingGrn.poId !== poId) {
              throw new Error(
                `Idempotency key "${idempotencyKey}" belongs to a different Purchase Order (${existingGrn.poId}).`
              )
            }
            const currentPo = await tx.purchaseOrder.findUnique({
              where: { id: poId },
              select: { status: true },
            })
            return {
              grnId: existingGrn.id,
              grnNumber: existingGrn.grnNumber,
              newPoStatus: currentPo?.status || PurchaseOrderStatus.RECEIVED,
              invoiceId: existingGrn.purchaseInvoiceId,
              invoiceNumber: existingGrn.purchaseInvoice?.invoiceNumber,
            }
          }
        }

        const po = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          include: {
            lines: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    requiresSerial: true,
                    category: { select: { name: true } },
                    parent: { select: { name: true } },
                  },
                },
              },
            },
            supplier: { select: { id: true, name: true } },
          },
        })
        if (!po) {
          throw new Error('Purchase Order not found')
        }

        if (po.status === PurchaseOrderStatus.CANCELLED) {
          throw new Error('Cannot receive items on a cancelled Purchase Order')
        }
        if (po.status === PurchaseOrderStatus.RECEIVED) {
          throw new Error('This Purchase Order has already been fully received')
        }

        // 2. Lock Supplier row and BankAccount row (if BANK freight) under strict hierarchy
        await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${po.supplierId} FOR UPDATE`

        if (totalFreight > 0 && freightPaymentMethod === FreightPaymentMethod.BANK && freightBankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${freightBankAccountId} FOR UPDATE`
        }

        const poLineMap = new Map(po.lines.map(l => [l.id, l]))

        // Validate quantities, serial numbers, and line existence
        const allSerials: string[] = []
        for (const inputLine of lines) {
          const poLine = poLineMap.get(inputLine.poLineId)
          if (!poLine) {
            throw new Error(`PO Line ${inputLine.poLineId} not found in this Purchase Order`)
          }

          const remainingQty = poLine.quantity - (poLine.quantityReceived || 0)
          if (inputLine.quantityToReceive > remainingQty) {
            throw new Error(
              `Cannot receive ${inputLine.quantityToReceive} units for "${poLine.product.name}". Remaining to receive: ${remainingQty}.`
            )
          }

          const lineNeedsSerial =
            Boolean(poLine.product.requiresSerial) &&
            !isGiftOrAccessoryProduct(poLine.product, poLine.note)

          if (lineNeedsSerial) {
            const serials = inputLine.serialNumbers?.map(s => s.trim()).filter(Boolean) ?? []
            if (serials.length !== inputLine.quantityToReceive) {
              throw new Error(
                `"${poLine.product.name}" requires serial numbers. Please provide exactly ${inputLine.quantityToReceive} serial(s). Got ${serials.length}.`
              )
            }
            const uniqueSerials = new Set(serials)
            if (uniqueSerials.size !== serials.length) {
              throw new Error(`"${poLine.product.name}" has duplicate serial numbers in input.`)
            }
            allSerials.push(...serials)
          }
        }

        if (allSerials.length > 0) {
          const existing = await tx.serialUnit.findMany({
            where: { serialNumber: { in: allSerials } },
            select: { serialNumber: true },
          })
          if (existing.length > 0) {
            const dupes = existing.map(s => s.serialNumber).join(', ')
            throw new Error(`Serial number(s) already exist in inventory: ${dupes}`)
          }
        }

        // Query prior GoodsReceivedNoteLine rows to compute already applied discounts for each poLine
        const poLineIds = lines.map(l => l.poLineId)
        const priorGrnLines = await tx.goodsReceivedNoteLine.findMany({
          where: { poLineId: { in: poLineIds } },
          select: { poLineId: true, discountApplied: true },
        })
        const appliedDiscountMap = new Map<string, number>()
        for (const pgl of priorGrnLines) {
          appliedDiscountMap.set(
            pgl.poLineId,
            round2((appliedDiscountMap.get(pgl.poLineId) || 0) + Number(pgl.discountApplied || 0))
          )
        }

        // 3. Landed Cost Allocation using pure landed-cost engine
        // Base cost is strictly taken from the PO line contract (poLine.unitCost)
        // Line discount is pro-rated according to quantity received, with remainder drift correction on final receipt
        const allocationInputs = lines.map(line => {
          const poLine = poLineMap.get(line.poLineId)!
          const lineDiscountTotal = Number(poLine.discount || 0)
          const alreadyApplied = appliedDiscountMap.get(line.poLineId) || 0
          const currentQtyReceived = poLine.quantityReceived || 0
          const isFinalReceipt = currentQtyReceived + line.quantityToReceive >= poLine.quantity

          let proRatedDiscount = 0
          if (isFinalReceipt) {
            proRatedDiscount = Math.max(0, round2(lineDiscountTotal - alreadyApplied))
          } else {
            proRatedDiscount =
              poLine.quantity > 0
                ? round2((lineDiscountTotal * line.quantityToReceive) / poLine.quantity)
                : 0
          }

          return {
            poLineId: line.poLineId,
            productId: poLine.productId,
            quantityToReceive: line.quantityToReceive,
            baseUnitCost: Number(poLine.unitCost),
            lineDiscount: proRatedDiscount,
          }
        })

        const landedResult = allocateLandedCosts(
          allocationInputs,
          totalFreight,
          costAllocationMethod as 'VALUE' | 'QUANTITY'
        )
        const lineAllocMap = new Map(landedResult.allocations.map(a => [a.poLineId, a]))

        // 4. Create GoodsReceivedNote
        const grnNumber = await nextDocumentNumber(tx, 'goods_received_note')
        const grn = await tx.goodsReceivedNote.create({
          data: {
            grnNumber,
            poId: po.id,
            outletId: user.outletId!,
            receivedById: user.id,
            receivedAt: receiveDate,
            supplierChallanNo: supplierChallanNo?.trim() || null,
            supplierNote: supplierNote?.trim() || null,
            transportCost: cleanTransportCost,
            otherCost: cleanOtherCost,
            otherCostNote: otherCostNote?.trim() || null,
            costAllocationMethod,
            freightPaymentMethod: totalFreight > 0 ? freightPaymentMethod : null,
            freightBankAccountId:
              totalFreight > 0 && freightPaymentMethod === FreightPaymentMethod.BANK
                ? freightBankAccountId
                : null,
            idempotencyKey: idempotencyKey || null,
          },
        })

        let batchTotalBase = 0

        // 5. Process lines: create GRN lines, increment quantityReceived, create StockLayers, SerialUnits, StockLedgers
        for (const inputLine of lines) {
          const poLine = poLineMap.get(inputLine.poLineId)!
          const alloc = lineAllocMap.get(inputLine.poLineId)!
          batchTotalBase = round2(batchTotalBase + alloc.lineNetBase)

          const grnLine = await tx.goodsReceivedNoteLine.create({
            data: {
              grnId: grn.id,
              poLineId: poLine.id,
              productId: poLine.productId,
              quantityReceived: inputLine.quantityToReceive,
              poUnitCost: poLine.unitCost,
              baseUnitCost: poLine.unitCost,
              freightAllocated: alloc.allocatedFreight,
              discountApplied: alloc.lineDiscount,
              unitCost: alloc.unitLandedCost, // landed cost
              serialNumbers: inputLine.serialNumbers || [],
            },
          })

          // Increment quantityReceived only (PO line unitCost & total are NEVER modified)
          await tx.purchaseOrderLine.update({
            where: { id: poLine.id },
            data: {
              quantityReceived: { increment: inputLine.quantityToReceive },
            },
          })

          const lineNeedsSerial =
            Boolean(poLine.product.requiresSerial) &&
            !isGiftOrAccessoryProduct(poLine.product, poLine.note)

          if (lineNeedsSerial && inputLine.serialNumbers && inputLine.serialNumbers.length > 0) {
            for (let u = 0; u < inputLine.serialNumbers.length; u++) {
              const sn = inputLine.serialNumbers[u].trim()
              const unitPrice = alloc.layerUnitCosts[u] ?? alloc.unitLandedCost

              const serial = await tx.serialUnit.create({
                data: {
                  serialNumber: sn,
                  productId: poLine.productId,
                  outletId: user.outletId!,
                  status: SerialStatus.IN_STOCK,
                  purchasedAt: receiveDate,
                  costPrice: unitPrice,
                  grnLineId: grnLine.id,
                  notes:
                    alloc.allocatedFreight > 0
                      ? `Received PO ${po.poNumber} (Base: ৳${alloc.baseUnitCost.toFixed(2)}, Landed Extra: ৳${alloc.unitExtraCost.toFixed(2)})`
                      : `Received PO ${po.poNumber}`,
                },
              })

              await tx.purchaseOrderLineSerial.create({
                data: {
                  poLineId: poLine.id,
                  serialUnitId: serial.id,
                },
              })

              await tx.stockLayer.create({
                data: {
                  productId: poLine.productId,
                  outletId: user.outletId!,
                  supplierId: po.supplierId,
                  purchaseOrderId: po.id,
                  grnLineId: grnLine.id,
                  quantityReceived: 1,
                  quantityRemaining: 1,
                  unitCost: unitPrice,
                  receivedAt: receiveDate,
                },
              })
            }
          } else {
            // Non-serialized: split fractional landed costs into up to 2 StockLayers with exact penny totals
            const layerSplits = getNonSerializedStockLayers(
              inputLine.quantityToReceive,
              alloc.lineLandedTotal
            )
            for (const split of layerSplits) {
              await tx.stockLayer.create({
                data: {
                  productId: poLine.productId,
                  outletId: user.outletId!,
                  supplierId: po.supplierId,
                  purchaseOrderId: po.id,
                  grnLineId: grnLine.id,
                  quantityReceived: split.quantity,
                  quantityRemaining: split.quantity,
                  unitCost: split.unitCost,
                  receivedAt: receiveDate,
                },
              })
            }
          }

          const stockLedgerNote =
            alloc.allocatedFreight > 0
              ? `Received PO ${po.poNumber} (${grn.grnNumber}) [Base: ৳${alloc.baseUnitCost.toFixed(2)}, Landed: ৳${alloc.unitLandedCost.toFixed(2)}]`
              : `Received PO ${po.poNumber} (${grn.grnNumber})`

          await tx.stockLedger.create({
            data: {
              productId: poLine.productId,
              outletId: user.outletId!,
              supplierId: po.supplierId,
              purchaseOrderId: po.id,
              movementType: StockMovementType.PURCHASE_IN,
              quantity: inputLine.quantityToReceive,
              referenceId: grn.id,
              referenceType: 'GoodsReceivedNote',
              notes: stockLedgerNote,
            },
          })
        }

        // 6. Update PO status
        const updatedPoLines = await tx.purchaseOrderLine.findMany({
          where: { poId: po.id },
          select: { quantity: true, quantityReceived: true },
        })
        const isFullyReceived = updatedPoLines.every(
          l => l.quantityReceived >= l.quantity
        )
        const newPoStatus = isFullyReceived
          ? PurchaseOrderStatus.RECEIVED
          : PurchaseOrderStatus.PARTIALLY_RECEIVED

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: newPoStatus },
        })

        // 7. Generate PurchaseInvoice
        // Invoicing Rule: goods only, unless freight is explicitly billed by the supplier (SUPPLIER_BILL)
        const isSupplierBillFreight =
          totalFreight > 0 && freightPaymentMethod === FreightPaymentMethod.SUPPLIER_BILL
        const invoiceTotal = isSupplierBillFreight
          ? round2(batchTotalBase + totalFreight)
          : batchTotalBase

        const invoiceNumber = await nextDocumentNumber(tx, 'purchase_invoice')
        const invoiceNotes =
          totalFreight > 0
            ? `Batch delivery for PO ${po.poNumber} (${grn.grnNumber}). Goods: ৳${batchTotalBase.toFixed(2)}, Freight: ৳${totalFreight.toFixed(2)} (${freightPaymentMethod})`
            : `Batch delivery for PO ${po.poNumber} (${grn.grnNumber})`

        const invoice = await tx.purchaseInvoice.create({
          data: {
            invoiceNumber,
            supplierId: po.supplierId,
            poId: po.id,
            subtotal: batchTotalBase,
            tax: 0,
            total: invoiceTotal,
            amountPaid: 0,
            status: InvoiceStatus.SENT, // NEVER DRAFT!
            notes: invoiceNotes,
            createdAt: receiveDate,
          },
        })

        await tx.goodsReceivedNote.update({
          where: { id: grn.id },
          data: { purchaseInvoiceId: invoice.id },
        })

        // 8. General Ledger Accounts Validation & Lookup
        const requiredCoaCodes = ['1400', '2100']
        if (totalFreight > 0) {
          if (freightPaymentMethod === FreightPaymentMethod.CASH_DRAWER) requiredCoaCodes.push('1100')
          if (freightPaymentMethod === FreightPaymentMethod.BANK) requiredCoaCodes.push('1200')
        }

        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: requiredCoaCodes } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))

        for (const code of requiredCoaCodes) {
          if (!coaMap.has(code)) {
            throw new Error(
              `Required Chart of Accounts account "${code}" not found. Cannot proceed with receipt.`
            )
          }
        }

        const invAccId = coaMap.get('1400')!
        const apAccId = coaMap.get('2100')!
        const cashAccId = coaMap.get('1100')
        const bankAccId = coaMap.get('1200')

        const glEntries: any[] = []

        // 8a. Goods GL: Dr 1400 Inventory / Cr 2100 Accounts Payable (for batchTotalBase)
        if (batchTotalBase > 0) {
          glEntries.push(
            {
              accountId: invAccId,
              type: TransactionType.DEBIT,
              amount: batchTotalBase,
              description: `Inventory for batch ${grn.grnNumber} (PO ${po.poNumber})`,
              referenceId: invoice.id,
              referenceType: 'PurchaseInvoice',
              outletId: user.outletId!,
            },
            {
              accountId: apAccId,
              type: TransactionType.CREDIT,
              amount: batchTotalBase,
              description: `Payable for invoice ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: 'PurchaseInvoice',
              outletId: user.outletId!,
            }
          )
        }

        // 8b. Freight GL & Payment handling (locks CashDrawer before invoice advance allocation)
        if (totalFreight > 0) {
          if (freightPaymentMethod === FreightPaymentMethod.CASH_DRAWER) {
            const openDrawer = await requireOpenDrawerForPurchase(tx, user.outletId)
            const stats = await tx.drawerTransaction.aggregate({
              where: { drawerId: openDrawer.id },
              _sum: { amount: true },
            })
            const cashBalance = Number(stats._sum.amount || 0)
            if (cashBalance < totalFreight) {
              throw new Error(
                `Insufficient cash in drawer for freight. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${totalFreight.toLocaleString()}`
              )
            }

            await tx.drawerTransaction.create({
              data: {
                drawerId: openDrawer.id,
                type: DRAWER_TX_TYPE.EXPENSE,
                amount: -totalFreight,
                description: `Freight for GRN ${grn.grnNumber} (PO ${po.poNumber})`,
                referenceId: grn.id,
                referenceType: 'GoodsReceivedNote',
              },
            })

            glEntries.push(
              {
                accountId: invAccId,
                type: TransactionType.DEBIT,
                amount: totalFreight,
                description: `Landed freight for ${grn.grnNumber}`,
                referenceId: grn.id,
                referenceType: 'GoodsReceivedNote',
                outletId: user.outletId!,
              },
              {
                accountId: cashAccId!,
                type: TransactionType.CREDIT,
                amount: totalFreight,
                description: `Cash freight payment for ${grn.grnNumber}`,
                referenceId: grn.id,
                referenceType: 'GoodsReceivedNote',
                outletId: user.outletId!,
              }
            )
          } else if (freightPaymentMethod === FreightPaymentMethod.BANK) {
            const bankAccount = await tx.bankAccount.findUnique({
              where: { id: freightBankAccountId },
            })
            if (!bankAccount) {
              throw new Error('Selected bank account for freight not found.')
            }
            if (Number(bankAccount.currentBalance) < totalFreight) {
              throw new Error(
                `Insufficient funds in bank account for freight. Available: ৳${Number(bankAccount.currentBalance).toLocaleString()}, Required: ৳${totalFreight.toLocaleString()}`
              )
            }

            await tx.bankAccount.update({
              where: { id: freightBankAccountId },
              data: { currentBalance: { decrement: totalFreight } },
            })

            await tx.bankTransaction.create({
              data: {
                bankAccountId: freightBankAccountId!,
                type: 'WITHDRAWAL',
                amount: totalFreight,
                description: `Freight for GRN ${grn.grnNumber} (PO ${po.poNumber})`,
                referenceId: grn.id,
                referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
                date: receiveDate,
              },
            })

            glEntries.push(
              {
                accountId: invAccId,
                type: TransactionType.DEBIT,
                amount: totalFreight,
                description: `Landed freight for ${grn.grnNumber}`,
                referenceId: grn.id,
                referenceType: 'GoodsReceivedNote',
                outletId: user.outletId!,
              },
              {
                accountId: bankAccId!,
                type: TransactionType.CREDIT,
                amount: totalFreight,
                description: `Bank freight payment for ${grn.grnNumber}`,
                referenceId: grn.id,
                referenceType: 'GoodsReceivedNote',
                outletId: user.outletId!,
              }
            )
          } else if (freightPaymentMethod === FreightPaymentMethod.SUPPLIER_BILL) {
            glEntries.push(
              {
                accountId: invAccId,
                type: TransactionType.DEBIT,
                amount: totalFreight,
                description: `Landed freight on supplier invoice ${invoice.invoiceNumber}`,
                referenceId: invoice.id,
                referenceType: 'PurchaseInvoice',
                outletId: user.outletId!,
              },
              {
                accountId: apAccId,
                type: TransactionType.CREDIT,
                amount: totalFreight,
                description: `Freight payable to supplier on ${invoice.invoiceNumber}`,
                referenceId: invoice.id,
                referenceType: 'PurchaseInvoice',
                outletId: user.outletId!,
              }
            )
          }
        }

        if (glEntries.length > 0) {
          assertBalancedJournal(glEntries)
          await tx.accountLedgerEntry.createMany({ data: glEntries })
        }

        // 8c. Supplier Ledger & Outstanding Balance update
        const supplierPayableIncrease = isSupplierBillFreight
          ? round2(batchTotalBase + totalFreight)
          : batchTotalBase

        if (supplierPayableIncrease > 0) {
          await tx.supplierLedger.create({
            data: {
              supplierId: po.supplierId,
              type: TransactionType.DEBIT,
              amount: supplierPayableIncrease,
              description: `Batch delivery invoice ${invoice.invoiceNumber} for PO ${po.poNumber}`,
              referenceId: invoice.id,
              invoiceId: invoice.id,
              outletId: user.outletId!,
              purchaseOrderId: po.id,
              transactionType: 'INVOICE_CREATED',
              createdById: user.id,
            },
          })

          await tx.supplier.update({
            where: { id: po.supplierId },
            data: { outstandingBalance: { increment: supplierPayableIncrease } },
          })
        }

        // 9. Auto-apply unapplied advances from this PO (oldest active payment first; locks PurchaseInvoice via applyInvoicePayment)
        const poPayments = await tx.purchasePayment.findMany({
          where: { purchaseOrderId: po.id, cancelledAt: null },
          include: { allocations: true },
          orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        })

        let remainingInvoiceToCover = invoiceTotal
        for (const p of poPayments) {
          if (remainingInvoiceToCover <= 0) break
          const allocatedSum = p.allocations.reduce((s, a) => s + Number(a.amount), 0)
          const unappliedAdvance = round2(Number(p.amount) - allocatedSum)

          if (unappliedAdvance > 0) {
            const toApply = Math.min(remainingInvoiceToCover, unappliedAdvance)
            await tx.purchasePaymentAllocation.create({
              data: {
                paymentId: p.id,
                invoiceId: invoice.id,
                amount: toApply,
              },
            })

            await applyInvoicePayment(tx, {
              invoiceId: invoice.id,
              deltaAmountPaid: toApply,
            })

            remainingInvoiceToCover = round2(remainingInvoiceToCover - toApply)
          }
        }

        // 10. Update product master costPrice to weighted average of remaining StockLayers
        // ARCHITECTURAL DESIGN NOTE:
        // Product.costPrice is maintained as the global, company-wide moving weighted average
        // carrying cost across all active StockLayers (all outlets). Product is a centralized catalog
        // model without an outlet foreign key. Valuation reports, product lists, and fallback COGS
        // for non-serialized stock require a unified business-wide inventory replacement cost.
        // Outlet-specific valuations and FIFO consumption are handled strictly via StockLayer.outletId.
        const distinctProductIds = Array.from(
          new Set(lines.map(l => poLineMap.get(l.poLineId)!.productId))
        )
        for (const productId of distinctProductIds) {
          const activeLayers = await tx.stockLayer.findMany({
            where: { productId, quantityRemaining: { gt: 0 } },
            select: { quantityRemaining: true, unitCost: true },
          })
          const totalRemainingQty = activeLayers.reduce((s, l) => s + l.quantityRemaining, 0)
          if (totalRemainingQty > 0) {
            const totalRemainingValue = activeLayers.reduce(
              (s, l) => s + l.quantityRemaining * Number(l.unitCost),
              0
            )
            const weightedAvgCost = round2(totalRemainingValue / totalRemainingQty)
            await tx.product.update({
              where: { id: productId },
              data: { costPrice: weightedAvgCost },
            })
          }
        }

        return {
          grnId: grn.id,
          grnNumber: grn.grnNumber,
          newPoStatus,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        }
      },
      { timeout: 45000 }
    )

    safeRevalidatePath('/purchases')
    safeRevalidatePath(`/purchases/${poId}`)
    safeRevalidatePath('/purchases/invoices')

    return ok({
      success: true,
      ...result,
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to receive purchase order items')
  }
}

const payAgainstPurchaseOrderInputSchema = z.object({
  poId: z.string().min(1, 'Purchase Order ID is required'),
  amount: z.number().positive('Payment amount must be greater than zero'),
  method: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
})

export type PayAgainstPurchaseOrderInput = z.infer<typeof payAgainstPurchaseOrderInputSchema>

/**
 * 4. Pay Against Purchase Order
 * - Capped at remaining commitment under lock: sum(unpaid invoices) + sum(unreceived lines at base cost) - unapplied advances
 * - Cash: enforces open cash drawer with sufficient funds (throws if closed/insufficient)
 * - Bank: enforces bank account with sufficient funds under lock
 * - Distributes payment to open invoices on this PO (oldest invoice first) via PurchasePaymentAllocation and applyInvoicePayment
 * - Posts balanced GL: Dr 2100 AP / Cr Cash/Bank
 */
export async function payAgainstPurchaseOrderAction(rawInput: PayAgainstPurchaseOrderInput) {
  let user
  try {
    user = await requireRole(
      UserRole.ACCOUNTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN
    )
  } catch (err: any) {
    return fail(err.message || 'Unauthorized')
  }
  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const parsed = payAgainstPurchaseOrderInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const { poId, amount, method, bankAccountId, reference } = parsed.data

  if (method !== PaymentMethod.CASH && !bankAccountId) {
    return fail('Bank account is required for electronic payments')
  }

  const paymentDate = new Date()

  try {
    if (method === PaymentMethod.CASH) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    const result = await prisma.$transaction(
      async tx => {
        // 1. Strict lock hierarchy: PurchaseOrder -> Supplier -> BankAccount -> CashDrawer -> PurchaseInvoice
        await tx.$executeRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`

        const po = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          include: {
            lines: {
              include: {
                grnLines: { select: { discountApplied: true } },
              },
            },
            purchaseInvoices: true,
            payments: { where: { cancelledAt: null }, include: { allocations: true } },
            supplier: { select: { id: true, name: true } },
          },
        })
        if (!po) {
          throw new Error('Purchase Order not found')
        }

        await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${po.supplierId} FOR UPDATE`

        if (bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
        }

        // 2. Compute remaining commitment on the PO under lock with fresh invoice & payment states
        // Note: PurchaseReturns already reduce PurchaseInvoice.total via applyInvoicePayment, so we do NOT
        // subtract totalReturned a second time. Summing signed (inv.total - inv.amountPaid) also ensures any
        // store credit on an already-paid invoice from an AP_REDUCTION return offsets remainingDue.
        const freshInvoices = await tx.purchaseInvoice.findMany({
          where: { poId },
          select: { id: true, total: true, amountPaid: true, status: true },
        })

        const freshPayments = await tx.purchasePayment.findMany({
          where: { purchaseOrderId: poId, cancelledAt: null },
          include: { allocations: true },
        })

        const unpaidInvoiceDue = freshInvoices.reduce((s, inv) => {
          return s + round2(Number(inv.total) - Number(inv.amountPaid))
        }, 0)

        const unreceivedGoodsDue = po.lines.reduce((s, line: any) => {
          const remQty = Math.max(0, line.quantity - (line.quantityReceived || 0))
          if (remQty <= 0) return s
          const lineDiscountTotal = Number(line.discount || 0)
          const alreadyApplied = (line.grnLines || []).reduce(
            (sum: number, gl: any) => sum + Number(gl.discountApplied || 0),
            0
          )
          const remDiscount = Math.max(0, round2(lineDiscountTotal - alreadyApplied))
          const remGross = round2(remQty * Number(line.unitCost))
          const remNet = Math.max(0, round2(remGross - remDiscount))
          return s + remNet
        }, 0)

        const unappliedAdvances = freshPayments.reduce((s, p) => {
          const allocSum = p.allocations.reduce((as, a) => as + Number(a.amount), 0)
          return s + Math.max(0, round2(Number(p.amount) - allocSum))
        }, 0)

        const remainingDue = round2(
          Math.max(0, unpaidInvoiceDue + unreceivedGoodsDue - unappliedAdvances)
        )

        if (amount > remainingDue) {
          throw new Error(
            `Payment amount (৳${amount.toLocaleString()}) exceeds remaining PO due (৳${remainingDue.toLocaleString()}).`
          )
        }

        // 3. Balance checks & deductions (locks CashDrawer before invoice allocation)
        if (method === PaymentMethod.CASH) {
          const openDrawer = await requireOpenDrawerForPurchase(tx, user.outletId)
          const stats = await tx.drawerTransaction.aggregate({
            where: { drawerId: openDrawer.id },
            _sum: { amount: true },
          })
          const cashBalance = Number(stats._sum.amount || 0)
          if (cashBalance < amount) {
            throw new Error(
              `Insufficient cash in drawer. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${amount.toLocaleString()}`
            )
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.PURCHASE_PAYMENT,
              amount: -amount,
              description: `Payment for PO ${po.poNumber}`,
              referenceId: po.id,
              referenceType: 'PurchaseOrder',
            },
          })
        } else if (bankAccountId) {
          const bank = await tx.bankAccount.findUnique({
            where: { id: bankAccountId },
          })
          if (!bank) {
            throw new Error('Selected bank account not found.')
          }
          if (Number(bank.currentBalance) < amount) {
            throw new Error(
              `Insufficient funds: Transaction amount (৳${amount.toLocaleString()}) exceeds available bank balance (৳${Number(bank.currentBalance).toLocaleString()}).`
            )
          }
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: { decrement: amount } },
          })
          await tx.bankTransaction.create({
            data: {
              bankAccountId,
              type: 'WITHDRAWAL',
              amount,
              referenceId: po.id,
              referenceType: BANK_TX_REF_TYPE.PURCHASE_INVOICE,
              description: `Payment against PO ${po.poNumber}`,
              date: paymentDate,
            },
          })
        }

        // 4. Create PurchasePayment
        const payment = await tx.purchasePayment.create({
          data: {
            purchaseOrderId: po.id,
            outletId: po.outletId,
            amount,
            method,
            bankAccountId: method === PaymentMethod.CASH ? null : bankAccountId,
            reference: reference || `Payment against PO ${po.poNumber}`,
            paidAt: paymentDate,
          },
        })

        // 5. Distribute payment to open invoices on this PO (oldest first; locks PurchaseInvoice via applyInvoicePayment)
        const openInvoices = await tx.purchaseInvoice.findMany({
          where: {
            poId: po.id,
            status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })

        let remainingToAllocate = amount
        for (const inv of openInvoices) {
          if (remainingToAllocate <= 0) break
          const invDue = round2(Number(inv.total) - Number(inv.amountPaid))
          if (invDue > 0) {
            const toAlloc = Math.min(invDue, remainingToAllocate)
            await tx.purchasePaymentAllocation.create({
              data: {
                paymentId: payment.id,
                invoiceId: inv.id,
                amount: toAlloc,
              },
            })
            await applyInvoicePayment(tx, {
              invoiceId: inv.id,
              deltaAmountPaid: toAlloc,
            })
            remainingToAllocate = round2(remainingToAllocate - toAlloc)
          }
        }

        // 6. Update Supplier Ledger & Outstanding Balance
        await tx.supplierLedger.create({
          data: {
            supplierId: po.supplierId,
            type: TransactionType.CREDIT,
            amount,
            description: `Payment against PO ${po.poNumber} (${method})`,
            referenceId: po.id,
            outletId: user.outletId!,
            purchaseOrderId: po.id,
            transactionType: 'PAYMENT',
            createdById: user.id,
          },
        })

        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { outstandingBalance: { decrement: amount } },
        })

        // 7. Double-Entry General Ledger: Dr 2100 AP / Cr 1100 Cash or 1200 Bank
        const payAccCode = method === PaymentMethod.CASH ? '1100' : '1200'
        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: ['2100', payAccCode] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const apAccId = coaMap.get('2100')
        const payAccId = coaMap.get(payAccCode)

        if (!apAccId || !payAccId) {
          throw new Error(
            `Required Chart of Accounts (2100 or ${payAccCode}) not found. Please configure them before recording payments.`
          )
        }

        const gl = [
          {
            accountId: apAccId,
            type: TransactionType.DEBIT,
            amount,
            description: `Payment against PO ${po.poNumber}`,
            referenceId: po.id,
            referenceType: 'PurchaseOrder',
            outletId: user.outletId!,
          },
          {
            accountId: payAccId,
            type: TransactionType.CREDIT,
            amount,
            description: `Payment against PO ${po.poNumber} (${method})`,
            referenceId: po.id,
            referenceType: 'PurchaseOrder',
            outletId: user.outletId!,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })

        return { paymentId: payment.id, amount }
      },
      { timeout: 35000 }
    )

    safeRevalidatePath('/purchases')
    safeRevalidatePath(`/purchases/${poId}`)
    return ok({ success: true, ...result })
  } catch (error: any) {
    return fail(error.message || 'Failed to record payment against purchase order')
  }
}

/**
 * Cancel a PurchasePayment, unrolling all invoice allocations and reverting supplier and GL accounts.
 * - Strict global lock hierarchy: PurchaseOrder -> Supplier -> BankAccount -> PurchaseInvoice
 * - Checks that CASH payments have an open cash drawer (throws if closed, no GL posted)
 * - Includes feeAmount in reversal (returns fee to Bank/Cash and credits fee expense)
 * - Marks payment as cancelled (does NOT hard-delete) with cancelledAt and cancelledById
 * - Guards against double-cancel
 */
export async function cancelPurchasePaymentAction(rawPaymentId: string) {
  let user
  try {
    user = await requireRole(
      UserRole.ACCOUNTANT,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN
    )
  } catch (err: any) {
    return fail(err.message || 'Unauthorized')
  }
  try {
    if (user.outletId) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    const result = await prisma.$transaction(
      async tx => {
        // Read payment metadata
        const locked = await tx.$queryRaw<{
          id: string
          outletId: string | null
          invoiceId: string | null
          purchaseOrderId: string | null
          amount: any
          feeAmount: any
          method: PaymentMethod
          bankAccountId: string | null
          cancelledAt: Date | null
        }[]>`
          SELECT id, "outletId", "invoiceId", "purchaseOrderId", amount, "feeAmount", method, "bankAccountId", "cancelledAt"
          FROM "PurchasePayment"
          WHERE id = ${rawPaymentId}
          FOR UPDATE
        `
        if (!locked || locked.length === 0) {
          throw new Error(`PurchasePayment with ID "${rawPaymentId}" not found`)
        }
        const payment = locked[0]

        // Double-cancel guard
        if (payment.cancelledAt) {
          throw new Error('Payment has already been cancelled')
        }

        const paymentAmount = round2(Number(payment.amount))
        const feeAmount = round2(Number(payment.feeAmount || 0))
        const totalReversal = round2(paymentAmount + feeAmount)

        // Resolve PO, Supplier, and Outlet IDs for hierarchy locking and outlet access check
        let poId = payment.purchaseOrderId
        let supplierId: string | null = null
        let paymentOutletId: string | null = payment.outletId ?? null

        if (poId) {
          const po = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            select: { id: true, supplierId: true, outletId: true },
          })
          supplierId = po?.supplierId || null
          if (!paymentOutletId) paymentOutletId = po?.outletId || null
        } else if (payment.invoiceId) {
          const inv = await tx.purchaseInvoice.findUnique({
            where: { id: payment.invoiceId },
            select: { id: true, poId: true, supplierId: true, po: { select: { outletId: true } } },
          })
          if (inv?.poId) poId = inv.poId
          supplierId = inv?.supplierId || null
          if (!paymentOutletId) paymentOutletId = inv?.po?.outletId || null
        }

        if (
          user.role !== UserRole.SUPER_ADMIN &&
          (!paymentOutletId || user.outletId !== paymentOutletId)
        ) {
          throw new Error('Forbidden: You do not have permission to cancel payments for another outlet')
        }

        // 1. Lock PurchaseOrder (if any)
        if (poId) {
          await tx.$executeRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`
        }

        // 2. Lock Supplier (if any)
        if (supplierId) {
          await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
        }

        // 3. Lock BankAccount (if any)
        if (payment.bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
        }

        // 4. Handle Cash Drawer or Bank Account refunds (locks CashDrawer before unrolling invoice allocations)
        if (payment.method === PaymentMethod.CASH) {
          if (!user.outletId) {
            throw new Error('User is not assigned to an outlet')
          }
          const drawer = await requireOpenDrawerForPurchase(tx, user.outletId)
          await tx.drawerTransaction.create({
            data: {
              drawerId: drawer.id,
              type: DRAWER_TX_TYPE.CASH_IN,
              amount: totalReversal,
              description: `Reversal for cancelled payment ${payment.id}`,
            },
          })
        } else if (payment.bankAccountId) {
          await tx.bankAccount.update({
            where: { id: payment.bankAccountId },
            data: { currentBalance: { increment: totalReversal } },
          })
          await tx.bankTransaction.create({
            data: {
              bankAccountId: payment.bankAccountId,
              type: 'DEPOSIT',
              amount: totalReversal,
              description: `Reversal for cancelled payment ${payment.id}`,
              referenceType: 'PurchasePaymentCancellation',
            },
          })
        }

        // 5. Unroll invoice allocations via applyInvoicePayment (locks PurchaseInvoice after CashDrawer)
        const allocations = await tx.purchasePaymentAllocation.findMany({
          where: { paymentId: payment.id },
        })

        for (const alloc of allocations) {
          await applyInvoicePayment(tx, {
            invoiceId: alloc.invoiceId,
            deltaAmountPaid: -round2(Number(alloc.amount)),
          })
          await tx.purchasePaymentAllocation.delete({ where: { id: alloc.id } })
        }

        if (payment.invoiceId && allocations.length === 0) {
          await applyInvoicePayment(tx, {
            invoiceId: payment.invoiceId,
            deltaAmountPaid: -paymentAmount,
          })
        }

        // 6. Update Supplier balance and ledger
        if (supplierId) {
          await tx.supplier.update({
            where: { id: supplierId },
            data: { outstandingBalance: { increment: paymentAmount } },
          })
          await tx.supplierLedger.create({
            data: {
              supplierId,
              type: TransactionType.DEBIT,
              amount: paymentAmount,
              description: `Reversal for cancelled payment ${payment.id}`,
              method: payment.method,
              bankAccountId: payment.bankAccountId,
              transactionType: 'PAYMENT_CANCELLED',
              createdById: user.id,
              outletId: user.outletId || undefined,
            },
          })
        }

        // 7. General Ledger Reversal: Dr Cash (1100) / Bank (1200), Cr Accounts Payable (2100)
        // plus fee reversal if feeAmount > 0 (mirroring recordPurchasePayment: 5290 MFS Charges or 5291 Bank Charges)
        const payAccCode = payment.method === PaymentMethod.CASH ? '1100' : '1200'
        const neededCoaCodes = ['2100', payAccCode]
        if (feeAmount > 0) neededCoaCodes.push('5290', '5291')

        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: neededCoaCodes } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const apAccId = coaMap.get('2100')
        const payAccId = coaMap.get(payAccCode)
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')

        if (!apAccId || !payAccId) {
          throw new Error(
            `Required Chart of Accounts (2100 or ${payAccCode}) not found for payment cancellation.`
          )
        }

        if (feeAmount > 0 && !feeAccId) {
          throw new Error(
            'Required Chart of Accounts fee account (5290 MFS Charges or 5291 Bank Charges) not found for fee reversal.'
          )
        }

        const gl: any[] = [
          {
            accountId: payAccId,
            type: TransactionType.DEBIT,
            amount: paymentAmount,
            description: `Reversal of payment ${payment.id} (${payment.method})`,
            referenceId: payment.id,
            referenceType: 'PurchasePaymentCancellation',
            outletId: user.outletId || undefined,
          },
          {
            accountId: apAccId,
            type: TransactionType.CREDIT,
            amount: paymentAmount,
            description: `Reversal of payment ${payment.id}`,
            referenceId: payment.id,
            referenceType: 'PurchasePaymentCancellation',
            outletId: user.outletId || undefined,
          },
        ]

        if (feeAmount > 0 && feeAccId) {
          gl.push(
            {
              accountId: payAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `Reversal of payment fee ${payment.id}`,
              referenceId: payment.id,
              referenceType: 'PurchasePaymentCancellation',
              outletId: user.outletId || undefined,
            },
            {
              accountId: feeAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `Reversal of payment fee ${payment.id}`,
              referenceId: payment.id,
              referenceType: 'PurchasePaymentCancellation',
              outletId: user.outletId || undefined,
            }
          )
        }

        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })

        // 8. Mark payment as cancelled (SOFT CANCEL - never hard-delete)
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: {
            cancelledAt: new Date(),
            cancelledById: user.id,
          },
        })

        return { paymentId: payment.id, amount: paymentAmount, feeAmount }
      },
      { timeout: 35000 }
    )

    safeRevalidatePath('/purchases')
    safeRevalidatePath('/purchases/invoices')
    return ok({ success: true, ...result })
  } catch (error: any) {
    return fail(error.message || 'Failed to cancel purchase payment')
  }
}


const updatePurchaseInvoiceFullInputSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  supplierBillRef: z.string().optional(),
  notes: z.string().optional(),
  discount: z.number().min(0).default(0),
  extraCost: z.number().min(0).default(0),
  extraCostDescription: z.string().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().optional(),
        productId: z.string(),
        quantity: z.number().int().min(1),
        unitCost: z.number().min(0),
        discount: z.number().min(0).optional().default(0),
        note: z.string().optional(),
      })
    )
    .optional(),
})

export type UpdatePurchaseInvoiceFullInput = z.infer<typeof updatePurchaseInvoiceFullInputSchema>

/**
 * 5. Update Purchase Invoice (6-Section Wizard) with Safety Guard
 * - Blocks edits if any linked stock was already sold or consumed!
 */
export async function updatePurchaseInvoiceFullAction(rawInput: UpdatePurchaseInvoiceFullInput) {
  const user = await requireAuth()
  if (!user.outletId) {
    return fail('User is not assigned to an outlet')
  }

  const parsed = updatePurchaseInvoiceFullInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message)
  }

  const { invoiceId, invoiceDate, dueDate, notes, discount, extraCost, lines } = parsed.data

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      po: true,
      supplier: true,
    },
  })
  if (!invoice) {
    return fail('Purchase Invoice not found')
  }

  // PRE-FLIGHT INVOICE EDIT SAFETY GUARD:
  // If invoice has a linked PO, inspect StockLayers to verify stock hasn't been consumed in sales
  if (invoice.poId) {
    const stockLayers = await prisma.stockLayer.findMany({
      where: { purchaseOrderId: invoice.poId },
    })

    const hasConsumedStock = stockLayers.some(
      l => l.quantityRemaining < l.quantityReceived
    )
    if (hasConsumedStock) {
      return fail(
        'Invoice cannot be edited: stock from this purchase has already been sold or consumed in sales.'
      )
    }

    const serials = await prisma.serialUnit.findMany({
      where: {
        poLineSerials: { some: { poLine: { poId: invoice.poId } } },
        status: { not: SerialStatus.IN_STOCK },
      },
      select: { serialNumber: true, status: true },
    })
    if (serials.length > 0) {
      const soldSerials = serials.map(s => `${s.serialNumber} (${s.status})`).join(', ')
      return fail(
        `Invoice cannot be edited: serialized units have already moved or been sold: ${soldSerials}`
      )
    }
  }

  return prisma.$transaction(async tx => {
    let currentSubtotal = Number(invoice.subtotal)

    if (lines && lines.length > 0 && invoice.poId) {
      currentSubtotal = round2(
        lines.reduce((acc, l) => acc + (l.quantity * l.unitCost - (l.discount || 0)), 0)
      )

      await tx.purchaseOrder.update({
        where: { id: invoice.poId },
        data: { subtotal: currentSubtotal, total: currentSubtotal },
      })

      for (const line of lines) {
        const lineTotal = round2(line.quantity * line.unitCost - (line.discount || 0))
        if (line.id) {
          const prevPoLine = await tx.purchaseOrderLine.findUnique({
            where: { id: line.id },
          })
          if (prevPoLine) {
            await tx.purchaseOrderLine.update({
              where: { id: line.id },
              data: {
                quantity: line.quantity,
                unitCost: line.unitCost,
                discount: line.discount || 0,
                total: lineTotal,
                note: line.note,
                quantityReceived: line.quantity,
              },
            })

            await tx.stockLayer.updateMany({
              where: {
                purchaseOrderId: invoice.poId,
                productId: line.productId,
                quantityRemaining: prevPoLine.quantity,
              },
              data: {
                unitCost: line.unitCost,
                quantityReceived: line.quantity,
                quantityRemaining: line.quantity,
              },
            })

            await tx.product.update({
              where: { id: line.productId },
              data: { costPrice: line.unitCost },
            })
          }
        } else {
          await tx.purchaseOrderLine.create({
            data: {
              poId: invoice.poId,
              productId: line.productId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              discount: line.discount || 0,
              total: lineTotal,
              note: line.note,
              quantityReceived: line.quantity,
            },
          })

          await tx.stockLayer.create({
            data: {
              purchaseOrderId: invoice.poId,
              productId: line.productId,
              outletId: user.outletId!,
              quantityReceived: line.quantity,
              quantityRemaining: line.quantity,
              unitCost: line.unitCost,
            },
          })

          await tx.stockLedger.create({
            data: {
              productId: line.productId,
              outletId: user.outletId!,
              movementType: StockMovementType.PURCHASE_IN,
              quantity: line.quantity,
              costPerUnit: line.unitCost,
              referenceType: 'PurchaseOrder',
              referenceId: invoice.poId,
              notes: `Added item via Purchase Invoice ${invoice.invoiceNumber} Edit`,
              createdById: user.id,
            },
          })

          await tx.product.update({
            where: { id: line.productId },
            data: { costPrice: line.unitCost },
          })
        }
      }
    }

    const newTotal = round2(currentSubtotal - discount + extraCost)
    const diff = round2(newTotal - Number(invoice.total))

    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        subtotal: currentSubtotal,
        total: newTotal,
        notes: notes ?? invoice.notes,
        dueDate: dueDate ? new Date(dueDate) : invoice.dueDate,
        createdAt: invoiceDate ? new Date(invoiceDate) : invoice.createdAt,
      },
    })

    // If total changed, adjust supplier balance and ledger
    if (diff !== 0) {
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${invoice.supplierId} FOR UPDATE`
      await tx.supplier.update({
        where: { id: invoice.supplierId },
        data: { outstandingBalance: { increment: diff } },
      })

      await tx.supplierLedger.create({
        data: {
          supplierId: invoice.supplierId,
          type: diff > 0 ? TransactionType.DEBIT : TransactionType.CREDIT,
          amount: Math.abs(diff),
          description: `Adjustment for Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          invoiceId: invoice.id,
          outletId: user.outletId!,
          transactionType: 'INVOICE_ADJUSTMENT',
          createdById: user.id,
        },
      })

      // Adjust GL: Dr 1400 Inventory (or 5200 Expense) / Cr 2100 AP
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1400', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccId = coaMap.get('1400')
      const apAccId = coaMap.get('2100')

      if (invAccId && apAccId) {
        const gl = [
          {
            accountId: invAccId,
            type: diff > 0 ? TransactionType.DEBIT : TransactionType.CREDIT,
            amount: Math.abs(diff),
            description: `Invoice ${invoice.invoiceNumber} adjustment`,
            referenceId: invoice.id,
            referenceType: 'PurchaseInvoice',
            outletId: user.outletId!,
          },
          {
            accountId: apAccId,
            type: diff > 0 ? TransactionType.CREDIT : TransactionType.DEBIT,
            amount: Math.abs(diff),
            description: `Invoice ${invoice.invoiceNumber} payable adjustment`,
            referenceId: invoice.id,
            referenceType: 'PurchaseInvoice',
            outletId: user.outletId!,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })
      }
    }

    safeRevalidatePath('/purchases/invoices')
    safeRevalidatePath(`/purchases/invoices/${invoice.id}`)
    return ok({ success: true, invoiceId: invoice.id, newTotal })
  })
}

/**
 * 6. Helper: Get POs with Delivery & Payment Status for UI
 */
export async function getPurchaseOrdersOverview(outletId?: string) {
  const user = await requireAuth()
  const effectiveOutletId = outletId || user.outletId
  if (!effectiveOutletId) return []

  const pos = await prisma.purchaseOrder.findMany({
    where: { outletId: effectiveOutletId },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              requiresSerial: true,
              sku: true,
              category: { select: { name: true } },
              parent: { select: { name: true } },
            },
          },
        },
      },
      payments: {
        select: { id: true, amount: true, method: true, paidAt: true },
      },
      purchaseInvoices: {
        select: { id: true, invoiceNumber: true, total: true, amountPaid: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return pos.map(po => {
    const totalAmount = Number(po.total)
    // Sum unique payments on PO or linked invoices
    const poPayments = po.payments.reduce((s, p) => s + Number(p.amount), 0)
    const invoicePayments = po.purchaseInvoices.reduce(
      (s, inv) => s + Number(inv.amountPaid),
      0
    )
    const totalPaid = Math.max(poPayments, invoicePayments)
    const totalDue = round2(Math.max(0, totalAmount - totalPaid))

    const isFullyReceived =
      po.lines.length > 0 &&
      po.lines.every(l => (l.quantityReceived || 0) >= l.quantity)
    const isPartiallyReceived =
      !isFullyReceived && po.lines.some(l => (l.quantityReceived || 0) > 0)

    const deliveryStatus = isFullyReceived
      ? 'Received'
      : isPartiallyReceived
        ? 'Partially Received'
        : 'Pending'

    const paymentStatus =
      totalPaid >= totalAmount ? 'Paid' : totalPaid > 0 ? 'Partially Paid' : 'Unpaid'

    return {
      id: po.id,
      poNumber: po.poNumber,
      orderDate: po.orderDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name || 'Unknown',
      supplierPhone: po.supplier?.phone,
      totalAmount,
      totalPaid,
      totalDue,
      deliveryStatus,
      paymentStatus,
      rawStatus: po.status,
      advanceAmount: Number(po.advanceAmount || 0),
      linesCount: po.lines.length,
      lines: po.lines.map(l => ({
        id: l.id,
        productId: l.productId,
        productName: l.product?.name || '',
        sku: l.product?.sku || '',
        note: l.note,
        requiresSerial:
          (l.product?.requiresSerial || false) &&
          !isGiftOrAccessoryProduct(l.product, l.note),
        quantity: l.quantity,
        quantityReceived: l.quantityReceived || 0,
        remainingQty: Math.max(0, l.quantity - (l.quantityReceived || 0)),
        unitCost: Number(l.unitCost),
        total: Number(l.total),
      })),
    }
  })
}

/**
 * 7. Helper: Get complete initial dataset for Purchase Terminal
 */
export async function getPurchaseTerminalData() {
  const user = await requireAuth()
  if (!user.outletId) return null

  const [products, suppliers, bankAccounts, categories] = await Promise.all([
    prisma.product.findMany({
      where: { outletId: user.outletId, isActive: true },
      select: {
        id: true,
        name: true,
        productCode: true,
        sku: true,
        barcode: true,
        condition: true,
        requiresSerial: true,
        costPrice: true,
        sellingPrice: true,
        category: { select: { id: true, name: true } },
        processor: { select: { name: true } },
        processorGen: { select: { name: true } },
        ram: { select: { name: true } },
        storage: { select: { name: true } },
        _count: {
          select: {
            serialUnits: { where: { status: SerialStatus.IN_STOCK } },
          },
        },
        stockLayers: {
          where: { outletId: user.outletId },
          select: { quantityRemaining: true },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.supplier.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        outstandingBalance: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.bankAccount.findMany({
      where: { outletId: user.outletId, isActive: true },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        currentBalance: true,
      },
      orderBy: { bankName: 'asc' },
    }),
    prisma.category.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const mappedProducts = products.map(p => {
    const isGiftOrAcc = isGiftOrAccessoryProduct(p)
    const effectiveRequiresSerial = isGiftOrAcc ? false : p.requiresSerial
    const layerStock = p.stockLayers.reduce((s, l) => s + l.quantityRemaining, 0)
    const stock = effectiveRequiresSerial ? p._count.serialUnits : layerStock

    return {
      id: p.id,
      name: p.name,
      productCode: p.productCode,
      sku: p.sku,
      barcode: p.barcode,
      condition: p.condition,
      requiresSerial: effectiveRequiresSerial,
      costPrice: Number(p.costPrice),
      sellingPrice: Number(p.sellingPrice),
      stock,
      category: p.category,
      processor: p.processor,
      processorGen: p.processorGen,
      ram: p.ram,
      storage: p.storage,
    }
  })

  return {
    products: mappedProducts,
    suppliers: suppliers.map(s => ({
      ...s,
      outstandingBalance: Number(s.outstandingBalance || 0),
    })),
    bankAccounts: bankAccounts.map(b => ({
      id: b.id,
      name: `${b.bankName} - ${b.accountName}`,
      accountNumber: b.accountNumber,
      currentBalance: Number(b.currentBalance || 0),
    })),
    categories: categories.map(c => c.name),
  }
}


