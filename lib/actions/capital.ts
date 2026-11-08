'use server'

import { requireAuth, requireRole, requireSensitiveRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { assertBalancedJournal } from '@/lib/accounting/journal'

export async function createCapitalInjection(data: {
  amount: number
  bankAccountId: string
  description: string
  injectionDate: Date
  notes?: string
}) {
  const user = await requireSensitiveRole(
    'createCapitalInjection',
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const capitalInjection = await prisma.capitalInjection.create({
    data: {
      amount: data.amount,
      bankAccountId: data.bankAccountId,
      description: data.description,
      injectionDate: data.injectionDate,
      notes: data.notes,
      createdById: user.id,
      status: 'PENDING',
    },
  })

  revalidatePath('/finances/capital')
  return ok(capitalInjection)
}

export async function approveCapitalInjection(capitalId: string) {
  const user = await requireSensitiveRole(
    'approveCapitalInjection',
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const capital = await prisma.capitalInjection.findUnique({
    where: { id: capitalId },
    include: {
      bankAccount: true,
    },
  })

  if (!capital) {
    return fail('Capital injection not found')
  }

  if (capital.status !== 'PENDING') {
    return fail('Capital injection is not pending')
  }

  try {
    await prisma.$transaction(async tx => {
      // Explicit row locking on CapitalInjection and BankAccount to prevent double-approval race conditions
      await tx.$queryRaw`SELECT id FROM "CapitalInjection" WHERE id = ${capitalId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${capital.bankAccountId} FOR UPDATE`

      const freshCapital = await tx.capitalInjection.findUnique({
        where: { id: capitalId },
      })

      if (!freshCapital || freshCapital.status !== 'PENDING') {
        throw new Error('Capital injection is no longer pending or valid')
      }

      // Update capital injection status
      await tx.capitalInjection.update({
        where: { id: capitalId },
        data: {
          status: 'APPROVED',
          approvedById: user.id,
        },
      })

      // Create bank transaction
      await tx.bankTransaction.create({
        data: {
          bankAccountId: capital.bankAccountId,
          type: 'DEPOSIT',
          amount: capital.amount,
          description: `Capital Injection: ${capital.description}`,
          referenceType: 'CAPITAL_INJECTION',
          referenceId: capitalId,
        },
      })

      // Update bank balance
      await tx.bankAccount.update({
        where: { id: capital.bankAccountId },
        data: {
          currentBalance: {
            increment: capital.amount,
          },
        },
      })

      // Fetch COA accounts for double-entry posting: Bank (1200/1110) & Equity (3000/3200)
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1200', '1110', '3000', '3200'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const bankAccId = coaMap.get('1200') || coaMap.get('1110')
      const equityAccId = coaMap.get('3000') || coaMap.get('3200')

      if (!bankAccId) {
        throw new Error('Bank account (1200 or 1110) not found in Chart of Accounts')
      }
      if (!equityAccId) {
        throw new Error('Owner Equity account (3000 or 3200) not found in Chart of Accounts')
      }

      const gl = [
        {
          accountId: bankAccId,
          type: 'DEBIT' as const,
          amount: capital.amount,
          description: `Capital Injection: ${capital.description}`,
          referenceId: capitalId,
          referenceType: 'CAPITAL_INJECTION',
          createdAt: capital.injectionDate,
        },
        {
          accountId: equityAccId,
          type: 'CREDIT' as const,
          amount: capital.amount,
          description: `Capital Injection: ${capital.description}`,
          referenceId: capitalId,
          referenceType: 'CAPITAL_INJECTION',
          createdAt: capital.injectionDate,
        },
      ]
      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({
        data: gl,
      })
    })

    revalidatePath('/finances/capital')
    revalidatePath('/finances/bank-accounts')
    return ok({ message: 'Capital injection approved successfully' })
  } catch (err: any) {
    return fail(err.message || 'Failed to approve capital injection')
  }
}

export async function rejectCapitalInjection(capitalId: string) {
  try {
    const user = await requireSensitiveRole(
      'rejectCapitalInjection',
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN
    )

    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CapitalInjection" WHERE id = ${capitalId} FOR UPDATE`

      const current = await tx.capitalInjection.findUnique({
        where: { id: capitalId },
      })

      if (!current) throw new Error('Capital injection not found')
      if (current.status !== 'PENDING') {
        throw new Error('Only pending capital injections can be rejected')
      }

      await tx.capitalInjection.update({
        where: { id: capitalId },
        data: {
          status: 'REJECTED',
          approvedById: user.id,
        },
      })
    })

    revalidatePath('/finances/capital')
    return ok({ message: 'Capital injection rejected successfully' })
  } catch (err: any) {
    return fail(err.message || 'Failed to reject capital injection')
  }
}

export async function getCapitalInjections() {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const injections = await prisma.capitalInjection.findMany({
    include: {
      bankAccount: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      injectionDate: 'desc',
    },
  })

  return injections
}

export async function getCapitalInjectionById(id: string) {
  await requireAuth()

  const injection = await prisma.capitalInjection.findUnique({
    where: { id },
    include: {
      bankAccount: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  return injection
}
