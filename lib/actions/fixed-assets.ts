'use server'

import { requireAuth, requireRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { logAudit } from '@/lib/audit/logger'
import { prisma } from '@/lib/db'
import {
  AssetCategory,
  FundingSource,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { assertBalancedJournal } from '@/lib/accounting/journal'

const createAssetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.nativeEnum(AssetCategory),
  acquisitionCost: z.coerce.number().min(0, 'Cost must be positive'),
  acquisitionDate: z.coerce.date(),
  depreciable: z.boolean(),
  usefulLifeYears: z.coerce.number().min(1).optional().nullable(),
  salvageValue: z.coerce.number().min(0).default(0),
  fundingSource: z.nativeEnum(FundingSource),
  bankAccountId: z.string().optional(),
  drawerId: z.string().optional(),
})

export async function createFixedAsset(data: z.infer<typeof createAssetSchema>) {
  try {
    const user = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)

    const parsed = createAssetSchema.safeParse(data)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const val = parsed.data

    if (val.depreciable && !val.usefulLifeYears) {
      return fail('Useful life is required for depreciable assets')
    }
    if (val.fundingSource === 'NEW_PURCHASE' && !val.bankAccountId && !val.drawerId) {
      return fail('Bank account or cash drawer is required for new purchases')
    }

    return await prisma.$transaction(async tx => {
      // 1. Funding Logic
      let ledgerEntries: any[] = []

      if (val.fundingSource === 'HISTORICAL') {
        // Historical assets offset against Opening Balance Equity
        const openingBalanceEquityId = await getOrCreateAccount(tx, '3200', 'Opening Balance Equity')
        const fixedAssetsAccountId = await getOrCreateAccount(tx, '1500', 'Fixed Assets')

        ledgerEntries = [
          {
            accountId: fixedAssetsAccountId,
            type: TransactionType.DEBIT,
            amount: val.acquisitionCost,
            description: `Historical Asset: ${val.name}`,
          },
          {
            accountId: openingBalanceEquityId,
            type: TransactionType.CREDIT,
            amount: val.acquisitionCost,
            description: `Historical Asset: ${val.name}`,
          },
        ]
      } else {
        // NEW_PURCHASE: Requires real outflow
        const fixedAssetsAccId = await getOrCreateAccount(tx, '1500', 'Fixed Assets')
        let sourceAccId: string

        if (val.bankAccountId) {
          sourceAccId = await getOrCreateAccount(tx, '1200', 'Bank Accounts')

          // Lock bank account
          await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ${val.bankAccountId} FOR UPDATE`

          const bank = await tx.bankAccount.findUnique({
            where: { id: val.bankAccountId },
            select: { currentBalance: true },
          })
          if (!bank) throw new Error('Bank account not found')
          if (Number(bank.currentBalance) < val.acquisitionCost) {
            throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
          }

          await tx.bankTransaction.create({
            data: {
              bankAccountId: val.bankAccountId,
              type: 'WITHDRAWAL',
              amount: val.acquisitionCost,
              description: `Fixed Asset Purchase: ${val.name}`,
              transactionAt: val.acquisitionDate,
              referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
            },
          })
          
          await tx.bankAccount.update({
            where: { id: val.bankAccountId },
            data: { currentBalance: { decrement: val.acquisitionCost } },
          })
        } else if (val.drawerId) {
          sourceAccId = await getOrCreateAccount(tx, '1100', 'Cash on Hand')

          const drawer = await tx.cashDrawer.findUnique({
            where: { id: val.drawerId },
          })
          if (!drawer || drawer.status !== 'OPEN') {
            throw new Error('Valid open cash drawer required')
          }

          await tx.$queryRaw`SELECT id FROM "CashDrawer" WHERE id = ${val.drawerId} FOR UPDATE`

          // Calculate current available cash to validate
          const txns = await tx.drawerTransaction.aggregate({
            where: { drawerId: val.drawerId },
            _sum: { amount: true },
          })
          const available = Number(txns._sum.amount || 0)
          if (available < val.acquisitionCost) {
            throw new Error('Insufficient cash in drawer')
          }

          await tx.drawerTransaction.create({
            data: {
              drawerId: val.drawerId,
              type: DRAWER_TX_TYPE.FIXED_ASSET_PURCHASE,
              amount: -val.acquisitionCost,
              description: `Fixed Asset Purchase: ${val.name}`,
              createdAt: val.acquisitionDate,
              referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
            },
          })
        } else {
          throw new Error('Funding source required')
        }

        ledgerEntries = [
          {
            accountId: fixedAssetsAccId,
            type: TransactionType.DEBIT,
            amount: val.acquisitionCost,
            description: `Fixed Asset Purchase: ${val.name}`,
          },
          {
            accountId: sourceAccId,
            type: TransactionType.CREDIT,
            amount: val.acquisitionCost,
            description: `Fixed Asset Purchase: ${val.name}`,
          },
        ]
      }

      // 2. Create Asset
      const asset = await tx.fixedAsset.create({
        data: {
          name: val.name,
          category: val.category,
          acquisitionCost: val.acquisitionCost,
          acquisitionDate: val.acquisitionDate,
          depreciable: val.depreciable,
          usefulLifeYears: val.usefulLifeYears,
          salvageValue: val.salvageValue,
          fundingSource: val.fundingSource,
          bankAccountId: val.bankAccountId,
          drawerId: val.drawerId,
          createdById: user.id,
        },
      })

      // 3. Apply Ledger Entries if Historical
      if (ledgerEntries.length > 0) {
        const gl = ledgerEntries.map(e => ({
          ...e,
          referenceId: asset.id,
          referenceType: 'FixedAsset',
        }))
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({
          data: gl,
        })
      }

      await logAudit('CREATE', 'FixedAsset', asset.id, { name: asset.name, cost: asset.acquisitionCost })
      return asset
    }).then(asset => {
      revalidatePath('/finances/fixed-assets')
      return ok(asset)
    })
  } catch (err: any) {
    return fail(err.message || 'Failed to create fixed asset')
  }
}

export type FixedAssetValuation = {
  id: string
  name: string
  category: string
  acquisitionCost: number
  acquisitionDate: Date
  depreciable: boolean
  usefulLifeYears: number | null
  salvageValue: number
  accumulatedDepreciation: number
  bookValue: number
  fundingSource: string
}

export async function getFixedAssets(asOfDate?: Date): Promise<FixedAssetValuation[]> {
  const targetDate = asOfDate || new Date()
  
  const assets = await prisma.fixedAsset.findMany({
    where: {
      acquisitionDate: { lte: targetDate },
    },
    orderBy: { acquisitionDate: 'asc' },
  })

  return assets.map(asset => {
    const cost = Number(asset.acquisitionCost)
    const salvage = Number(asset.salvageValue)
    let accDep = 0

    if (asset.depreciable && asset.usefulLifeYears && asset.usefulLifeYears > 0) {
      const msPerYear = 1000 * 60 * 60 * 24 * 365.25
      const yearsElapsed = (targetDate.getTime() - asset.acquisitionDate.getTime()) / msPerYear
      
      if (yearsElapsed > 0) {
        const depreciableBase = cost - salvage
        const yearlyDepreciation = depreciableBase / asset.usefulLifeYears
        
        // Straight-line: yearsElapsed * yearlyDepreciation, capped at the depreciable base
        accDep = Math.min(yearlyDepreciation * yearsElapsed, depreciableBase)
      }
    }

    const accDepRounded = Math.round((accDep + Number.EPSILON) * 100) / 100
    const bookValueRounded = Math.round((cost - accDepRounded + Number.EPSILON) * 100) / 100

    return {
      id: asset.id,
      name: asset.name,
      category: asset.category,
      acquisitionCost: cost,
      acquisitionDate: asset.acquisitionDate,
      depreciable: asset.depreciable,
      usefulLifeYears: asset.usefulLifeYears,
      salvageValue: salvage,
      accumulatedDepreciation: accDepRounded,
      bookValue: bookValueRounded,
      fundingSource: asset.fundingSource,
    }
  })
}

const updateAssetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.nativeEnum(AssetCategory),
  acquisitionCost: z.coerce.number().min(0, 'Cost must be positive'),
  acquisitionDate: z.coerce.date(),
  depreciable: z.boolean(),
  usefulLifeYears: z.coerce.number().min(1).optional().nullable(),
  salvageValue: z.coerce.number().min(0).default(0),
})

export async function updateFixedAsset(id: string, data: z.infer<typeof updateAssetSchema>) {
  try {
    const _user = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)

    const parsed = updateAssetSchema.safeParse(data)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const val = parsed.data

    if (val.depreciable && !val.usefulLifeYears) {
      return fail('Useful life is required for depreciable assets')
    }

    return await prisma.$transaction(async tx => {
      const existing = await tx.fixedAsset.findUnique({ where: { id } })
      if (!existing) throw new Error('Fixed asset not found')

      const updated = await tx.fixedAsset.update({
        where: { id },
        data: {
          name: val.name,
          category: val.category,
          acquisitionCost: val.acquisitionCost,
          acquisitionDate: val.acquisitionDate,
          depreciable: val.depreciable,
          usefulLifeYears: val.usefulLifeYears,
          salvageValue: val.salvageValue,
        },
      })

      // Update associated ledger entries and funding source if acquisition cost changed (Finding #29)
      const costDelta = val.acquisitionCost - Number(existing.acquisitionCost)

      if (existing.fundingSource === FundingSource.HISTORICAL) {
        if (costDelta !== 0) {
          const ledgerEntries = await tx.accountLedgerEntry.findMany({
            where: { referenceId: id, referenceType: 'FixedAsset' },
          })
          for (const entry of ledgerEntries) {
            await tx.accountLedgerEntry.update({
              where: { id: entry.id },
              data: {
                amount: val.acquisitionCost,
                description: `Historical Asset: ${val.name}`,
              },
            })
          }
        }
      } else if (existing.fundingSource === FundingSource.NEW_PURCHASE) {
        if (costDelta !== 0) {
          if (existing.bankAccountId) {
            await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${existing.bankAccountId} FOR UPDATE`
            if (costDelta > 0) {
              const bank = await tx.bankAccount.findUnique({
                where: { id: existing.bankAccountId },
                select: { currentBalance: true },
              })
              if (!bank) throw new Error('Bank account not found')
              if (Number(bank.currentBalance) < costDelta) {
                throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
              }
              await tx.bankAccount.update({
                where: { id: existing.bankAccountId },
                data: { currentBalance: { decrement: costDelta } },
              })
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: existing.bankAccountId,
                  type: 'WITHDRAWAL',
                  amount: costDelta,
                  description: `Fixed Asset Cost Adjustment: ${val.name}`,
                  transactionAt: new Date(),
                  referenceId: id,
                  referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
                },
              })
            } else {
              await tx.bankAccount.update({
                where: { id: existing.bankAccountId },
                data: { currentBalance: { increment: -costDelta } },
              })
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: existing.bankAccountId,
                  type: 'DEPOSIT',
                  amount: -costDelta,
                  description: `Fixed Asset Cost Adjustment (Refund): ${val.name}`,
                  transactionAt: new Date(),
                  referenceId: id,
                  referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
                },
              })
            }
          } else if (existing.drawerId) {
            await tx.$executeRaw`SELECT id FROM "CashDrawer" WHERE id = ${existing.drawerId} FOR UPDATE`
            await tx.drawerTransaction.create({
              data: {
                drawerId: existing.drawerId,
                type: costDelta > 0 ? DRAWER_TX_TYPE.CASH_OUT : DRAWER_TX_TYPE.CASH_IN,
                amount: -costDelta,
                description: `Fixed Asset Cost Adjustment: ${val.name}`,
                referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
              },
            })
          }

          // Update ledger entries to match new acquisition cost
          const ledgerEntries = await tx.accountLedgerEntry.findMany({
            where: { referenceId: id, referenceType: 'FixedAsset' },
          })
          for (const entry of ledgerEntries) {
            await tx.accountLedgerEntry.update({
              where: { id: entry.id },
              data: {
                amount: val.acquisitionCost,
                description: `Fixed Asset Purchase: ${val.name}`,
              },
            })
          }
        }
      }

      await logAudit('UPDATE', 'FixedAsset', id, { name: updated.name, cost: Number(updated.acquisitionCost) })
      return updated
    }).then(asset => {
      revalidatePath('/finances/fixed-assets')
      revalidatePath('/reports/balance-sheet')
      return ok(asset)
    })
  } catch (err: any) {
    return fail(err.message || 'Failed to update fixed asset')
  }
}

