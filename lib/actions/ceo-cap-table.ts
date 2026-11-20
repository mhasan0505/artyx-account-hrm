'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isCurrentUserCeo } from '@/lib/actions/money-management'
import { round2 } from '@/lib/finance/accounting-math'
import { getExecutiveBadgeLabel } from '@/lib/auth/executive-roles'

async function assertCeoAuthority() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  const isCeo = await isCurrentUserCeo()
  if (!isCeo) {
    throw new Error(
      'Forbidden: Only the CEO has authority to manage partners, shareholders, and investor segments.'
    )
  }
  return session.user
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED CAP-TABLE, SHAREHOLDER & INVESTOR SEGMENT READ
// ─────────────────────────────────────────────────────────────────────────────

export async function getCeoCapTableData() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const [
    isCeo,
    owners,
    shareholders,
    segments,
    investors,
    bankAccounts,
    activeUsers,
    userRolesSetting,
    customRolesSetting,
  ] = await Promise.all([
    isCurrentUserCeo(),
    prisma.agencyOwner.findMany({
      orderBy: [{ isActive: 'desc' }, { equityPercentage: 'desc' }],
    }),
    prisma.shareholder.findMany({
      orderBy: [{ isActive: 'desc' }, { equityPercentage: 'desc' }],
    }),
    prisma.investorSegment.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        investors: {
          select: {
            id: true,
            stage: true,
            committedAmount: true,
            investedAmount: true,
            equityPercentage: true,
          },
        },
      },
    }),
    prisma.investor.findMany({
      orderBy: [{ investedAmount: 'desc' }, { committedAmount: 'desc' }],
      include: {
        segment: { select: { id: true, name: true, instrumentType: true } },
      },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        employee: {
          select: {
            phone: true,
            designation: { select: { name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.setting.findUnique({ where: { key: 'user_custom_roles_map' } }),
    prisma.setting.findUnique({ where: { key: 'system_custom_roles' } }),
  ])

  // Resolve existing Executive users so the CEO can add partners directly from them
  let userRoleMap: Record<string, string> = {}
  let customRoles: Array<{ id: string; name?: string; label?: string }> = []
  try {
    if (userRolesSetting?.value) userRoleMap = JSON.parse(userRolesSetting.value)
    if (customRolesSetting?.value) customRoles = JSON.parse(customRolesSetting.value)
  } catch {
    // Ignore malformed role settings cleanly
  }

  const existingOwnerEmails = new Set(
    owners.map(o => o.email?.trim().toLowerCase()).filter(Boolean)
  )
  const existingOwnerNames = new Set(
    owners.map(o => o.name.trim().toLowerCase())
  )

  const executiveCandidates = activeUsers
    .map(u => {
      const assignedId = userRoleMap[u.id]
      const foundRole = assignedId
        ? customRoles.find(
            r => r.id === assignedId || r.name === assignedId || r.label === assignedId
          )
        : undefined
      const customRoleLabel = foundRole?.label || foundRole?.name || assignedId || null
      const badge = getExecutiveBadgeLabel(u.role, customRoleLabel)
      const isExecutive =
        badge !== null ||
        u.role === 'SUPER_ADMIN' ||
        u.role === 'ADMIN' ||
        Boolean(
          customRoleLabel &&
            /(CEO|COO|CMO|CTO|CFO|CHIEF|FOUNDER|DIRECTOR|PARTNER)/i.test(
              customRoleLabel
            )
        )

      if (!isExecutive) return null

      const displayTitle =
        customRoleLabel ||
        u.employee?.designation?.name ||
        (badge === 'CEO'
          ? 'Chief Executive Officer'
          : badge === 'COO'
          ? 'Chief Operating Officer'
          : badge === 'CMO'
          ? 'Chief Marketing Officer'
          : u.role === 'SUPER_ADMIN'
          ? 'Managing Partner'
          : 'Executive Director')

      const suggestedTier =
        badge === 'CEO' || u.email.toLowerCase() === 'mhasan.coder@gmail.com'
          ? 'FOUNDER'
          : badge === 'COO' || badge === 'CMO' || u.role === 'SUPER_ADMIN'
          ? 'MANAGING_PARTNER'
          : 'PARTNER'

      const isAlreadyPartner =
        existingOwnerEmails.has(u.email.trim().toLowerCase()) ||
        existingOwnerNames.has(u.name.trim().toLowerCase())

      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: u.employee?.phone ?? null,
        roleBadge: badge || customRoleLabel || u.role.replace(/_/g, ' '),
        suggestedTitle: displayTitle,
        suggestedTier,
        isAlreadyPartner,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const activeOwners = owners.filter(o => o.isActive)
  const totalPartnerEquityPct = round2(
    activeOwners.reduce((s, o) => s + Number(o.equityPercentage), 0)
  )
  const totalCapitalPool = round2(
    owners.reduce((s, o) => s + Number(o.currentCapitalBalance), 0)
  )
  const totalDrawings = round2(
    owners.reduce((s, o) => s + Number(o.totalDrawings), 0)
  )
  const totalDistributed = round2(
    owners.reduce((s, o) => s + Number(o.totalProfitDistributed), 0)
  )

  const activeShareholders = shareholders.filter(sh => sh.isActive)
  const totalShareholderEquityPct = round2(
    activeShareholders.reduce((s, sh) => s + Number(sh.equityPercentage), 0)
  )
  const totalIssuedShares = activeShareholders.reduce(
    (s, sh) => s + Number(sh.shareCount || 0),
    0
  )

  const totalInvestorCommitted = round2(
    investors
      .filter(i => i.stage !== 'PASSED')
      .reduce((s, i) => s + Number(i.committedAmount), 0)
  )
  const totalInvestorFunded = round2(
    investors.reduce((s, i) => s + Number(i.investedAmount), 0)
  )
  const totalInvestorEquityPct = round2(
    investors
      .filter(i => i.isActive && i.stage !== 'PASSED')
      .reduce((s, i) => s + Number(i.equityPercentage), 0)
  )

  return {
    isCeo,
    summary: {
      totalPartners: owners.length,
      activePartners: activeOwners.length,
      totalPartnerEquityPct,
      isPartnerEquityBalanced: Math.abs(totalPartnerEquityPct - 100) < 0.01,
      totalCapitalPool,
      totalDrawings,
      totalDistributed,
      totalShareholders: shareholders.length,
      totalShareholderEquityPct,
      totalIssuedShares,
      totalSegments: segments.length,
      totalInvestors: investors.length,
      totalInvestorCommitted,
      totalInvestorFunded,
      totalInvestorEquityPct,
    },
    owners: owners.map(o => ({
      id: o.id,
      name: o.name,
      title: o.title,
      stakeholderRole: o.stakeholderRole,
      email: o.email,
      phone: o.phone,
      equityPercentage: Number(o.equityPercentage),
      shareCount: o.shareCount,
      shareClass: o.shareClass,
      votingRights: o.votingRights,
      vestingSchedule: o.vestingSchedule,
      joinDate: o.joinDate.toISOString(),
      isActive: o.isActive,
      initialCapital: Number(o.initialCapital),
      currentCapitalBalance: Number(o.currentCapitalBalance),
      totalDrawings: Number(o.totalDrawings),
      totalProfitDistributed: Number(o.totalProfitDistributed),
      notes: o.notes,
    })),
    shareholders: shareholders.map(sh => ({
      id: sh.id,
      name: sh.name,
      email: sh.email,
      phone: sh.phone,
      holderType: sh.holderType,
      shareClass: sh.shareClass,
      shareCount: sh.shareCount,
      equityPercentage: Number(sh.equityPercentage),
      parValue: Number(sh.parValue),
      investedCapital: Number(sh.investedCapital),
      issueDate: sh.issueDate.toISOString(),
      vestingSchedule: sh.vestingSchedule,
      votingRights: sh.votingRights,
      certificateNumber: sh.certificateNumber,
      isActive: sh.isActive,
      notes: sh.notes,
    })),
    segments: segments.map(seg => {
      const committed = round2(
        seg.investors
          .filter(i => i.stage !== 'PASSED')
          .reduce((s, i) => s + Number(i.committedAmount), 0)
      )
      const funded = round2(
        seg.investors.reduce((s, i) => s + Number(i.investedAmount), 0)
      )
      const allocatedEquity = round2(
        seg.investors
          .filter(i => i.stage !== 'PASSED')
          .reduce((s, i) => s + Number(i.equityPercentage), 0)
      )
      return {
        id: seg.id,
        name: seg.name,
        code: seg.code,
        description: seg.description,
        instrumentType: seg.instrumentType,
        targetAllocation: Number(seg.targetAllocation),
        minTicketSize: Number(seg.minTicketSize),
        equityPoolPct: Number(seg.equityPoolPct),
        priority: seg.priority,
        isActive: seg.isActive,
        investorCount: seg.investors.length,
        committedTotal: committed,
        fundedTotal: funded,
        allocatedEquityPct: allocatedEquity,
      }
    }),
    investors: investors.map(inv => ({
      id: inv.id,
      segmentId: inv.segmentId,
      segmentName: inv.segment?.name ?? null,
      name: inv.name,
      organization: inv.organization,
      email: inv.email,
      phone: inv.phone,
      investorType: inv.investorType,
      stage: inv.stage,
      instrument: inv.instrument,
      committedAmount: Number(inv.committedAmount),
      investedAmount: Number(inv.investedAmount),
      equityPercentage: Number(inv.equityPercentage),
      valuationCap: inv.valuationCap ? Number(inv.valuationCap) : null,
      investedDate: inv.investedDate ? inv.investedDate.toISOString() : null,
      boardSeat: inv.boardSeat,
      notes: inv.notes,
      isActive: inv.isActive,
    })),
    bankAccounts,
    executiveCandidates,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAREHOLDER CRUD (CEO EXCLUSIVE)
// ─────────────────────────────────────────────────────────────────────────────

const shareholderSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  holderType: z.string().min(2).default('FOUNDER'),
  shareClass: z.string().min(2).default('COMMON'),
  shareCount: z.number().int().min(0).default(0),
  equityPercentage: z.number().min(0).max(100),
  parValue: z.number().min(0).default(0),
  investedCapital: z.number().min(0).default(0),
  issueDate: z.string().optional(),
  vestingSchedule: z.string().max(120).optional().nullable(),
  votingRights: z.boolean().default(true),
  certificateNumber: z.string().max(60).optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().max(400).optional().nullable(),
})

export async function createShareholderAction(
  input: z.infer<typeof shareholderSchema>
) {
  await assertCeoAuthority()
  const parsed = shareholderSchema.parse(input)

  const created = await prisma.shareholder.create({
    data: {
      name: parsed.name,
      email: parsed.email || null,
      phone: parsed.phone || null,
      holderType: parsed.holderType,
      shareClass: parsed.shareClass,
      shareCount: parsed.shareCount,
      equityPercentage: new Prisma.Decimal(parsed.equityPercentage),
      parValue: new Prisma.Decimal(parsed.parValue),
      investedCapital: new Prisma.Decimal(parsed.investedCapital),
      issueDate: parsed.issueDate ? new Date(parsed.issueDate) : new Date(),
      vestingSchedule: parsed.vestingSchedule || null,
      votingRights: parsed.votingRights,
      certificateNumber: parsed.certificateNumber || null,
      isActive: parsed.isActive,
      notes: parsed.notes || null,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true, id: created.id }
}

export async function updateShareholderAction(
  id: string,
  input: z.infer<typeof shareholderSchema>
) {
  await assertCeoAuthority()
  const parsed = shareholderSchema.parse(input)

  await prisma.shareholder.update({
    where: { id },
    data: {
      name: parsed.name,
      email: parsed.email || null,
      phone: parsed.phone || null,
      holderType: parsed.holderType,
      shareClass: parsed.shareClass,
      shareCount: parsed.shareCount,
      equityPercentage: new Prisma.Decimal(parsed.equityPercentage),
      parValue: new Prisma.Decimal(parsed.parValue),
      investedCapital: new Prisma.Decimal(parsed.investedCapital),
      ...(parsed.issueDate ? { issueDate: new Date(parsed.issueDate) } : {}),
      vestingSchedule: parsed.vestingSchedule || null,
      votingRights: parsed.votingRights,
      certificateNumber: parsed.certificateNumber || null,
      isActive: parsed.isActive,
      notes: parsed.notes || null,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}

export async function deleteShareholderAction(id: string) {
  await assertCeoAuthority()
  await prisma.shareholder.delete({ where: { id } })
  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVESTOR SEGMENT CRUD (CEO EXCLUSIVE)
// ─────────────────────────────────────────────────────────────────────────────

const investorSegmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(30).optional().nullable(),
  description: z.string().max(400).optional().nullable(),
  instrumentType: z.string().min(2).default('EQUITY'),
  targetAllocation: z.number().min(0).default(0),
  minTicketSize: z.number().min(0).default(0),
  equityPoolPct: z.number().min(0).max(100).default(0),
  priority: z.number().int().min(1).max(99).default(1),
  isActive: z.boolean().default(true),
})

export async function createInvestorSegmentAction(
  input: z.infer<typeof investorSegmentSchema>
) {
  await assertCeoAuthority()
  const parsed = investorSegmentSchema.parse(input)

  const created = await prisma.investorSegment.create({
    data: {
      name: parsed.name,
      code: parsed.code || null,
      description: parsed.description || null,
      instrumentType: parsed.instrumentType,
      targetAllocation: new Prisma.Decimal(parsed.targetAllocation),
      minTicketSize: new Prisma.Decimal(parsed.minTicketSize),
      equityPoolPct: new Prisma.Decimal(parsed.equityPoolPct),
      priority: parsed.priority,
      isActive: parsed.isActive,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true, id: created.id }
}

export async function updateInvestorSegmentAction(
  id: string,
  input: z.infer<typeof investorSegmentSchema>
) {
  await assertCeoAuthority()
  const parsed = investorSegmentSchema.parse(input)

  await prisma.investorSegment.update({
    where: { id },
    data: {
      name: parsed.name,
      code: parsed.code || null,
      description: parsed.description || null,
      instrumentType: parsed.instrumentType,
      targetAllocation: new Prisma.Decimal(parsed.targetAllocation),
      minTicketSize: new Prisma.Decimal(parsed.minTicketSize),
      equityPoolPct: new Prisma.Decimal(parsed.equityPoolPct),
      priority: parsed.priority,
      isActive: parsed.isActive,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}

export async function deleteInvestorSegmentAction(id: string) {
  await assertCeoAuthority()
  await prisma.investorSegment.delete({ where: { id } })
  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVESTOR CRUD (CEO EXCLUSIVE)
// ─────────────────────────────────────────────────────────────────────────────

const investorSchema = z.object({
  segmentId: z.string().optional().nullable(),
  name: z.string().trim().min(2).max(120),
  organization: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  investorType: z.string().min(2).default('ANGEL'),
  stage: z.string().min(2).default('COMMITTED'),
  instrument: z.string().min(2).default('EQUITY'),
  committedAmount: z.number().min(0).default(0),
  investedAmount: z.number().min(0).default(0),
  equityPercentage: z.number().min(0).max(100).default(0),
  valuationCap: z.number().min(0).optional().nullable(),
  investedDate: z.string().optional().nullable(),
  boardSeat: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(400).optional().nullable(),
})

export async function createInvestorAction(
  input: z.infer<typeof investorSchema>
) {
  await assertCeoAuthority()
  const parsed = investorSchema.parse(input)

  const created = await prisma.investor.create({
    data: {
      segmentId: parsed.segmentId || null,
      name: parsed.name,
      organization: parsed.organization || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      investorType: parsed.investorType,
      stage: parsed.stage,
      instrument: parsed.instrument,
      committedAmount: new Prisma.Decimal(parsed.committedAmount),
      investedAmount: new Prisma.Decimal(parsed.investedAmount),
      equityPercentage: new Prisma.Decimal(parsed.equityPercentage),
      valuationCap:
        parsed.valuationCap && parsed.valuationCap > 0
          ? new Prisma.Decimal(parsed.valuationCap)
          : null,
      investedDate: parsed.investedDate ? new Date(parsed.investedDate) : null,
      boardSeat: parsed.boardSeat,
      isActive: parsed.isActive,
      notes: parsed.notes || null,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true, id: created.id }
}

export async function updateInvestorAction(
  id: string,
  input: z.infer<typeof investorSchema>
) {
  await assertCeoAuthority()
  const parsed = investorSchema.parse(input)

  await prisma.investor.update({
    where: { id },
    data: {
      segmentId: parsed.segmentId || null,
      name: parsed.name,
      organization: parsed.organization || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      investorType: parsed.investorType,
      stage: parsed.stage,
      instrument: parsed.instrument,
      committedAmount: new Prisma.Decimal(parsed.committedAmount),
      investedAmount: new Prisma.Decimal(parsed.investedAmount),
      equityPercentage: new Prisma.Decimal(parsed.equityPercentage),
      valuationCap:
        parsed.valuationCap && parsed.valuationCap > 0
          ? new Prisma.Decimal(parsed.valuationCap)
          : null,
      investedDate: parsed.investedDate ? new Date(parsed.investedDate) : null,
      boardSeat: parsed.boardSeat,
      isActive: parsed.isActive,
      notes: parsed.notes || null,
    },
  })

  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}

export async function deleteInvestorAction(id: string) {
  await assertCeoAuthority()
  await prisma.investor.delete({ where: { id } })
  revalidatePath('/equity')
  revalidatePath('/equity/investors')
  return { success: true }
}
