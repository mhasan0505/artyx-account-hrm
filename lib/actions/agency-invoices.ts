'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'

export type InvoiceFilterParams = {
  search?: string
  status?: string
  clientId?: string
  startDate?: Date
  endDate?: Date
  page?: number
  pageSize?: number
}

// ─────────────────────────────────────────────
// 1. INVOICE DIRECTORY & METRICS
// ─────────────────────────────────────────────

export async function getAgencyInvoices(params: InvoiceFilterParams = {}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const { search, status, clientId, startDate, endDate, page = 1, pageSize = 20 } = params
  const skip = (page - 1) * pageSize

  const where: Prisma.AgencyInvoiceWhereInput = {
    ...(status && status !== 'ALL' ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(startDate || endDate
      ? {
          issueDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { invoiceNumber: { contains: search, mode: 'insensitive' } },
            { client: { companyName: { contains: search, mode: 'insensitive' } } },
            { client: { contactPerson: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [invoices, totalCount, aggregateStats] = await Promise.all([
    prisma.agencyInvoice.findMany({
      where,
      orderBy: { issueDate: 'desc' },
      skip,
      take: pageSize,
      include: {
        client: {
          select: {
            id: true,
            companyName: true,
            contactPerson: true,
            email: true,
            phone: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            serviceCategory: true,
          },
        },
        _count: {
          select: {
            items: true,
            payments: true,
          },
        },
      },
    }),
    prisma.agencyInvoice.count({ where }),
    prisma.agencyInvoice.aggregate({
      _sum: {
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
      },
      _count: {
        id: true,
      },
    }),
  ])

  return {
    invoices,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    currentPage: page,
    summary: {
      totalInvoiced: Number(aggregateStats._sum.totalAmount || 0),
      totalReceived: Number(aggregateStats._sum.paidAmount || 0),
      totalDue: Number(aggregateStats._sum.dueAmount || 0),
      count: aggregateStats._count.id,
    },
  }
}

// ─────────────────────────────────────────────
// 2. GET INVOICE BY ID (Full Detail)
// ─────────────────────────────────────────────

export async function getAgencyInvoiceById(id: string) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  return prisma.agencyInvoice.findUnique({
    where: { id },
    include: {
      client: true,
      project: true,
      items: true,
      payments: {
        include: {
          bankAccount: {
            select: {
              accountName: true,
              bankName: true,
              accountNumber: true,
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
      },
    },
  })
}

// ─────────────────────────────────────────────
// 3. CREATE INVOICE
// ─────────────────────────────────────────────

export async function createAgencyInvoice(data: {
  clientId: string
  projectId?: string
  dueDate: Date
  issueDate?: Date
  discount?: number
  taxRate?: number
  notes?: string
  paymentTerms?: string
  items: Array<{
    description: string
    serviceCategory?: string
    quantity: number
    unitPrice: number
  }>
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  if (!data.items || data.items.length === 0) {
    throw new Error('Invoice must contain at least one line item')
  }

  // Calculate Subtotal & Line items
  let subtotal = 0
  const processedItems = data.items.map(item => {
    const qty = Number(item.quantity) || 1
    const price = Number(item.unitPrice) || 0
    const total = qty * price
    subtotal += total
    return {
      description: item.description.trim(),
      serviceCategory: item.serviceCategory || null,
      quantity: new Prisma.Decimal(qty),
      unitPrice: new Prisma.Decimal(price),
      totalPrice: new Prisma.Decimal(total),
    }
  })

  const discountAmount = Number(data.discount) || 0
  const taxRate = Number(data.taxRate) || 0
  const taxableBase = Math.max(0, subtotal - discountAmount)
  const taxAmount = (taxableBase * taxRate) / 100
  const totalAmount = taxableBase + taxAmount
  const dueAmount = totalAmount

  const subtotalDec = new Prisma.Decimal(subtotal)
  const discountDec = new Prisma.Decimal(discountAmount)
  const taxRateDec = new Prisma.Decimal(taxRate)
  const taxAmountDec = new Prisma.Decimal(taxAmount)
  const totalDec = new Prisma.Decimal(totalAmount)
  const dueDec = new Prisma.Decimal(dueAmount)

  // Generate sequential invoice number (e.g. INV-2026-0001)
  const year = (data.issueDate || new Date()).getFullYear()
  const invoiceCount = await prisma.agencyInvoice.count()
  const invoiceNumber = `INV-${year}-${(invoiceCount + 101).toString().padStart(4, '0')}`

  const newInvoice = await prisma.$transaction(async tx => {
    // 1. Create Invoice
    const inv = await tx.agencyInvoice.create({
      data: {
        invoiceNumber,
        clientId: data.clientId,
        projectId: data.projectId || null,
        issueDate: data.issueDate || new Date(),
        dueDate: data.dueDate,
        subtotal: subtotalDec,
        discount: discountDec,
        taxRate: taxRateDec,
        taxAmount: taxAmountDec,
        totalAmount: totalDec,
        paidAmount: new Prisma.Decimal(0),
        dueAmount: dueDec,
        currency: 'BDT',
        status: 'SENT',
        notes: data.notes?.trim() || null,
        paymentTerms: data.paymentTerms || 'Net 15',
        items: {
          create: processedItems,
        },
      },
      include: {
        client: true,
      },
    })

    // 2. Update Client Outstanding Balance
    const client = await tx.agencyClient.update({
      where: { id: data.clientId },
      data: {
        outstandingBalance: {
          increment: totalDec,
        },
      },
    })

    // 3. Post to Client Ledger
    await tx.clientLedger.create({
      data: {
        clientId: data.clientId,
        date: data.issueDate || new Date(),
        type: 'DEBIT',
        amount: totalDec,
        balance: client.outstandingBalance,
        reference: invoiceNumber,
        description: `Invoice ${invoiceNumber} issued for ${inv.client.companyName}`,
      },
    })

    return inv
  })

  revalidatePath('/invoices')
  revalidatePath('/clients')
  revalidatePath(`/clients/${data.clientId}`)
  revalidatePath('/accounts-receivable')
  return { success: true, invoice: newInvoice }
}

// ─────────────────────────────────────────────
// 4. RECORD PAYMENT AGAINST INVOICE
// ─────────────────────────────────────────────

export async function recordAgencyPayment(data: {
  invoiceId: string
  amount: number
  paymentMethod: string
  bankAccountId?: string
  paymentDate?: Date
  reference?: string
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const payAmount = Number(data.amount)
  if (payAmount <= 0) {
    throw new Error('Payment amount must be greater than zero')
  }

  const invoice = await prisma.agencyInvoice.findUnique({
    where: { id: data.invoiceId },
    include: { client: true },
  })

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  const currentDue = Number(invoice.dueAmount)
  if (payAmount > currentDue + 0.01) {
    throw new Error(`Payment amount (৳${payAmount}) exceeds invoice due amount (৳${currentDue})`)
  }

  const payDec = new Prisma.Decimal(payAmount)
  const payCount = await prisma.agencyPayment.count()
  const year = new Date().getFullYear()
  const paymentNumber = `PAY-${year}-${(payCount + 101).toString().padStart(4, '0')}`

  const result = await prisma.$transaction(async tx => {
    // 1. Create Payment Record
    const payment = await tx.agencyPayment.create({
      data: {
        paymentNumber,
        invoiceId: data.invoiceId,
        clientId: invoice.clientId,
        amount: payDec,
        paymentDate: data.paymentDate || new Date(),
        paymentMethod: data.paymentMethod,
        bankAccountId: data.bankAccountId || null,
        reference: data.reference?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    })

    // 2. Update Invoice Paid and Due Amounts
    const newPaidAmount = new Prisma.Decimal(invoice.paidAmount).add(payDec)
    const newDueAmount = new Prisma.Decimal(invoice.dueAmount).sub(payDec)
    const newStatus = newDueAmount.lte(0.01) ? 'PAID' : 'PARTIAL'

    await tx.agencyInvoice.update({
      where: { id: data.invoiceId },
      data: {
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount.lte(0.01) ? new Prisma.Decimal(0) : newDueAmount,
        status: newStatus,
      },
    })

    // 3. Decrement Client Outstanding Balance
    const updatedClient = await tx.agencyClient.update({
      where: { id: invoice.clientId },
      data: {
        outstandingBalance: {
          decrement: payDec,
        },
      },
    })

    // 4. Client Ledger Entry (Credit)
    await tx.clientLedger.create({
      data: {
        clientId: invoice.clientId,
        date: data.paymentDate || new Date(),
        type: 'CREDIT',
        amount: payDec,
        balance: updatedClient.outstandingBalance,
        reference: paymentNumber,
        description: `Payment received (${data.paymentMethod}) for ${invoice.invoiceNumber}`,
      },
    })

    // 5. If Bank Account specified, update Bank Account & Bank Transaction
    if (data.bankAccountId) {
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: {
            increment: payDec,
          },
        },
      })

      await tx.bankTransaction.create({
        data: {
          bankAccountId: data.bankAccountId,
          type: 'DEPOSIT',
          amount: payDec,
          description: `Agency payment ${paymentNumber} received from ${invoice.client.companyName}`,
          reference: paymentNumber,
          transactionDate: data.paymentDate || new Date(),
        },
      })
    }

    return { payment, newStatus }
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${data.invoiceId}`)
  revalidatePath('/clients')
  revalidatePath(`/clients/${invoice.clientId}`)
  revalidatePath('/accounts-receivable')
  revalidatePath('/finances/banks')
  return { success: true, ...result }
}

// ─────────────────────────────────────────────
// 5. ACCOUNTS RECEIVABLE REPORT
// ─────────────────────────────────────────────

export async function getAccountsReceivable() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const unpaidInvoices = await prisma.agencyInvoice.findMany({
    where: {
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
      dueAmount: { gt: 0 },
    },
    include: {
      client: {
        select: {
          id: true,
          companyName: true,
          contactPerson: true,
          phone: true,
          email: true,
        },
      },
      project: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  })

  const now = new Date()
  let current = 0
  let days1To30 = 0
  let days31To60 = 0
  let days60Plus = 0

  const items = unpaidInvoices.map(inv => {
    const due = Number(inv.dueAmount)
    const dueDate = new Date(inv.dueDate)
    const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays <= 0) {
      current += due
    } else if (diffDays <= 30) {
      days1To30 += due
    } else if (diffDays <= 60) {
      days31To60 += due
    } else {
      days60Plus += due
    }

    return {
      ...inv,
      overdueDays: Math.max(0, diffDays),
    }
  })

  const totalOutstanding = current + days1To30 + days31To60 + days60Plus

  return {
    invoices: items,
    agingSummary: {
      current,
      days1To30,
      days31To60,
      days60Plus,
      totalOutstanding,
    },
  }
}

