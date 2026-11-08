'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { PaymentMethod, UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'

const customerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(1, 'Phone is required'),
  address: z.string().min(1, 'Address is required'),
  groupId: z.string().optional(),
})

const supplierSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
})

export async function createCustomer(formData: FormData) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER
  )
  const raw = Object.fromEntries(formData)
  const parsed = customerSchema.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const normalizedEmail = parsed.data.email?.trim() || undefined
  const normalizedPhone = parsed.data.phone?.trim() || undefined

  if (normalizedEmail) {
    const existingByEmail = await prisma.customer.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existingByEmail) return fail('Email already exists')
  }

  if (normalizedPhone) {
    const existingByPhone = await prisma.customer.findFirst({
      where: { phone: normalizedPhone },
      select: { id: true },
    })
    if (existingByPhone) return fail('Phone already exists')
  }

  const data = {
    ...parsed.data,
    email: normalizedEmail,
    phone: normalizedPhone,
    groupId: parsed.data.groupId || undefined,
  }

  const customer = await prisma.customer.create({ data })
  revalidatePath('/customers')
  return ok({ id: customer.id, name: customer.name })
}

export async function getCustomers() {
  await requireAuth()
  return prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      group: { select: { name: true } },
      _count: { select: { sales: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function searchCustomers(query: string) {
  await requireAuth()

  if (!query || query.trim().length < 2) {
    return []
  }

  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      outstandingBalance: true,
      group: {
        select: {
          name: true,
          discountPct: true,
        },
      },
    },
    take: 10,
    orderBy: { createdAt: 'desc' },
  })

  return customers.map(customer => ({
    ...customer,
    outstandingBalance: Number(customer.outstandingBalance),
  }))
}

export async function getCustomerById(id: string) {
  await requireAuth()

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      group: {
        select: {
          name: true,
          discountPct: true,
        },
      },
    },
  })

  return customer
}

export async function lookupCustomerByPhone(phone: string) {
  await requireAuth()
  return prisma.customer.findFirst({
    where: { phone: { contains: phone } },
    select: {
      id: true,
      name: true,
      phone: true,
      group: { select: { discountPct: true } },
    },
  })
}

export async function createSupplier(
  formDataOrInput:
    | FormData
    | (z.infer<typeof supplierSchema> & { createLinkedCustomer?: boolean | string })
) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const raw: Record<string, any> =
    formDataOrInput instanceof FormData
      ? Object.fromEntries(formDataOrInput)
      : formDataOrInput

  const parsed = supplierSchema.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const createLinkedCustomer =
    raw.createLinkedCustomer === 'true' || raw.createLinkedCustomer === true

  const data = {
    ...parsed.data,
    email: parsed.data.email?.trim() || undefined,
    phone: parsed.data.phone?.trim() || undefined,
    address: parsed.data.address?.trim() || undefined,
    country: parsed.data.country?.trim() || undefined,
  }

  try {
    const result = await prisma.$transaction(async tx => {
      const supplier = await tx.supplier.create({ data })

      if (createLinkedCustomer) {
        // Check if a customer with this email or phone already exists
        let existingCustomer = null
        if (data.email) {
          existingCustomer = await tx.customer.findFirst({
            where: { email: { equals: data.email, mode: 'insensitive' } },
          })
        }
        if (!existingCustomer && data.phone) {
          existingCustomer = await tx.customer.findFirst({
            where: { phone: data.phone },
          })
        }

        if (existingCustomer) {
          // Link existing customer to the new supplier
          await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { linkedSupplierId: supplier.id },
          })
        } else {
          try {
            await tx.customer.create({
              data: {
                name: data.name,
                email: data.email || undefined,
                phone: data.phone || undefined,
                address: data.address || undefined,
                linkedSupplierId: supplier.id,
              },
            })
          } catch (err: any) {
            // Gracefully catch unique constraint (e.g. P2002) and link to existing customer
            if (err?.code === 'P2002') {
              const matched = await tx.customer.findFirst({
                where: {
                  OR: [
                    ...(data.email ? [{ email: { equals: data.email, mode: 'insensitive' as const } }] : []),
                    ...(data.phone ? [{ phone: data.phone }] : []),
                  ],
                },
              })
              if (matched) {
                await tx.customer.update({
                  where: { id: matched.id },
                  data: { linkedSupplierId: supplier.id },
                })
              } else {
                throw err
              }
            } else {
              throw err
            }
          }
        }
      }

      return supplier
    })

    revalidatePath('/suppliers')
    revalidatePath('/b2b')
    revalidatePath('/customers')
    return ok({ id: result.id, name: result.name })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const target = (error?.meta?.target as string[]) || []
      if (target.includes('email')) {
        return fail('A supplier with this email already exists.')
      }
      return fail('A supplier with these unique details already exists.')
    }
    return fail(error?.message || 'Failed to create supplier')
  }
}