const disposeAssetSchema = z.object({
  disposalDate: z.coerce.date().default(() => new Date()),
  proceedsAmount: z.coerce.number().min(0).default(0),
  bankAccountId: z.string().optional(),
  drawerId: z.string().optional(),
  notes: z.string().optional(),
})

export async function disposeFixedAsset(
  id: string,
  data: z.infer<typeof disposeAssetSchema>
) {
  try {
    const _user = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)
    const parsed = disposeAssetSchema.safeParse(data)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const val = parsed.data

    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM "FixedAsset" WHERE id = ${id} FOR UPDATE`
      const asset = await tx.fixedAsset.findUnique({ where: { id } })
      if (!asset) throw new Error('Fixed asset not found')

      const cost = Number(asset.acquisitionCost)
      const salvage = Number(asset.salvageValue)
      let accDep = 0

      if (asset.depreciable && asset.usefulLifeYears && asset.usefulLifeYears > 0) {
        const msPerYear = 1000 * 60 * 60 * 24 * 365.25
        const yearsElapsed = (val.disposalDate.getTime() - asset.acquisitionDate.getTime()) / msPerYear
        if (yearsElapsed > 0) {
          const depreciableBase = cost - salvage
          const yearlyDep = depreciableBase / asset.usefulLifeYears
          accDep = Math.min(yearlyDep * yearsElapsed, depreciableBase)
        }
      }
      accDep = Math.round((accDep + Number.EPSILON) * 100) / 100
      const bookValue = Math.round((cost - accDep + Number.EPSILON) * 100) / 100
      const proceeds = val.proceedsAmount || 0
      const gainOrLoss = Math.round((proceeds - bookValue + Number.EPSILON) * 100) / 100

      const fixedAssetsAccId = await getOrCreateAccount(tx, '1500', 'Fixed Assets')
      const accDepAccId = await getOrCreateAccount(tx, '1510', 'Accumulated Depreciation')
      const gainAccId = await getOrCreateAccount(tx, '4300', 'Other Income')
      const lossAccId = await getOrCreateAccount(tx, '5299', 'Miscellaneous Expense')
      const bankAccId = await getOrCreateAccount(tx, '1200', 'Bank Accounts')
      const cashAccId = await getOrCreateAccount(tx, '1100', 'Cash in Hand')

      const glEntries: any[] = []

      if (proceeds > 0) {
        if (val.bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${val.bankAccountId} FOR UPDATE`
          await tx.bankAccount.update({
            where: { id: val.bankAccountId },
            data: { currentBalance: { increment: proceeds } },
          })
          await tx.bankTransaction.create({
            data: {
              bankAccountId: val.bankAccountId,
              type: 'DEPOSIT',
              amount: proceeds,
              description: `Proceeds from disposal of fixed asset: ${asset.name}`,
              transactionAt: val.disposalDate,
              referenceId: id,
              referenceType: 'FixedAssetDisposal',
            },
          })
          glEntries.push({
            accountId: bankAccId,
            type: TransactionType.DEBIT,
            amount: proceeds,
            description: `Disposal proceeds (Bank): ${asset.name}`,
            referenceId: id,
            referenceType: 'FixedAssetDisposal',
          })
        } else if (val.drawerId) {
          await tx.$executeRaw`SELECT id FROM "CashDrawer" WHERE id = ${val.drawerId} FOR UPDATE`
          await tx.drawerTransaction.create({
            data: {
              drawerId: val.drawerId,
              type: DRAWER_TX_TYPE.CASH_IN,
              amount: proceeds,
              description: `Proceeds from disposal of fixed asset: ${asset.name}`,
              referenceId: id,
              referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
            },
          })
          glEntries.push({
            accountId: cashAccId,
            type: TransactionType.DEBIT,
            amount: proceeds,
            description: `Disposal proceeds (Cash): ${asset.name}`,
            referenceId: id,
            referenceType: 'FixedAssetDisposal',
          })
        }
      }

      if (accDep > 0) {
        glEntries.push({
          accountId: accDepAccId,
          type: TransactionType.DEBIT,
          amount: accDep,
          description: `Write off accumulated depreciation on disposal: ${asset.name}`,
          referenceId: id,
          referenceType: 'FixedAssetDisposal',
        })
      }

      if (gainOrLoss > 0) {
        glEntries.push({
          accountId: gainAccId,
          type: TransactionType.CREDIT,
          amount: gainOrLoss,
          description: `Gain on disposal of fixed asset: ${asset.name}`,
          referenceId: id,
          referenceType: 'FixedAssetDisposal',
        })
      } else if (gainOrLoss < 0) {
        glEntries.push({
          accountId: lossAccId,
          type: TransactionType.DEBIT,
          amount: Math.abs(gainOrLoss),
          description: `Loss on disposal of fixed asset: ${asset.name}`,
          referenceId: id,
          referenceType: 'FixedAssetDisposal',
        })
      }

      glEntries.push({
        accountId: fixedAssetsAccId,
        type: TransactionType.CREDIT,
        amount: cost,
        description: `Remove fixed asset cost on disposal: ${asset.name}`,
        referenceId: id,
        referenceType: 'FixedAssetDisposal',
      })

      assertBalancedJournal(glEntries)
      await tx.accountLedgerEntry.createMany({ data: glEntries })

      await tx.fixedAsset.delete({ where: { id } })

      await logAudit('DISPOSAL', 'FixedAsset', id, {
        name: asset.name,
        cost,
        accDep,
        bookValue,
        proceeds,
        gainOrLoss,
      })

      return {
        id,
        name: asset.name,
        cost,
        bookValue,
        proceeds,
        gainOrLoss,
      }
    }).then(res => {
      revalidatePath('/finances/fixed-assets')
      revalidatePath('/reports/balance-sheet')
      return ok(res)
    })
  } catch (err: any) {
    return fail(err.message || 'Failed to dispose fixed asset')
  }
}

