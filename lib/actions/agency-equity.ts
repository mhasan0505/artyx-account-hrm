'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'

// ─────────────────────────────────────────────
// 1. OWNERS & EQUITY OVERVIEW
// ─────────────────────────────────────────────

export async function getAgencyOwners() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const owners = await prisma.agencyOwner.findMany({
    orderBy: { equityPercentage: 'desc' },
    include: {
      drawings: {
        orderBy: { drawingDate: 'desc' },
        take: 5,
      },
      distributions: {
        include: {
          batch: true,
        },
        orderBy: { batch: { periodEndDate: 'desc' } },
        take: 5,
      },
      _count: {
        select: {
          drawings: true,
          distributions: true,
          ledger: true,
        },
      },
    },
  })

  const totalEquity = owners.reduce(
    (sum, o) => sum + Number(o.equityPercentage),
    0
  )
  const totalCapital = owners.reduce(
    (sum, o) => sum + Number(o.currentCapitalBalance),
    0
  )
  const totalDrawings = owners.reduce(
    (sum, o) => sum + Number(o.totalDrawings),
    0
  )
  const totalProfitDistributed = owners.reduce(
    (sum, o) => sum + Number(o.totalProfitDistributed),
    0
  )

  return {
    owners,
    summary: {
      totalOwners: owners.length,
      totalEquityPercentage: totalEquity,
      isEquityBalanced: Math.abs(totalEquity - 100) < 0.01,
      totalCapitalPool: totalCapital,
      totalCumulativeDrawings: totalDrawings,
      totalCumulativeDistributed: totalProfitDistributed,
    },
  }
}

// ─────────────────────────────────────────────
// 2. CREATE & UPDATE OWNER
// ─────────────────────────────────────────────

export async function createAgencyOwner(data: {
  name: string
  title: string
  email?: string
  phone?: string
  equityPercentage: number
  initialCapital?: number
  joinDate?: Date
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const equityDec = new Prisma.Decimal(data.equityPercentage)
  const capitalDec = new Prisma.Decimal(data.initialCapital || 0)

  const owner = await prisma.$transaction(async tx => {
    const newOwner = await tx.agencyOwner.create({
      data: {
        name: data.name.trim(),
        title: data.title.trim(),
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        equityPercentage: equityDec,
        initialCapital: capitalDec,
        currentCapitalBalance: capitalDec,
        totalDrawings: new Prisma.Decimal(0),
        totalProfitDistributed: new Prisma.Decimal(0),
        joinDate: data.joinDate || new Date(),
        notes: data.notes?.trim() || null,
        isActive: true,
      },
    })

    if (capitalDec.gt(0)) {
      await tx.ownerEquityLedger.create({
        data: {
          ownerId: newOwner.id,
          date: data.joinDate || new Date(),
          entryType: 'CAPITAL_INJECTED',
          amount: capitalDec,
          balance: capitalDec,
          reference: 'INITIAL_CAPITAL',
          description: `Initial capital contribution of ৳${capitalDec.toNumber().toLocaleString()}`,
        },
      })
    }

    return newOwner
  })

  revalidatePath('/equity')
  return { success: true, owner }
}

export async function updateAgencyOwner(
  id: string,
  data: Partial<{
    name: string
    title: string
    email: string
    phone: string
    equityPercentage: number
    isActive: boolean
    notes: string
  }>
) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const updated = await prisma.agencyOwner.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name.trim() } : {}),
      ...(data.title ? { title: data.title.trim() } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.equityPercentage !== undefined
        ? { equityPercentage: new Prisma.Decimal(data.equityPercentage) }
        : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
  })

  revalidatePath('/equity')
  revalidatePath(`/equity/${id}`)
  return { success: true, owner: updated }
}

// ─────────────────────────────────────────────
// 3. OWNER DRAWINGS (Personal Withdrawals)
// ─────────────────────────────────────────────

