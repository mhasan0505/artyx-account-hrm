'use server'

import { requireAuth, requireRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { assertBalancedJournal } from '@/lib/accounting/journal'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Helper function to calculate transfer charges
const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100

function calculateTransferCharge(
  amount: number,
  isMfs: boolean,
  cashoutChargePct: number,
  transactionChargePct: number
): { chargeAmount: number; netAmount: number; chargePct: number } {
  // MFS uses cashoutChargePct, Bank uses transactionChargePct
  const chargePct = isMfs ? cashoutChargePct : transactionChargePct
  const chargeAmount = round2((amount * chargePct) / 100)
  const netAmount = round2(amount - chargeAmount)

  return { chargeAmount, netAmount, chargePct }
}

// Server action to get charge estimate for UI
export async function getTransferChargeEstimate(
  bankAccountId: string,
  amount: number
) {
  await requireAuth()

  const account = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: {
      isMfs: true,
      cashoutChargePct: true,
      transactionChargePct: true,
    },
  })

  if (!account) {
    return fail('Bank account not found')
  }

  const { chargeAmount, netAmount, chargePct } = calculateTransferCharge(
    amount,
    account.isMfs,
    Number(account.cashoutChargePct),
    Number(account.transactionChargePct)
  )

  return ok({ chargeAmount, netAmount, chargePct })
}

const createTransferSchema = z.object({
  type: z.enum(['DRAWER_TO_BANK', 'BANK_TO_DRAWER']),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  bankAccountId: z.string().optional(),
  drawerId: z.string().optional(),
  notes: z.string().optional(),
})

export async function createContraTransfer(
  data: z.infer<typeof createTransferSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER
  )
  const parsed = createTransferSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { type, amount, bankAccountId, drawerId, notes } = parsed.data

  if (type === 'DRAWER_TO_BANK' && (!drawerId || !bankAccountId)) {
    return fail('Cash drawer and target bank account are required.')
  }
  if (type === 'BANK_TO_DRAWER' && (!bankAccountId || !drawerId)) {
    return fail('Source bank account and cash drawer are required.')
  }

  const client = tx ?? prisma

  const transfer = await client.contraTransfer.create({
    data: {
      type,
      amount,
      bankAccountId: bankAccountId || null,
      drawerId: drawerId || null,
      createdById: user.id,
      status: 'PENDING',
      notes: notes || null,
    },
  })

  revalidatePath('/finances/transfers')
  return ok(transfer)
}

