'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { BankTransactionType, ChequeStatus, Prisma, UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'

const bankAccountSchema = z.object({
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  bankName: z.string().min(1),
  branch: z.string().optional(),
  openingBalance: z.coerce.number().default(0),
  outletId: z.string().optional(),
  isMfs: z.boolean().default(false),
  transactionChargePct: z.coerce.number().default(0),
  cashoutChargePct: z.coerce.number().default(0),
  chargeType: z.string().default('MERCHANT_BEARS'),
})

export async function createBankAccount(
  data: z.infer<typeof bankAccountSchema>
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT
  )
  const parsed = bankAccountSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  try {
    const account = await prisma.$transaction(async tx => {
      if (user.outletId) {
        await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${user.outletId} FOR UPDATE`
      }

      const exists = await tx.bankAccount.findFirst({
        where: { accountNumber: parsed.data.accountNumber },
      })
      if (exists) throw new Error('An account with this number already exists')

      const newAcc = await tx.bankAccount.create({
        data: {
          accountName: parsed.data.accountName,
          accountNumber: parsed.data.accountNumber,
          bankName: parsed.data.bankName,
          branch: parsed.data.branch,
          openingBalance: parsed.data.openingBalance,
          currentBalance: parsed.data.openingBalance,
          outletId: user.outletId, // FORCE server-side outletId
          isMfs: parsed.data.isMfs,
          transactionChargePct: parsed.data.transactionChargePct,
          cashoutChargePct: parsed.data.cashoutChargePct,
          chargeType: parsed.data.chargeType,
        },
      })

      if (parsed.data.openingBalance > 0) {
        const bankTx = await tx.bankTransaction.create({
          data: {
            bankAccountId: newAcc.id,
            type: 'DEPOSIT',
            amount: parsed.data.openingBalance,
            description: `Opening Balance for ${newAcc.accountName}`,
          },
        })

        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: ['1110', '1200', '3200'] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const bankAcc = newAcc.isMfs
          ? (coaMap.get('1110') || coaMap.get('1200'))
          : (coaMap.get('1200') || coaMap.get('1110'))
        const equityAcc = coaMap.get('3200')

        if (!bankAcc) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
        if (!equityAcc) throw new Error('Opening balance equity account (3200) not found in Chart of Accounts')

        const gl = [
          {
            accountId: bankAcc,
            type: 'DEBIT' as const,
            amount: parsed.data.openingBalance,
            description: `Opening Balance: ${newAcc.accountName}`,
            referenceId: bankTx.id,
            referenceType: 'BankTransaction',
            createdAt: newAcc.createdAt,
          },
          {
            accountId: equityAcc,
            type: 'CREDIT' as const,
            amount: parsed.data.openingBalance,
            description: `Opening Balance: ${newAcc.accountName}`,
            referenceId: bankTx.id,
            referenceType: 'BankTransaction',
            createdAt: newAcc.createdAt,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      }

      return newAcc
    })

    revalidatePath('/finances/cash')
    return ok(account)
  } catch (err: any) {
    return fail(err.message || 'Failed to create bank account')
  }
}

const updateBankAccountSchema = z
  .object({
    accountName: z.string().min(1).optional(),
    accountNumber: z.string().min(1).optional(),
    bankName: z.string().min(1).optional(),
    branch: z.string().optional().nullable(),
    isMfs: z.boolean().optional(),
    transactionChargePct: z.coerce.number().min(0).max(100).optional(),
    cashoutChargePct: z.coerce.number().min(0).max(100).optional(),
    chargeType: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export async function updateBankAccount(
  id: string,
  data: z.infer<typeof updateBankAccountSchema>
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT
  )
  if (!id?.trim()) return fail('Invalid account ID')

  const parsed = updateBankAccountSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.bankAccount.findUnique({
    where: { id },
  })
  if (!existing) return fail('Bank account not found')
  if (existing.outletId && !validateOutletAccess(user, existing.outletId)) {
    return fail('Forbidden: Outlet access denied')
  }

  const account = await prisma.bankAccount.update({
    where: { id },
    data: parsed.data,
  })
  revalidatePath('/finances/cash')
  revalidatePath('/finances/banks')
  return ok(account)
}

const bankTxSchema = z.object({
  bankAccountId: z.string(),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER']),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
  transactionDate: z.coerce.date(),
  reference: z.string().optional(),
  counterAccountCode: z.string().optional(),
})

export async function createBankTransaction(
  data: z.infer<typeof bankTxSchema>
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.MANAGER
  )
  const parsed = bankTxSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  try {
    await prisma.$transaction(async tx => {
      // Explicit row locking on BankAccount to serialize concurrent balance checks & updates
      await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${parsed.data.bankAccountId} FOR UPDATE`

      const account = await tx.bankAccount.findUnique({
        where: { id: parsed.data.bankAccountId },
      })
      if (!account) throw new Error('Bank account not found')

      const isCredit = parsed.data.type === 'DEPOSIT'
      const delta = isCredit ? parsed.data.amount : -parsed.data.amount

      if (!isCredit && Number(account.currentBalance) < parsed.data.amount) {
        throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
      }

      let targetAccount: any = null
      if (parsed.data.type === 'TRANSFER') {
        if (!parsed.data.reference) {
          throw new Error('Target bank account is required for bank transfer')
        }
        if (parsed.data.reference === parsed.data.bankAccountId) {
          throw new Error('Cannot transfer to the same bank account')
        }
        targetAccount = await tx.bankAccount.findUnique({
          where: { id: parsed.data.reference },
        })
        if (!targetAccount) {
          throw new Error('Target bank account not found')
        }
        if (!targetAccount.isActive) {
          throw new Error('Target bank account is inactive')
        }
        await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${targetAccount.id} FOR UPDATE`
      }

      const effectiveDate = parsed.data.transactionDate ?? new Date()

      const bankTx = await tx.bankTransaction.create({
        data: {
          bankAccountId: parsed.data.bankAccountId,
          type: parsed.data.type as 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER',
          amount: parsed.data.amount,
          description: parsed.data.description,
          transactionAt: effectiveDate,
          referenceId: parsed.data.reference,
          referenceType: parsed.data.type === 'TRANSFER' ? 'BankTransfer' : undefined,
        },
      })

      await tx.bankAccount.update({
        where: { id: parsed.data.bankAccountId },
        data: { currentBalance: { increment: delta } },
      })

      if (parsed.data.type === 'TRANSFER' && targetAccount) {
        await tx.bankAccount.update({
          where: { id: targetAccount.id },
          data: { currentBalance: { increment: parsed.data.amount } },
        })
        await tx.bankTransaction.create({
          data: {
            bankAccountId: targetAccount.id,
            type: 'DEPOSIT',
            amount: parsed.data.amount,
            description: `Transfer from ${account.accountName}: ${parsed.data.description}`,
            referenceId: parsed.data.bankAccountId,
            referenceType: 'BankTransfer',
            transactionAt: effectiveDate,
          },
        })
      }

      // Fetch COA accounts for double-entry posting
      const targetCounterCode = parsed.data.counterAccountCode?.trim() || '3100'
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: {
          code: {
            in: Array.from(
              new Set(['1100', '1110', '1200', '3100', '4400', '5290', '5291', targetCounterCode])
            ),
          },
        },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const bankAcc = coaMap.get('1200') || coaMap.get('1110')
      const cashAcc = coaMap.get('1100')
      const counterAccId =
        coaMap.get(targetCounterCode) ||
        coaMap.get('3100') ||
        (parsed.data.type === 'DEPOSIT' ? coaMap.get('4400') : coaMap.get('5291')) ||
        cashAcc
      const sourceBankAccId = account.isMfs
        ? (coaMap.get('1110') || bankAcc)
        : (coaMap.get('1200') || bankAcc)

      const refId = parsed.data.reference || bankTx.id

      if (parsed.data.type === 'DEPOSIT') {
        if (!sourceBankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
        if (!counterAccId) throw new Error('Counter account not found in Chart of Accounts')

        // If explicitly transferring from Cash in Hand (1100), record the outflow in the open CashDrawer
        if (targetCounterCode === '1100' && cashAcc && counterAccId === cashAcc) {
          const targetOutletId = account.outletId || user.outletId
          const openDrawer = targetOutletId
            ? await ensureOpenDrawer(tx, targetOutletId, { now: effectiveDate })
            : null
          if (!openDrawer) {
            throw new Error(
              'No open cash drawer found to transfer cash into bank. Open a cash drawer first or use Owner Equity (3100).'
            )
          }
          await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${openDrawer.id} FOR UPDATE`
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: 'BANK_DEPOSIT',
              amount: -parsed.data.amount,
              description: `Bank Deposit to ${account.accountName}: ${parsed.data.description}`,
              referenceId: bankTx.id,
              referenceType: 'BankTransaction',
              createdAt: effectiveDate,
            },
          })
        }

        const gl = [
          {
            accountId: sourceBankAccId,
            type: 'DEBIT' as const,
            amount: parsed.data.amount,
            description: parsed.data.description,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
          {
            accountId: counterAccId,
            type: 'CREDIT' as const,
            amount: parsed.data.amount,
            description: parsed.data.description,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      } else if (parsed.data.type === 'WITHDRAWAL') {
        if (!sourceBankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
        if (!counterAccId) throw new Error('Counter account not found in Chart of Accounts')

        // If explicitly withdrawing to Cash in Hand (1100), record the inflow in the open CashDrawer
        if (targetCounterCode === '1100' && cashAcc && counterAccId === cashAcc) {
          const targetOutletId = account.outletId || user.outletId
          const openDrawer = targetOutletId
            ? await ensureOpenDrawer(tx, targetOutletId, { now: effectiveDate })
            : null
          if (!openDrawer) {
            throw new Error(
              'No open cash drawer found to receive cash withdrawal from bank. Open a cash drawer first or use Owner Equity (3100).'
            )
          }
          await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${openDrawer.id} FOR UPDATE`
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawer.id,
              type: 'BANK_WITHDRAWAL',
              amount: parsed.data.amount,
              description: `Bank Withdrawal from ${account.accountName}: ${parsed.data.description}`,
              referenceId: bankTx.id,
              referenceType: 'BankTransaction',
              createdAt: effectiveDate,
            },
          })
        }

        const gl = [
          {
            accountId: counterAccId,
            type: 'DEBIT' as const,
            amount: parsed.data.amount,
            description: parsed.data.description,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
          {
            accountId: sourceBankAccId,
            type: 'CREDIT' as const,
            amount: parsed.data.amount,
            description: parsed.data.description,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      } else if (parsed.data.type === 'TRANSFER' && targetAccount) {
        const targetBankAccId = targetAccount.isMfs
          ? (coaMap.get('1110') || bankAcc)
          : (coaMap.get('1200') || bankAcc)

        if (!sourceBankAccId || !targetBankAccId) {
          throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
        }

        const gl = [
          {
            accountId: targetBankAccId,
            type: 'DEBIT' as const,
            amount: parsed.data.amount,
            description: `Bank Transfer: ${parsed.data.description}`,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
          {
            accountId: sourceBankAccId,
            type: 'CREDIT' as const,
            amount: parsed.data.amount,
            description: `Bank Transfer: ${parsed.data.description}`,
            referenceId: refId,
            referenceType: 'BankTransaction',
            createdAt: effectiveDate,
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      }
    })

    revalidatePath('/finances/cash')
    return ok({ success: true })
  } catch (err: any) {
    return fail(err.message || 'Failed to record bank transaction')
  }
}

const chequeSchema = z.object({
  type: z.string().min(1),
  partyName: z.string().min(1),
  amount: z.coerce.number().positive(),
  chequeNumber: z.string().min(1),
  bankAccountId: z.string().min(1),
  issueDate: z.coerce.date(),
})

export async function createCheque(data: z.infer<typeof chequeSchema>) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT
  )
  const parsed = chequeSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const cheque = await prisma.cheque.create({
    data: parsed.data,
  })

  revalidatePath('/finances/cash')
  return ok(cheque)
}

export async function updateChequeStatus(
  chequeId: string,
  status: ChequeStatus
) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT
  )

  if (!chequeId?.trim()) return fail('Invalid cheque ID')

  try {
    const updatedCheque = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM "Cheque" WHERE id = ${chequeId} FOR UPDATE`
      const cheque = await tx.cheque.findUnique({
        where: { id: chequeId },
      })
      if (!cheque) throw new Error('Cheque not found')

      if (cheque.status === status) {
        if (status === ChequeStatus.CLEARED) throw new Error('Cheque is already cleared')
        if (status === ChequeStatus.BOUNCED) throw new Error('Cheque is already marked as bounced')
        if (status === ChequeStatus.CANCELLED) throw new Error('Cheque is already cancelled')
        return cheque
      }

      if (cheque.status === ChequeStatus.CLEARED && status === ChequeStatus.CLEARED) {
        throw new Error('Cheque is already cleared')
      }

      const isIncoming = ['RECEIVED', 'RECEIVE', 'INWARD', 'DEPOSIT'].includes(cheque.type.toUpperCase())
      const amountNum = Number(cheque.amount)

      // Fetch COA accounts
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1110', '1200', '1300', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const bankAccId = coaMap.get('1200') || coaMap.get('1110')
      const arAccId = coaMap.get('1300')
      const apAccId = coaMap.get('2100')

      // 1. Transitioning to CLEARED
      if (status === ChequeStatus.CLEARED) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${cheque.bankAccountId} FOR UPDATE`
        const account = await tx.bankAccount.findUnique({
          where: { id: cheque.bankAccountId },
        })
        if (!account) throw new Error('Bank account not found')

        if (isIncoming) {
          // Money enters bank account
          await tx.bankAccount.update({
            where: { id: cheque.bankAccountId },
            data: { currentBalance: { increment: amountNum } },
          })

          await tx.bankTransaction.create({
            data: {
              bankAccountId: cheque.bankAccountId,
              type: 'DEPOSIT',
              amount: cheque.amount,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              transactionAt: new Date(),
            },
          })

          if (!bankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
          if (!arAccId) throw new Error('Accounts receivable account (1300) not found in Chart of Accounts')

          const gl = [
            {
              accountId: bankAccId,
              type: 'DEBIT' as const,
              amount: amountNum,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
            {
              accountId: arAccId,
              type: 'CREDIT' as const,
              amount: amountNum,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({ data: gl })
        } else {
          // Outgoing payment clears
          if (Number(account.currentBalance) < amountNum) {
            throw new Error('Insufficient funds in bank account for cheque clearing')
          }

          await tx.bankAccount.update({
            where: { id: cheque.bankAccountId },
            data: { currentBalance: { decrement: amountNum } },
          })

          await tx.bankTransaction.create({
            data: {
              bankAccountId: cheque.bankAccountId,
              type: 'WITHDRAWAL',
              amount: cheque.amount,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              transactionAt: new Date(),
            },
          })

          if (!bankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
          if (!apAccId) throw new Error('Accounts payable account (2100) not found in Chart of Accounts')

          const gl = [
            {
              accountId: apAccId,
              type: 'DEBIT' as const,
              amount: amountNum,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
            {
              accountId: bankAccId,
              type: 'CREDIT' as const,
              amount: amountNum,
              description: `Cheque cleared: ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({ data: gl })
        }
      } else if (cheque.status === ChequeStatus.CLEARED && status === ChequeStatus.BOUNCED) {
        // 2. Previously CLEARED cheque now BOUNCES -> Reverse the financial effect!
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${cheque.bankAccountId} FOR UPDATE`
        const account = await tx.bankAccount.findUnique({
          where: { id: cheque.bankAccountId },
        })
        if (!account) throw new Error('Bank account not found')

        if (isIncoming) {
          // Reverse incoming deposit
          await tx.bankAccount.update({
            where: { id: cheque.bankAccountId },
            data: { currentBalance: { decrement: amountNum } },
          })

          await tx.bankTransaction.create({
            data: {
              bankAccountId: cheque.bankAccountId,
              type: 'WITHDRAWAL',
              amount: cheque.amount,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              transactionAt: new Date(),
            },
          })

          if (!bankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
          if (!arAccId) throw new Error('Accounts receivable account (1300) not found in Chart of Accounts')

          const gl = [
            {
              accountId: arAccId,
              type: 'DEBIT' as const,
              amount: amountNum,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
            {
              accountId: bankAccId,
              type: 'CREDIT' as const,
              amount: amountNum,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({ data: gl })
        } else {
          // Reverse outgoing payment
          await tx.bankAccount.update({
            where: { id: cheque.bankAccountId },
            data: { currentBalance: { increment: amountNum } },
          })

          await tx.bankTransaction.create({
            data: {
              bankAccountId: cheque.bankAccountId,
              type: 'DEPOSIT',
              amount: cheque.amount,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              transactionAt: new Date(),
            },
          })

          if (!bankAccId) throw new Error('Bank account (1200/1110) not found in Chart of Accounts')
          if (!apAccId) throw new Error('Accounts payable account (2100) not found in Chart of Accounts')

          const gl = [
            {
              accountId: bankAccId,
              type: 'DEBIT' as const,
              amount: amountNum,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
            {
              accountId: apAccId,
              type: 'CREDIT' as const,
              amount: amountNum,
              description: `Cheque bounced (reversal): ${cheque.chequeNumber} (${cheque.partyName})`,
              referenceId: cheque.id,
              referenceType: 'Cheque',
              createdAt: new Date(),
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({ data: gl })
        }
      }

      return await tx.cheque.update({
        where: { id: chequeId },
        data: {
          status,
          clearingDate: status === ChequeStatus.CLEARED ? new Date() : (status === ChequeStatus.BOUNCED ? null : cheque.clearingDate),
        },
      })
    })

    revalidatePath('/finances/cash')
    return ok(updatedCheque)
  } catch (err: any) {
    return fail(err.message || 'Failed to update cheque status')
  }
}

export async function deleteBankAccount(id: string) {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)

  // 1. Check for linked bank transactions
  const txCount = await prisma.bankTransaction.count({
    where: { bankAccountId: id },
  })
  if (txCount > 0)
    return fail('Cannot delete: this account has existing transactions.')

  // 2. Check for linked sale payments
  const saleCount = await prisma.salePayment.count({
    where: { bankAccountId: id },
  })
  if (saleCount > 0)
    return fail('Cannot delete: this account is linked to sale payments.')

  // 3. Check for linked purchase payments
  const purchaseCount = await prisma.purchasePayment.count({
    where: { bankAccountId: id },
  })
  if (purchaseCount > 0)
    return fail('Cannot delete: this account is linked to purchase payments.')

  // 4. Check for linked service payments
  const serviceCount = await prisma.servicePayment.count({
    where: { bankAccountId: id },
  })
  if (serviceCount > 0)
    return fail('Cannot delete: this account is linked to service payments.')

  // 5. Check for linked payroll payments
  const payrollCount = await prisma.payrollPayment.count({
    where: { bankAccountId: id },
  })
  if (payrollCount > 0)
    return fail('Cannot delete: this account is linked to payroll payments.')

  // 6. Check for linked expenses
  const expenseCount = await prisma.expense.count({
    where: { bankAccountId: id },
  })
  if (expenseCount > 0)
    return fail('Cannot delete: this account is linked to expenses.')

  // 7. Check for linked capital injections
  const capitalCount = await prisma.capitalInjection.count({
    where: { bankAccountId: id },
  })
  if (capitalCount > 0)
    return fail('Cannot delete: this account is linked to capital injections.')

  // 8. Check for linked cheques
  const chequeCount = await prisma.cheque.count({
    where: { bankAccountId: id },
  })
  if (chequeCount > 0)
    return fail('Cannot delete: this account is linked to cheques.')

  await prisma.bankAccount.delete({ where: { id } })
  revalidatePath('/finances/banks')
  return ok(null)
}

export async function getBankAccounts() {
  const user = await requireAuth()
  return withDatabaseReadFallback(
    () =>
      prisma.bankAccount.findMany({
        where: user.role === 'SUPER_ADMIN' ? {} : { outletId: user.outletId },
        include: { outlet: { select: { name: true } } },
        orderBy: { accountName: 'asc' },
      }),
    [],
    'getBankAccounts'
  )
}

export async function getBankTransactions(accountId: string) {
  await requireAuth()
  return withDatabaseReadFallback(
    () =>
      prisma.bankTransaction.findMany({
        where: { bankAccountId: accountId },
        orderBy: { transactionAt: 'desc' },
        take: 200,
      }),
    [],
    'getBankTransactions'
  )
}

// ── Bank Account Statement Types & Server Action ──────────────────────────────

export interface BankAccountStatementLine {
  sn: number
  id: string
  date: Date
  type: BankTransactionType
  typeLabel: string
  description: string
  referenceId: string | null
  referenceType: string | null
  depositAmount: number
  withdrawalAmount: number
  runningBalance: number
  isReconciled: boolean
}

export interface BankAccountStatementSummary {
  periodTotalDeposits: number
  periodTotalWithdrawals: number
  periodNetChange: number
  periodClosingBalance: number
  pageTotalDeposits: number
  pageTotalWithdrawals: number
  pageNetChange: number
  pageClosingBalance: number
}

export interface BankAccountStatementAccount {
  id: string
  accountName: string
  accountNumber: string
  bankName: string
  branch: string | null
  isMfs: boolean
  transactionChargePct: number
  cashoutChargePct: number
  chargeType: string
  openingBalance: number
  currentBalance: number
  outletId: string
  outletName: string
  isActive: boolean
  createdAt: Date
}

export interface BankAccountStatementData {
  account: BankAccountStatementAccount
  rows: BankAccountStatementLine[]
  windowOpeningBalance: number
  pageOpeningBalance: number
  summary: BankAccountStatementSummary
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface BankStatementFilters {
  page?: number
  pageSize?: number
  from?: string | Date
  to?: string | Date
  type?: 'ALL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'
  search?: string
}

export async function getBankAccountStatement(
  accountId: string,
  filters?: BankStatementFilters
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  const account = await prisma.bankAccount.findUnique({
    where: { id: accountId },
    include: { outlet: { select: { name: true } } },
  })

  if (!account) {
    return fail('Bank / MFS account not found')
  }

  if (user.role !== UserRole.SUPER_ADMIN && account.outletId !== user.outletId) {
    return fail('You do not have permission to view statements for this branch')
  }

  const page = Math.max(1, filters?.page ?? 1)
  const pageSize = Math.max(1, Math.min(200, filters?.pageSize ?? 25))

  const fromDate = filters?.from ? new Date(filters.from) : undefined
  if (fromDate) {
    fromDate.setHours(0, 0, 0, 0)
  }

  const toDate = filters?.to ? new Date(filters.to) : undefined
  if (toDate) {
    toDate.setHours(23, 59, 59, 999)
  }

  // 1. Calculate opening balance before the filtered window
  const baseOpening = Number(account.openingBalance)
  let windowOpeningBalance = baseOpening

  if (fromDate) {
    const preWindowAggs = await prisma.bankTransaction.groupBy({
      by: ['type'],
      where: {
        bankAccountId: account.id,
        transactionAt: { lt: fromDate },
      },
      _sum: { amount: true },
    })

    let preDeposits = 0
    let preWithdrawals = 0
    for (const agg of preWindowAggs) {
      const sum = Number(agg._sum.amount ?? 0)
      if (agg.type === 'DEPOSIT') preDeposits += sum
      else if (agg.type === 'WITHDRAWAL' || agg.type === 'TRANSFER') preWithdrawals += sum
    }
    windowOpeningBalance = baseOpening + preDeposits - preWithdrawals
  }

  // 2. Build where clause for the filtered window
  const windowWhere: Prisma.BankTransactionWhereInput = {
    bankAccountId: account.id,
  }

  if (fromDate || toDate) {
    windowWhere.transactionAt = {}
    if (fromDate) windowWhere.transactionAt.gte = fromDate
    if (toDate) windowWhere.transactionAt.lte = toDate
  }

  if (filters?.type && filters.type !== 'ALL') {
    windowWhere.type = filters.type as BankTransactionType
  }

  const q = filters?.search?.trim()
  if (q) {
    windowWhere.OR = [
      { description: { contains: q, mode: 'insensitive' } },
      { referenceId: { contains: q, mode: 'insensitive' } },
      { referenceType: { contains: q, mode: 'insensitive' } },
    ]
  }

  // 3. Count total matching rows and get period aggregates
  const [totalCount, periodAggs] = await Promise.all([
    prisma.bankTransaction.count({ where: windowWhere }),
    prisma.bankTransaction.groupBy({
      by: ['type'],
      where: windowWhere,
      _sum: { amount: true },
    }),
  ])

  let periodTotalDeposits = 0
  let periodTotalWithdrawals = 0
  for (const agg of periodAggs) {
    const sum = Number(agg._sum.amount ?? 0)
    if (agg.type === 'DEPOSIT') periodTotalDeposits += sum
    else if (agg.type === 'WITHDRAWAL' || agg.type === 'TRANSFER') periodTotalWithdrawals += sum
  }

  const periodNetChange = periodTotalDeposits - periodTotalWithdrawals
  const periodClosingBalance = windowOpeningBalance + periodNetChange

  // 4. Calculate page opening balance (for seamless multi-page continuity)
  const skip = (page - 1) * pageSize
  const take = pageSize

  let pageOpeningBalance = windowOpeningBalance
  if (skip > 0) {
    const searchLike = q ? `%${q}%` : null
    const filterType =
      filters?.type && filters.type !== 'ALL' ? filters.type : null
    const prevAgg = await prisma.$queryRaw<{ type: string; total: number }[]>(
      Prisma.sql`
        WITH paged AS (
          SELECT type, amount FROM "BankTransaction"
          WHERE "bankAccountId" = ${account.id}
            ${fromDate ? Prisma.sql`AND "transactionAt" >= ${fromDate}` : Prisma.empty}
            ${toDate ? Prisma.sql`AND "transactionAt" <= ${toDate}` : Prisma.empty}
            ${filterType ? Prisma.sql`AND type::text = ${filterType}` : Prisma.empty}
            ${
              searchLike
                ? Prisma.sql`AND (
                    COALESCE(description, '') ILIKE ${searchLike}
                    OR COALESCE("referenceId", '') ILIKE ${searchLike}
                    OR COALESCE("referenceType", '') ILIKE ${searchLike}
                  )`
                : Prisma.empty
            }
          ORDER BY "transactionAt" ASC, "createdAt" ASC, id ASC
          LIMIT ${skip}
        )
        SELECT type, SUM(amount) as total FROM paged GROUP BY type
      `
    )

    let prevDeposits = 0
    let prevWithdrawals = 0
    for (const row of prevAgg) {
      if (row.type === 'DEPOSIT') prevDeposits += Number(row.total)
      if (row.type === 'WITHDRAWAL' || row.type === 'TRANSFER') prevWithdrawals += Number(row.total)
    }
    pageOpeningBalance = windowOpeningBalance + prevDeposits - prevWithdrawals
  }

  // 5. Fetch rows for current page in chronological order
  const rawRows = await prisma.bankTransaction.findMany({
    where: windowWhere,
    orderBy: [{ transactionAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    skip,
    take,
  })

  let currentRunningBalance = pageOpeningBalance
  let pageTotalDeposits = 0
  let pageTotalWithdrawals = 0

  const rows: BankAccountStatementLine[] = rawRows.map((tx, idx) => {
    const amt = Number(tx.amount)
    const isIncomingTransfer =
      tx.type === 'TRANSFER' &&
      tx.referenceType === 'BankTransfer' &&
      (tx.description?.toLowerCase().includes('from') || tx.description?.toLowerCase().includes('inward'))
    const isOutgoingTransfer = tx.type === 'TRANSFER' && !isIncomingTransfer

    const depositAmount = (tx.type === 'DEPOSIT' || isIncomingTransfer) ? amt : 0
    const withdrawalAmount = (tx.type === 'WITHDRAWAL' || isOutgoingTransfer) ? amt : 0

    currentRunningBalance += depositAmount - withdrawalAmount
    pageTotalDeposits += depositAmount
    pageTotalWithdrawals += withdrawalAmount

    const typeLabel =
      tx.type === 'DEPOSIT'
        ? 'Deposit'
        : tx.type === 'WITHDRAWAL'
          ? 'Withdrawal'
          : isIncomingTransfer
            ? 'Transfer In'
            : 'Transfer Out'

    return {
      sn: skip + idx + 1,
      id: tx.id,
      date: tx.transactionAt,
      type: tx.type,
      typeLabel,
      description: tx.description,
      referenceId: tx.referenceId,
      referenceType: tx.referenceType,
      depositAmount,
      withdrawalAmount,
      runningBalance: currentRunningBalance,
      isReconciled: tx.isReconciled,
    }
  })

  const pageNetChange = pageTotalDeposits - pageTotalWithdrawals

  const summary: BankAccountStatementSummary = {
    periodTotalDeposits,
    periodTotalWithdrawals,
    periodNetChange,
    periodClosingBalance,
    pageTotalDeposits,
    pageTotalWithdrawals,
    pageNetChange,
    pageClosingBalance: currentRunningBalance,
  }

  const accountData: BankAccountStatementAccount = {
    id: account.id,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    bankName: account.bankName,
    branch: account.branch,
    isMfs: account.isMfs,
    transactionChargePct: Number(account.transactionChargePct),
    cashoutChargePct: Number(account.cashoutChargePct),
    chargeType: account.chargeType,
    openingBalance: Number(account.openingBalance),
    currentBalance: Number(account.currentBalance),
    outletId: account.outletId,
    outletName: account.outlet?.name ?? 'Main Outlet',
    isActive: account.isActive,
    createdAt: account.createdAt,
  }

  return ok({
    account: accountData,
    rows,
    windowOpeningBalance,
    pageOpeningBalance,
    summary,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  } satisfies BankAccountStatementData)
}