export async function executeFixedAssetDepreciation(asOfDate?: Date) {
  const targetDate = asOfDate || new Date()

  return await prisma.$transaction(async tx => {
    const depreciableAssets = await tx.fixedAsset.findMany({
      where: {
        depreciable: true,
        usefulLifeYears: { not: null, gt: 0 },
        acquisitionDate: { lte: targetDate },
      },
    })

    const depExpenseAccId = await getOrCreateAccount(tx, '5320', 'Depreciation Expense')
    const accDepAccId = await getOrCreateAccount(tx, '1510', 'Accumulated Depreciation')

    const existingDepGroups =
      depreciableAssets.length > 0
        ? await tx.accountLedgerEntry.groupBy({
            by: ['referenceId'],
            where: {
              referenceId: { in: depreciableAssets.map(a => a.id) },
              referenceType: 'Depreciation',
              type: TransactionType.DEBIT,
            },
            _sum: { amount: true },
          })
        : []
    const alreadyPostedByAssetId = new Map<string, number>()
    for (const grp of existingDepGroups) {
      if (grp.referenceId) {
        alreadyPostedByAssetId.set(grp.referenceId, Number(grp._sum.amount ?? 0))
      }
    }

    let totalDepPosted = 0
    const glEntries: any[] = []

    for (const asset of depreciableAssets) {
      const cost = Number(asset.acquisitionCost)
      const salvage = Number(asset.salvageValue)
      const depreciableBase = cost - salvage
      const yearlyDep = depreciableBase / asset.usefulLifeYears!

      const msPerYear = 1000 * 60 * 60 * 24 * 365.25
      const yearsElapsed = (targetDate.getTime() - asset.acquisitionDate.getTime()) / msPerYear
      if (yearsElapsed <= 0) continue

      const targetAccDep = Math.min(yearlyDep * yearsElapsed, depreciableBase)
      const targetAccDepRounded = Math.round((targetAccDep + Number.EPSILON) * 100) / 100

      const alreadyPosted = alreadyPostedByAssetId.get(asset.id) ?? 0
      const deltaToPost = Math.round((targetAccDepRounded - alreadyPosted + Number.EPSILON) * 100) / 100

      if (deltaToPost > 0.01) {
        totalDepPosted += deltaToPost
        glEntries.push(
          {
            accountId: depExpenseAccId,
            type: TransactionType.DEBIT,
            amount: deltaToPost,
            description: `Depreciation Expense: ${asset.name}`,
            referenceId: asset.id,
            referenceType: 'Depreciation',
            createdAt: targetDate,
          },
          {
            accountId: accDepAccId,
            type: TransactionType.CREDIT,
            amount: deltaToPost,
            description: `Accumulated Depreciation: ${asset.name}`,
            referenceId: asset.id,
            referenceType: 'Depreciation',
            createdAt: targetDate,
          }
        )
      }
    }

    if (glEntries.length > 0) {
      assertBalancedJournal(glEntries)
      await tx.accountLedgerEntry.createMany({ data: glEntries })
    }

    return { totalDepPosted, count: glEntries.length / 2 }
  })
}