export async function updateSupplier(id: string, formData: FormData) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const raw = Object.fromEntries(formData)
  const parsed = supplierSchema.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const data = {
    ...parsed.data,
    email: parsed.data.email || undefined,
  }

  const supplier = await prisma.supplier.update({ where: { id }, data })
  revalidatePath('/suppliers')
  return ok({ id: supplier.id, name: supplier.name })
}

export async function deleteSupplier(id: string) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { _count: { select: { purchaseOrders: true } } },
  })

  if (!supplier) return fail('Supplier not found')
  if (supplier._count.purchaseOrders > 0)
    return fail('Cannot delete a supplier with existing purchase orders')

  await prisma.supplier.delete({ where: { id } })
  revalidatePath('/suppliers')
  return ok({ id })
}

export async function getSuppliers() {
  await requireAuth()
  return prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      country: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { purchaseOrders: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createCustomerGroup(formData: FormData) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const name = formData.get('name') as string
  const rawDiscount = formData.get('discountPct')
  const discountPct = rawDiscount !== null && rawDiscount !== '' ? Number(rawDiscount) : 0
  if (isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
    return fail('Discount percentage must be a valid number between 0 and 100')
  }
  if (!name?.trim()) return fail('Name is required')

  const group = await prisma.customerGroup.create({
    data: { name: name.trim(), discountPct },
  })
  revalidatePath('/customers/groups')
  return ok({ id: group.id })
}

export async function getCustomerGroups() {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  return prisma.customerGroup.findMany({
    select: {
      id: true,
      name: true,
      discountPct: true,
      createdAt: true,
      _count: { select: { customers: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function updateCustomerGroup(
  id: string,
  name: string,
  discountPct: number
) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const cleanName = name.trim()
  if (!cleanName) return fail('Name is required')
  if (isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
    return fail('Discount percentage must be a valid number between 0 and 100')
  }

  const existing = await prisma.customerGroup.findFirst({
    where: {
      name: { equals: cleanName, mode: 'insensitive' },
      id: { not: id },
    },
    select: { id: true },
  })
  if (existing) return fail('Another customer group with this name already exists')

  const group = await prisma.customerGroup.update({
    where: { id },
    data: { name: cleanName, discountPct },
  })

  revalidatePath('/customers/groups')
  revalidatePath('/master-setup')
  return ok({ id: group.id, name: group.name })
}

const payCustomerSchema = z.object({
  customerId: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.string(),
  bankAccountId: z.string().optional(),
  notes: z.string().optional(),
  chequeDate: z.string().optional(),
})

export async function receivePaymentFromCustomer(
  data: z.infer<typeof payCustomerSchema>
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER
  )

  const parsed = payCustomerSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { customerId, amount, paymentMethod, bankAccountId, chequeDate } =
    parsed.data
  let notes = parsed.data.notes
  if (paymentMethod === 'CHEQUE' && chequeDate) {
    if (!notes?.includes('[Cheque Matures:')) {
      notes = notes ? `${notes} | [Cheque Matures: ${chequeDate}]` : `[Cheque Matures: ${chequeDate}]`
    }
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  })
  if (!customer) return fail('Customer not found')

  try {
    const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100
    await prisma.$transaction(async tx => {
      // Lock Customer row to prevent concurrent over-collections
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
      const lockedCustomer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, outstandingBalance: true },
      })
      if (!lockedCustomer) throw new Error('Customer not found')

      const currentDue = round2(Math.max(0, Number(lockedCustomer.outstandingBalance || 0)))
      if (amount > currentDue + 0.01) {
        throw new Error(
          `Payment amount (৳${amount.toLocaleString()}) exceeds customer's outstanding balance (৳${currentDue.toLocaleString()})`
        )
      }

      // Create ledger entry for payment received
      await tx.customerLedger.create({
        data: {
          customerId,
          type: 'CREDIT', // Payment from customer reduces their A/R balance
          amount,
          description: `Payment received via ${paymentMethod}${notes ? ` - ${notes}` : ''}`,
          referenceId: `PAYMENT-RCV-${Date.now()}`,
        },
      })

      // Update customer outstanding balance
      await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      // Allocate payment FIFO across open Sales and ServiceInvoices
      let remaining = round2(amount)
      const resolvedMethod = (
        paymentMethod in PaymentMethod
          ? (paymentMethod as PaymentMethod)
          : PaymentMethod.CASH
      )

      if (remaining > 0) {
        const openSales = await tx.$queryRaw<Array<{ id: string; total: any; amountPaid: any }>>`
          SELECT id, total, "amountPaid" FROM "Sale"
          WHERE "customerId" = ${customerId}
            AND "isQuotation" = false
            AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
            AND "amountPaid" < total
          ORDER BY "createdAt" ASC
          FOR UPDATE
        `
        for (const sale of openSales) {
          if (remaining <= 0) break
          const due = round2(Number(sale.total) - Number(sale.amountPaid || 0))
          const applied = round2(Math.min(remaining, Math.max(0, due)))
          if (applied > 0) {
            await tx.sale.update({
              where: { id: sale.id },
              data: { amountPaid: round2(Number(sale.amountPaid || 0) + applied) },
            })
            await tx.salePayment.create({
              data: {
                saleId: sale.id,
                amount: applied,
                method: resolvedMethod,
                bankAccountId: bankAccountId || null,
              },
            })
            remaining = round2(remaining - applied)
          }
        }
      }

      if (remaining > 0) {
        const openServiceInvoices = await tx.$queryRaw<Array<{ id: string; total: any; amountPaid: any }>>`
          SELECT si.id, si.total, si."amountPaid"
          FROM "ServiceInvoice" si
          JOIN "ServiceJob" sj ON sj.id = si."jobId"
          WHERE sj."customerId" = ${customerId}
            AND si.status IN ('UNPAID', 'PARTIALLY_PAID')
            AND si."amountPaid" < si.total
          ORDER BY si."createdAt" ASC
          FOR UPDATE
        `
        for (const inv of openServiceInvoices) {
          if (remaining <= 0) break
          const due = round2(Number(inv.total) - Number(inv.amountPaid || 0))
          const applied = round2(Math.min(remaining, Math.max(0, due)))
          if (applied > 0) {
            const newPaid = round2(Number(inv.amountPaid || 0) + applied)
            const isPaid = newPaid >= round2(Number(inv.total)) - 0.01
            await tx.serviceInvoice.update({
              where: { id: inv.id },
              data: {
                amountPaid: newPaid,
                status: isPaid ? 'PAID' : 'PARTIALLY_PAID',
              },
            })
            await tx.servicePayment.create({
              data: {
                invoiceId: inv.id,
                amount: applied,
                method: resolvedMethod,
                bankAccountId: bankAccountId || null,
              },
            })
            remaining = round2(remaining - applied)
          }
        }
      }

      if (paymentMethod === 'CASH') {
        // Find active cash drawer for user's outlet
        const drawer = await ensureOpenDrawer(tx, user.outletId)

        if (!drawer) {
          throw new Error('No open cash drawer found for this outlet. Please open a cash drawer first.')
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: drawer.id,
            type: 'CUSTOMER_PAYMENT',
            amount: amount,
            description: `Payment received from customer ${customer.name}${notes ? ` - ${notes}` : ''}`,
          },
        })
      } else if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
        // Record bank transaction
        await tx.bankTransaction.create({
          data: {
            bankAccountId,
            type: 'DEPOSIT',
            amount: amount,
            description: `Payment received from customer ${customer.name}${notes ? ` - ${notes}` : ''}`,
            referenceType: 'CUSTOMER_PAYMENT',
          },
        })

        // Update bank balance
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: { increment: amount },
          },
        })
      }

      // Double-entry ledger posting for Balance Sheet sync:
      // 1100 = Cash in Hand, 1200 = Bank Accounts, 1300 = Accounts Receivable
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1110', '1200', '1300'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const cashAccId = coaMap.get('1100')
      const bankAccId = coaMap.get('1200') || coaMap.get('1110')
      const arAccId = coaMap.get('1300')
      const debitAccId = paymentMethod === 'CASH' ? cashAccId : bankAccId

      if (debitAccId && arAccId) {
        const gl = [
          {
            accountId: debitAccId,
            type: 'DEBIT' as const,
            amount,
            description: `Customer Payment received from ${customer.name}${notes ? ` - ${notes}` : ''}`,
            referenceId: customerId,
            referenceType: 'CustomerPayment',
          },
          {
            accountId: arAccId,
            type: 'CREDIT' as const,
            amount,
            description: `Customer Payment received from ${customer.name}${notes ? ` - ${notes}` : ''}`,
            referenceId: customerId,
            referenceType: 'CustomerPayment',
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      }
    })

    revalidatePath('/reports/due')
    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    revalidatePath('/finances/cash')
    revalidatePath('/finances/drawer')
    revalidatePath('/reports/cash')

    return ok({
      message: `Payment of ৳${amount.toLocaleString()} received from ${customer.name}`,
    })
  } catch (error) {
    console.error('Error recording payment:', error)
    return fail('Failed to record payment received')
  }
}

