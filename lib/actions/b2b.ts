'use server'

import { requireAuth, requireRole, requireSensitiveRole } from '@/lib/actions/auth-guard'
import { consumeStockLayers } from '@/lib/inventory/stock-layers'
import { checkAndNotifyLowStock } from '@/lib/notifications/triggers/low-stock'
import { logAuditDirect } from '@/lib/audit/logger'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { PaymentMethod, TransactionType, UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { fail, ok } from './result'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'
import { nextDocumentNumber } from '@/lib/numbering/next-document-number'
import { assertBalancedJournal } from '@/lib/accounting/journal'

/**
 * Get all suppliers with B2B client information
 */
export async function getB2BClients(params?: {
  search?: string
  status?: string
  page?: number
  limit?: number
}) {
  await requireAuth()

  return withDatabaseReadFallback(
    async () => {
      const page = params?.page && params.page > 0 ? params.page : undefined
      const limit = params?.limit && params.limit > 0 ? params.limit : undefined
      const skip = page && limit ? (page - 1) * limit : undefined

      const where = {
        ...(params?.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' as const } },
                { email: { contains: params.search, mode: 'insensitive' as const } },
                { phone: { contains: params.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      }

      const suppliers = await prisma.supplier.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          country: true,
          outstandingBalance: true,
          createdAt: true,
          updatedAt: true,
          linkedCustomer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              outstandingBalance: true,
            },
          },
          _count: {
            select: {
              purchaseOrders: true,
              ledgerEntries: true,
              notes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(skip !== undefined ? { skip } : {}),
        ...(limit !== undefined ? { take: limit } : {}),
      })

      const supplierIds = suppliers.map(s => s.id)

      // Fetch last activities in bulk (3 queries instead of N*3)
      const [lastPOs, lastLedgers, lastNotes] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where: { supplierId: { in: supplierIds } },
          select: { supplierId: true, orderDate: true, status: true },
          orderBy: { orderDate: 'desc' },
        }),
        prisma.supplierLedger.findMany({
          where: { supplierId: { in: supplierIds } },
          select: { supplierId: true, createdAt: true, type: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.supplierNote.findMany({
          where: { supplierId: { in: supplierIds } },
          select: { supplierId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      // Build a map of supplierId → last activity
      const lastActivityMap = new Map<
        string,
        { date: Date; type: string; detail?: string }
      >()

      for (const po of lastPOs) {
        if (
          !lastActivityMap.has(po.supplierId) ||
          po.orderDate > lastActivityMap.get(po.supplierId)!.date
        ) {
          lastActivityMap.set(po.supplierId, {
            date: po.orderDate,
            type: 'PURCHASE_ORDER',
            detail: po.status,
          })
        }
      }
      for (const le of lastLedgers) {
        const existing = lastActivityMap.get(le.supplierId)
        if (!existing || le.createdAt > existing.date) {
          lastActivityMap.set(le.supplierId, {
            date: le.createdAt,
            type: 'LEDGER_TRANSACTION',
          })
        }
      }
      for (const note of lastNotes) {
        const existing = lastActivityMap.get(note.supplierId)
        if (!existing || note.createdAt > existing.date) {
          lastActivityMap.set(note.supplierId, {
            date: note.createdAt,
            type: 'NOTE',
          })
        }
      }

      return suppliers.map(s => {
        const grossAp = Number(s.outstandingBalance || 0)
        const grossAr = s.linkedCustomer ? Number(s.linkedCustomer.outstandingBalance || 0) : 0
        const netBalance = grossAr - grossAp

        return {
          ...s,
          outstandingBalance: grossAp,
          grossApBalance: grossAp,
          grossArBalance: grossAr,
          netBalance,
          isB2BLinked: Boolean(s.linkedCustomer),
          linkedCustomer: s.linkedCustomer
            ? {
                ...s.linkedCustomer,
                outstandingBalance: Number(s.linkedCustomer.outstandingBalance || 0),
              }
            : null,
          lastActivity: lastActivityMap.get(s.id) ?? null,
        }
      })
    },
    [],
    'getB2BClients'
  )
}

export async function getB2BClientsPaginated(params?: {
  search?: string
  status?: string
  page?: number
  limit?: number
}) {
  await requireAuth()
  const page = Math.max(1, params?.page ?? 1)
  const limit = Math.max(1, params?.limit ?? 15)

  const where = {
    ...(params?.search
      ? {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' as const } },
            { email: { contains: params.search, mode: 'insensitive' as const } },
            { phone: { contains: params.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [clients, total] = await Promise.all([
    getB2BClients({ ...params, page, limit }),
    prisma.supplier.count({ where }),
  ])

  return {
    clients,
    total,
    totalPages: Math.ceil(total / limit),
    page,
    limit,
  }
}

/**
 * Get detailed supplier profile with all transactions and products
 */
export async function getSupplierProfile(supplierId: string) {
  const user = await requireAuth()

  // Fetch supplier and outlet data in parallel
  const [supplier, outlet] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        linkedCustomer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            outstandingBalance: true,
          },
        },
        _count: {
          select: {
            purchaseOrders: true,
            ledgerEntries: true,
            notes: true,
          },
        },
      },
    }),
    user.outletId
      ? prisma.outlet.findUnique({ where: { id: user.outletId } })
      : null,
  ])

  if (!supplier) return null

  const grossAp = Number(supplier.outstandingBalance || 0)
  const grossAr = supplier.linkedCustomer ? Number(supplier.linkedCustomer.outstandingBalance || 0) : 0
  const netBalance = grossAr - grossAp

  const _supplierData = {
    ...supplier,
    outstandingBalance: grossAp,
    grossApBalance: grossAp,
    grossArBalance: grossAr,
    netBalance,
    isB2BLinked: Boolean(supplier.linkedCustomer),
    linkedCustomer: supplier.linkedCustomer
      ? {
          ...supplier.linkedCustomer,
          outstandingBalance: Number(supplier.linkedCustomer.outstandingBalance || 0),
        }
      : null,
  }

  // Get all purchase orders
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { supplierId },
    include: {
      outlet: {
        select: { name: true },
      },
      createdBy: {
        select: { name: true },
      },
      lines: {
        include: {
          product: {
            select: { name: true },
          },
        },
      },
      _count: {
        select: { lines: true },
      },
    },
    orderBy: { orderDate: 'desc' },
  })

  // Get all ledger entries (transaction history)
  const ledgerEntries = await prisma.supplierLedger.findMany({
    where: { supplierId },
    include: {
      bankAccount: { select: { bankName: true, accountName: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Get all notes
  const notes = await prisma.supplierNote.findMany({
    where: { supplierId },
    orderBy: { createdAt: 'desc' },
  })

  // Get purchase invoices
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { supplierId },
    include: {
      payments: {
        orderBy: { paidAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Get purchase returns
  const returns = await prisma.purchaseReturn.findMany({
    where: { supplierId },
    include: {
      lines: {
        include: {
          product: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Map unified transactions from supplier ledger entries
  const supplierTransactions = ledgerEntries.map(entry => ({
    id: entry.id,
    supplierId: entry.supplierId,
    type: entry.transactionType || entry.type,
    amount: Number(entry.amount),
    method: entry.method,
    bankAccountId: entry.bankAccountId,
    bankAccount: entry.bankAccount,
    feeAmount: Number(entry.feeAmount || 0),
    reference: entry.reference,
    description: entry.description,
    invoiceId: entry.invoiceId,
    purchaseOrderId: entry.purchaseOrderId,
    purchaseReturnId: entry.purchaseReturnId,
    outletId: entry.outletId,
    createdById: entry.createdById || '',
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
  }))

  // Get all serial numbers supplied by this supplier
  const serialsRaw = await prisma.purchaseOrderLineSerial.findMany({
    where: {
      poLine: {
        po: {
          supplierId,
        },
      },
    },
    include: {
      serialUnit: true,
      poLine: {
        include: {
          product: { select: { name: true, sku: true } },
          po: { select: { poNumber: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const serialUnits = serialsRaw.map(s => ({
    id: s.serialUnit.id,
    serialNumber: s.serialUnit.serialNumber,
    productName: s.poLine.product.name,
    sku: s.poLine.product.sku,
    poNumber: s.poLine.po.poNumber,
    status: s.serialUnit.status,
    warrantyEnds: s.serialUnit.warrantyExpiry,
    costPrice: Number(s.poLine.unitCost || 0),
    receivedAt: s.createdAt,
  }))

  const bankAccountsRaw = await prisma.bankAccount.findMany({
    where: { isActive: true },
    select: { id: true, bankName: true, accountName: true, accountNumber: true },
  })

  // Get products supplied (unique products from all purchase orders)
  const productsSupplied = await prisma.purchaseOrderLine.findMany({
    where: {
      po: {
        supplierId,
      },
    },
    select: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          category: {
            select: { name: true },
          },
        },
      },
      quantity: true,
      unitCost: true,
    },
    distinct: ['productId'],
    orderBy: {
      product: {
        name: 'asc',
      },
    },
  })

  // Calculate statistics
  const totalPurchaseValue = purchaseOrders.reduce(
    (sum, po) => sum + Number(po.total),
    0
  )

  const totalPaymentsMade = supplierTransactions
    .filter(t => t.type.includes('PAYMENT'))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0)

  const completedOrders = purchaseOrders.filter(
    po => po.status === 'RECEIVED'
  ).length

  const pendingOrders = purchaseOrders.filter(
    po => po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED'
  ).length

  // Normalize all events into unified activity feed
  const activities = normalizeActivities(
    supplierId,
    purchaseOrders,
    invoices,
    returns,
    ledgerEntries,
    notes
  )

  return {
    outlet: outlet
      ? {
          id: outlet.id,
          name: outlet.name,
          slogan: outlet.slogan ?? null,
          address: outlet.address ?? null,
          phone: outlet.phone ?? null,
          email: outlet.email ?? null,
          logo: outlet.logo ?? null,
          openTime: outlet.openTime ?? null,
          closeTime: outlet.closeTime ?? null,
        }
      : null,
    supplier: _supplierData,
    purchaseOrders: purchaseOrders.map(po => ({
      ...po,
      subtotal: Number(po.subtotal),
      tax: Number(po.tax),
      total: Number(po.total),
    })),
    invoices: invoices.map(inv => ({
      ...inv,
      subtotal: Number(inv.subtotal),
      tax: Number(inv.tax),
      total: Number(inv.total),
      amountPaid: Number(inv.amountPaid),
      payments: inv.payments.map(p => ({
        ...p,
        amount: Number(p.amount),
      })),
    })),
    returns: returns.map(ret => ({
      ...ret,
      total: Number(ret.total),
      lines: ret.lines.map(line => ({
        ...line,
        unitCost: Number(line.unitCost),
        total: Number(line.unitCost) * line.quantity,
      })),
    })),
    ledgerEntries: ledgerEntries.map(entry => ({
      ...entry,
      amount: Number(entry.amount),
    })),
    notes,
    productsSupplied: productsSupplied.map(ps => ({
      product: ps.product,
      lastQuantity: ps.quantity,
      lastUnitCost: Number(ps.unitCost),
    })),
    supplierTransactions: supplierTransactions.map(t => ({
      ...t,
      amount: Number(t.amount || 0),
      feeAmount: Number(t.feeAmount || 0),
    })),
    serialUnits,
    bankAccounts: bankAccountsRaw,
    activities,
    statistics: {
      totalPurchaseValue,
      totalPaymentsMade,
      completedOrders,
      pendingOrders,
      totalOrders: purchaseOrders.length,
      totalProducts: productsSupplied.length,
      totalSerials: serialUnits.length,
      totalInvoices: invoices.length,
      totalReturns: returns.length,
    },
  }
}

/**
 * Normalize all supplier events into a unified activity feed
 */
function normalizeActivities(
  supplierId: string,
  purchaseOrders: any[],
  invoices: any[],
  returns: any[],
  ledgerEntries: any[],
  notes: any[]
): any[] {
  const activities: any[] = []

  // Purchase Orders
  for (const po of purchaseOrders) {
    activities.push({
      id: `po-${po.id}`,
      type: 'PURCHASE_ORDER_CREATED',
      timestamp: po.orderDate,
      title: 'Purchase Order Created',
      description: `PO #${po.poNumber} created with ${po._count.lines} items`,
      amount: Number(po.total),
      status: po.status,
      actor: po.createdBy?.name,
      metadata: { poNumber: po.poNumber, poId: po.id },
      details: {
        items: po.lines?.map((line: any) => ({
          name: line.product?.name || 'Unknown',
          quantity: line.quantity,
          unitCost: Number(line.unitCost),
          total: Number(line.total),
        })),
      },
    })

    // Status transitions
    if (po.status === 'RECEIVED' && po.updatedAt > po.orderDate) {
      activities.push({
        id: `po-received-${po.id}`,
        type: 'PURCHASE_ORDER_RECEIVED',
        timestamp: po.updatedAt,
        title: 'Purchase Order Received',
        description: `PO #${po.poNumber} marked as received`,
        amount: Number(po.total),
        status: 'RECEIVED',
        metadata: { poNumber: po.poNumber, poId: po.id },
      })
    }

    if (po.status === 'CANCELLED') {
      activities.push({
        id: `po-cancelled-${po.id}`,
        type: 'PURCHASE_ORDER_CANCELLED',
        timestamp: po.updatedAt,
        title: 'Purchase Order Cancelled',
        description: `PO #${po.poNumber} was cancelled`,
        amount: Number(po.total),
        status: 'CANCELLED',
        metadata: { poNumber: po.poNumber, poId: po.id },
      })
    }
  }

  // Invoices
  for (const invoice of invoices) {
    activities.push({
      id: `invoice-${invoice.id}`,
      type: 'INVOICE_CREATED',
      timestamp: invoice.createdAt,
      title: 'Invoice Created',
      description: `Invoice #${invoice.invoiceNumber} created`,
      amount: Number(invoice.total),
      status: invoice.status,
      metadata: { invoiceNumber: invoice.invoiceNumber, invoiceId: invoice.id },
      details: {
        payments: invoice.payments?.map((p: any) => ({
          amount: Number(p.amount),
          method: p.method,
          date: p.paidAt,
          reference: p.reference,
        })),
      },
    })

    if (invoice.status === 'PAID') {
      activities.push({
        id: `invoice-paid-${invoice.id}`,
        type: 'INVOICE_PAID',
        timestamp: invoice.updatedAt,
        title: 'Invoice Paid',
        description: `Invoice #${invoice.invoiceNumber} fully paid`,
        amount: Number(invoice.total),
        status: 'PAID',
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          invoiceId: invoice.id,
        },
      })
    }

    if (invoice.status === 'PARTIALLY_PAID') {
      activities.push({
        id: `invoice-partial-${invoice.id}`,
        type: 'INVOICE_PARTIALLY_PAID',
        timestamp: invoice.updatedAt,
        title: 'Invoice Partially Paid',
        description: `Invoice #${invoice.invoiceNumber}: ৳${Number(invoice.amountPaid).toLocaleString()} of ৳${Number(invoice.total).toLocaleString()} paid`,
        amount: Number(invoice.amountPaid),
        status: 'PARTIALLY_PAID',
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          invoiceId: invoice.id,
        },
      })
    }

    if (invoice.status === 'OVERDUE') {
      activities.push({
        id: `invoice-overdue-${invoice.id}`,
        type: 'INVOICE_OVERDUE',
        timestamp: invoice.updatedAt,
        title: 'Invoice Overdue',
        description: `Invoice #${invoice.invoiceNumber} is overdue`,
        amount: Number(invoice.total),
        status: 'OVERDUE',
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          invoiceId: invoice.id,
        },
      })
    }
  }

  // Returns
  for (const ret of returns) {
    activities.push({
      id: `return-${ret.id}`,
      type: 'RETURN_CREATED',
      timestamp: ret.createdAt,
      title: 'Purchase Return Created',
      description: `Return #${ret.returnNumber} created`,
      amount: Number(ret.total),
      status: 'RETURNED',
      metadata: { returnNumber: ret.returnNumber, returnId: ret.id },
      details: {
        items: ret.lines?.map((line: any) => ({
          name: line.product?.name || 'Unknown',
          quantity: line.quantity,
          unitCost: Number(line.unitCost),
          total: Number(line.total),
        })),
      },
    })
  }

  // Ledger Entries
  for (const entry of ledgerEntries) {
    const isDebit = entry.type === 'DEBIT'
    activities.push({
      id: `ledger-${entry.id}`,
      type: isDebit ? 'LEDGER_DEBIT' : 'LEDGER_CREDIT',
      timestamp: entry.createdAt,
      title: isDebit ? 'Debit Entry' : 'Credit Entry',
      description:
        entry.description ||
        (isDebit
          ? 'Amount owed to supplier'
          : 'Payment received from supplier'),
      amount: Number(entry.amount),
      status: entry.type,
      metadata: { ledgerId: entry.id, referenceId: entry.referenceId },
    })
  }

  // Notes
  for (const note of notes) {
    activities.push({
      id: `note-${note.id}`,
      type: 'NOTE_ADDED',
      timestamp: note.createdAt,
      title: 'Note Added',
      description: note.note,
      metadata: { noteId: note.id },
    })
  }

  // Sort by timestamp descending (newest first)
  return activities.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  )
}

/**
 * Get supplier purchase order details
 */
export async function getSupplierPurchaseOrder(poId: string) {
  await requireAuth()

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: true,
      outlet: {
        select: { name: true },
      },
      createdBy: {
        select: { name: true, email: true },
      },
      approvedBy: {
        select: { name: true },
      },
      sentBy: {
        select: { name: true },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              category: {
                select: { name: true },
              },
            },
          },
          serialUnits: {
            include: {
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
    },
  })

  if (!po) return null

  return {
    ...po,
    subtotal: Number(po.subtotal),
    tax: Number(po.tax),
    total: Number(po.total),
    supplier: {
      ...po.supplier,
      outstandingBalance: Number(po.supplier.outstandingBalance),
    },
    lines: po.lines.map(line => ({
      ...line,
      unitCost: Number(line.unitCost),
      discount: Number(line.discount),
      total: Number(line.total),
    })),
  }
}

/**
 * Sell products to a B2B client (supplier)
 * This creates a ledger entry and optionally adjusts stock
 */
const sellToSupplierSchema = z.object({
  supplierId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  serialNumbers: z.array(z.string()).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional().default('CREDIT'),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function sellProductToSupplier(
  data: z.infer<typeof sellToSupplierSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = sellToSupplierSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const {
    supplierId,
    productId,
    quantity,
    unitPrice,
    serialNumbers,
    paymentMethod,
    bankAccountId,
    reference,
    notes,
  } = parsed.data

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  })
  if (!supplier) return fail('Supplier not found')

  // Verify product exists and check stock/serials
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      name: true,
      sku: true,
      costPrice: true,
      requiresSerial: true,
      outletId: true,
    },
  })
  if (!product) return fail('Product not found')

  // Validate payment reference for non-cash/non-credit payments
  if (
    paymentMethod !== 'CASH' &&
    paymentMethod !== 'CREDIT' &&
    !reference?.trim()
  ) {
    return fail(
      `Payment reference is required for ${paymentMethod} payments. Please provide a transaction ID, cheque number, or other reference.`
    )
  }

  if (product.requiresSerial) {
    const provided = serialNumbers?.filter(Boolean) ?? []
    if (provided.length !== quantity) {
      return fail(`Please provide exactly ${quantity} serial number(s)`)
    }
    // Verify serials exist and are in stock
    const existingSerials = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: provided }, status: 'IN_STOCK', productId },
      select: { serialNumber: true },
    })
    if (existingSerials.length !== provided.length) {
      return fail(
        'One or more serial numbers not found or not in stock for this product'
      )
    }
  }

  const totalAmount = unitPrice * quantity
  const outletId = user.outletId || product.outletId

  try {
    const result = await prisma.$transaction(async tx => {
      // Row locking on Supplier & Product to serialize concurrent transactions
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`
      if (bankAccountId) {
        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      let feeAmount = 0
      // If payment received, handle drawer / bank
      if (paymentMethod && paymentMethod !== 'CREDIT') {
        if (paymentMethod === 'CASH') {
          const openDrawer = await ensureOpenDrawer(tx, outletId)
          if (!openDrawer) {
            throw new Error(
              'No open cash drawer found. Please open a drawer first.'
            )
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.B2B_SALE,
              amount: totalAmount,
              description: `Sale to supplier: ${supplier.name} - ${product.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_SALE,
            },
          })
        } else if (bankAccountId) {
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: bankAccountId },
          })
          if (!bankAccount) throw new Error('Bank account not found')
          if (
            bankAccount.isMfs &&
            bankAccount.transactionChargePct.toNumber() > 0
          ) {
            feeAmount = Number(
              (
                (totalAmount * bankAccount.transactionChargePct.toNumber()) /
                100
              ).toFixed(2)
            )
          }
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'DEPOSIT',
              amount: totalAmount,
              description: `Sale to supplier: ${supplier.name} - ${product.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_SALE,
            },
          })
          if (feeAmount > 0) {
            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankAccount.id,
                type: 'WITHDRAWAL',
                amount: feeAmount,
                description: `MFS/Bank Fee — Sale to supplier: ${supplier.name}`,
                referenceType: BANK_TX_REF_TYPE.B2B_SALE,
              },
            })
          }
          await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: { currentBalance: { increment: Number((totalAmount - feeAmount).toFixed(2)) } },
          })
        }
      }

      // Snapshot Supplier previousDue and newBalance
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
      const supplierForSnap = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: {
          outstandingBalance: true,
          linkedCustomer: { select: { id: true, outstandingBalance: true } },
        },
      })

      if (supplierForSnap?.linkedCustomer) {
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${supplierForSnap.linkedCustomer.id} FOR UPDATE`
      }

      const supAp = Number(supplierForSnap?.outstandingBalance || 0)
      const custAr = supplierForSnap?.linkedCustomer ? Number(supplierForSnap.linkedCustomer.outstandingBalance || 0) : 0

      let prevDueVal: number
      let newBalVal: number

      if (supplierForSnap?.linkedCustomer) {
        prevDueVal = custAr - supAp
        const creditAmt = paymentMethod === 'CREDIT' ? totalAmount : 0
        newBalVal = prevDueVal + creditAmt
      } else {
        prevDueVal = supAp
        const creditAmt = paymentMethod === 'CREDIT' ? totalAmount : 0
        newBalVal = prevDueVal - creditAmt
      }

      // Generate sale invoice number
      const invoiceNumber = await nextDocumentNumber(tx, 'b2b_sale_invoice')

      // Create Sale Invoice
      const saleInvoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'SALE',
          supplierId,
          status: paymentMethod === 'CREDIT' ? 'SENT' : 'PAID',
          subtotal: totalAmount,
          tax: 0,
          total: totalAmount,
          amountPaid: paymentMethod !== 'CREDIT' ? totalAmount : 0,
          previousDue: prevDueVal,
          newBalance: newBalVal,
          notes: notes || null,
        },
      })

      // Create ledger entry for the sale
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.CREDIT,
          amount: totalAmount,
          description: `Sold ${quantity}x ${product.name} (SKU: ${product.sku}) @ ৳${unitPrice} each`,
          referenceId: `SELL-${Date.now()}`,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          transactionType: 'SALE',
          createdById: user.id,
          invoiceId: saleInvoice.id,
          outletId: outletId || null,
        },
      })
      const ledgerEntry = transaction

      // Update receivable/payable balance ONLY for credit sales
      if (paymentMethod === 'CREDIT') {
        if (supplierForSnap?.linkedCustomer) {
          await tx.customer.update({
            where: { id: supplierForSnap.linkedCustomer.id },
            data: {
              outstandingBalance: {
                increment: totalAmount,
              },
            },
          })
          await tx.customerLedger.create({
            data: {
              customerId: supplierForSnap.linkedCustomer.id,
              type: TransactionType.DEBIT,
              amount: totalAmount,
              description: `B2B Credit Sale (${invoiceNumber}): ${quantity}x ${product.name}`,
              referenceId: saleInvoice.id,
            },
          })
        } else {
          await tx.supplier.update({
            where: { id: supplierId },
            data: {
              outstandingBalance: {
                decrement: totalAmount,
              },
            },
          })
        }
      }

      // Update stock (outgoing)
      if (product.requiresSerial && serialNumbers) {
        const serials = serialNumbers.filter(Boolean)
        await tx.serialUnit.updateMany({
          where: { serialNumber: { in: serials }, productId },
          data: { status: 'SOLD', soldAt: new Date() },
        })
      }

      const consumedBatches = await consumeStockLayers(tx, {
        productId,
        outletId: outletId || product.outletId,
        quantityNeeded: quantity,
        allowSyntheticLayer: false,
      })

      const cogsAmount = consumedBatches.reduce(
        (sum, b) => sum + b.quantityConsumed * Number(b.unitCost),
        0
      )

      await tx.stockLedger.create({
        data: {
          productId,
          outletId: outletId || product.outletId,
          movementType: 'SALE_OUT',
          quantity: -quantity,
          referenceId: transaction.id,
          referenceType: 'SUPPLIER_SALE',
          notes: `Sold ${quantity}x ${product.name} to ${supplier.name}`,
        },
      })

      // Double-Entry General Ledger Postings for B2B Sale:
      // Dr Cash (1100) / Bank (1200) / Accounts Receivable (1300): Total Sale Amount
      // Cr Sales Revenue (4000): Total Sale Amount
      // Dr COGS (5000): Cost basis of consumed inventory
      // Cr Inventory Asset (1400): Cost basis of consumed inventory
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '1300', '1400', '4000', '5000', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const revenueAccId = coaMap.get('4000')
      const invAccId = coaMap.get('1400')
      const cogsAccId = coaMap.get('5000')
      const assetAccId =
        paymentMethod === 'CASH'
          ? coaMap.get('1100')
          : paymentMethod === 'CREDIT'
          ? coaMap.get('1300')
          : coaMap.get('1200')

      if (!revenueAccId) throw new Error('Sales Revenue account (4000) not found in Chart of Accounts')
      if (!invAccId) throw new Error('Inventory Asset account (1400) not found in Chart of Accounts')
      if (!cogsAccId) throw new Error('COGS account (5000) not found in Chart of Accounts')
      if (!assetAccId) {
        throw new Error(`Asset account for ${paymentMethod} not found in Chart of Accounts`)
      }

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = [
        {
          accountId: assetAccId,
          type: TransactionType.DEBIT,
          amount: totalAmount,
          description: `B2B Sale to ${supplier.name} - ${product.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SALE',
          createdAt: effectiveDate,
        },
        {
          accountId: revenueAccId,
          type: TransactionType.CREDIT,
          amount: totalAmount,
          description: `B2B Sale to ${supplier.name} - ${product.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SALE',
          createdAt: effectiveDate,
        },
      ]

      if (cogsAmount > 0) {
        gl.push(
          {
            accountId: cogsAccId,
            type: TransactionType.DEBIT,
            amount: cogsAmount,
            description: `COGS for B2B Sale to ${supplier.name} - ${product.name}`,
            referenceId: transaction.id,
            referenceType: 'B2B_SALE',
            createdAt: effectiveDate,
          },
          {
            accountId: invAccId,
            type: TransactionType.CREDIT,
            amount: cogsAmount,
            description: `Inventory deduction for B2B Sale to ${supplier.name} - ${product.name}`,
            referenceId: transaction.id,
            referenceType: 'B2B_SALE',
            createdAt: effectiveDate,
          }
        )
      }

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        if (feeAccId && assetAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS/Bank Fee for B2B Sale to ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SALE',
              createdAt: effectiveDate,
            },
            {
              accountId: assetAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS/Bank Fee for B2B Sale to ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SALE',
              createdAt: effectiveDate,
            }
          )
        }
      }

      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({ data: gl })

      return { ledgerEntry, transaction }
    })

    if (notes) {
      await prisma.supplierNote.create({
        data: {
          supplierId,
          note: `Sale: ${notes}`,
        },
      })
    }

    await logAuditDirect(user.id, 'SUPPLIER_SALE', 'Supplier', supplierId, {
      amount: totalAmount,
      productId,
      quantity,
      unitPrice,
      paymentMethod,
      supplierName: supplier.name,
      transactionId: result.transaction.id,
    })

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)

    // INV-007: Trigger low-stock notifications after B2B sale stock reduction
    const targetOutletId = user.outletId || product.outletId
    if (targetOutletId) {
      checkAndNotifyLowStock([productId], targetOutletId).catch(err => {
        console.error('[sellProductToSupplier] Low stock notification check failed:', err)
      })
    }

    return ok({
      message: `Successfully sold ${quantity}x ${product.name} to ${supplier.name}`,
      amount: totalAmount,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error selling to supplier:', error)
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error.message || 'Failed to process sale transaction')
  }
}

