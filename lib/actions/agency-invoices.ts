'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  AgencyAccountBucket,
  JournalSourceType,
  Prisma,
  RevenueRecognitionMethod,
  TransactionType,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { notifyExecutives } from '@/lib/notifications/executive-notifier'
import { computeRealizedFxGainLoss, round2 } from '@/lib/finance/accounting-math'
import { findAccountByBucket } from '@/lib/finance/agency-coa-template'
import { postBalancedJournal } from '@/lib/finance/journal-engine'
import {
  createRevenueSchedule,
  evaluateMilestoneDeferralForInvoice,
} from '@/lib/finance/rev-rec-engine'

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
  retainerId?: string
  dueDate: Date
  issueDate?: Date
  discount?: number
  taxRate?: number
  currency?: string
  exchangeRate?: number
  deferRevenue?: boolean
  retainerMonths?: number
  notes?: string
  paymentTerms?: string
  items: Array<{
    description: string
    serviceCategory?: string
    isPassThrough?: boolean
    milestoneId?: string
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

  const currency = (data.currency || 'BDT').trim().toUpperCase()
  const exchangeRate =
    currency === 'BDT'
      ? 1
      : Number(data.exchangeRate) > 0
      ? Number(data.exchangeRate)
      : 1

  // Calculate Subtotal & Line items
  let subtotal = 0
  let passThroughForeign = 0
  const processedItems = data.items.map(item => {
    const qty = Number(item.quantity) || 1
    const price = Number(item.unitPrice) || 0
    const total = round2(qty * price)
    subtotal += total
    if (item.isPassThrough) {
      passThroughForeign += total
    }
    return {
      description: item.description.trim(),
      serviceCategory: item.serviceCategory || null,
      isPassThrough: Boolean(item.isPassThrough),
      milestoneId: item.milestoneId || null,
      quantity: new Prisma.Decimal(qty),
      unitPrice: new Prisma.Decimal(price),
      totalPrice: new Prisma.Decimal(total),
    }
  })

  subtotal = round2(subtotal)
  passThroughForeign = round2(passThroughForeign)
  const discountAmount = round2(Number(data.discount) || 0)
  const taxRate = Number(data.taxRate) || 0
  const taxableBase = Math.max(0, round2(subtotal - discountAmount))
  const taxAmount = round2((taxableBase * taxRate) / 100)
  const totalAmount = round2(taxableBase + taxAmount)
  const dueAmount = totalAmount

  const subtotalDec = new Prisma.Decimal(subtotal)
  const discountDec = new Prisma.Decimal(discountAmount)
  const taxRateDec = new Prisma.Decimal(taxRate)
  const taxAmountDec = new Prisma.Decimal(taxAmount)
  const totalDec = new Prisma.Decimal(totalAmount)
  const dueDec = new Prisma.Decimal(dueAmount)

  const issueDate = data.issueDate || new Date()
  const year = issueDate.getFullYear()
  const invoiceCount = await prisma.agencyInvoice.count()
  const invoiceNumber = `INV-${year}-${(invoiceCount + 101).toString().padStart(4, '0')}`

  const newInvoice = await prisma.$transaction(async tx => {
    // 1. Create Invoice
    const inv = await tx.agencyInvoice.create({
      data: {
        invoiceNumber,
        clientId: data.clientId,
        projectId: data.projectId || null,
        issueDate,
        dueDate: data.dueDate,
        subtotal: subtotalDec,
        discount: discountDec,
        taxRate: taxRateDec,
        taxAmount: taxAmountDec,
        totalAmount: totalDec,
        paidAmount: new Prisma.Decimal(0),
        dueAmount: dueDec,
        currency,
        exchangeRate: new Prisma.Decimal(exchangeRate),
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

    const totalBase = round2(totalAmount * exchangeRate)
    const taxBase = round2(taxAmount * exchangeRate)
    const passThroughBase = round2(passThroughForeign * exchangeRate)
    const netAgiBase = Math.max(0, round2(totalBase - taxBase - passThroughBase))

    // 2. Automated Revenue Recognition Schedule (Deferred vs. Immediate Earned)
    let deferredBase = 0
    let immediateEarnedBase = netAgiBase

    if (data.retainerMonths && data.retainerMonths > 1 && netAgiBase > 0) {
      deferredBase = netAgiBase
      immediateEarnedBase = 0
      await createRevenueSchedule(tx, {
        invoiceId: inv.id,
        projectId: data.projectId || null,
        retainerId: data.retainerId || null,
        method: RevenueRecognitionMethod.STRAIGHT_LINE_MONTHLY,
        deferredAmountBase: deferredBase,
        startDate: issueDate,
        months: data.retainerMonths,
        notes: `Straight-line ${data.retainerMonths}-month retainer amortization`,
      })
    } else if (
      data.deferRevenue ||
      data.items.some(it => Boolean(it.milestoneId) && !it.isPassThrough)
    ) {
      const evalRes = await evaluateMilestoneDeferralForInvoice(tx, {
        invoiceId: inv.id,
        projectId: data.projectId || null,
        issueDate,
        exchangeRate,
        items: data.items.map(it => ({
          milestoneId: it.milestoneId ?? null,
          isPassThrough: Boolean(it.isPassThrough),
          totalPrice: round2((Number(it.quantity) || 1) * (Number(it.unitPrice) || 0)),
        })),
        forceDeferAll: Boolean(data.deferRevenue),
      })

      // Apply invoice-level discount proportionally to netAgiBase
      const rawTotal = evalRes.totalDeferredBase + evalRes.totalImmediateEarnedBase
      const scale = rawTotal > 0 ? Math.min(1, netAgiBase / rawTotal) : 1
      deferredBase = round2(evalRes.totalDeferredBase * scale)
      immediateEarnedBase = round2(Math.max(0, netAgiBase - deferredBase))

      if (deferredBase > 0) {
        const linkedMilestoneId =
          evalRes.milestoneAllocations.find(a => a.deferredBase > 0 && a.milestoneId)
            ?.milestoneId ?? null
        await createRevenueSchedule(tx, {
          invoiceId: inv.id,
          projectId: data.projectId || null,
          retainerId: data.retainerId || null,
          method: RevenueRecognitionMethod.MILESTONE,
          deferredAmountBase: deferredBase,
          startDate: issueDate,
          milestoneId: linkedMilestoneId,
          notes: data.deferRevenue
            ? 'Upfront project deposit deferred until milestone delivery'
            : 'Partial/pre-completion milestone billing deferred until approval',
        })
      }
    }

    // Mark billed milestones if linked
    const billedMilestoneIds = data.items
      .map(i => i.milestoneId)
      .filter((id): id is string => Boolean(id))
    if (billedMilestoneIds.length > 0) {
      await tx.projectMilestone.updateMany({
        where: { id: { in: billedMilestoneIds } },
        data: { isBilled: true },
      })
    }

    // 3. Post Balanced Double-Entry Journal (Base BDT)
    const arAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.ACCOUNTS_RECEIVABLE,
      '1300'
    )
    const earnedAcctId = await findAccountByBucket(
      tx,
      data.retainerId
        ? AgencyAccountBucket.REVENUE_RETAINER
        : AgencyAccountBucket.REVENUE_PROJECT,
      data.retainerId ? '4220' : '4210'
    )
    const deferredAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.DEFERRED_REVENUE,
      '2250'
    )
    const passThroughAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.PASS_THROUGH_BILLING,
      '4290'
    )
    const vatAcct = await tx.chartOfAccount.findUnique({
      where: { code: '2300' },
      select: { id: true },
    })

    if (arAcctId && earnedAcctId && totalBase > 0) {
      const creditLines: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
      }> = []

      if (immediateEarnedBase > 0) {
        creditLines.push({
          accountId: earnedAcctId,
          type: TransactionType.CREDIT,
          amount: immediateEarnedBase,
          description: `Earned Revenue — ${invoiceNumber}`,
        })
      }
      if (deferredBase > 0) {
        creditLines.push({
          accountId: deferredAcctId ?? earnedAcctId,
          type: TransactionType.CREDIT,
          amount: deferredBase,
          description: `Deferred Revenue — ${invoiceNumber}`,
        })
      }
      if (passThroughBase > 0) {
        creditLines.push({
          accountId: passThroughAcctId ?? earnedAcctId,
          type: TransactionType.CREDIT,
          amount: passThroughBase,
          description: `Pass-Through Billing — ${invoiceNumber}`,
        })
      }
      if (taxBase > 0 && vatAcct?.id) {
        creditLines.push({
          accountId: vatAcct.id,
          type: TransactionType.CREDIT,
          amount: taxBase,
          description: `VAT Payable — ${invoiceNumber}`,
        })
      }

      const creditSum = round2(creditLines.reduce((s, l) => s + l.amount, 0))
      if (creditLines.length > 0 && Math.abs(creditSum - totalBase) <= 0.05) {
        await postBalancedJournal(tx, {
          entryDate: issueDate,
          description: `Invoice ${invoiceNumber} — ${inv.client.companyName}`,
          sourceType: JournalSourceType.INVOICE,
          sourceId: inv.id,
          createdById: session.user.id,
          lines: [
            {
              accountId: arAcctId,
              type: TransactionType.DEBIT,
              amount: creditSum,
              description: `Accounts Receivable — ${invoiceNumber}`,
              referenceId: inv.id,
              referenceType: 'AgencyInvoice',
            },
            ...creditLines.map(l => ({
              ...l,
              referenceId: inv.id,
              referenceType: 'AgencyInvoice',
            })),
          ],
        })
      }
    }

    // 4. Update Client Outstanding Balance (Base BDT)
    const totalBaseDec = new Prisma.Decimal(totalBase)
    const client = await tx.agencyClient.update({
      where: { id: data.clientId },
      data: {
        outstandingBalance: {
          increment: totalBaseDec,
        },
      },
    })

    // 5. Post to Client Ledger
    await tx.clientLedger.create({
      data: {
        clientId: data.clientId,
        date: issueDate,
        type: 'DEBIT',
        amount: totalBaseDec,
        balance: client.outstandingBalance,
        reference: invoiceNumber,
        description: `Invoice ${invoiceNumber} issued for ${inv.client.companyName}${
          currency !== 'BDT' ? ` (${currency} ${totalAmount} @ ${exchangeRate})` : ''
        }`,
      },
    })

    return inv
  })

  await notifyExecutives({
    actorId: session.user.id,
    actorName: session.user.name,
    category: 'INVOICE',
    priority: 'NORMAL',
    eventKey: 'invoice.created',
    title: `Invoice ${newInvoice.invoiceNumber} Issued`,
    body: `${currency === 'BDT' ? '৳' : `${currency} `}${Number(newInvoice.totalAmount).toLocaleString()} billed to ${newInvoice.client.companyName} by ${session.user.name || 'Executive'}.`,
    url: `/invoices/${newInvoice.id}`,
    metadata: { invoiceId: newInvoice.id, clientId: data.clientId },
  })

  revalidatePath('/invoices')
  revalidatePath('/clients')
  revalidatePath(`/clients/${data.clientId}`)
  revalidatePath('/accounts-receivable')
  revalidatePath('/finances/profit-loss')
  revalidatePath('/finances/revenue-recognition')
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
  settlementRate?: number
  reference?: string
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const payAmount = round2(Number(data.amount))
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
    throw new Error(`Payment amount (${payAmount}) exceeds invoice due amount (${currentDue})`)
  }

  const currency = invoice.currency || 'BDT'
  const invoiceRate = Number(invoice.exchangeRate || 1)
  const settlementRate =
    currency === 'BDT'
      ? 1
      : Number(data.settlementRate) > 0
      ? Number(data.settlementRate)
      : invoiceRate

  const fx = computeRealizedFxGainLoss({
    amountForeign: payAmount,
    invoiceRate,
    settlementRate,
  })

  const payDec = new Prisma.Decimal(payAmount)
  const baseDec = new Prisma.Decimal(fx.settledBase)
  const bookedBaseDec = new Prisma.Decimal(fx.bookedBase)
  const payCount = await prisma.agencyPayment.count()
  const paymentDate = data.paymentDate || new Date()
  const year = paymentDate.getFullYear()
  const paymentNumber = `PAY-${year}-${(payCount + 101).toString().padStart(4, '0')}`

  const result = await prisma.$transaction(async tx => {
    // 1. Create Payment Record with Realized FX Gain/Loss
    const payment = await tx.agencyPayment.create({
      data: {
        paymentNumber,
        invoiceId: data.invoiceId,
        clientId: invoice.clientId,
        amount: payDec,
        currency,
        settlementRate: new Prisma.Decimal(settlementRate),
        baseAmount: baseDec,
        realizedFxGainLoss: new Prisma.Decimal(fx.realizedGainLoss),
        paymentDate,
        paymentMethod: data.paymentMethod,
        bankAccountId: data.bankAccountId || null,
        reference: data.reference?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    })

    // 2. Update Invoice Paid and Due Amounts (in invoice currency)
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

    // 3. Decrement Client Outstanding Balance (booked base BDT)
    const updatedClient = await tx.agencyClient.update({
      where: { id: invoice.clientId },
      data: {
        outstandingBalance: {
          decrement: bookedBaseDec,
        },
      },
    })

    // 4. Client Ledger Entry (Credit)
    await tx.clientLedger.create({
      data: {
        clientId: invoice.clientId,
        date: paymentDate,
        type: 'CREDIT',
        amount: bookedBaseDec,
        balance: updatedClient.outstandingBalance,
        reference: paymentNumber,
        description: `Payment received (${data.paymentMethod}) for ${invoice.invoiceNumber}${
          fx.realizedGainLoss !== 0
            ? ` · FX ${fx.realizedGainLoss > 0 ? 'Gain' : 'Loss'} ৳${Math.abs(fx.realizedGainLoss).toLocaleString()}`
            : ''
        }`,
      },
    })

    // 5. If Bank Account specified, deposit actual settled BDT amount
    if (data.bankAccountId) {
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: {
            increment: baseDec,
          },
        },
      })

      await tx.bankTransaction.create({
        data: {
          bankAccountId: data.bankAccountId,
          type: 'DEPOSIT',
          amount: baseDec,
          description: `Agency payment ${paymentNumber} received from ${invoice.client.companyName}`,
          reference: paymentNumber,
          transactionDate: paymentDate,
        },
      })
    }

    // 6. Post Balanced Double-Entry Settlement Journal (with Realized FX line if non-zero)
    const cashOrBankAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.CASH_AND_BANK,
      data.bankAccountId ? '1200' : '1100'
    )
    const arAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.ACCOUNTS_RECEIVABLE,
      '1300'
    )
    const fxAcctId = await findAccountByBucket(
      tx,
      AgencyAccountBucket.FX_GAIN_LOSS,
      '4500'
    )

    if (cashOrBankAcctId && arAcctId && fx.settledBase > 0) {
      const lines: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
      }> = [
        {
          accountId: cashOrBankAcctId,
          type: TransactionType.DEBIT,
          amount: fx.settledBase,
          description: `Cash/Bank Receipt — ${paymentNumber} (${invoice.invoiceNumber})`,
          referenceId: payment.id,
          referenceType: 'AgencyPayment',
        },
        {
          accountId: arAcctId,
          type: TransactionType.CREDIT,
          amount: fx.bookedBase,
          description: `Clear AR — ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'AgencyPayment',
        },
      ]

      if (fx.realizedGainLoss !== 0 && fxAcctId) {
        lines.push({
          accountId: fxAcctId,
          type:
            fx.realizedGainLoss > 0
              ? TransactionType.CREDIT
              : TransactionType.DEBIT,
          amount: Math.abs(fx.realizedGainLoss),
          description: `Realized FX ${fx.realizedGainLoss > 0 ? 'Gain' : 'Loss'} — ${invoice.invoiceNumber}`,
          referenceId: payment.id,
          referenceType: 'AgencyPayment',
        })
      }

      if (fx.realizedGainLoss === 0 || fxAcctId) {
        await postBalancedJournal(tx, {
          entryDate: paymentDate,
          description: `Payment ${paymentNumber} for ${invoice.invoiceNumber}`,
          sourceType:
            fx.realizedGainLoss !== 0
              ? JournalSourceType.FX_SETTLEMENT
              : JournalSourceType.PAYMENT,
          sourceId: payment.id,
          createdById: session.user.id,
          lines,
        })
      }
    }

    return { payment, newStatus, realizedFxGainLoss: fx.realizedGainLoss }
  })

  await notifyExecutives({
    actorId: session.user.id,
    actorName: session.user.name,
    category: 'PAYMENT',
    priority: 'HIGH',
    eventKey: 'invoice.payment_received',
    title: `Payment Received: ৳${fx.settledBase.toLocaleString()}`,
    body: `${invoice.client.companyName} paid via ${data.paymentMethod} for ${invoice.invoiceNumber} (${result.newStatus}) — logged by ${session.user.name || 'Executive'}.`,
    url: `/invoices/${data.invoiceId}`,
    metadata: { invoiceId: data.invoiceId, paymentNumber },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${data.invoiceId}`)
  revalidatePath('/clients')
  revalidatePath(`/clients/${invoice.clientId}`)
  revalidatePath('/accounts-receivable')
  revalidatePath('/finances/banks')
  revalidatePath('/finances/profit-loss')
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