export async function recordOwnerDrawing(data: {
  ownerId: string
  amount: number
  drawingDate?: Date
  paymentMethod?: string
  bankAccountId?: string
  reason?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const drawAmount = Number(data.amount)
  if (drawAmount <= 0) {
    throw new Error('Drawing amount must be greater than zero')
  }

  const owner = await prisma.agencyOwner.findUnique({
    where: { id: data.ownerId },
  })

  if (!owner) {
    throw new Error('Owner not found')
  }

  const drawDec = new Prisma.Decimal(drawAmount)
  const drawCount = await prisma.ownerDrawing.count()
  const year = new Date().getFullYear()
  const drawingNumber = `DRW-${year}-${(drawCount + 101).toString().padStart(4, '0')}`

  const result = await prisma.$transaction(async tx => {
    // 1. Create Drawing Record
    const drawing = await tx.ownerDrawing.create({
      data: {
        drawingNumber,
        ownerId: data.ownerId,
        amount: drawDec,
        drawingDate: data.drawingDate || new Date(),
        paymentMethod: data.paymentMethod || 'BANK_TRANSFER',
        bankAccountId: data.bankAccountId || null,
        reason: data.reason?.trim() || 'Personal drawing against profit share',
        status: 'APPROVED',
      },
    })

    // 2. Update Owner Capital & Total Drawings
    const newCapitalBalance = new Prisma.Decimal(owner.currentCapitalBalance).sub(drawDec)
    const newTotalDrawings = new Prisma.Decimal(owner.totalDrawings).add(drawDec)

    await tx.agencyOwner.update({
      where: { id: data.ownerId },
      data: {
        currentCapitalBalance: newCapitalBalance,
        totalDrawings: newTotalDrawings,
      },
    })

    // 3. Owner Equity Ledger Entry
    await tx.ownerEquityLedger.create({
      data: {
        ownerId: data.ownerId,
        date: data.drawingDate || new Date(),
        entryType: 'DRAWING',
        amount: drawDec,
        balance: newCapitalBalance,
        reference: drawingNumber,
        description: `Drawing of ৳${drawAmount.toLocaleString()} (${data.reason || 'Personal drawing'})`,
      },
    })

    // 4. Update Bank Account if paid from Bank
    if (data.bankAccountId) {
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: {
            decrement: drawDec,
          },
        },
      })

      await tx.bankTransaction.create({
        data: {
          bankAccountId: data.bankAccountId,
          type: 'WITHDRAWAL',
          amount: drawDec,
          description: `Owner Drawing: ${owner.name} (${drawingNumber})`,
          reference: drawingNumber,
          transactionDate: data.drawingDate || new Date(),
        },
      })
    }

    return drawing
  })

  revalidatePath('/equity')
  revalidatePath(`/equity/${data.ownerId}`)
  revalidatePath('/equity/drawings')
  revalidatePath('/finances/banks')
  return { success: true, drawing: result }
}

// ─────────────────────────────────────────────
// 4. PROFIT SHARE DISTRIBUTION ENGINE
// ─────────────────────────────────────────────

export async function calculateProfitDistributionPreview(params: {
  startDate: Date
  endDate: Date
  retainedReservePercentage?: number
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const { startDate, endDate, retainedReservePercentage = 20 } = params

  // 1. Calculate Invoiced Revenue in period
  const revenueAgg = await prisma.agencyInvoice.aggregate({
    where: {
      issueDate: { gte: startDate, lte: endDate },
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    },
    _sum: { totalAmount: true },
  })
  const totalRevenue = Number(revenueAgg._sum.totalAmount || 0)

  // 2. Calculate Expenses in period
  const expenseAgg = await prisma.expense.aggregate({
    where: {
      expenseDate: { gte: startDate, lte: endDate },
      status: 'APPROVED',
    },
    _sum: { amount: true },
  })
  const totalExpenses = Number(expenseAgg._sum.amount || 0)

  // 3. Net Operating Profit
  const netProfit = Math.max(0, totalRevenue - totalExpenses)
  const retainedPct = Math.min(100, Math.max(0, retainedReservePercentage))
  const retainedAmount = (netProfit * retainedPct) / 100
  const distributableProfit = Math.max(0, netProfit - retainedAmount)

  // 4. Fetch Active Owners & Their Drawings in this period
  const owners = await prisma.agencyOwner.findMany({
    where: { isActive: true },
    orderBy: { equityPercentage: 'desc' },
  })

  const ownerBreakdown = await Promise.all(
    owners.map(async owner => {
      const eqPct = Number(owner.equityPercentage)
      const calculatedShare = (distributableProfit * eqPct) / 100

      // Drawings taken in this exact period
      const drawingsAgg = await prisma.ownerDrawing.aggregate({
        where: {
          ownerId: owner.id,
          drawingDate: { gte: startDate, lte: endDate },
          status: 'APPROVED',
        },
        _sum: { amount: true },
      })
      const drawingsInPeriod = Number(drawingsAgg._sum.amount || 0)
      const netPayable = Math.max(0, calculatedShare - drawingsInPeriod)

      return {
        ownerId: owner.id,
        name: owner.name,
        title: owner.title,
        equityPercentage: eqPct,
        calculatedShare,
        drawingsInPeriod,
        netPayable,
      }
    })
  )

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    retainedReservePercentage: retainedPct,
    retainedReserveAmount: retainedAmount,
    distributableProfit,
    owners: ownerBreakdown,
  }
}