/**
 * Record a purchase from a B2B client (supplier)
 * This creates a quick purchase ledger entry
 */
const purchaseFromSupplierSchema = z.object({
  supplierId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
  serialNumbers: z.array(z.string()).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional().default('CREDIT'),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function recordPurchaseFromSupplier(
  data: z.infer<typeof purchaseFromSupplierSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = purchaseFromSupplierSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const {
    supplierId,
    productId,
    quantity,
    unitCost,
    serialNumbers,
    paymentMethod,
    bankAccountId,
    reference,
    notes,
  } = parsed.data

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  })
  if (!supplier) return fail('Supplier not found')

  // Verify product exists
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      name: true,
      sku: true,
      requiresSerial: true,
      outletId: true,
      sellingPrice: true,
    },
  })
  if (!product) return fail('Product not found')

  if (product.requiresSerial) {
    const provided = serialNumbers?.filter(Boolean) ?? []
    if (provided.length !== quantity) {
      return fail(`Please provide exactly ${quantity} serial number(s)`)
    }
    // Check uniqueness within this request
    const uniqueSerials = new Set(provided)
    if (uniqueSerials.size !== provided.length) {
      return fail('Serial numbers must be unique')
    }
    // Check they don't already exist for this product
    const existingSerials = await prisma.serialUnit.findMany({
      where: { serialNumber: { in: provided }, productId },
      select: { serialNumber: true },
    })
    if (existingSerials.length > 0) {
      return fail(
        `Serial number(s) already exist: ${existingSerials.map(s => s.serialNumber).join(', ')}`
      )
    }
  }

  const totalAmount = unitCost * quantity
  const outletId = user.outletId || product.outletId

  try {
    const result = await prisma.$transaction(async tx => {
      // Row locking on Supplier & Product to serialize concurrent transactions
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`
      if (bankAccountId) {
        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      let feeAmount = 0
      // If payment made, handle drawer / bank
      if (paymentMethod && paymentMethod !== 'CREDIT') {
        if (paymentMethod === 'CASH') {
          const openDrawer = await ensureOpenDrawer(tx, outletId)
          if (!openDrawer) {
            throw new Error(
              'No open cash drawer found. Please open a drawer first.'
            )
          }
          // Check sufficient cash before deducting
          const purchaseStats = await tx.drawerTransaction.aggregate({
            where: { drawerId: openDrawer.id },
            _sum: { amount: true },
          })
          const purchaseCashBalance = Number(purchaseStats._sum.amount || 0)
          if (purchaseCashBalance < totalAmount) {
            throw new Error(
              `Insufficient cash in drawer. Available: ৳${purchaseCashBalance.toLocaleString()}, Required: ৳${totalAmount.toLocaleString()}`
            )
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.B2B_PURCHASE,
              amount: -totalAmount,
              description: `Purchase from supplier: ${supplier.name} - ${product.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_PURCHASE,
            },
          })
        } else if (bankAccountId) {
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: bankAccountId },
          })
          if (!bankAccount) throw new Error('Bank account not found')
          if (
            bankAccount.isMfs &&
            bankAccount.transactionChargePct.toNumber() > 0
          ) {
            feeAmount = Number(
              (
                (totalAmount * bankAccount.transactionChargePct.toNumber()) /
                100
              ).toFixed(2)
            )
          }
          // Check sufficient bank balance before deducting (including MFS fee)
          if (Number(bankAccount.currentBalance) < totalAmount + feeAmount) {
            throw new Error(
              `Insufficient balance in bank account. Available: ৳${Number(bankAccount.currentBalance).toLocaleString()}, Required: ৳${(totalAmount + feeAmount).toLocaleString()}`
            )
          }
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'WITHDRAWAL',
              amount: totalAmount,
              description: `Purchase from supplier: ${supplier.name} - ${product.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_PURCHASE,
            },
          })
          if (feeAmount > 0) {
            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankAccount.id,
                type: 'WITHDRAWAL',
                amount: feeAmount,
                description: `MFS Transaction Charge: Purchase from supplier ${supplier.name}`,
                referenceType: BANK_TX_REF_TYPE.B2B_PURCHASE,
              },
            })
          }
          await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: { currentBalance: { decrement: Number((totalAmount + feeAmount).toFixed(2)) } },
          })
        }
      }

      // Create ledger entry for the purchase
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.DEBIT,
          amount: totalAmount,
          description: `Purchased ${quantity}x ${product.name} (SKU: ${product.sku}) @ ৳${unitCost} each`,
          referenceId: `PURCHASE-${Date.now()}`,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          transactionType: 'PURCHASE',
          outletId: outletId || null,
          createdById: user.id,
        },
      })
      const ledgerEntry = transaction

      // Update supplier outstanding balance — only for credit purchases
      // (immediate cash/bank payments do not create an outstanding balance)
      if (paymentMethod === 'CREDIT') {
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            outstandingBalance: {
              increment: totalAmount,
            },
          },
        })
      }

      // Create SerialUnit records for purchased items
      if (product.requiresSerial && serialNumbers) {
        const serials = serialNumbers.filter(Boolean)
        await tx.serialUnit.createMany({
          data: serials.map(serialNumber => ({
            productId,
            serialNumber,
            outletId,
            status: 'IN_STOCK' as const,
            costPrice: unitCost,
            sellingPrice: product.sellingPrice,
            purchaseOrderId: null,
          })),
        })
      }

      // Update stock (incoming)
      await tx.stockLedger.create({
        data: {
          productId,
          outletId: outletId || product.outletId,
          supplierId: parsed.data.supplierId,
          movementType: 'PURCHASE_IN',
          quantity,
          referenceId: transaction.id,
          referenceType: 'SUPPLIER_PURCHASE',
          notes: `Purchased ${quantity}x ${product.name} from ${supplier.name}`,
        },
      })

      await tx.stockLayer.create({
        data: {
          productId,
          outletId: outletId || product.outletId,
          supplierId: parsed.data.supplierId,
          quantityReceived: quantity,
          quantityRemaining: quantity,
          unitCost: unitCost,
          receivedAt: new Date(),
        },
      })

      // Double-Entry General Ledger Postings for B2B Purchase:
      // Dr Inventory (1400): Total purchase value
      // Cr Cash (1100) / Bank (1200) / Accounts Payable (2100): Payment / Debt
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '1400', '2100', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccId = coaMap.get('1400')
      const creditAccId =
        paymentMethod === 'CASH'
          ? coaMap.get('1100')
          : paymentMethod === 'CREDIT'
          ? coaMap.get('2100')
          : coaMap.get('1200')

      if (!invAccId) throw new Error('Inventory Asset account (1400) not found in Chart of Accounts')
      if (!creditAccId) {
        throw new Error(`Credit account for ${paymentMethod} not found in Chart of Accounts`)
      }

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = [
        {
          accountId: invAccId,
          type: TransactionType.DEBIT,
          amount: totalAmount,
          description: `B2B Purchase from ${supplier.name} - ${product.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_PURCHASE',
          createdAt: effectiveDate,
        },
        {
          accountId: creditAccId,
          type: TransactionType.CREDIT,
          amount: totalAmount,
          description: `B2B Purchase from ${supplier.name} - ${product.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_PURCHASE',
          createdAt: effectiveDate,
        },
      ]

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        if (feeAccId && creditAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS/Bank Fee for B2B Purchase from ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_PURCHASE',
              createdAt: effectiveDate,
            },
            {
              accountId: creditAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS/Bank Fee for B2B Purchase from ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_PURCHASE',
              createdAt: effectiveDate,
            }
          )
        }
      }

      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({ data: gl })

      return { ledgerEntry, transaction }
    })

    if (notes) {
      await prisma.supplierNote.create({
        data: {
          supplierId,
          note: `Purchase: ${notes}`,
        },
      })
    }

    await logAuditDirect(user.id, 'SUPPLIER_PURCHASE', 'Supplier', supplierId, {
      amount: totalAmount,
      productId,
      quantity,
      unitCost,
      paymentMethod,
      supplierName: supplier.name,
      transactionId: result.transaction.id,
    })

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)

    return ok({
      message: `Successfully recorded purchase of ${quantity}x ${product.name} from ${supplier.name}`,
      amount: totalAmount,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error recording purchase:', error)
    return fail(error.message || 'Failed to record purchase transaction')
  }
}

/**
 * Exchange products with a B2B client (supplier)
 * This can be a swap of products or a return/exchange scenario
 */
const exchangeWithSupplierSchema = z.object({
  supplierId: z.string(),
  itemsGiven: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number().int().positive(),
      unitValue: z.number().positive(),
      serialNumbers: z.array(z.string()).optional(),
    })
  ),
  itemsReceived: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number().int().positive(),
      unitValue: z.number().positive(),
      serialNumbers: z.array(z.string()).optional(),
    })
  ),
  paymentMethod: z.nativeEnum(PaymentMethod).optional().default('CREDIT'),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function exchangeWithSupplier(
  data: z.infer<typeof exchangeWithSupplierSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = exchangeWithSupplierSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const {
    supplierId,
    itemsGiven,
    itemsReceived,
    paymentMethod,
    bankAccountId,
    reference,
    notes,
  } = parsed.data

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  })
  if (!supplier) return fail('Supplier not found')

  // Fetch all products referenced in the exchange to validate serial requirements
  const productIds = [
    ...new Set([
      ...itemsGiven.map(i => i.productId),
      ...itemsReceived.map(i => i.productId),
    ]),
  ]
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, requiresSerial: true, outletId: true },
  })
  const productMap = new Map(products.map(p => [p.id, p]))

  // Validate serials for items given (must exist and be in stock)
  for (const item of itemsGiven) {
    const product = productMap.get(item.productId)
    if (!product) return fail(`Product not found for ${item.productName}`)
    if (product.requiresSerial) {
      const provided = item.serialNumbers?.filter(Boolean) ?? []
      if (provided.length !== item.quantity) {
        return fail(
          `Please provide exactly ${item.quantity} serial number(s) for ${item.productName} (given)`
        )
      }
      const existingSerials = await prisma.serialUnit.findMany({
        where: {
          serialNumber: { in: provided },
          status: 'IN_STOCK',
          productId: item.productId,
        },
        select: { serialNumber: true },
      })
      if (existingSerials.length !== provided.length) {
        return fail(
          `One or more serial numbers not found or not in stock for ${item.productName}`
        )
      }
    }
  }

  // Validate serials for items received (must be unique)
  for (const item of itemsReceived) {
    const product = productMap.get(item.productId)
    if (!product) return fail(`Product not found for ${item.productName}`)
    if (product.requiresSerial) {
      const provided = item.serialNumbers?.filter(Boolean) ?? []
      if (provided.length !== item.quantity) {
        return fail(
          `Please provide exactly ${item.quantity} serial number(s) for ${item.productName} (received)`
        )
      }
      const existingSerials = await prisma.serialUnit.findMany({
        where: {
          serialNumber: { in: provided },
          productId: item.productId,
        },
        select: { serialNumber: true },
      })
      if (existingSerials.length > 0) {
        return fail(
          `Serial number(s) already exist for ${item.productName}: ${existingSerials.map(s => s.serialNumber).join(', ')}`
        )
      }
    }
  }

  // Calculate totals
  const totalGiven = itemsGiven.reduce(
    (sum, item) => sum + item.quantity * item.unitValue,
    0
  )
  const totalReceived = itemsReceived.reduce(
    (sum, item) => sum + item.quantity * item.unitValue,
    0
  )
  const difference = totalGiven - totalReceived

  const outletId = user.outletId

  try {
    const result = await prisma.$transaction(async tx => {
      // Row lock supplier to prevent balance race conditions
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

      // Create detailed description
      const givenDesc = itemsGiven
        .map(item => `${item.quantity}x ${item.productName}`)
        .join(', ')
      const receivedDesc = itemsReceived
        .map(item => `${item.quantity}x ${item.productName}`)
        .join(', ')

      const description = `Exchange - Given: ${givenDesc} (৳${totalGiven}) | Received: ${receivedDesc} (৳${totalReceived})`

      let feeAmount = 0
      // If payment involved (for difference), handle drawer / bank
      if (difference !== 0 && paymentMethod && paymentMethod !== 'CREDIT') {
        if (paymentMethod === 'CASH') {
          const openDrawer = await ensureOpenDrawer(tx, outletId)
          if (!openDrawer) {
            throw new Error(
              'No open cash drawer found. Please open a drawer first.'
            )
          }
          // Check sufficient cash when we are paying the supplier (difference < 0)
          if (difference < 0) {
            const exchStats = await tx.drawerTransaction.aggregate({
              where: { drawerId: openDrawer.id },
              _sum: { amount: true },
            })
            const exchCashBalance = Number(exchStats._sum.amount || 0)
            if (exchCashBalance < Math.abs(difference)) {
              throw new Error(
                `Insufficient cash in drawer. Available: ৳${exchCashBalance.toLocaleString()}, Required: ৳${Math.abs(difference).toLocaleString()}`
              )
            }
          }
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: difference > 0 ? DRAWER_TX_TYPE.B2B_SALE : DRAWER_TX_TYPE.B2B_PURCHASE,
              // CASH_IN is positive, CASH_OUT must be negative for correct balance aggregation
              amount: difference > 0 ? Math.abs(difference) : -Math.abs(difference),
              description: `Exchange with supplier: ${supplier.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_EXCHANGE,
            },
          })
        } else if (bankAccountId) {
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: bankAccountId },
          })
          if (!bankAccount) throw new Error('Bank account not found')
          // Check sufficient bank balance when we are paying the supplier (difference < 0)
          if (difference < 0 && Number(bankAccount.currentBalance) < Math.abs(difference)) {
            throw new Error(
              `Insufficient balance in bank account. Available: ৳${Number(bankAccount.currentBalance).toLocaleString()}, Required: ৳${Math.abs(difference).toLocaleString()}`
            )
          }
          if (
            bankAccount.isMfs &&
            bankAccount.transactionChargePct.toNumber() > 0
          ) {
            feeAmount = Number(
              (
                (Math.abs(difference) *
                  bankAccount.transactionChargePct.toNumber()) /
                100
              ).toFixed(2)
            )
          }
          if (difference < 0 && Number(bankAccount.currentBalance) < Math.abs(difference) + feeAmount) {
            throw new Error(
              `Insufficient balance in bank account. Available: ৳${Number(bankAccount.currentBalance).toLocaleString()}, Required: ৳${(Math.abs(difference) + feeAmount).toLocaleString()}`
            )
          }
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: difference > 0 ? 'DEPOSIT' : 'WITHDRAWAL',
              amount: Math.abs(difference),
              description: `Exchange with supplier: ${supplier.name}`,
              referenceType: BANK_TX_REF_TYPE.B2B_EXCHANGE,
            },
          })
          if (feeAmount > 0) {
            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankAccount.id,
                type: 'WITHDRAWAL',
                amount: feeAmount,
                description: `MFS/Bank Fee — Exchange with supplier: ${supplier.name}`,
                referenceType: BANK_TX_REF_TYPE.B2B_EXCHANGE,
              },
            })
          }
          const netBankDelta =
            difference > 0
              ? Number((Math.abs(difference) - feeAmount).toFixed(2))
              : -Number((Math.abs(difference) + feeAmount).toFixed(2))
          await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: {
              currentBalance: {
                increment: netBankDelta,
              },
            },
          })
        }
      }

      if (difference !== 0 && (!paymentMethod || paymentMethod === 'CREDIT')) {
        const linkedCust = await tx.customer.findUnique({
          where: { linkedSupplierId: supplierId },
          select: { id: true },
        })
        if (difference > 0 && linkedCust) {
          await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${linkedCust.id} FOR UPDATE`
          await tx.customer.update({
            where: { id: linkedCust.id },
            data: { outstandingBalance: { increment: Math.abs(difference) } },
          })
        } else {
          // Update supplier outstanding balance (AP: we owe supplier -> increment when difference < 0, decrement when difference > 0)
          await tx.supplier.update({
            where: { id: supplierId },
            data: {
              outstandingBalance: {
                [difference < 0 ? 'increment' : 'decrement']:
                  Math.abs(difference),
              },
            },
          })
        }
      }

      // Create supplier ledger record for the exchange
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId,
          type: difference > 0 ? TransactionType.CREDIT : TransactionType.DEBIT,
          amount: Math.abs(difference),
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          description: `${description}${difference !== 0 ? ` | Difference: ৳${Math.abs(difference)} ${difference > 0 ? '(in our favor)' : '(in their favor)'}` : ' (even exchange)'}`,
          transactionType: 'EXCHANGE',
          referenceId: `EXCHANGE-${Date.now()}`,
          outletId: outletId || null,
          createdById: user.id,
        },
      })
      const ledgerEntry = transaction

      // Mark given serials as SOLD
      let totalGivenCostBasis = 0
      for (const item of itemsGiven) {
        const product = productMap.get(item.productId)
        if (product?.requiresSerial && item.serialNumbers) {
          const serials = item.serialNumbers.filter(Boolean)
          await tx.serialUnit.updateMany({
            where: {
              serialNumber: { in: serials },
              productId: item.productId,
            },
            data: { status: 'SOLD', soldAt: new Date() },
          })
        }
        // Deplete FIFO stock layer
        const consumed = await consumeStockLayers(tx, {
          productId: item.productId,
          outletId: outletId || product!.outletId,
          quantityNeeded: item.quantity,
          allowSyntheticLayer: false,
        })
        totalGivenCostBasis += consumed.reduce(
          (sum, b) => sum + b.quantityConsumed * Number(b.unitCost),
          0
        )

        // Stock ledger for items given
        await tx.stockLedger.create({
          data: {
            productId: item.productId,
            outletId: outletId || product!.outletId,
            movementType: 'SALE_OUT',
            quantity: -item.quantity,
            referenceId: transaction.id,
            referenceType: 'SUPPLIER_EXCHANGE',
            notes: `Exchange given - ${item.quantity}x ${item.productName}`,
          },
        })
      }

      // Create SerialUnit records for received items
      for (const item of itemsReceived) {
        const product = productMap.get(item.productId)
        if (product?.requiresSerial && item.serialNumbers) {
          const serials = item.serialNumbers.filter(Boolean)
          await tx.serialUnit.createMany({
            data: serials.map(serialNumber => ({
              productId: item.productId,
              serialNumber,
              outletId: outletId || product!.outletId,
              status: 'IN_STOCK' as const,
            })),
          })
        }
        // Stock ledger for items received
        await tx.stockLedger.create({
          data: {
            productId: item.productId,
            outletId: outletId || product!.outletId,
            supplierId: supplier.id,
            movementType: 'PURCHASE_IN',
            quantity: item.quantity,
            referenceId: transaction.id,
            referenceType: 'SUPPLIER_EXCHANGE',
            notes: `Exchange received - ${item.quantity}x ${item.productName}`,
          },
        })

        await tx.stockLayer.create({
          data: {
            productId: item.productId,
            outletId: outletId || product!.outletId,
            supplierId: supplier.id,
            quantityReceived: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitValue,
            receivedAt: new Date(),
          },
        })
      }

      // Double-Entry General Ledger Postings for B2B Exchange:
      // Dr Inventory (1400) for totalReceived
      // Cr Sales Revenue (4000) for totalGiven
      // If difference > 0 (supplier pays/owes us): Dr Cash (1100)/Bank (1200)/AR (1300) for difference
      // If difference < 0 (we pay/owe supplier): Cr Cash (1100)/Bank (1200)/AP (2100) for |difference|
      // Dr COGS (5000) for totalGivenCostBasis
      // Cr Inventory (1400) for totalGivenCostBasis
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '1300', '1400', '2100', '4000', '5000', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccId = coaMap.get('1400')
      const revAccId = coaMap.get('4000')
      const cogsAccId = coaMap.get('5000')

      if (!invAccId) throw new Error('Inventory Asset account (1400) not found in Chart of Accounts')
      if (!revAccId) throw new Error('Sales Revenue account (4000) not found in Chart of Accounts')
      if (!cogsAccId) throw new Error('COGS account (5000) not found in Chart of Accounts')

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = []

      if (totalReceived > 0) {
        gl.push({
          accountId: invAccId,
          type: TransactionType.DEBIT,
          amount: totalReceived,
          description: `B2B Exchange Received from ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_EXCHANGE',
          createdAt: effectiveDate,
        })
      }

      if (totalGiven > 0) {
        gl.push({
          accountId: revAccId,
          type: TransactionType.CREDIT,
          amount: totalGiven,
          description: `B2B Exchange Given to ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_EXCHANGE',
          createdAt: effectiveDate,
        })
      }

      if (difference > 0) {
        const settlementAccId =
          paymentMethod === 'CASH'
            ? coaMap.get('1100')
            : paymentMethod === 'CREDIT'
            ? coaMap.get('1300')
            : coaMap.get('1200')
        if (!settlementAccId) throw new Error(`Settlement account for ${paymentMethod} not found`)
        gl.push({
          accountId: settlementAccId,
          type: TransactionType.DEBIT,
          amount: Math.abs(difference),
          description: `B2B Exchange Inflow from ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_EXCHANGE',
          createdAt: effectiveDate,
        })
      } else if (difference < 0) {
        const settlementAccId =
          paymentMethod === 'CASH'
            ? coaMap.get('1100')
            : paymentMethod === 'CREDIT'
            ? coaMap.get('2100')
            : coaMap.get('1200')
        if (!settlementAccId) throw new Error(`Settlement account for ${paymentMethod} not found`)
        gl.push({
          accountId: settlementAccId,
          type: TransactionType.CREDIT,
          amount: Math.abs(difference),
          description: `B2B Exchange Outflow to ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_EXCHANGE',
          createdAt: effectiveDate,
        })
      }

      if (totalGivenCostBasis > 0) {
        gl.push(
          {
            accountId: cogsAccId,
            type: TransactionType.DEBIT,
            amount: totalGivenCostBasis,
            description: `COGS for B2B Exchange Given to ${supplier.name}`,
            referenceId: transaction.id,
            referenceType: 'B2B_EXCHANGE',
            createdAt: effectiveDate,
          },
          {
            accountId: invAccId,
            type: TransactionType.CREDIT,
            amount: totalGivenCostBasis,
            description: `Inventory deduction for B2B Exchange Given to ${supplier.name}`,
            referenceId: transaction.id,
            referenceType: 'B2B_EXCHANGE',
            createdAt: effectiveDate,
          }
        )
      }

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        const bankAccId = coaMap.get('1200')
        if (feeAccId && bankAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS Fee for B2B Exchange with ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_EXCHANGE',
              createdAt: effectiveDate,
            },
            {
              accountId: bankAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS Fee for B2B Exchange with ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_EXCHANGE',
              createdAt: effectiveDate,
            }
          )
        }
      }

      if (gl.length > 0) {
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })
      }

      return { ledgerEntry, transaction }
    })

    // Create a note with full details
    const givenDesc = itemsGiven
      .map(item => `${item.quantity}x ${item.productName}`)
      .join(', ')
    const receivedDesc = itemsReceived
      .map(item => `${item.quantity}x ${item.productName}`)
      .join(', ')
    const description = `Exchange - Given: ${givenDesc} (৳${totalGiven}) | Received: ${receivedDesc} (৳${totalReceived})`
    const fullNote = `${description}${difference !== 0 ? ` | Difference: ৳${Math.abs(difference)} ${difference > 0 ? '(in our favor)' : '(in their favor)'}` : ' (even exchange)'}${notes ? ` | Notes: ${notes}` : ''}`

    await prisma.supplierNote.create({
      data: {
        supplierId,
        note: fullNote,
      },
    })

    // Log audit
    await logAuditDirect(user.id, 'SUPPLIER_EXCHANGE', 'Supplier', supplierId, {
      totalGiven,
      totalReceived,
      difference,
      supplierName: supplier.name,
      transactionId: result.transaction.id,
    })

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)

    // INV-007: Trigger low-stock notification for items given to supplier
    const givenProductIds = Array.from(new Set(itemsGiven.map(item => item.productId)))
    const targetOutletId = user.outletId
    if (targetOutletId && givenProductIds.length > 0) {
      checkAndNotifyLowStock(givenProductIds, targetOutletId).catch(err => {
        console.error('[exchangeWithSupplier] Low stock notification check failed:', err)
      })
    }

    return ok({
      message: `Successfully processed exchange with ${supplier.name}`,
      difference,
      totalGiven,
      totalReceived,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error processing exchange:', error)
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error.message || 'Failed to process exchange transaction')
  }
}

/**
 * Make a payment to supplier (reduce outstanding balance)
 */
const paySupplierSchema = z.object({
  supplierId: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export async function makePaymentToSupplier(
  data: z.infer<typeof paySupplierSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = paySupplierSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { supplierId, amount, paymentMethod, bankAccountId, reference, notes } =
    parsed.data

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  })
  if (!supplier) return fail('Supplier not found')

  const outletId = user.outletId
  if (!outletId) return fail('No outlet identified for this transaction')

  try {
    const result = await prisma.$transaction(async tx => {
      // Row locking on Supplier to serialize concurrent payments
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
      const lockedSupplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, outstandingBalance: true },
      })
      if (!lockedSupplier) throw new Error('Supplier not found')
      const currentOutstanding = Number(lockedSupplier.outstandingBalance || 0)
      if (currentOutstanding > 0 && amount > currentOutstanding) {
        throw new Error(
          `Payment amount (৳${amount.toLocaleString()}) exceeds supplier outstanding balance (৳${currentOutstanding.toLocaleString()}).`
        )
      }
      if (bankAccountId) {
        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      let feeAmount = 0

      // 1. Balance Checks & Deductions
      if (paymentMethod === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, outletId)

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a drawer first.'
          )
        }

        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId: openDrawer.id },
          _sum: { amount: true },
        })

        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < amount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${amount.toLocaleString()}`
          )
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.SUPPLIER_PAYMENT,
            amount: -amount,
            description: `Payment to supplier: ${supplier.name}`,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
      } else if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: bankAccountId },
        })

        if (!bankAccount) throw new Error('Bank account not found')

        if (Number(bankAccount.currentBalance) < amount) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        // Calculate MFS fee if applicable
        if (bankAccount.isMfs && bankAccount.cashoutChargePct.toNumber() > 0) {
          feeAmount = Number(
            ((amount * bankAccount.cashoutChargePct.toNumber()) / 100).toFixed(
              2
            )
          )
        }

        if (Number(bankAccount.currentBalance) < amount + feeAmount) {
          throw new Error('Insufficient funds: Transaction amount plus fee exceeds the available bank balance.')
        }

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: 'WITHDRAWAL',
            amount,
            description: `Payment to supplier: ${supplier.name}`,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
        if (feeAmount > 0) {
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'WITHDRAWAL',
              amount: feeAmount,
              description: `MFS/Bank Fee — Payment to supplier: ${supplier.name}`,
              referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
            },
          })
        }
        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { decrement: Number((amount + feeAmount).toFixed(2)) } },
        })
      }

      // 2. Create Supplier Ledger Entry (paying supplier reduces what we owe -> CREDIT)
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.CREDIT,
          amount,
          description: `Payment to ${supplier.name} via ${paymentMethod}${notes ? ` - ${notes}` : ''}`,
          referenceId: `PAYMENT-${Date.now()}`,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          transactionType: 'PAYMENT_OUT',
          outletId,
          createdById: user.id,
        },
      })
      const ledgerEntry = transaction

      // 4. Update Supplier Outstanding Balance
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      // Double-Entry General Ledger Postings for Supplier Payment:
      // Dr Accounts Payable (2100): Payment reduces payable
      // Cr Cash (1100) or Bank (1200): Outflow of money
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '2100', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const apAccId = coaMap.get('2100')
      const assetAccId =
        paymentMethod === PaymentMethod.CASH
          ? coaMap.get('1100')
          : coaMap.get('1200')

      if (!apAccId) throw new Error('Accounts Payable account (2100) not found in Chart of Accounts')
      if (!assetAccId) {
        throw new Error(`Payment asset account for ${paymentMethod} not found in Chart of Accounts`)
      }

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = [
        {
          accountId: apAccId,
          type: TransactionType.DEBIT,
          amount,
          description: `Payment to supplier: ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SUPPLIER_PAYMENT',
          createdAt: effectiveDate,
        },
        {
          accountId: assetAccId,
          type: TransactionType.CREDIT,
          amount,
          description: `Payment to supplier: ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SUPPLIER_PAYMENT',
          createdAt: effectiveDate,
        },
      ]

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        if (feeAccId && assetAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS Fee for payment to supplier: ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SUPPLIER_PAYMENT',
              createdAt: effectiveDate,
            },
            {
              accountId: assetAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS Fee for payment to supplier: ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SUPPLIER_PAYMENT',
              createdAt: effectiveDate,
            }
          )
        }
      }

      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({ data: gl })

      return { ledgerEntry, transaction }
    })

    // 5. Log Audit Event (outside transaction)
    await logAuditDirect(
      user.id,
      'SUPPLIER_PAYMENT_OUT',
      'Supplier',
      supplierId,
      {
        amount,
        method: paymentMethod,
        bankAccountId: bankAccountId || null,
        reference: reference || null,
        supplierName: supplier.name,
        transactionId: result.transaction.id,
      }
    )

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)

    return ok({
      message: `Payment of ৳${amount.toLocaleString()} recorded for ${supplier.name}`,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error recording payment:', error)
    return fail(error.message || 'Failed to record payment')
  }
}