export async function postFixedAssetDepreciation(asOfDate?: Date) {
  try {
    await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)
    const res = await executeFixedAssetDepreciation(asOfDate)
    revalidatePath('/finances/fixed-assets')
    revalidatePath('/reports/balance-sheet')
    return ok(res)
  } catch (err: any) {
    return fail(err.message || 'Failed to post fixed asset depreciation')
  }
}

export async function deleteFixedAsset(id: string) {
  try {
    await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTANT)

    return await prisma.$transaction(async tx => {
      const existing = await tx.fixedAsset.findUnique({ where: { id } })
      if (!existing) throw new Error('Fixed asset not found')

      if (existing.fundingSource === FundingSource.NEW_PURCHASE) {
        if (existing.bankAccountId) {
          await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${existing.bankAccountId} FOR UPDATE`
          await tx.bankAccount.update({
            where: { id: existing.bankAccountId },
            data: { currentBalance: { increment: Number(existing.acquisitionCost) } },
          })
          await tx.bankTransaction.create({
            data: {
              bankAccountId: existing.bankAccountId,
              type: 'DEPOSIT',
              amount: existing.acquisitionCost,
              description: `Revert Fixed Asset Purchase: ${existing.name}`,
              referenceId: id,
              referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
            },
          })
        } else if (existing.drawerId) {
          await tx.$executeRaw`SELECT id FROM "CashDrawer" WHERE id = ${existing.drawerId} FOR UPDATE`
          await tx.drawerTransaction.create({
            data: {
              drawerId: existing.drawerId,
              type: DRAWER_TX_TYPE.CASH_IN,
              amount: Number(existing.acquisitionCost),
              description: `Revert Fixed Asset Purchase: ${existing.name}`,
              referenceId: id,
              referenceType: BANK_TX_REF_TYPE.FIXED_ASSET,
            },
          })
        }
      }

      // Clean up associated ledger entries
      await tx.accountLedgerEntry.deleteMany({
        where: { referenceId: id },
      })

      // Delete fixed asset
      await tx.fixedAsset.delete({ where: { id } })

      await logAudit('DELETE', 'FixedAsset', id, { name: existing.name, cost: Number(existing.acquisitionCost) })
      return true
    }).then(() => {
      revalidatePath('/finances/fixed-assets')
      revalidatePath('/reports/balance-sheet')
      return ok(true)
    })
  } catch (err: any) {
    return fail(err.message || 'Failed to delete fixed asset')
  }
}

// Helper for CoA
async function getOrCreateAccount(tx: any, code: string, defaultName: string) {
  let account = await tx.chartOfAccount.findUnique({ where: { code } })
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code,
        name: defaultName,
        type: code.startsWith('1') ? 'ASSET' : code.startsWith('3') ? 'EQUITY' : code.startsWith('4') ? 'INCOME' : 'EXPENSE',
      },
    })
  }
  return account.id
}

export async function getFixedAssetsAction(asOfDateStr?: string) {
  try {
    await requireAuth()
    const asOfDate = asOfDateStr ? new Date(asOfDateStr) : new Date()
    const assets = await getFixedAssets(asOfDate)
    return ok(assets)
  } catch (err: any) {
    return fail(err.message || 'Failed to fetch fixed assets')
  }
}

export async function getFixedAssetsFundingOptions() {
  try {
    const user = await requireAuth()
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { outletId: user.outletId, isActive: true },
      select: { id: true, accountName: true, bankName: true, currentBalance: true },
      orderBy: { accountName: 'asc' },
    })

    const openDrawer = await prisma.cashDrawer.findFirst({
      where: { outletId: user.outletId, status: 'OPEN' },
      select: { id: true, openedAt: true, openingBalance: true },
    })

    let drawerBalance = 0
    if (openDrawer) {
      const txns = await prisma.drawerTransaction.aggregate({
        where: { drawerId: openDrawer.id },
        _sum: { amount: true },
      })
      drawerBalance = Number(txns._sum.amount || 0)
    }

    return ok({
      bankAccounts: bankAccounts.map(b => ({
        ...b,
        currentBalance: Number(b.currentBalance),
      })),
      openDrawer: openDrawer
        ? {
            id: openDrawer.id,
            openedAt: openDrawer.openedAt,
            balance: drawerBalance,
          }
        : null,
    })
  } catch (err: any) {
    return fail(err.message || 'Failed to load funding options')
  }
}
