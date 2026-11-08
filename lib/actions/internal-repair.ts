'use server'

import { requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { getPrismaDatabaseErrorMessage, prisma } from '@/lib/db'
import { JobType, SerialStatus, ServiceJobStatus, StockMovementType, TransactionType, UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { nextDocumentNumber } from '@/lib/numbering/next-document-number'
import { consumeStockLayers } from '@/lib/inventory/stock-layers'
import { assertBalancedJournal } from '@/lib/accounting/journal'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path)
  } catch {
    // Ignore static generation store missing error outside Next.js request context
  }
}

function failIfDatabaseUnavailable(error: unknown) {
  const message = getPrismaDatabaseErrorMessage(error)
  return message ? fail(message) : null
}

export async function dispatchInternalRepair(
  serialUnitId: string,
  issueDescription: string,
  sessionOutletId?: string,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const executeDispatch = async (activeTx: PrismaTx) => {
    // 1. Lock and validate SerialUnit
    await activeTx.$executeRaw`SELECT id FROM "SerialUnit" WHERE id = ${serialUnitId} FOR UPDATE`
    
    const unit = await activeTx.serialUnit.findUnique({
      where: { id: serialUnitId },
      include: { product: true }
    })

    if (!unit) {
      throw new Error('Serial unit not found')
    }

    if (unit.status !== SerialStatus.IN_STOCK) {
      throw new Error(`Only IN_STOCK items can be sent for internal repair. Current status: ${unit.status}`)
    }

    // Determine the outlet to use for the stock ledger entry.
    // The user requested to use the serialUnit's outletId first, fallback to session/user outlet.
    const targetOutletId = unit.outletId || sessionOutletId || user.outletId
    
    if (!targetOutletId) {
      throw new Error('Could not determine outlet for internal repair dispatch.')
    }

    validateOutletAccess(user, targetOutletId)

    // 2. Update SerialUnit status
    await activeTx.serialUnit.update({
      where: { id: unit.id },
      data: {
        status: SerialStatus.IN_SERVICE,
      },
    })

    // 3. Write StockLedger entry (deduct 1)
    await activeTx.stockLedger.create({
      data: {
        productId: unit.productId,
        outletId: targetOutletId,
        movementType: StockMovementType.INTERNAL_REPAIR_OUT,
        quantity: -1,
        notes: `Internal repair dispatch for S/N: ${unit.serialNumber}`,
      }
    })

    // 4. Create ServiceJob for internal repair
    const job = await activeTx.serviceJob.create({
      data: {
        jobNumber: await nextDocumentNumber(activeTx, 'internal_repair'),
        jobType: JobType.INTERNAL,
        outletId: targetOutletId,
        device: unit.product.name,
        issue: issueDescription,
        serialUnitId: unit.id,
        receivedAt: new Date(),
        status: ServiceJobStatus.RECEIVED,
      }
    })

    return job
  }

  try {
    let result: any
    if (tx) {
      result = await executeDispatch(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeDispatch(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/products-ledger')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to dispatch internal repair')
  }
}

export async function resolveInternalRepair(
  jobId: string,
  resolutionStatus: 'RESTOCK' | 'SCRAP',
  notes: string,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const executeResolution = async (activeTx: PrismaTx) => {
    // 1. Fetch ServiceJob
    await activeTx.$executeRaw`SELECT id FROM "ServiceJob" WHERE id = ${jobId} FOR UPDATE`
    const job = await activeTx.serviceJob.findUnique({
      where: { id: jobId }
    })

    if (!job) {
      throw new Error('Service ticket not found')
    }

    if (job.jobType !== JobType.INTERNAL) {
      throw new Error('This ticket is not an internal repair ticket.')
    }

    if (!job.serialUnitId) {
      throw new Error('Internal repair ticket missing associated serial unit.')
    }

    // 2. Lock SerialUnit
    await activeTx.$executeRaw`SELECT id FROM "SerialUnit" WHERE id = ${job.serialUnitId} FOR UPDATE`
    const unit = await activeTx.serialUnit.findUnique({
      where: { id: job.serialUnitId },
      include: { product: true },
    })

    if (!unit) {
      throw new Error('Serial unit not found')
    }

    const targetOutletId = unit.outletId || job.outletId || user.outletId
    
    if (!targetOutletId) {
      throw new Error('Could not determine outlet for internal repair resolution.')
    }

    validateOutletAccess(user, targetOutletId)

    // 3. Handle Resolution Status
    if (resolutionStatus === 'RESTOCK') {
      await activeTx.serialUnit.update({
        where: { id: unit.id },
        data: {
          status: SerialStatus.IN_STOCK,
        },
      })

      await activeTx.stockLedger.create({
        data: {
          productId: unit.productId,
          outletId: targetOutletId,
          movementType: StockMovementType.INTERNAL_REPAIR_IN,
          quantity: 1,
          referenceId: job.id,
          referenceType: 'ServiceJob',
          notes: `Restocked after internal repair. S/N: ${unit.serialNumber}`,
        }
      })
    } else if (resolutionStatus === 'SCRAP') {
      await activeTx.serialUnit.update({
        where: { id: unit.id },
        data: {
          status: SerialStatus.DEAD,
        },
      })

      // SVC-F9: Deplete FIFO stock layer upon permanent scrap
      const consumedBatches = await consumeStockLayers(activeTx, {
        productId: unit.productId,
        outletId: targetOutletId,
        quantityNeeded: 1,
        allowSyntheticLayer: false,
      })

      const scrapCost =
        consumedBatches.reduce(
          (sum, b) => sum + b.quantityConsumed * Number(b.unitCost),
          0
        ) || Number(unit.costPrice || 0)

      // Post Double-Entry General Ledger for Scrapped Internal Repair Unit:
      // Dr Loss on Scrap Expense (5320 / 5300 / 5299)
      // Cr Inventory Asset (1400)
      if (scrapCost > 0) {
        const coaAccounts = await activeTx.chartOfAccount.findMany({
          where: { code: { in: ['1400', '5320', '5300', '5299'] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const invAccountId = coaMap.get('1400')
        const scrapExpenseAccountId =
          coaMap.get('5320') || coaMap.get('5300') || coaMap.get('5299')

        if (!invAccountId) {
          throw new Error('Inventory Asset account (1400) not found in Chart of Accounts')
        }
        if (!scrapExpenseAccountId) {
          throw new Error('Loss on Scrap account (5320 or 5300) not found in Chart of Accounts')
        }

        const effectiveDate = new Date()
        const gl = [
          {
            accountId: scrapExpenseAccountId,
            type: TransactionType.DEBIT,
            amount: scrapCost,
            description: `Loss on Scrapped Internal Repair Unit (${unit.serialNumber}) - ${unit.product?.name || 'Device'}`,
            referenceId: job.id,
            referenceType: 'InternalRepairScrap',
            createdAt: effectiveDate,
          },
          {
            accountId: invAccountId,
            type: TransactionType.CREDIT,
            amount: scrapCost,
            description: `Inventory write-off for Scrapped Internal Repair Unit (${unit.serialNumber})`,
            referenceId: job.id,
            referenceType: 'InternalRepairScrap',
            createdAt: effectiveDate,
          },
        ]

        assertBalancedJournal(gl)
        await activeTx.accountLedgerEntry.createMany({ data: gl })
      }
    }

    // 4. Update ServiceJob
    const updatedJob = await activeTx.serviceJob.update({
      where: { id: jobId },
      data: {
        status: ServiceJobStatus.COMPLETED,
        completedAt: new Date(),
        resolution: `Resolved as ${resolutionStatus}${notes ? ': ' + notes : ''}`,
      }
    })

    return updatedJob
  }

  try {
    let result: any
    if (tx) {
      result = await executeResolution(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeResolution(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/products-ledger')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to resolve internal repair')
  }
}