/**
 * Receive payment from supplier (reduce outstanding balance they owe us)
 */
export async function receivePaymentFromSupplier(
  data: z.infer<typeof paySupplierSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = paySupplierSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { supplierId, amount, paymentMethod, bankAccountId, reference, notes } =
    parsed.data

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  })
  if (!supplier) return fail('Supplier not found')

  const outletId = user.outletId
  if (!outletId) return fail('No outlet identified for this transaction')

  try {
    const result = await prisma.$transaction(async tx => {
      // Row locking on Supplier to serialize concurrent payment receipts
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`
      if (bankAccountId) {
        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      let feeAmount = 0

      // 1. Balance & Deposit Processing
      if (paymentMethod === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, outletId)

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a drawer first.'
          )
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.B2B_PAYMENT,
            amount,
            description: `Payment received from supplier: ${supplier.name}`,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
      } else if (bankAccountId) {
        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: bankAccountId },
        })

        if (!bankAccount) throw new Error('Bank account not found')

        // Calculate MFS fee if applicable
        if (
          bankAccount.isMfs &&
          bankAccount.transactionChargePct.toNumber() > 0
        ) {
          feeAmount = Number(
            (
              (amount * bankAccount.transactionChargePct.toNumber()) /
              100
            ).toFixed(2)
          )
        }

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: 'DEPOSIT',
            amount,
            description: `Payment received from supplier: ${supplier.name}`,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
        if (feeAmount > 0) {
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'WITHDRAWAL',
              amount: feeAmount,
              description: `MFS/Bank Fee — Payment received from supplier: ${supplier.name}`,
              referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
            },
          })
        }
        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { increment: Number((amount - feeAmount).toFixed(2)) } },
        })
      }

      // 2. Create Supplier Ledger Entry
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.CREDIT,
          amount,
          description: `Payment received from ${supplier.name} via ${paymentMethod}${notes ? ` - ${notes}` : ''}`,
          referenceId: `PAYMENT-RCV-${Date.now()}`,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          transactionType: 'PAYMENT_IN',
          outletId,
          createdById: user.id,
        },
      })
      const ledgerEntry = transaction

      // 4. Update Receivable / Supplier Balance
      const linkedCustomer = await tx.customer.findUnique({
        where: { linkedSupplierId: supplierId },
        select: { id: true, outstandingBalance: true },
      })
      if (linkedCustomer) {
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${linkedCustomer.id} FOR UPDATE`
        await tx.customer.update({
          where: { id: linkedCustomer.id },
          data: {
            outstandingBalance: {
              decrement: amount,
            },
          },
        })
        await tx.customerLedger.create({
          data: {
            customerId: linkedCustomer.id,
            type: TransactionType.CREDIT,
            amount,
            description: `Payment received from supplier ${supplier.name} via ${paymentMethod}${notes ? ` - ${notes}` : ''}`,
            referenceId: transaction.id,
          },
        })
      } else {
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            outstandingBalance: {
              increment: amount,
            },
          },
        })
      }

      // Double-Entry General Ledger Postings for Receipt from Supplier:
      // Dr Cash (1100) or Bank (1200): Cash/bank inflow
      // Cr Accounts Receivable (1300): Settles supplier debt / receivable
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '1300', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const arAccId = coaMap.get('1300')
      const assetAccId =
        paymentMethod === PaymentMethod.CASH
          ? coaMap.get('1100')
          : coaMap.get('1200')

      if (!arAccId) throw new Error('Accounts Receivable account (1300) not found in Chart of Accounts')
      if (!assetAccId) {
        throw new Error(`Deposit asset account for ${paymentMethod} not found in Chart of Accounts`)
      }

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = [
        {
          accountId: assetAccId,
          type: TransactionType.DEBIT,
          amount,
          description: `Payment received from supplier: ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SUPPLIER_RECEIPT',
          createdAt: effectiveDate,
        },
        {
          accountId: arAccId,
          type: TransactionType.CREDIT,
          amount,
          description: `Receivable settled from supplier: ${supplier.name}`,
          referenceId: transaction.id,
          referenceType: 'B2B_SUPPLIER_RECEIPT',
          createdAt: effectiveDate,
        },
      ]

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        if (feeAccId && assetAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS Fee for payment received from supplier: ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SUPPLIER_RECEIPT',
              createdAt: effectiveDate,
            },
            {
              accountId: assetAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS Fee for payment received from supplier: ${supplier.name}`,
              referenceId: transaction.id,
              referenceType: 'B2B_SUPPLIER_RECEIPT',
              createdAt: effectiveDate,
            }
          )
        }
      }

      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({ data: gl })

      return { ledgerEntry, transaction }
    })

    // 5. Log Audit Event
    await logAuditDirect(
      user.id,
      'SUPPLIER_PAYMENT_IN',
      'Supplier',
      supplierId,
      {
        amount,
        method: paymentMethod,
        bankAccountId: bankAccountId || null,
        reference: reference || null,
        supplierName: supplier.name,
        transactionId: result.transaction.id,
      }
    )

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)

    return ok({
      message: `Payment of ৳${amount.toLocaleString()} received from ${supplier.name}`,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error recording payment:', error)
    return fail(error.message || 'Failed to record payment received')
  }
}