export async function approveContraTransfer(
  transferId: string,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )

  const client = tx ?? prisma

  const transfer = await client.contraTransfer.findUnique({
    where: { id: transferId },
    include: {
      bankAccount: true,
      drawer: {
        include: {
          outlet: { select: { id: true } },
        },
      },
    },
  })

  if (!transfer) return fail('Transfer not found.')
  if (transfer.status !== 'PENDING')
    return fail(`Transfer is already ${transfer.status}`)

  if (
    user.role !== UserRole.SUPER_ADMIN &&
    transfer.drawer?.outlet?.id &&
    user.outletId !== transfer.drawer.outlet.id
  ) {
    return fail('Not authorized to approve transfer for this outlet')
  }

  if (transfer.drawer && transfer.drawer.status !== 'OPEN') {
    return fail('Source cash drawer must be open to process contra transfer')
  }

  try {
    const executeApproval = async (activeTx: PrismaTx) => {
      // Explicit row locking on ContraTransfer to prevent double-approval
      await activeTx.$queryRaw`SELECT id FROM "ContraTransfer" WHERE id = ${transferId} FOR UPDATE`

      const freshTransfer = await activeTx.contraTransfer.findUnique({
        where: { id: transferId },
      })
      if (!freshTransfer || freshTransfer.status !== 'PENDING') {
        throw new Error(`Transfer is already ${freshTransfer?.status ?? 'processed'}`)
      }

      if (transfer.drawerId) {
        await activeTx.$queryRaw`SELECT id FROM "CashDrawer" WHERE id = ${transfer.drawerId} FOR UPDATE`
        const lockedDrawer = await activeTx.cashDrawer.findUnique({
          where: { id: transfer.drawerId },
          select: { id: true, status: true },
        })
        if (!lockedDrawer || lockedDrawer.status !== 'OPEN') {
          throw new Error('Source cash drawer must be open to process contra transfer')
        }
      }
      if (transfer.bankAccountId) {
        await activeTx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${transfer.bankAccountId} FOR UPDATE`
      }

      // Fetch COA accounts for double-entry ledger posting
      const coaAccounts = await activeTx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1110', '1200'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const cashAcc = coaMap.get('1100')
      const bankAcc = coaMap.get('1200') || coaMap.get('1110')
      const ledgerEntries: any[] = []

      // 1. Update transfer status
      const updatedTransfer = await activeTx.contraTransfer.update({
        where: { id: transferId },
        data: {
          status: 'APPROVED',
          approvedById: user.id,
        },
      })

      // 2. Perform double-entry for the transfer with balance checks
      if (transfer.type === 'DRAWER_TO_BANK') {
        // Balance check for drawer
        const stats = await activeTx.drawerTransaction.aggregate({
          where: { drawerId: transfer.drawerId! },
          _sum: { amount: true },
        })
        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < Number(transfer.amount)) {
          throw new Error(
            `Insufficient cash in drawer. Available: ${cashBalance.toLocaleString()}, Required: ${Number(transfer.amount).toLocaleString()}`
          )
        }

        // Deduct from Drawer
        await activeTx.drawerTransaction.create({
          data: {
            drawerId: transfer.drawerId!,
            type: DRAWER_TX_TYPE.CASH_OUT,
            amount: -transfer.amount,
            description: `Bank Deposit - TRN-${transfer.id.slice(-6)}`,
            referenceId: transfer.id,
            referenceType: BANK_TX_REF_TYPE.CONTRA_TRANSFER,
          },
        })

        // Add to Bank
        await activeTx.bankTransaction.create({
          data: {
            bankAccountId: transfer.bankAccountId!,
            type: 'DEPOSIT',
            amount: transfer.amount,
            description: `Cash Deposit - TRN-${transfer.id.slice(-6)}`,
            referenceId: transfer.id,
            referenceType: BANK_TX_REF_TYPE.CONTRA_TRANSFER,
          },
        })
        await activeTx.bankAccount.update({
          where: { id: transfer.bankAccountId! },
          data: { currentBalance: { increment: transfer.amount } },
        })

        if (cashAcc && bankAcc) {
          ledgerEntries.push(
            {
              accountId: bankAcc,
              type: 'DEBIT',
              amount: transfer.amount,
              description: `Cash Deposit - TRN-${transfer.id.slice(-6)}`,
              referenceId: transfer.id,
              referenceType: 'ContraTransfer',
            },
            {
              accountId: cashAcc,
              type: 'CREDIT',
              amount: transfer.amount,
              description: `Bank Deposit - TRN-${transfer.id.slice(-6)}`,
              referenceId: transfer.id,
              referenceType: 'ContraTransfer',
            }
          )
        }
      } else if (transfer.type === 'BANK_TO_DRAWER') {
        const bank = transfer.bankAccount
        if (!bank) throw new Error('Bank account not found')

        // Balance check for bank
        const freshBank = await activeTx.bankAccount.findUnique({
          where: { id: transfer.bankAccountId! },
          select: { currentBalance: true },
        })
        if (!freshBank) throw new Error('Source bank account not found')
        if (Number(freshBank.currentBalance) < Number(transfer.amount)) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        // Calculate charge for BANK_TO_DRAWER
        const { chargeAmount, netAmount } = calculateTransferCharge(
          Number(transfer.amount),
          bank.isMfs,
          Number(bank.cashoutChargePct),
          Number(bank.transactionChargePct)
        )

        // Deduct from Bank (full amount)
        await activeTx.bankTransaction.create({
          data: {
            bankAccountId: transfer.bankAccountId!,
            type: 'WITHDRAWAL',
            amount: transfer.amount,
            description: `Cash Withdrawal - TRN-${transfer.id.slice(-6)}`,
            referenceId: transfer.id,
            referenceType: BANK_TX_REF_TYPE.CONTRA_TRANSFER,
          },
        })
        await activeTx.bankAccount.update({
          where: { id: transfer.bankAccountId! },
          data: { currentBalance: { decrement: transfer.amount } },
        })

        // Add to Drawer (net amount after charge)
        await activeTx.drawerTransaction.create({
          data: {
            drawerId: transfer.drawerId!,
            type: DRAWER_TX_TYPE.CASH_IN,
            amount: netAmount,
            description: `Bank Withdrawal - TRN-${transfer.id.slice(-6)}${chargeAmount > 0 ? ` (Charge: ৳${chargeAmount})` : ''}`,
            referenceId: transfer.id,
            referenceType: BANK_TX_REF_TYPE.CONTRA_TRANSFER,
          },
        })

        let chargeAccount: { id: string } | null = null

        // Create expense record for charge if > 0
        if (chargeAmount > 0) {
          const chargeAccountCode = bank.isMfs ? '5290' : '5291'

          chargeAccount = await activeTx.chartOfAccount.findFirst({
            where: { code: chargeAccountCode },
            select: { id: true },
          })

          if (!chargeAccount) {
            throw new Error(
              `Expense account ${chargeAccountCode} not found. Please configure Chart of Accounts.`
            )
          }

          // Determine payment method from bank name
          const bankNameLower = bank.bankName.toLowerCase()
          let paymentMethod: 'BANK_TRANSFER' | 'BKASH' | 'NAGAD' | 'ROCKET' =
            'BANK_TRANSFER'
          if (bank.isMfs) {
            if (bankNameLower.includes('nagad')) paymentMethod = 'NAGAD'
            else if (bankNameLower.includes('rocket')) paymentMethod = 'ROCKET'
            else paymentMethod = 'BKASH'
          }

          // Create expense record
          await activeTx.expense.create({
            data: {
              description: `${bank.isMfs ? bank.bankName : 'Bank'} transfer charge - TRN-${transfer.id.slice(-6)}`,
              amount: chargeAmount,
              expenseDate: new Date(),
              outletId: transfer.drawer!.outlet.id,
              method: paymentMethod,
              bankAccountId: transfer.bankAccountId!,
              status: 'APPROVED',
              createdById: user.id,
              approvedById: user.id,
              accountId: chargeAccount.id,
            },
          })
        }

        if (cashAcc && bankAcc) {
          ledgerEntries.push(
            {
              accountId: cashAcc,
              type: 'DEBIT',
              amount: netAmount,
              description: `Bank Withdrawal - TRN-${transfer.id.slice(-6)}`,
              referenceId: transfer.id,
              referenceType: 'ContraTransfer',
            },
            {
              accountId: bankAcc,
              type: 'CREDIT',
              amount: transfer.amount,
              description: `Cash Withdrawal - TRN-${transfer.id.slice(-6)}`,
              referenceId: transfer.id,
              referenceType: 'ContraTransfer',
            }
          )
          if (chargeAmount > 0 && chargeAccount) {
            ledgerEntries.push({
              accountId: chargeAccount.id,
              type: 'DEBIT',
              amount: chargeAmount,
              description: `Bank transfer charge - TRN-${transfer.id.slice(-6)}`,
              referenceId: transfer.id,
              referenceType: 'ContraTransfer',
            })
          }
        }
      }

      if (ledgerEntries.length > 0) {
        assertBalancedJournal(ledgerEntries)
        await activeTx.accountLedgerEntry.createMany({
          data: ledgerEntries,
        })
      }

      return updatedTransfer
    }

    let result: any
    if (tx) {
      result = await executeApproval(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeApproval(innerTx))
    }

    revalidatePath('/finances/transfers')
    revalidatePath('/finances/banks')
    revalidatePath('/finances/drawer')

    return ok(result)
  } catch (err: any) {
    return fail(err.message || 'Failed to approve transfer')
  }
}

export async function rejectContraTransfer(
  transferId: string,
  reason?: string,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )

  const client = tx ?? prisma

  const transfer = await client.contraTransfer.findUnique({
    where: { id: transferId },
    include: {
      drawer: {
        include: {
          outlet: { select: { id: true } },
        },
      },
    },
  })

  if (!transfer) return fail('Transfer not found.')
  if (transfer.status !== 'PENDING')
    return fail(`Transfer is already ${transfer.status}`)

  if (
    user.role !== UserRole.SUPER_ADMIN &&
    transfer.drawer?.outlet?.id &&
    user.outletId !== transfer.drawer.outlet.id
  ) {
    return fail('Not authorized to reject transfer for this outlet')
  }

  const updatedTransfer = await client.contraTransfer.update({
    where: { id: transferId },
    data: {
      status: 'REJECTED',
      approvedById: user.id, // using approvedBy to track who decided it
      notes: reason
        ? `${transfer.notes || ''}\nRejection Reason: ${reason}`.trim()
        : transfer.notes,
    },
  })

  revalidatePath('/finances/transfers')
  return ok(updatedTransfer)
}

export async function getContraTransfers() {
  await requireAuth()

  return withDatabaseReadFallback(
    () =>
      prisma.contraTransfer.findMany({
        include: {
          createdBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          bankAccount: true,
          drawer: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    [],
    'getContraTransfers'
  )
}