export async function getCustomerProfileData(id: string) {
  await requireAuth()

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      group: { select: { id: true, name: true, discountPct: true } },
      linkedSupplier: { select: { id: true, name: true } },
      sales: {
        select: {
          id: true,
          saleNumber: true,
          createdAt: true,
          status: true,
          total: true,
          amountPaid: true,
          cashier: { select: { name: true } },
          lines: {
            select: {
              id: true,
              product: { select: { name: true, sku: true } },
              quantity: true,
              unitPrice: true,
              total: true,
              serials: {
                select: {
                  serialUnit: { select: { serialNumber: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      serviceJobs: {
        select: {
          id: true,
          jobNumber: true,
          device: true,
          issue: true,
          status: true,
          receivedAt: true,
          estimatedCost: true,
          technician: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      ledgerEntries: {
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          referenceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!customer) return null

  // Process summary metrics
  const totalOrders = customer.sales.length
  const totalSpent = customer.sales.reduce(
    (sum, sale) => sum + Number(sale.total),
    0
  )
  const outstandingBalance = Number(customer.outstandingBalance)
  const totalServices = customer.serviceJobs.length

  // Flatten purchased items & serials
  const purchasedItems: Array<{
    lineId: string
    productName: string
    sku: string | null
    quantity: number
    unitPrice: number
    total: number
    saleNumber: string
    saleDate: Date
    serials: string[]
  }> = []

  customer.sales.forEach(sale => {
    sale.lines.forEach(line => {
      purchasedItems.push({
        lineId: line.id,
        productName: line.product.name,
        sku: line.product.sku,
        quantity: line.quantity,
        unitPrice: Number(line.unitPrice),
        total: Number(line.total),
        saleNumber: sale.saleNumber,
        saleDate: sale.createdAt,
        serials: line.serials.map(s => s.serialUnit.serialNumber),
      })
    })
  })

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    group: customer.group,
    linkedSupplier: customer.linkedSupplier,
    createdAt: customer.createdAt,
    outstandingBalance,
    totalOrders,
    totalSpent,
    totalServices,
    sales: customer.sales.map(s => ({
      ...s,
      total: Number(s.total),
      amountPaid: Number(s.amountPaid),
    })),
    serviceJobs: customer.serviceJobs.map(sj => ({
      ...sj,
      estimatedCost: sj.estimatedCost != null ? Number(sj.estimatedCost) : null,
    })),
    ledgerEntries: customer.ledgerEntries.map(l => ({
      ...l,
      amount: Number(l.amount),
    })),
    purchasedItems,
  }
}

export async function getCustomersReport(outletId?: string) {
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

  try {
    const [customers, salesMetrics] = await Promise.all([
      prisma.customer.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          outstandingBalance: true,
        },
        orderBy: {
          name: 'asc',
        },
      }),
      targetOutletId
        ? prisma.$queryRaw<{ customerId: string; totalSpent: number; totalOrders: bigint; lastPurchase: Date | null }[]>`
            SELECT "customerId", SUM(total) as "totalSpent", COUNT(id) as "totalOrders", MAX("createdAt") as "lastPurchase"
            FROM "Sale"
            WHERE status = 'COMPLETED' AND "outletId" = ${targetOutletId} AND "customerId" IS NOT NULL
            GROUP BY "customerId"
          `
        : prisma.$queryRaw<{ customerId: string; totalSpent: number; totalOrders: bigint; lastPurchase: Date | null }[]>`
            SELECT "customerId", SUM(total) as "totalSpent", COUNT(id) as "totalOrders", MAX("createdAt") as "lastPurchase"
            FROM "Sale"
            WHERE status = 'COMPLETED' AND "customerId" IS NOT NULL
            GROUP BY "customerId"
          `,
    ])

    const salesMap = new Map(
      salesMetrics.map(m => [
        m.customerId,
        {
          totalSpent: Number(m.totalSpent || 0),
          totalOrders: Number(m.totalOrders || 0),
          lastPurchase: m.lastPurchase ? new Date(m.lastPurchase).toISOString() : null,
        },
      ])
    )

    let activeCustomers = 0
    let totalRevenue = 0
    let totalDue = 0

    const customerMetrics = customers.map(customer => {
      const metrics = salesMap.get(customer.id) || {
        totalSpent: 0,
        totalOrders: 0,
        lastPurchase: null,
      }
      const due = Number(customer.outstandingBalance)
      totalDue += due
      totalRevenue += metrics.totalSpent
      if (metrics.totalOrders > 0) activeCustomers++

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalOrders: metrics.totalOrders,
        totalSpent: metrics.totalSpent,
        totalDue: due,
        lastPurchase: metrics.lastPurchase,
      }
    })

    return ok({
      totalCustomers: customers.length,
      activeCustomers,
      totalRevenue,
      totalDue,
      customers: customerMetrics,
    })
  } catch (error) {
    console.error('Error generating customers report:', error)
    return fail('Failed to generate customers report')
  }
}