/**
 * Pay a supplier invoice (invoice-specific payment)
 */
const payInvoiceSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  chequeDate: z.string().optional(),
})

export async function paySupplierInvoice(
  data: z.infer<typeof payInvoiceSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const parsed = payInvoiceSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { invoiceId, amount, paymentMethod, bankAccountId, reference, chequeDate } =
    parsed.data
  let notes = parsed.data.notes
  if (paymentMethod === PaymentMethod.CHEQUE && chequeDate) {
    if (!notes?.includes('[Cheque Matures:')) {
      notes = notes ? `${notes} | [Cheque Matures: ${chequeDate}]` : `[Cheque Matures: ${chequeDate}]`
    }
  }

  if (paymentMethod !== PaymentMethod.CASH && !bankAccountId) {
    return fail('Bank account is required for electronic payments')
  }

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: { po: { select: { outletId: true } } },
  })
  if (!invoice) return fail('Invoice not found')

  const isSaleInvoice = invoice.invoiceType === 'SALE'
  const outletId = invoice.po?.outletId || user.outletId
  if (!outletId) return fail('No outlet identified for this transaction')

  try {
    const result = await prisma.$transaction(async tx => {
      // Row locking on PurchaseInvoice to serialize invoice payment updates
      await tx.$executeRaw`SELECT id FROM "PurchaseInvoice" WHERE id = ${invoiceId} FOR UPDATE`
      if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      const lockedInvoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: { po: { select: { outletId: true } } },
      })
      if (!lockedInvoice) throw new Error('Invoice not found')

      const currentAmountPaid = Number(lockedInvoice.amountPaid || 0)
      const invoiceTotal = Number(lockedInvoice.total)
      const remainingDue = Math.max(0, Math.round((invoiceTotal - currentAmountPaid + Number.EPSILON) * 100) / 100)

      if (remainingDue <= 0) {
        throw new Error('Invoice is already fully paid')
      }
      if (amount > remainingDue + 0.01) {
        throw new Error(`Payment amount (৳${amount}) exceeds remaining invoice balance (৳${remainingDue})`)
      }

      const updatedAmountPaid = Math.round((currentAmountPaid + amount + Number.EPSILON) * 100) / 100
      const newStatus =
        updatedAmountPaid >= invoiceTotal - 0.01 ? 'PAID' : 'PARTIALLY_PAID'

      let feeAmount = 0

      // 1. Balance Checks & Deductions
      if (paymentMethod === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, outletId)

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a drawer first.'
          )
        }

        if (isSaleInvoice) {
          // Sale invoice payment - cash comes IN
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.B2B_PAYMENT,
              amount: amount,
              description: `Sale invoice payment received: ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.B2B_SALE_PAYMENT,
            },
          })
        } else {
          // Purchase invoice payment - cash goes OUT
          const stats = await tx.drawerTransaction.aggregate({
            where: { drawerId: openDrawer.id },
            _sum: { amount: true },
          })

          const cashBalance = Number(stats._sum.amount || 0)
          if (cashBalance < amount) {
            throw new Error(
              `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${amount.toLocaleString()}`
            )
          }

          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: DRAWER_TX_TYPE.B2B_PURCHASE_PAYMENT,
              amount: -amount,
              description: `Invoice payment: ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.SUPPLIER_INVOICE_PAYMENT,
            },
          })
        }
      } else if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: bankAccountId },
        })

        if (!bankAccount) throw new Error('Bank account not found')

        if (isSaleInvoice) {
          // Sale invoice payment - money comes IN (deposit)
          if (
            bankAccount.isMfs &&
            bankAccount.transactionChargePct.toNumber() > 0
          ) {
            feeAmount = Number(
              (
                (amount * bankAccount.transactionChargePct.toNumber()) /
                100
              ).toFixed(2)
            )
          }

          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'DEPOSIT',
              amount,
              description: `Sale invoice payment received: ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.B2B_SALE_PAYMENT,
            },
          })
          if (feeAmount > 0) {
            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankAccount.id,
                type: 'WITHDRAWAL',
                amount: feeAmount,
                description: `MFS/Bank Fee — Sale invoice payment: ${invoice.invoiceNumber}`,
                referenceId: invoice.id,
                referenceType: BANK_TX_REF_TYPE.B2B_SALE_PAYMENT,
              },
            })
          }
          await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: { currentBalance: { increment: Number((amount - feeAmount).toFixed(2)) } },
          })
        } else {
          // Purchase invoice payment - money goes OUT (withdrawal)
          if (
            bankAccount.isMfs &&
            bankAccount.cashoutChargePct.toNumber() > 0
          ) {
            feeAmount = Number(
              (
                (amount * bankAccount.cashoutChargePct.toNumber()) /
                100
              ).toFixed(2)
            )
          }

          if (Number(bankAccount.currentBalance) < amount + feeAmount) {
            throw new Error('Insufficient funds: Transaction amount plus fee exceeds the available bank balance.')
          }

          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: 'WITHDRAWAL',
              amount,
              description: `Invoice payment: ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.SUPPLIER_INVOICE_PAYMENT,
            },
          })
          if (feeAmount > 0) {
            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankAccount.id,
                type: 'WITHDRAWAL',
                amount: feeAmount,
                description: `MFS/Bank Fee — Invoice payment: ${invoice.invoiceNumber}`,
                referenceId: invoice.id,
                referenceType: BANK_TX_REF_TYPE.SUPPLIER_INVOICE_PAYMENT,
              },
            })
          }
          await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: { currentBalance: { decrement: Number((amount + feeAmount).toFixed(2)) } },
          })
        }
      }

      // 2. Create Purchase Payment Record
      const purchasePayment = await tx.purchasePayment.create({
        data: {
          invoiceId,
          amount,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          reference: reference || null,
        },
      })

      // 3. Update Invoice atomically
      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { amountPaid: { increment: amount }, status: newStatus as any },
      })

      // 4. Create Supplier Ledger Entry
      // SALE invoice payment = CREDIT (supplier pays us, settles receivable)
      // PURCHASE invoice payment = CREDIT (we pay supplier, settles payable)
      const transaction = await tx.supplierLedger.create({
        data: {
          supplierId: invoice.supplierId,
          type: TransactionType.CREDIT,
          amount,
          description: `Payment for invoice ${invoice.invoiceNumber}${notes ? ` - ${notes}` : ''}`,
          referenceId: invoiceId,
          method: paymentMethod,
          bankAccountId: bankAccountId || null,
          feeAmount,
          reference: reference || null,
          transactionType: 'INVOICE_PAYMENT',
          invoiceId,
          outletId,
          purchaseOrderId: invoice.poId || null,
          createdById: user.id,
        },
      })
      const ledgerEntry = transaction

      // 6. Update Supplier / Linked Customer Balance
      if (isSaleInvoice) {
        const linkedCustomer = await tx.customer.findUnique({
          where: { linkedSupplierId: invoice.supplierId },
          select: { id: true },
        })
        if (linkedCustomer) {
          await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${linkedCustomer.id} FOR UPDATE`
          await tx.customer.update({
            where: { id: linkedCustomer.id },
            data: { outstandingBalance: { decrement: amount } },
          })
          await tx.customerLedger.create({
            data: {
              customerId: linkedCustomer.id,
              type: TransactionType.CREDIT,
              amount,
              description: `B2B Sale Invoice Payment (${invoice.invoiceNumber})`,
              referenceId: invoice.id,
            },
          })
        } else {
          await tx.supplier.update({
            where: { id: invoice.supplierId },
            data: { outstandingBalance: { increment: amount } },
          })
        }
      } else {
        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: {
            outstandingBalance: {
              decrement: amount,
            },
          },
        })
      }

      // Double-Entry General Ledger Postings for Invoice Payment:
      // If SALE invoice: Dr Cash/Bank, Cr Accounts Receivable (1300)
      // If PURCHASE invoice: Dr Accounts Payable (2100), Cr Cash/Bank
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '1300', '2100', '5290', '5291'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const apAccId = coaMap.get('2100')
      const arAccId = coaMap.get('1300')
      const assetAccId =
        paymentMethod === PaymentMethod.CASH
          ? coaMap.get('1100')
          : coaMap.get('1200')

      if (isSaleInvoice && !arAccId) throw new Error('Accounts Receivable account (1300) not found in Chart of Accounts')
      if (!isSaleInvoice && !apAccId) throw new Error('Accounts Payable account (2100) not found in Chart of Accounts')
      if (!assetAccId) throw new Error(`Asset account for ${paymentMethod} not found in Chart of Accounts`)

      const effectiveDate = new Date()
      const gl: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt: Date
      }> = []

      if (isSaleInvoice) {
        gl.push(
          {
            accountId: assetAccId,
            type: TransactionType.DEBIT,
            amount,
            description: `Payment received for B2B Sale Invoice ${invoice.invoiceNumber}`,
            referenceId: transaction.id,
            referenceType: 'B2B_INVOICE_PAYMENT',
            createdAt: effectiveDate,
          },
          {
            accountId: arAccId!,
            type: TransactionType.CREDIT,
            amount,
            description: `Payment received for B2B Sale Invoice ${invoice.invoiceNumber}`,
            referenceId: transaction.id,
            referenceType: 'B2B_INVOICE_PAYMENT',
            createdAt: effectiveDate,
          }
        )
      } else {
        gl.push(
          {
            accountId: apAccId!,
            type: TransactionType.DEBIT,
            amount,
            description: `Payment for Purchase Invoice ${invoice.invoiceNumber}`,
            referenceId: transaction.id,
            referenceType: 'B2B_INVOICE_PAYMENT',
            createdAt: effectiveDate,
          },
          {
            accountId: assetAccId,
            type: TransactionType.CREDIT,
            amount,
            description: `Payment for Purchase Invoice ${invoice.invoiceNumber}`,
            referenceId: transaction.id,
            referenceType: 'B2B_INVOICE_PAYMENT',
            createdAt: effectiveDate,
          }
        )
      }

      if (feeAmount > 0) {
        const feeAccId = coaMap.get('5290') || coaMap.get('5291')
        if (feeAccId && assetAccId) {
          gl.push(
            {
              accountId: feeAccId,
              type: TransactionType.DEBIT,
              amount: feeAmount,
              description: `MFS Fee for invoice payment: ${invoice.invoiceNumber}`,
              referenceId: transaction.id,
              referenceType: 'B2B_INVOICE_PAYMENT',
              createdAt: effectiveDate,
            },
            {
              accountId: assetAccId,
              type: TransactionType.CREDIT,
              amount: feeAmount,
              description: `MFS Fee for invoice payment: ${invoice.invoiceNumber}`,
              referenceId: transaction.id,
              referenceType: 'B2B_INVOICE_PAYMENT',
              createdAt: effectiveDate,
            }
          )
        }
      }

      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({ data: gl })

      return { purchasePayment, ledgerEntry, transaction }
    })

    // 7. Log Audit Event
    await logAuditDirect(
      user.id,
      'SUPPLIER_INVOICE_PAYMENT',
      'PurchaseInvoice',
      invoiceId,
      {
        amount,
        method: paymentMethod,
        bankAccountId: bankAccountId || null,
        reference: reference || null,
        invoiceNumber: invoice.invoiceNumber,
        supplierId: invoice.supplierId,
        transactionId: result.transaction.id,
      }
    )

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${invoice.supplierId}`)
    revalidatePath('/ledger/invoices')

    return ok({
      message: `Payment of ৳${amount.toLocaleString()} recorded for invoice ${invoice.invoiceNumber}`,
      transactionId: result.transaction.id,
    })
  } catch (error: any) {
    console.error('Error recording invoice payment:', error)
    return fail(error.message || 'Failed to record invoice payment')
  }
}