export async function createProfitDistributionBatch(data: {
  title: string
  periodStartDate: Date
  periodEndDate: Date
  periodType: string
  retainedReservePercentage: number
  notes?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const preview = await calculateProfitDistributionPreview({
    startDate: data.periodStartDate,
    endDate: data.periodEndDate,
    retainedReservePercentage: data.retainedReservePercentage,
  })

  if (preview.distributableProfit <= 0) {
    throw new Error('Distributable profit is zero or negative for the selected period')
  }

  const batchCount = await prisma.profitDistributionBatch.count()
  const year = new Date().getFullYear()
  const batchNumber = `DIST-${year}-${(batchCount + 101).toString().padStart(4, '0')}`

  const batch = await prisma.profitDistributionBatch.create({
    data: {
      batchNumber,
      title: data.title.trim(),
      periodStartDate: data.periodStartDate,
      periodEndDate: data.periodEndDate,
      periodType: data.periodType,
      totalRevenue: new Prisma.Decimal(preview.totalRevenue),
      totalExpenses: new Prisma.Decimal(preview.totalExpenses),
      netProfit: new Prisma.Decimal(preview.netProfit),
      retainedReservePercentage: new Prisma.Decimal(preview.retainedReservePercentage),
      retainedReserveAmount: new Prisma.Decimal(preview.retainedReserveAmount),
      distributableProfit: new Prisma.Decimal(preview.distributableProfit),
      totalDistributed: new Prisma.Decimal(preview.distributableProfit),
      status: 'APPROVED',
      notes: data.notes?.trim() || null,
      createdById: session.user.id || 'system',
      lines: {
        create: preview.owners.map(o => ({
          ownerId: o.ownerId,
          equityPercentage: new Prisma.Decimal(o.equityPercentage),
          calculatedShare: new Prisma.Decimal(o.calculatedShare),
          drawingsDeducted: new Prisma.Decimal(o.drawingsInPeriod),
          netPayable: new Prisma.Decimal(o.netPayable),
          paidAmount: new Prisma.Decimal(0),
          paymentStatus: 'PENDING',
        })),
      },
    },
    include: {
      lines: {
        include: { owner: true },
      },
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/distributions')
  return { success: true, batch }
}

export async function disburseOwnerProfitLine(data: {
  lineId: string
  paidAmount: number
  paymentMethod: string
  bankAccountId?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const line = await prisma.ownerDistributionLine.findUnique({
    where: { id: data.lineId },
    include: {
      owner: true,
      batch: true,
    },
  })

  if (!line) {
    throw new Error('Distribution line not found')
  }

  const payDec = new Prisma.Decimal(data.paidAmount)

  await prisma.$transaction(async tx => {
    // 1. Update Distribution Line
    await tx.ownerDistributionLine.update({
      where: { id: data.lineId },
      data: {
        paidAmount: payDec,
        paymentStatus: 'PAID',
        paymentMethod: data.paymentMethod,
        bankAccountId: data.bankAccountId || null,
        paidAt: new Date(),
      },
    })

    // 2. Update Owner Total Profit Distributed & Capital Balance
    await tx.agencyOwner.update({
      where: { id: line.ownerId },
      data: {
        totalProfitDistributed: {
          increment: payDec,
        },
      },
    })

    // 3. Post to Owner Equity Ledger
    await tx.ownerEquityLedger.create({
      data: {
        ownerId: line.ownerId,
        date: new Date(),
        entryType: 'PAYOUT',
        amount: payDec,
        balance: line.owner.currentCapitalBalance,
        reference: line.batch.batchNumber,
        description: `Profit share payout for ${line.batch.title} (${data.paymentMethod})`,
      },
    })

    // 4. Bank debit if paid via Bank
    if (data.bankAccountId) {
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: {
            decrement: payDec,
          },
        },
      })

      await tx.bankTransaction.create({
        data: {
          bankAccountId: data.bankAccountId,
          type: 'WITHDRAWAL',
          amount: payDec,
          description: `Partner Dividend Payout: ${line.owner.name} (${line.batch.batchNumber})`,
          reference: line.batch.batchNumber,
          transactionDate: new Date(),
        },
      })
    }
  })

  revalidatePath('/equity')
  revalidatePath('/equity/distributions')
  revalidatePath(`/equity/${line.ownerId}`)
  return { success: true }
}

export async function getAllDistributionBatches() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  return prisma.profitDistributionBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      lines: {
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              title: true,
              equityPercentage: true,
            },
          },
        },
      },
    },
  })
}

// ─────────────────────────────────────────────
// 5. OWNER 360° EQUITY PROFILE & LEDGER
// ─────────────────────────────────────────────

export async function getAgencyOwnerById(id: string) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const owner = await prisma.agencyOwner.findUnique({
    where: { id },
    include: {
      drawings: {
        orderBy: { drawingDate: 'desc' },
        include: {
          bankAccount: {
            select: {
              accountName: true,
              bankName: true,
            },
          },
        },
      },
      distributions: {
        include: {
          batch: true,
        },
        orderBy: { paidAt: 'desc' },
      },
      ledger: {
        orderBy: { date: 'desc' },
      },
    },
  })

  return owner
}