/**
 * Get unified transaction history for a supplier
 */
export async function getSupplierTransactions(
  supplierId: string,
  filters?: {
    type?: string
    method?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  }
) {
  await requireAuth()

  const where: any = { supplierId }

  if (filters?.type) {
    where.OR = [
      { transactionType: filters.type },
      { type: filters.type as any },
    ]
  }

  if (filters?.method) {
    where.method = filters.method
  }

  if (filters?.from || filters?.to) {
    where.createdAt = {}
    if (filters.from) {
      where.createdAt.gte = getLocalDateRangeBoundaries(filters.from, filters.from, 6).start
    }
    if (filters.to) {
      where.createdAt.lte = getLocalDateRangeBoundaries(filters.to, filters.to, 6).end
    }
  }

  const [entries, total] = await Promise.all([
    prisma.supplierLedger.findMany({
      where,
      include: {
        bankAccount: {
          select: { bankName: true, accountName: true, accountNumber: true },
        },
        invoice: {
          select: { invoiceNumber: true, total: true, amountPaid: true },
        },
        createdBy: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    }),
    prisma.supplierLedger.count({ where }),
  ])

  return {
    transactions: entries.map(t => ({
      ...t,
      type: t.transactionType || t.type,
      amount: Number(t.amount),
      feeAmount: Number(t.feeAmount || 0),
    })),
    total,
  }
}

/**
 * Get invoices for a supplier with payment history
 */
export async function getSupplierInvoices(
  supplierId: string,
  filters?: {
    status?: string
    from?: string
    to?: string
  }
) {
  await requireAuth()

  const where: any = { supplierId }

  if (filters?.status) {
    where.status = filters.status
  }

  if (filters?.from || filters?.to) {
    where.createdAt = {}
    if (filters.from) {
      where.createdAt.gte = getLocalDateRangeBoundaries(filters.from, filters.from, 6).start
    }
    if (filters.to) {
      where.createdAt.lte = getLocalDateRangeBoundaries(filters.to, filters.to, 6).end
    }
  }

  const invoices = await prisma.purchaseInvoice.findMany({
    where,
    include: {
      payments: {
        orderBy: { paidAt: 'desc' },
        include: {
          bankAccount: {
            select: { bankName: true, accountName: true },
          },
        },
      },
      po: {
        select: { poNumber: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return invoices.map(inv => ({
    ...inv,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    amountPaid: Number(inv.amountPaid),
    remaining: Math.max(Number(inv.total) - Number(inv.amountPaid), 0),
    payments: inv.payments.map(p => ({
      ...p,
      amount: Number(p.amount),
    })),
  }))
}

/**
 * Get products for dropdown in B2B transactions
 */
export async function getProductsForB2B(outletId: string) {
  await requireAuth()

  return prisma.product.findMany({
    where: {
      outletId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      sku: true,
      sellingPrice: true,
      costPrice: true,
      requiresSerial: true,
      serialUnits: {
        where: { status: 'IN_STOCK' },
        select: { serialNumber: true },
      },
    },
    orderBy: {
      name: 'asc',
    },
  })
}

/**
 * Wipe all purchase, sales, and transaction history for a supplier, resetting outstanding balance to 0.
 */
export async function wipeSupplierHistory(supplierId: string) {
  const user = await requireSensitiveRole(
    'wipeSupplierHistory',
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  // 1. Fetch supplier with purchase orders, lines, and serial units to validate
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      purchaseOrders: {
        include: {
          lines: {
            include: {
              serialUnits: {
                include: {
                  serialUnit: {
                    include: {
                      saleLineSerials: true,
                      serviceJobSerials: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!supplier) {
    return fail('Supplier not found')
  }

  const poIds = supplier.purchaseOrders.map(po => po.id)

  // B2B-003: Guard against wiping stock that has already been partially or fully sold
  const supplierStockLayers = await prisma.stockLayer.findMany({
    where: {
      OR: [
        { supplierId },
        ...(poIds.length > 0 ? [{ purchaseOrderId: { in: poIds } }] : []),
      ],
    },
    select: { id: true, quantityReceived: true, quantityRemaining: true },
  })

  const hasConsumedStock = supplierStockLayers.some(
    l => l.quantityRemaining < l.quantityReceived
  )
  if (hasConsumedStock) {
    return fail(
      'Cannot wipe supplier history: inventory received from this supplier has already been partially or fully sold.'
    )
  }

  // Audit log start of history wipe
  await logAuditDirect(
    user.id,
    'SUPPLIER_HISTORY_WIPE_STARTED',
    'Supplier',
    supplierId,
    {
      supplierName: supplier.name,
      purchaseOrderCount: supplier.purchaseOrders.length,
    }
  )

  // Collect all serial units purchased from this supplier
  const serialUnits = supplier.purchaseOrders.flatMap(po =>
    po.lines.flatMap(line =>
      line.serialUnits.map(pus => pus.serialUnit)
    )
  )

  // Separate serials into those we can delete (unsold/unused) and those we must keep (sold/used to preserve retail history)
  const serialsToDelete = serialUnits.filter(
    su => su.saleLineSerials.length === 0 && su.serviceJobSerials.length === 0
  )
  const serialsToKeep = serialUnits.filter(
    su => su.saleLineSerials.length > 0 || su.serviceJobSerials.length > 0
  )

  // 2. Perform transactional deletion
  try {
    await prisma.$transaction(
      async tx => {
        const poLineIds = supplier.purchaseOrders.flatMap(po => po.lines.map(l => l.id))
        const serialsToDeleteIds = serialsToDelete.map(su => su.id)
        const serialsToKeepIds = serialsToKeep.map(su => su.id)

        // Track which bank accounts were credited by B2B sales to this supplier
        // so their balances can be restored when those deposit records are wiped.
        const supplierTxBankRows = await tx.supplierTransaction.findMany({
          where: { supplierId },
          select: { bankAccountId: true },
        })
        const supplierTransactionsBankAccountIds = Array.from(
          new Set(supplierTxBankRows.map(t => t.bankAccountId).filter((id): id is string => Boolean(id)))
        )

        // Delete serial links
        if (poLineIds.length > 0) {
          await tx.purchaseOrderLineSerial.deleteMany({
            where: { poLineId: { in: poLineIds } },
          })
        }

        // Delete SerialUnits that were purchased but never sold/used in retail
        if (serialsToDeleteIds.length > 0) {
          await tx.serialUnit.deleteMany({
            where: { id: { in: serialsToDeleteIds } },
          })
        }

        // Keep sold/used serial units to maintain retail sale consistency, but clear their purchase notes/origin
        if (serialsToKeepIds.length > 0) {
          await tx.serialUnit.updateMany({
            where: { id: { in: serialsToKeepIds } },
            data: {
              notes: 'Purchase history wiped',
              purchasedAt: null,
            },
          })
        }

        // Delete PO lines
        if (poIds.length > 0) {
          await tx.purchaseOrderLine.deleteMany({
            where: { poId: { in: poIds } },
          })
        }

        // Delete Purchase Orders
        if (poIds.length > 0) {
          await tx.purchaseOrder.deleteMany({
            where: { id: { in: poIds } },
          })
        }

        // Get all supplier transaction IDs to delete stock ledger references
        const transactions = await tx.supplierTransaction.findMany({
          where: { supplierId },
          select: { id: true },
        })
        const txIds = transactions.map(t => t.id)

        // Fetch invoices to delete payments and invoice logs
        const invoices = await tx.purchaseInvoice.findMany({
          where: { supplierId },
          select: { id: true },
        })
        const invoiceIds = invoices.map(i => i.id)

        // Delete stock ledger entries referencing these POs (purchases) or supplier transactions (B2B sales)
        await tx.stockLedger.deleteMany({
          where: {
            OR: [
              { referenceId: { in: poIds }, referenceType: 'PURCHASE' },
              { referenceId: { in: txIds }, referenceType: 'SUPPLIER_SALE' },
            ],
          },
        })

        // Delete unconsumed StockLayer rows
        await tx.stockLayer.deleteMany({
          where: {
            OR: [
              { supplierId },
              ...(poIds.length > 0 ? [{ purchaseOrderId: { in: poIds } }] : []),
            ],
          },
        })

        // Delete orphaned double-entry General Ledger rows. Without this, the Balance Sheet
        // and P&L keep phantom Inventory / AP / Revenue / Cash entries forever.
        await tx.accountLedgerEntry.deleteMany({
          where: {
            OR: [
              { referenceId: { in: poIds }, referenceType: 'PURCHASE' },
              { referenceId: { in: invoiceIds }, referenceType: 'PurchaseInvoice' },
              { referenceId: { in: txIds }, referenceType: 'SUPPLIER_SALE' },
            ],
          },
        })

        // Restore bank balances for B2B sales deposits BEFORE deleting the transactions.
        if (supplierTransactionsBankAccountIds.length > 0) {
          const bankRows = await tx.bankAccount.findMany({
            where: { id: { in: supplierTransactionsBankAccountIds } },
            select: { id: true },
          })
          for (const bank of bankRows) {
            const totalDeposited = await tx.bankTransaction.aggregate({
              where: {
                bankAccountId: bank.id,
                referenceType: 'SUPPLIER_SALE',
              },
              _sum: { amount: true },
            })
            await tx.bankAccount.update({
              where: { id: bank.id },
              data: {
                currentBalance: {
                  decrement: Number(totalDeposited._sum.amount || 0),
                },
              },
            })
          }
        }

        // Delete bank transactions created for B2B sales to this supplier (deposits).
        await tx.bankTransaction.deleteMany({
          where: {
            referenceType: 'SUPPLIER_SALE',
            bankAccountId: { in: supplierTransactionsBankAccountIds },
          },
        })

        // Fetch returns to delete return lines and returns
        const returns = await tx.purchaseReturn.findMany({
          where: { supplierId },
          select: { id: true },
        })
        const returnIds = returns.map(r => r.id)

        if (returnIds.length > 0) {
          await tx.purchaseReturnLine.deleteMany({
            where: { returnId: { in: returnIds } },
          })
          await tx.purchaseReturn.deleteMany({
            where: { id: { in: returnIds } },
          })
        }

        if (invoiceIds.length > 0) {
          await tx.purchasePayment.deleteMany({
            where: { invoiceId: { in: invoiceIds } },
          })
          await tx.purchaseInvoiceEditLog.deleteMany({
            where: { invoiceId: { in: invoiceIds } },
          })
          await tx.purchaseInvoice.deleteMany({
            where: { id: { in: invoiceIds } },
          })
        }

        // Delete Supplier ledger, transaction, and notes records
        await tx.supplierLedger.deleteMany({
          where: { supplierId },
        })
        await tx.supplierTransaction.deleteMany({
          where: { supplierId },
        })
        await tx.supplierNote.deleteMany({
          where: { supplierId },
        })

        // Reset Supplier outstandingBalance to 0
        await tx.supplier.update({
          where: { id: supplierId },
          data: { outstandingBalance: 0 },
        })
      },
      { timeout: 30000 }
    )

    // 3. Revalidate path caches to update the frontend UI
    revalidatePath('/suppliers')
    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)
    revalidatePath(`/suppliers/${supplierId}`)
    revalidatePath('/purchases')
    revalidatePath('/purchases/invoices')
    revalidatePath('/purchases/returns')

    await logAuditDirect(
      user.id,
      'SUPPLIER_HISTORY_WIPED',
      'Supplier',
      supplierId,
      {
        supplierName: supplier.name,
        poCount: supplier.purchaseOrders.length,
        serialsDeletedCount: serialsToDelete.length,
        serialsKeptCount: serialsToKeep.length,
      }
    )

    return ok({ id: supplierId, name: supplier.name })
  } catch (error: any) {
    return fail(error.message || 'An error occurred while wiping history')
  }
}

/**
 * Net settlements between a Supplier and its linked Customer.
 * Decrements both outstanding balances by the settled amount and records balanced GL entries.
 */
export async function settleLinkedPartyBalance(
  supplierId: string,
  amount: number,
  options?: {
    idempotencyKey?: string
    notes?: string
    outletId?: string
  },
  tx?: any
) {
  let user: any
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

  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return fail('Settlement amount must be a positive number')
  }

  const cleanIdempotencyKey = options?.idempotencyKey?.trim() || undefined
  const client = tx ?? prisma

  if (cleanIdempotencyKey) {
    const existing = await client.supplierLedger.findFirst({
      where: {
        referenceId: cleanIdempotencyKey,
        transactionType: 'PARTY_NETTING',
      },
    })
    if (existing) {
      return ok({
        message: 'Settlement already processed (idempotent)',
        amount: Number(existing.amount),
        referenceId: existing.referenceId,
      })
    }
  }

  try {
    const executeSettlement = async (activeTx: any) => {
      // 1. Lock Supplier and read linked customer
      await activeTx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

      const supplier = await activeTx.supplier.findUnique({
        where: { id: supplierId },
        include: { linkedCustomer: true },
      })

      if (!supplier) {
        throw new Error('Supplier not found')
      }

      if (!supplier.linkedCustomer) {
        throw new Error('This supplier does not have a linked customer record for netting')
      }

      const customerId = supplier.linkedCustomer.id

      // 2. Lock Customer
      await activeTx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customerId} FOR UPDATE`

      const customer = await activeTx.customer.findUnique({
        where: { id: customerId },
      })

      if (!customer) {
        throw new Error('Linked customer not found')
      }

      const supplierBalance = Number(supplier.outstandingBalance || 0)
      const customerBalance = Number(customer.outstandingBalance || 0)

      if (supplierBalance <= 0 || customerBalance <= 0) {
        throw new Error(
          `Cannot net balances: Supplier balance is ৳${supplierBalance.toLocaleString()} and Customer balance is ৳${customerBalance.toLocaleString()}. Both must be positive.`
        )
      }

      const maxNettable = Math.min(supplierBalance, customerBalance)
      if (amount > maxNettable) {
        throw new Error(
          `Settlement amount (৳${amount.toLocaleString()}) exceeds the maximum nettable balance (৳${maxNettable.toLocaleString()}).`
        )
      }

      const nettingRef = cleanIdempotencyKey || `NET-${Date.now()}`
      const outletId = options?.outletId || user.outletId || null
      const notesSuffix = options?.notes?.trim() ? ` - ${options.notes.trim()}` : ''

      // 3. Update both balances
      await activeTx.supplier.update({
        where: { id: supplierId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      await activeTx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      // 4. Create SupplierLedger entry
      const supplierLedgerEntry = await activeTx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.CREDIT,
          amount,
          description: `Party netting with linked customer ${customer.name}${notesSuffix}`,
          referenceId: nettingRef,
          reference: nettingRef,
          transactionType: 'PARTY_NETTING',
          outletId,
          createdById: user.id,
        },
      })

      // 5. Create CustomerLedger entry
      const customerLedgerEntry = await activeTx.customerLedger.create({
        data: {
          customerId,
          type: TransactionType.CREDIT,
          amount,
          description: `Party netting with linked supplier ${supplier.name}${notesSuffix}`,
          referenceId: nettingRef,
        },
      })

      // 6. Post balanced GL Entry: Dr Accounts Payable (2100) / Cr Accounts Receivable (1300)
      const coaAccounts = await activeTx.chartOfAccount.findMany({
        where: { code: { in: ['1300', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map<string, string>(coaAccounts.map((a: any) => [a.code, a.id]))
      const apAccountId = coaMap.get('2100')
      const arAccountId = coaMap.get('1300')

      if (!apAccountId || !arAccountId) {
        throw new Error('Chart of accounts missing required accounts: 2100 (AP) or 1300 (AR)')
      }

      const effectiveDate = new Date()
      const gl = [
        {
          accountId: apAccountId,
          type: TransactionType.DEBIT,
          amount,
          description: `Net settlement: ${supplier.name} AP offset against ${customer.name} AR`,
          referenceId: supplierLedgerEntry.id,
          referenceType: 'PARTY_NETTING',
          createdAt: effectiveDate,
        },
        {
          accountId: arAccountId,
          type: TransactionType.CREDIT,
          amount,
          description: `Net settlement: ${customer.name} AR offset against ${supplier.name} AP`,
          referenceId: supplierLedgerEntry.id,
          referenceType: 'PARTY_NETTING',
          createdAt: effectiveDate,
        },
      ]

      assertBalancedJournal(gl)
      await activeTx.accountLedgerEntry.createMany({ data: gl })

      return {
        supplierId,
        customerId,
        amount,
        referenceId: nettingRef,
        supplierLedgerId: supplierLedgerEntry.id,
        customerLedgerId: customerLedgerEntry.id,
        supplierNewBalance: supplierBalance - amount,
        customerNewBalance: customerBalance - amount,
        supplierName: supplier.name,
        customerName: customer.name,
      }
    }

    let result
    if (tx) {
      result = await executeSettlement(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeSettlement(innerTx), {
        maxWait: 15000,
        timeout: 30000,
      })
    }

    await logAuditDirect(user.id, 'PARTY_NET_SETTLEMENT', 'Supplier', supplierId, {
      supplierId,
      customerId: result.customerId,
      amount: result.amount,
      referenceId: result.referenceId,
      supplierName: result.supplierName,
      customerName: result.customerName,
    })

    revalidatePath('/b2b')
    revalidatePath(`/b2b/${supplierId}`)
    revalidatePath(`/suppliers/${supplierId}`)
    revalidatePath(`/customers/${result.customerId}`)
    revalidatePath('/finance')

    return ok({
      message: `Successfully netted ৳${amount.toLocaleString()} between ${result.supplierName} and ${result.customerName}`,
      ...result,
    })
  } catch (error: any) {
    console.error('Error netting party balances:', error)
    return fail(error.message || 'Failed to net party balances')
  }
}

