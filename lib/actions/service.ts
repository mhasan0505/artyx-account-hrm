'use server'

import { requireAuth, requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { consumeStockLayers } from '@/lib/inventory/stock-layers'
import { checkAndNotifyLowStock } from '@/lib/notifications/triggers/low-stock'
import { getPrismaDatabaseErrorMessage, prisma } from '@/lib/db'
import {
  BankTransactionType,
  InvoiceStatus,
  PaymentMethod,
  SerialStatus,
  ServiceJobStatus,
  StockMovementType,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { nextDocumentNumber } from '@/lib/numbering/next-document-number'

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


export async function getCustomerPurchasedProducts(customerId: string) {
  await requireAuth()
  if (!customerId?.trim()) return ok([])

  try {
    const saleLines = await prisma.saleLine.findMany({
      where: {
        sale: { customerId },
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        sale: { select: { id: true, saleNumber: true, createdAt: true } },
        serials: {
          include: {
            serialUnit: {
              select: {
                id: true,
                serialNumber: true,
                status: true,
                warrantyExpiry: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: 50,
    })

    const result: Array<{
      id: string
      productName: string
      serialUnitId: string | null
      serialNumber: string | null
      saleNumber: string
      saleDate: string
      warrantyExpiry?: string | null
      label: string
    }> = []

    for (const line of saleLines) {
      const formattedDate = new Date(line.sale.createdAt).toLocaleDateString('en-GB')
      if (line.serials.length > 0) {
        for (const s of line.serials) {
          const expiryDate = s.serialUnit?.warrantyExpiry
            ? new Date(s.serialUnit.warrantyExpiry)
            : null
          const isUnderWarranty = expiryDate ? expiryDate > new Date() : false
          const warrantyTag = expiryDate
            ? ` [Warranty: ${isUnderWarranty ? 'Valid' : 'Expired'} until ${expiryDate.toLocaleDateString('en-GB')}]`
            : ''

          result.push({
            id: `${line.id}_${s.serialUnit.id}`,
            productName: line.product.name,
            serialUnitId: s.serialUnit.id,
            serialNumber: s.serialUnit.serialNumber,
            saleNumber: line.sale.saleNumber,
            saleDate: formattedDate,
            warrantyExpiry: expiryDate ? expiryDate.toISOString() : null,
            label: `${line.product.name} (S/N: ${s.serialUnit.serialNumber}) — Invoice ${line.sale.saleNumber} (${formattedDate})${warrantyTag}`,
          })
        }
      } else {
        result.push({
          id: line.id,
          productName: line.product.name,
          serialUnitId: null,
          serialNumber: null,
          saleNumber: line.sale.saleNumber,
          saleDate: formattedDate,
          label: `${line.product.name} — Invoice ${line.sale.saleNumber} (${formattedDate})`,
        })
      }
    }

    return ok(result)
  } catch (error: any) {
    return fail(error?.message || 'Failed to fetch customer purchased products')
  }
}

const createJobSchema = z.object({
  customerId: z.string().min(1),
  outletId: z.string().optional(),
  device: z.string().min(1),
  issue: z.string().min(1),
  accessoriesReceived: z.string().optional(),
  expectedCompletionDate: z.coerce.date().optional(),
  serialUnitId: z.string().optional(),
  technicianId: z.string().optional(),
  isWarranty: z.coerce.boolean().default(false),
  estimatedCost: z.coerce.number().min(0).optional(),
  receivedAt: z.coerce.date().optional(),
})

export async function createServiceJob(
  data: z.infer<typeof createJobSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = createJobSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const executeCreate = async (activeTx: PrismaTx) => {
    const jobOutletId =
      user.outletId ||
      parsed.data.outletId ||
      (await activeTx.outlet.findFirst())?.id

    if (!jobOutletId) throw new Error('Outlet is required to create a service job')

    // Resolve & sanitize serialUnitId to prevent FK violations
    let finalSerialUnitId: string | null = null
    let finalSerialNumber: string | null = null
    const rawSerial = parsed.data.serialUnitId?.trim()
    if (rawSerial) {
      const unit = await activeTx.serialUnit.findFirst({
        where: {
          OR: [{ id: rawSerial }, { serialNumber: { equals: rawSerial, mode: 'insensitive' } }],
        },
        select: { id: true, serialNumber: true, status: true, warrantyExpiry: true },
      })
      if (unit) {
        if (unit.status === SerialStatus.IN_SERVICE) {
          throw new Error('Serial unit is already in service on an active ticket')
        }
        if (unit.status === SerialStatus.DEAD) {
          throw new Error('Serial unit is marked as DEAD and cannot be accepted for service')
        }
        if (unit.status === SerialStatus.RETURNED_TO_SUPPLIER) {
          throw new Error('Serial unit has been returned to supplier and cannot be accepted for service')
        }

        // SVC-F3: Check warranty expiry on warranty intake
        if (parsed.data.isWarranty && unit.warrantyExpiry && new Date(unit.warrantyExpiry) < new Date()) {
          if (!([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as string[]).includes(user.role)) {
            throw new Error(
              `Cannot claim warranty: Serial warranty expired on ${new Date(unit.warrantyExpiry).toLocaleDateString('en-GB')}. Manager approval required.`
            )
          }
        }

        finalSerialUnitId = unit.id
        finalSerialNumber = unit.serialNumber

        // 1. RMA / Service Intake: When a device is received, transition SerialUnit status from SOLD -> IN_SERVICE
        // Note: No StockLedger movement is created so it is never treated as saleable inventory!
        await activeTx.serialUnit.update({
          where: { id: unit.id },
          data: {
            status: SerialStatus.IN_SERVICE,
          },
        })
      } else {
        // Customer's own device or manual intake serial number
        finalSerialNumber = rawSerial
      }
    }

    // Resolve & sanitize technicianId
    let finalTechnicianId: string | null = null
    const rawTech = parsed.data.technicianId?.trim()
    if (rawTech) {
      const tech = await activeTx.user.findFirst({
        where: { id: rawTech },
        select: { id: true },
      })
      if (tech) {
        finalTechnicianId = tech.id
      }
    }

    const job = await activeTx.serviceJob.create({
      data: {
        jobNumber: await nextDocumentNumber(activeTx, 'service_job'),
        customerId: parsed.data.customerId,
        outletId: jobOutletId,
        device: parsed.data.device,
        issue: parsed.data.issue,
        accessoriesReceived: parsed.data.accessoriesReceived?.trim() || null,
        expectedCompletionDate: parsed.data.expectedCompletionDate || null,
        serialUnitId: finalSerialUnitId,
        serialNumber: finalSerialNumber,
        technicianId: finalTechnicianId,
        isWarranty: parsed.data.isWarranty,
        estimatedCost: parsed.data.estimatedCost,
        receivedAt: parsed.data.receivedAt,
      },
    })

    return job
  }

  try {
    let job: any
    if (tx) {
      job = await executeCreate(tx)
    } else {
      job = await prisma.$transaction(async innerTx => await executeCreate(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    return ok(job)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to create service ticket')
  }
}

export async function updateServiceJobStatus(
  jobId: string,
  status: ServiceJobStatus,
  notes?: string,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  const executeStatusUpdate = async (activeTx: PrismaTx) => {
    const job = await activeTx.serviceJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        outletId: true,
        serialUnitId: true,
        isWarranty: true,
        status: true,
        serialUnit: { select: { id: true, status: true } },
      },
    })
    if (!job) throw new Error('Service ticket not found')
    validateOutletAccess(user, job.outletId ?? '')

    // ── IMMUTABLE STATE GUARD ──
    // DELIVERED is terminal. Re-flipping a delivered job would resurrect a serial
    // that was handed back to the customer and silently rewrite the RMA history.
    if (job.status === ServiceJobStatus.DELIVERED) {
      throw new Error(
        'Cannot change the status of a delivered service ticket. Open a new ticket instead.'
      )
    }

    if (status === ServiceJobStatus.CANCELLED) {
      if (job.serialUnit?.status === SerialStatus.RETURNED_TO_SUPPLIER) {
        throw new Error(
          'Cannot cancel a service ticket while unit is at supplier (RETURNED_TO_SUPPLIER). Return unit from supplier or resolve RMA first.'
        )
      }
      const invoice = await activeTx.serviceInvoice.findUnique({
        where: { jobId },
        select: { id: true, amountPaid: true },
      })
      if (invoice && Number(invoice.amountPaid) > 0) {
        throw new Error(
          'Cannot cancel a service ticket with recorded payments. Please process a refund or void the invoice first.'
        )
      }
    }

    // Handle serial unit status lifecycle according to service status
    if (job.serialUnitId) {
      if (status === ServiceJobStatus.DELIVERED) {
        // Returned back to customer after successful repair
        await activeTx.serialUnit.update({
          where: { id: job.serialUnitId },
          data: { status: SerialStatus.SOLD },
        })
      } else if (status === ServiceJobStatus.CANCELLED) {
        // Cancelled ticket - return back to customer only if not with supplier
        if (job.serialUnit?.status !== SerialStatus.RETURNED_TO_SUPPLIER) {
          await activeTx.serialUnit.update({
            where: { id: job.serialUnitId },
            data: { status: SerialStatus.SOLD },
          })
        }
      }
    }

    const updated = await activeTx.serviceJob.update({
      where: { id: jobId },
      data: {
        status,
        ...(status === ServiceJobStatus.COMPLETED
          ? { completedAt: new Date() }
          : {}),
        ...(status === ServiceJobStatus.DELIVERED
          ? { deliveredAt: new Date() }
          : {}),
        ...(notes?.trim() ? { resolution: notes.trim() } : {}),
      },
    })

    return updated
  }

  try {
    let updated: any
    if (tx) {
      updated = await executeStatusUpdate(tx)
    } else {
      updated = await prisma.$transaction(async innerTx => await executeStatusUpdate(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    return ok(updated)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to update service ticket status')
  }
}

const updateJobSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().optional(),
  device: z.string().min(1),
  issue: z.string().min(1),
  accessoriesReceived: z.string().optional(),
  expectedCompletionDate: z.coerce.date().optional(),
  serialUnitId: z.string().optional(),
  technicianId: z.string().optional(),
  status: z.nativeEnum(ServiceJobStatus),
  diagnosis: z.string().optional(),
  resolution: z.string().optional(),
  isWarranty: z.coerce.boolean().default(false),
  estimatedCost: z.coerce.number().min(0).optional(),
  receivedAt: z.coerce.date(),
})

export async function updateServiceJob(
  data: z.infer<typeof updateJobSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = updateJobSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const executeUpdate = async (activeTx: PrismaTx) => {
    const job = await activeTx.serviceJob.findUnique({
      where: { id: parsed.data.id },
      select: { outletId: true, serialUnitId: true, status: true },
    })
    if (!job) throw new Error('Service ticket not found')
    validateOutletAccess(user, job.outletId ?? '')

    // ── IMMUTABLE STATE GUARD ──
    // A DELIVERED job has been handed back to the customer (or internally completed).
    // Its serial lifecycle is sealed — reopening it would silently re-assign the
    // serial unit and corrupt the RMA chain. Use a new ticket instead.
    if (job.status === ServiceJobStatus.DELIVERED) {
      throw new Error(
        'Cannot modify a delivered service ticket. Create a new ticket if the device needs further work.'
      )
    }

    // Resolve & sanitize serialUnitId to prevent FK violations
    let finalSerialUnitId: string | null = null
    let finalSerialNumber: string | null = null
    const rawSerial = parsed.data.serialUnitId?.trim()
    if (rawSerial) {
      const unit = await activeTx.serialUnit.findFirst({
        where: {
          OR: [{ id: rawSerial }, { serialNumber: { equals: rawSerial, mode: 'insensitive' } }],
        },
        select: { id: true, serialNumber: true, status: true },
      })
      if (unit) {
        finalSerialUnitId = unit.id
        finalSerialNumber = unit.serialNumber
        // Keep serial unit in IN_SERVICE status while ticket is active
        if (parsed.data.status !== ServiceJobStatus.DELIVERED && parsed.data.status !== ServiceJobStatus.CANCELLED) {
          await activeTx.serialUnit.update({
            where: { id: unit.id },
            data: { status: SerialStatus.IN_SERVICE },
          })
        }
      } else {
        finalSerialNumber = rawSerial
      }
    }

    // Resolve & sanitize technicianId
    let finalTechnicianId: string | null = null
    const rawTech = parsed.data.technicianId?.trim()
    if (rawTech) {
      const tech = await activeTx.user.findFirst({
        where: { id: rawTech },
        select: { id: true },
      })
      if (tech) {
        finalTechnicianId = tech.id
      }
    }

    const updated = await activeTx.serviceJob.update({
      where: { id: parsed.data.id },
      data: {
        ...(parsed.data.customerId ? { customerId: parsed.data.customerId } : {}),
        device: parsed.data.device,
        issue: parsed.data.issue,
        accessoriesReceived: parsed.data.accessoriesReceived?.trim() || null,
        expectedCompletionDate: parsed.data.expectedCompletionDate || null,
        serialUnitId: finalSerialUnitId,
        serialNumber: finalSerialNumber,
        technicianId: finalTechnicianId,
        status: parsed.data.status,
        diagnosis: parsed.data.diagnosis?.trim() || null,
        resolution: parsed.data.resolution?.trim() || null,
        isWarranty: parsed.data.isWarranty,
        estimatedCost: parsed.data.estimatedCost ?? null,
        receivedAt: parsed.data.receivedAt,
        ...(parsed.data.status === ServiceJobStatus.COMPLETED
          ? { completedAt: new Date() }
          : {}),
        ...(parsed.data.status === ServiceJobStatus.DELIVERED
          ? { deliveredAt: new Date() }
          : {}),
      },
    })

    return updated
  }

  try {
    let updated: any
    if (tx) {
      updated = await executeUpdate(tx)
    } else {
      updated = await prisma.$transaction(async innerTx => await executeUpdate(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    return ok(updated)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to update service ticket')
  }
}

export async function deleteServiceJob(jobId: string, tx?: PrismaTx) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )

  if (!jobId?.trim()) return fail('Invalid service ticket')

  const client = tx ?? prisma

  try {
    const job = await client.serviceJob.findUnique({
      where: { id: jobId },
      select: { id: true, outletId: true, serialUnitId: true, jobType: true },
    })
    if (!job) return fail('Service ticket not found')
    if (job.jobType === 'INTERNAL') {
      return fail('Internal repairs cannot be deleted. Please resolve them using the Resolve Repair action instead.')
    }
    validateOutletAccess(user, job.outletId ?? '')

    const invoice = await client.serviceInvoice.findUnique({
      where: { jobId },
      select: { id: true },
    })
    if (invoice) {
      return fail('Cannot delete a service ticket that already has an invoice')
    }

    const executeDelete = async (activeTx: PrismaTx) => {
      // If a serial was in service, revert it back to SOLD
      if (job.serialUnitId) {
        await activeTx.serialUnit.update({
          where: { id: job.serialUnitId },
          data: { status: SerialStatus.SOLD },
        })
      }

      await activeTx.serviceJobPart.deleteMany({ where: { jobId } })
      await activeTx.serviceJob.delete({ where: { id: jobId } })
    }

    if (tx) {
      await executeDelete(tx)
    } else {
      await prisma.$transaction(async innerTx => await executeDelete(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    return ok({ id: jobId })
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to delete service ticket')
  }
}

const dispatchRmaSchema = z.object({
  jobId: z.string().min(1),
  supplierId: z.string().optional(),
  notes: z.string().optional(),
})

export async function dispatchRmaToSupplier(
  data: z.infer<typeof dispatchRmaSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = dispatchRmaSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const executeDispatch = async (activeTx: PrismaTx) => {
    const job = await activeTx.serviceJob.findUnique({
      where: { id: parsed.data.jobId },
      select: { id: true, outletId: true, serialUnitId: true, jobNumber: true },
    })
    if (!job) throw new Error('Service ticket not found')
    validateOutletAccess(user, job.outletId ?? '')

    // 4. Supplier Dispatch: Update SerialUnit to RETURNED_TO_SUPPLIER
    if (job.serialUnitId) {
      await activeTx.serialUnit.update({
        where: { id: job.serialUnitId },
        data: {
          status: SerialStatus.RETURNED_TO_SUPPLIER,
        },
      })
    }

    const updated = await activeTx.serviceJob.update({
      where: { id: parsed.data.jobId },
      data: {
        status: ServiceJobStatus.WAITING_PARTS,
        resolution: parsed.data.notes?.trim()
          ? `Dispatched to Supplier: ${parsed.data.notes.trim()}`
          : 'Dispatched to Supplier for Warranty RMA',
      },
    })

    return updated
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
    safeRevalidatePath('/service/rma')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to dispatch RMA to supplier')
  }
}

const resolveReplacementSchema = z.object({
  jobId: z.string().min(1),
  replacementSerialUnitId: z.string().min(1),
  notes: z.string().optional(),
})

export async function resolveRmaReplacement(
  data: z.infer<typeof resolveReplacementSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = resolveReplacementSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const executeReplacement = async (activeTx: PrismaTx) => {
    const job = await activeTx.serviceJob.findUnique({
      where: { id: parsed.data.jobId },
      select: {
        id: true,
        jobNumber: true,
        outletId: true,
        serialUnitId: true,
        customerId: true,
        device: true,
        jobType: true,
        serialUnit: { select: { id: true, warrantyExpiry: true } },
      },
    })
    if (!job) throw new Error('Service ticket not found')
    if (job.jobType === 'INTERNAL') {
      throw new Error('resolveRmaReplacement is for Customer RMAs only. For internal repairs, resolve the ticket manually.')
    }
    validateOutletAccess(user, job.outletId ?? '')

    // SVC-F3: Check warranty expiry on RMA replacement
    if (job.serialUnit?.warrantyExpiry && new Date(job.serialUnit.warrantyExpiry) < new Date()) {
      if (!([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as string[]).includes(user.role)) {
        throw new Error(
          `Cannot process RMA replacement: Serial warranty expired on ${new Date(job.serialUnit.warrantyExpiry).toLocaleDateString('en-GB')}. Manager approval required.`
        )
      }
    }

    const targetOutletId = user.outletId ?? job.outletId ?? ''

    // 1. Lock and validate NEW replacement serial unit
    await activeTx.$executeRaw`SELECT id FROM "SerialUnit" WHERE id = ${parsed.data.replacementSerialUnitId} FOR UPDATE`
    const newSerial = await activeTx.serialUnit.findUnique({
      where: { id: parsed.data.replacementSerialUnitId },
      include: { product: true },
    })

    if (!newSerial) {
      throw new Error('Replacement serial unit not found')
    }
    if (newSerial.status !== SerialStatus.IN_STOCK) {
      throw new Error(`Replacement serial unit is not IN_STOCK (current status: ${newSerial.status})`)
    }

    // 2. Transition NEW replacement serial from IN_STOCK -> SOLD
    await activeTx.serialUnit.update({
      where: { id: newSerial.id },
      data: {
        status: SerialStatus.SOLD,
        soldAt: new Date(),
      },
    })

    // 3. Deduct NEW replacement serial from StockLedger
    await activeTx.stockLedger.create({
      data: {
        productId: newSerial.productId,
        outletId: targetOutletId,
        movementType: StockMovementType.SERVICE_USE,
        quantity: -1,
        referenceId: job.id,
        referenceType: 'ServiceJob',
        notes: `RMA Warranty Replacement for Ticket ${job.jobNumber} (Old Unit: ${job.serialUnitId || 'N/A'})`,
      },
    })

    // SVC-F4: Deplete FIFO stock layer and post GL for RMA warranty replacement
    const consumedBatches = await consumeStockLayers(activeTx, {
      productId: newSerial.productId,
      outletId: targetOutletId,
      quantityNeeded: 1,
      allowSyntheticLayer: false,
    })

    const unitCost =
      consumedBatches.reduce(
        (sum, b) => sum + b.quantityConsumed * Number(b.unitCost),
        0
      ) || Number(newSerial.costPrice || newSerial.product?.costPrice || 0)

    if (unitCost > 0) {
      const coaAccounts = await activeTx.chartOfAccount.findMany({
        where: { code: { in: ['1400', '5000', '5320', '5299'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const invAccountId = coaMap.get('1400')
      const warrantyExpenseAccountId =
        coaMap.get('5320') || coaMap.get('5000') || coaMap.get('5299')

      if (!invAccountId) {
        throw new Error('Inventory Asset account (1400) not found in Chart of Accounts')
      }
      if (!warrantyExpenseAccountId) {
        throw new Error('Warranty/COGS expense account (5320 or 5000) not found in Chart of Accounts')
      }

      const effectiveDate = new Date()
      const gl = [
        {
          accountId: warrantyExpenseAccountId,
          type: TransactionType.DEBIT,
          amount: unitCost,
          description: `RMA Warranty Replacement Unit (${newSerial.serialNumber}) for Ticket ${job.jobNumber}`,
          referenceId: job.id,
          referenceType: 'RmaReplacement',
          createdAt: effectiveDate,
        },
        {
          accountId: invAccountId,
          type: TransactionType.CREDIT,
          amount: unitCost,
          description: `Inventory deduction for RMA Replacement Unit (${newSerial.serialNumber})`,
          referenceId: job.id,
          referenceType: 'RmaReplacement',
          createdAt: effectiveDate,
        },
      ]

      assertBalancedJournal(gl)
      await activeTx.accountLedgerEntry.createMany({ data: gl })
    }

    // 4. Mark OLD unit permanently as DEAD (scrapped) or RETURNED_TO_SUPPLIER
    if (job.serialUnitId) {
      await activeTx.serialUnit.update({
        where: { id: job.serialUnitId },
        data: {
          status: SerialStatus.DEAD,
        },
      })
    }

    // 5. Complete ServiceJob
    const updatedJob = await activeTx.serviceJob.update({
      where: { id: job.id },
      data: {
        status: ServiceJobStatus.COMPLETED,
        completedAt: new Date(),
        resolution: parsed.data.notes?.trim()
          ? `RMA Replaced with Serial ${newSerial.serialNumber}: ${parsed.data.notes.trim()}`
          : `RMA Replaced with Serial ${newSerial.serialNumber}`,
      },
    })

    return { job: updatedJob, replacementSerial: newSerial }
  }

  try {
    let result: any
    if (tx) {
      result = await executeReplacement(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeReplacement(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to resolve RMA replacement')
  }
}

const resolveRefundSchema = z
  .object({
    jobId: z.string().min(1),
    amount: z.coerce.number().positive('Refund amount must be positive'),
    method: z.nativeEnum(PaymentMethod),
    bankAccountId: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    data => data.method === PaymentMethod.CASH || (typeof data.bankAccountId === 'string' && data.bankAccountId.trim().length > 0),
    { message: 'Bank account is required for non-cash refund', path: ['bankAccountId'] }
  )

export async function resolveRmaRefund(
  data: z.infer<typeof resolveRefundSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = resolveRefundSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { jobId, amount, method, bankAccountId, notes } = parsed.data

  const executeRefund = async (activeTx: PrismaTx) => {
    const job = await activeTx.serviceJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        outletId: true,
        customerId: true,
        serialUnitId: true,
      },
    })
    if (!job) throw new Error('Service ticket not found')
    validateOutletAccess(user, job.outletId ?? '')

    const targetOutletId = user.outletId ?? job.outletId ?? ''

    // 1. Process payment refund deduction from Drawer or Bank Account
    if (method === PaymentMethod.CASH) {
      const rawDrawers = await activeTx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "CashDrawer"
        WHERE "outletId" = ${targetOutletId} AND status = 'OPEN'
        ORDER BY "openedAt" DESC
        LIMIT 1
        FOR UPDATE
      `
      if (!rawDrawers || rawDrawers.length === 0) {
        throw new Error('No open cash drawer found for cash refund')
      }
      const openDrawerId = rawDrawers[0].id

      await activeTx.drawerTransaction.create({
        data: {
          drawerId: openDrawerId,
          type: DRAWER_TX_TYPE.SERVICE_REFUND,
          amount: -amount,
          description: `RMA Warranty Refund for Ticket ${job.jobNumber}`,
          referenceId: job.id,
          referenceType: BANK_TX_REF_TYPE.SERVICE_REFUND,
        },
      })
    } else if (bankAccountId) {
      await activeTx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      await activeTx.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: { decrement: amount } },
      })

      await activeTx.bankTransaction.create({
        data: {
          bankAccountId,
          type: BankTransactionType.WITHDRAWAL,
          amount,
          description: `RMA Warranty Refund for Ticket ${job.jobNumber}`,
          referenceId: job.id,
          referenceType: BANK_TX_REF_TYPE.SERVICE_REFUND,
        },
      })
    }

    // 1b. Post General Ledger double-entry for RMA refund (Dr Service Revenue/Returns, Cr Cash/Bank)
    const coaAccounts = await activeTx.chartOfAccount.findMany({
      where: {
        code: { in: ['1100', '1200', '4200', '5299'] },
      },
      select: { id: true, code: true },
    })
    const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
    const refundExpenseAccountId = coaMap.get('4200') || coaMap.get('5299')
    const assetAccountId =
      method === PaymentMethod.CASH ? coaMap.get('1100') : coaMap.get('1200')

    if (!assetAccountId) {
      throw new Error(`Asset account for ${method === PaymentMethod.CASH ? 'Cash (1100)' : 'Bank (1200)'} not found in Chart of Accounts`)
    }
    if (!refundExpenseAccountId) {
      throw new Error('Refund expense account (4200 or 5299) not found in Chart of Accounts')
    }

    const effectiveDate = new Date()
    const gl = [
      {
        accountId: refundExpenseAccountId,
        type: TransactionType.DEBIT,
        amount,
        description: `RMA Warranty Refund — Ticket ${job.jobNumber}`,
        referenceId: job.id,
        referenceType: 'ServiceJob',
        createdAt: effectiveDate,
      },
      {
        accountId: assetAccountId,
        type: TransactionType.CREDIT,
        amount,
        description: `RMA Warranty Refund — Ticket ${job.jobNumber}`,
        referenceId: job.id,
        referenceType: 'ServiceJob',
        createdAt: effectiveDate,
      },
    ]
    assertBalancedJournal(gl)
    await activeTx.accountLedgerEntry.createMany({
      data: gl,
    })

    // 2. Mark OLD unit as DEAD
    if (job.serialUnitId) {
      await activeTx.serialUnit.update({
        where: { id: job.serialUnitId },
        data: {
          status: SerialStatus.DEAD,
        },
      })
    }

    // 3. Complete ServiceJob
    const updatedJob = await activeTx.serviceJob.update({
      where: { id: job.id },
      data: {
        status: ServiceJobStatus.COMPLETED,
        completedAt: new Date(),
        resolution: notes?.trim()
          ? `RMA Refunded ৳${amount.toLocaleString()} via ${method}: ${notes.trim()}`
          : `RMA Refunded ৳${amount.toLocaleString()} via ${method}`,
      },
    })

    return updatedJob
  }

  try {
    let result: any
    if (tx) {
      result = await executeRefund(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeRefund(innerTx), {
        maxWait: 15000,
        timeout: 60000,
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/service/rma')
    safeRevalidatePath('/finances')
    safeRevalidatePath('/reports')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to resolve RMA refund')
  }
}

const serviceInvoiceSchema = z.object({
  jobId: z.string(),
  laborCost: z.coerce.number().min(0),
  parts: z
    .array(
      z.object({
        productId: z.string().optional(),
        serialNumber: z.string().optional(),
        serialUnitId: z.string().optional(),
        quantity: z.coerce.number().int().min(1),
        unitCost: z.coerce.number().min(0),
      })
    )
    .default([]),
  payments: z.array(
    z
      .object({
        method: z.nativeEnum(PaymentMethod),
        amount: z.coerce.number().min(0),
        bankAccountId: z.string().optional(),
        feeAmount: z.coerce.number().min(0).optional(),
        reference: z.string().optional(),
      })
      .refine(
        p => p.method === PaymentMethod.CASH || !p.amount || (typeof p.bankAccountId === 'string' && p.bankAccountId.trim().length > 0),
        { message: 'Bank account is required for non-cash payments', path: ['bankAccountId'] }
      )
  ),
})

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100

export async function createServiceInvoice(
  data: z.infer<typeof serviceInvoiceSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = serviceInvoiceSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { jobId, laborCost, parts, payments } = parsed.data
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } })
  if (!job) return fail('Service job not found')
  if (job.jobType === 'INTERNAL') return fail('Cannot create an invoice for an internal repair job.')
  validateOutletAccess(user, job.outletId ?? '')

  const partsCost = round2(parts.reduce((sum, p) => sum + round2(p.quantity * p.unitCost), 0))
  const total = round2(laborCost + partsCost)
  const amountPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  const dueAmount = round2(total > amountPaid ? total - amountPaid : 0)

  // SVC-F7: Friendly validation against overpayments before entering transaction
  if (amountPaid > total + 0.01) {
    return fail(`Payment amount (৳${amountPaid}) exceeds invoice total (৳${total})`)
  }

  const targetOutletId = user.outletId ?? job.outletId ?? ''

  try {
    const executeInvoice = async (tx: PrismaTx) => {
      // 0. Pessimistic sorted locking on products to prevent inventory deadlocks
      const uniqueProductIds = Array.from(
        new Set(parts.map(p => p.productId).filter(Boolean))
      ).sort()
      for (const pid of uniqueProductIds) {
        await tx.$executeRaw`SELECT id FROM "Product" WHERE id = ${pid} FOR UPDATE`
      }

      // 1. Check open cash drawer if cash payment is included
      const hasCashPayment = payments.some(p => p.method === PaymentMethod.CASH && p.amount > 0)
      let openDrawerId: string | null = null

      if (hasCashPayment) {
        const rawDrawers = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "CashDrawer"
          WHERE "outletId" = ${targetOutletId} AND status = 'OPEN'
          ORDER BY "openedAt" DESC
          LIMIT 1
          FOR UPDATE
        `
        if (!rawDrawers || rawDrawers.length === 0) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a cash drawer first.'
          )
        }
        openDrawerId = rawDrawers[0].id
      }

      // 2. Create ServiceInvoice
      const invoice = await tx.serviceInvoice.create({
        data: {
          invoiceNumber: await nextDocumentNumber(tx, 'service_invoice'),
          jobId,
          status:
            amountPaid >= total
              ? InvoiceStatus.PAID
              : amountPaid > 0
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.SENT,
          laborCost,
          partsCost,
          total,
          amountPaid,
          payments: {
            create: payments.map(p => ({
              method: p.method,
              amount: p.amount,
              bankAccountId: p.bankAccountId || undefined,
              feeAmount: p.feeAmount || 0,
              reference: p.reference?.trim() || undefined,
            })),
          },
        },
      })

      // 3. Process Parts Inventory (Serial updateMany guard or consumeStockLayers)
      let exactPartsCogs = 0
      const partRows = parts.filter(
        p => !!p.productId || !!p.serialNumber || !!p.serialUnitId
      )
      if (partRows.length > 0) {
        // Bug 5 fix: Pre-resolve serial product IDs before serviceJobPart creation to avoid FK crashes
        const resolvedPartRows: Array<{
          productId: string
          quantity: number
          unitCost: number
          serialNumber?: string
          serialUnitId?: string
        }> = []

        for (const p of partRows) {
          let finalPid = p.productId
          if (!finalPid && (p.serialNumber || p.serialUnitId)) {
            const snCondition = p.serialNumber
              ? { serialNumber: p.serialNumber }
              : { id: p.serialUnitId }
            const foundSerial = await tx.serialUnit.findFirst({
              where: snCondition,
              select: { productId: true },
            })
            if (foundSerial) {
              finalPid = foundSerial.productId
            }
          }

          if (!finalPid) {
            throw new Error('Part is missing a valid product reference.')
          }

          resolvedPartRows.push({
            productId: finalPid,
            quantity: p.quantity,
            unitCost: p.unitCost,
            serialNumber: p.serialNumber,
            serialUnitId: p.serialUnitId,
          })
        }

        await tx.serviceJobPart.createMany({
          data: resolvedPartRows.map(p => ({
            jobId,
            productId: p.productId,
            quantity: p.quantity,
            unitCost: p.unitCost,
          })),
        })

        for (const p of resolvedPartRows) {
          if (p.serialNumber || p.serialUnitId) {
            // Serialized part: atomic updateMany guard pattern
            const snCondition = p.serialNumber
              ? { serialNumber: p.serialNumber }
              : { id: p.serialUnitId }

            const updatedCount = await tx.serialUnit.updateMany({
              where: {
                ...snCondition,
                outletId: targetOutletId,
                status: SerialStatus.IN_STOCK,
              },
              data: {
                status: SerialStatus.IN_SERVICE,
              },
            })

            if (updatedCount.count === 0) {
              throw new Error(
                `Serial number ${p.serialNumber || p.serialUnitId} is not available in stock at this outlet`
              )
            }

            const serial = await tx.serialUnit.findFirst({
              where: snCondition,
              select: { id: true, productId: true, costPrice: true },
            })

            if (serial) {
              // Consume StockLayers for serialized parts to maintain FIFO accounting truth
              const batches = await consumeStockLayers(tx, {
                productId: serial.productId,
                outletId: targetOutletId,
                quantityNeeded: 1,
                allowSyntheticLayer: false,
              })

              const consumedCost = batches.length > 0
                ? batches.reduce((sum, b) => sum + Number(b.totalCost ?? (Number(b.quantityConsumed) * Number(b.unitCost))), 0)
                : Number(serial.costPrice ?? p.unitCost)
              exactPartsCogs = round2(exactPartsCogs + consumedCost)

              if (batches.length > 0) {
                for (const batch of batches) {
                  await tx.stockLedger.create({
                    data: {
                      productId: serial.productId,
                      outletId: targetOutletId,
                      supplierId: batch.supplierId,
                      purchaseOrderId: batch.purchaseOrderId,
                      movementType: StockMovementType.SERVICE_USE,
                      quantity: -batch.quantityConsumed,
                      referenceId: invoice.id,
                      referenceType: 'ServiceInvoice',
                      notes: `Service Repair Part Used (Serial ${p.serialNumber || p.serialUnitId}) (Layer ${batch.layerId})`,
                    },
                  })
                }
              } else {
                await tx.stockLedger.create({
                  data: {
                    productId: serial.productId,
                    outletId: targetOutletId,
                    movementType: StockMovementType.SERVICE_USE,
                    quantity: -1,
                    referenceId: invoice.id,
                    referenceType: 'ServiceInvoice',
                    notes: `Service Repair Part Used (Serial ${p.serialNumber || p.serialUnitId})`,
                  },
                })
              }
            }
          } else if (p.productId) {
            // Non-serialized part: consumeStockLayers
            const batches = await consumeStockLayers(tx, {
              productId: p.productId,
              outletId: targetOutletId,
              quantityNeeded: p.quantity,
            })

            for (const batch of batches) {
              // Bug 1 fix: Accumulate exact FIFO layer cost basis for consumed part
              exactPartsCogs = round2(
                exactPartsCogs + Number(batch.quantityConsumed) * Number(batch.unitCost)
              )

              await tx.stockLedger.create({
                data: {
                  productId: p.productId,
                  outletId: targetOutletId,
                  supplierId: batch.supplierId,
                  purchaseOrderId: batch.purchaseOrderId,
                  movementType: StockMovementType.SERVICE_USE,
                  quantity: -batch.quantityConsumed,
                  referenceId: invoice.id,
                  referenceType: 'ServiceInvoice',
                  notes: `Service Part Used (Layer ${batch.layerId})`,
                },
              })
            }
          }
        }
      }

      // 4. Process Payments Received (Cash drawer & Bank accounts)
      for (const p of payments) {
        if (p.amount <= 0) continue

        if (p.method === PaymentMethod.CASH && openDrawerId) {
          await tx.drawerTransaction.create({
            data: {
              drawerId: openDrawerId,
              type: DRAWER_TX_TYPE.SERVICE_PAYMENT,
              amount: p.amount,
              description: `Service Payment Invoice ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
            },
          })
        } else if (
          p.method === PaymentMethod.BANK_TRANSFER ||
          p.method === PaymentMethod.BKASH ||
          p.method === PaymentMethod.NAGAD ||
          p.method === PaymentMethod.ROCKET ||
          p.method === PaymentMethod.CARD ||
          p.method === PaymentMethod.CHEQUE
        ) {
          if (p.bankAccountId) {
            const pFee = round2(Number(p.feeAmount || 0))
            const netDeposit = round2(p.amount - pFee)
            await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${p.bankAccountId} FOR UPDATE`

            await tx.bankAccount.update({
              where: { id: p.bankAccountId },
              data: {
                currentBalance: { increment: netDeposit },
              },
            })

            await tx.bankTransaction.create({
              data: {
                bankAccountId: p.bankAccountId,
                type: BankTransactionType.DEPOSIT,
                amount: p.amount,
                description: `Service Invoice Payment ${invoice.invoiceNumber}`,
                referenceId: invoice.id,
                referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
              },
            })

            if (pFee > 0) {
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: p.bankAccountId,
                  type: BankTransactionType.WITHDRAWAL,
                  amount: pFee,
                  description: `MFS/Bank Fee — Service Invoice ${invoice.invoiceNumber}`,
                  referenceId: invoice.id,
                  referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
                },
              })
            }
          }
        }
      }

      // 5. Customer Due Tracking (Unpaid Balance)
      if (dueAmount > 0 && job.customerId) {
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${job.customerId} FOR UPDATE`

        await tx.customer.update({
          where: { id: job.customerId },
          data: {
            outstandingBalance: { increment: dueAmount },
          },
        })

        await tx.customerLedger.create({
          data: {
            customerId: job.customerId,
            type: TransactionType.DEBIT,
            amount: dueAmount,
            description: `Service Invoice Due ${invoice.invoiceNumber}`,
            referenceId: invoice.id,
          },
        })
      }

      // 6. Double-Entry General Ledger Postings (AccountLedgerEntry)
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: {
          code: { in: ['1100', '1200', '1300', '1400', '4200', '5000', '5290', '5291', '5299'] },
        },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))

      const cashAccountId = coaMap.get('1100')
      const bankAssetAccountId = coaMap.get('1200')
      const accountsReceivableAccountId = coaMap.get('1300')
      const inventoryAccountId = coaMap.get('1400')
      const serviceRevenueAccountId = coaMap.get('4200')
      const cogsAccountId = coaMap.get('5000')

      const ledgerEntries: Array<{
        accountId: string
        type: TransactionType
        amount: number
        description: string
        referenceId: string
        referenceType: string
        createdAt?: Date
      }> = []

      // 6. Double-Entry General Ledger Postings (AccountLedgerEntry)
      const cashPaid = payments
        .filter(p => p.method === PaymentMethod.CASH)
        .reduce((sum, p) => sum + p.amount, 0)
      const nonCashPaid = payments
        .filter(p => p.method !== PaymentMethod.CASH)
        .reduce((sum, p) => sum + p.amount, 0)

      if (total > 0 && !serviceRevenueAccountId) {
        throw new Error('Service revenue account (4200) not found in Chart of Accounts')
      }
      if (cashPaid > 0 && !cashAccountId) {
        throw new Error('Cash account (1100) not found in Chart of Accounts')
      }
      if (nonCashPaid > 0 && !bankAssetAccountId) {
        throw new Error('Bank account (1200) not found in Chart of Accounts')
      }
      if (dueAmount > 0 && !accountsReceivableAccountId) {
        throw new Error('Accounts receivable account (1300) not found in Chart of Accounts')
      }
      if (exactPartsCogs > 0) {
        if (!cogsAccountId) throw new Error('COGS account (5000) not found in Chart of Accounts')
        if (!inventoryAccountId) throw new Error('Inventory account (1400) not found in Chart of Accounts')
      }

      const invoiceDate = invoice.createdAt

      // 6.1. Credit Service Revenue for total invoice amount
      if (serviceRevenueAccountId && total > 0) {
        ledgerEntries.push({
          accountId: serviceRevenueAccountId,
          type: TransactionType.CREDIT,
          amount: total,
          description: `Service Revenue — Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
      }

      // 6.2. Debit Cash in Hand for cash payments
      if (cashAccountId && cashPaid > 0) {
        ledgerEntries.push({
          accountId: cashAccountId,
          type: TransactionType.DEBIT,
          amount: cashPaid,
          description: `Cash Payment — Service Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
      }

      // 6.3. Debit Bank Accounts for non-cash payments
      if (bankAssetAccountId && nonCashPaid > 0) {
        ledgerEntries.push({
          accountId: bankAssetAccountId,
          type: TransactionType.DEBIT,
          amount: nonCashPaid,
          description: `Bank/MFS Payment — Service Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
      }

      // 6.4. Debit Accounts Receivable for unpaid due balance
      if (accountsReceivableAccountId && dueAmount > 0) {
        ledgerEntries.push({
          accountId: accountsReceivableAccountId,
          type: TransactionType.DEBIT,
          amount: dueAmount,
          description: `Accounts Receivable — Service Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
      }

      // 6.5. Debit COGS & Credit Inventory for parts consumed at exact FIFO cost basis (Bug 1 fix)
      if (cogsAccountId && inventoryAccountId && exactPartsCogs > 0) {
        ledgerEntries.push({
          accountId: cogsAccountId,
          type: TransactionType.DEBIT,
          amount: exactPartsCogs,
          description: `Service Parts COGS — Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
        ledgerEntries.push({
          accountId: inventoryAccountId,
          type: TransactionType.CREDIT,
          amount: exactPartsCogs,
          description: `Service Parts Inventory Deduction — Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: invoiceDate,
        })
      }

      // 6.6. Bank/MFS Transaction Fees
      for (const p of payments) {
        const fee = p.feeAmount || 0
        if (fee > 0) {
          const feeAccountId =
            p.method === PaymentMethod.BKASH ||
            p.method === PaymentMethod.NAGAD ||
            p.method === PaymentMethod.ROCKET
              ? coaMap.get('5290') || coaMap.get('5299')
              : coaMap.get('5291') || coaMap.get('5299')

          if (feeAccountId && bankAssetAccountId) {
            ledgerEntries.push({
              accountId: feeAccountId,
              type: TransactionType.DEBIT,
              amount: fee,
              description: `Transaction Fee — Service Invoice ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: 'ServiceInvoice',
              createdAt: invoiceDate,
            })
            ledgerEntries.push({
              accountId: bankAssetAccountId,
              type: TransactionType.CREDIT,
              amount: fee,
              description: `Transaction Fee Deduction — Service Invoice ${invoice.invoiceNumber}`,
              referenceId: invoice.id,
              referenceType: 'ServiceInvoice',
              createdAt: invoiceDate,
            })

            await tx.expense.create({
              data: {
                description: `MFS/Bank Transaction Fee (Service Invoice ${invoice.invoiceNumber})`,
                amount: fee,
                accountId: feeAccountId,
                status: 'APPROVED',
                outletId: targetOutletId,
                createdById: user.id,
                approvedById: user.id,
                bankAccountId: p.bankAccountId || undefined,
                method: p.method,
              },
            })
          }
        }
      }

      if (ledgerEntries.length > 0) {
        assertBalancedJournal(ledgerEntries)
        await tx.accountLedgerEntry.createMany({
          data: ledgerEntries,
        })
      }

      // 7. Complete ServiceJob
      await tx.serviceJob.update({
        where: { id: jobId },
        data: {
          finalCost: total,
          status: ServiceJobStatus.COMPLETED,
          completedAt: new Date(),
        },
      })

      return invoice
    }

    let result: any
    if (tx) {
      result = await executeInvoice(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeInvoice(innerTx))
    }

    // Trigger Low-Stock Notification for consumed service parts
    const consumedProductIds = parts
      .map(p => p.productId)
      .filter((id): id is string => Boolean(id))
    if (consumedProductIds.length > 0) {
      checkAndNotifyLowStock(consumedProductIds, targetOutletId).catch(err => {
        console.error('[Service] Failed to check low stock after invoice:', err)
      })
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/finances')
    safeRevalidatePath('/reports')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    if (error?.message?.startsWith('FIFO_LAYER_DEFICIT:')) {
      const parts = error.message.split('|')
      const productName = parts[0].replace('FIFO_LAYER_DEFICIT:', '').replace(/"/g, '')
      const available = parts[1]
      const required = parts[2]
      return fail(
        `Stock records for ${productName} are inconsistent (FIFO layers: ${available}, required: ${required}). Ask a manager to run a stock adjustment.`
      )
    }
    return fail(error?.message || 'Failed to create service invoice')
  }
}

const collectPaymentSchema = z
  .object({
    invoiceId: z.string().min(1, 'Invoice ID is required'),
    amount: z.coerce.number().positive('Payment amount must be greater than 0'),
    method: z.nativeEnum(PaymentMethod),
    bankAccountId: z.string().optional(),
    feeAmount: z.coerce.number().min(0).optional(),
    reference: z.string().optional(),
    chequeDate: z.string().optional(),
  })
  .refine(
    data => data.method === PaymentMethod.CASH || (typeof data.bankAccountId === 'string' && data.bankAccountId.trim().length > 0),
    { message: 'Bank account is required for non-cash payment', path: ['bankAccountId'] }
  )

export async function collectServicePayment(
  data: z.infer<typeof collectPaymentSchema>,
  tx?: PrismaTx
) {
  const user = await requireRole(
    UserRole.CASHIER,
    UserRole.TECHNICIAN,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  )
  const parsed = collectPaymentSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { invoiceId, amount, method, bankAccountId, feeAmount = 0, chequeDate } = parsed.data
  let reference = parsed.data.reference
  if (method === PaymentMethod.CHEQUE && chequeDate) {
    if (!reference?.includes('[Cheque Matures:')) {
      reference = reference ? `${reference} | [Cheque Matures: ${chequeDate}]` : `[Cheque Matures: ${chequeDate}]`
    }
  }

  const executeCollect = async (activeTx: PrismaTx) => {
    // Row lock on ServiceInvoice to serialize concurrent payments
    await activeTx.$executeRaw`SELECT id FROM "ServiceInvoice" WHERE id = ${invoiceId} FOR UPDATE`

    const invoice = await activeTx.serviceInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        job: { select: { id: true, jobNumber: true, outletId: true, customerId: true } },
        payments: true,
      },
    })
    if (!invoice) throw new Error('Service invoice not found')
    validateOutletAccess(user, invoice.job.outletId ?? '')

    const targetOutletId = user.outletId ?? invoice.job.outletId ?? ''
    const currentPaid = Number(invoice.amountPaid || 0)
    const invoiceTotal = Number(invoice.total)
    const currentDue = Math.max(0, round2(invoiceTotal - currentPaid))

    if (currentDue <= 0) {
      throw new Error('Invoice is already fully paid')
    }
    if (amount > currentDue + 0.01) {
      throw new Error(`Payment amount (৳${amount}) exceeds remaining due (৳${currentDue})`)
    }

    // 1. Process Cash Drawer
    let openDrawerId: string | null = null
    if (method === PaymentMethod.CASH) {
      const rawDrawers = await activeTx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "CashDrawer"
        WHERE "outletId" = ${targetOutletId} AND status = 'OPEN'
        ORDER BY "openedAt" DESC
        LIMIT 1
        FOR UPDATE
      `
      if (!rawDrawers || rawDrawers.length === 0) {
        throw new Error(
          'No open cash drawer found for this outlet. Please open a cash drawer first.'
        )
      }
      openDrawerId = rawDrawers[0].id

      await activeTx.drawerTransaction.create({
        data: {
          drawerId: openDrawerId,
          type: DRAWER_TX_TYPE.SERVICE_PAYMENT,
          amount,
          description: `Service Due Payment Invoice ${invoice.invoiceNumber}`,
          referenceId: invoiceId,
          referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
        },
      })
    } else if (bankAccountId) {
      // 2. Process Bank / MFS
      const netDeposit = round2(amount - (feeAmount || 0))
      await activeTx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      await activeTx.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: { increment: netDeposit } },
      })

      await activeTx.bankTransaction.create({
        data: {
          bankAccountId,
          type: BankTransactionType.DEPOSIT,
          amount,
          description: `Service Due Payment Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
        },
      })

      if (feeAmount > 0) {
        await activeTx.bankTransaction.create({
          data: {
            bankAccountId,
            type: BankTransactionType.WITHDRAWAL,
            amount: feeAmount,
            description: `MFS/Bank Fee — Service Due Payment Invoice ${invoice.invoiceNumber}`,
            referenceId: invoice.id,
            referenceType: BANK_TX_REF_TYPE.SERVICE_PAYMENT,
          },
        })
      }
    }

    // 3. Create ServicePayment record
    const payment = await activeTx.servicePayment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        method,
        bankAccountId: bankAccountId || null,
        feeAmount,
        reference: reference?.trim() || null,
      },
    })

    // 4. Update ServiceInvoice amountPaid atomically and status
    const newAmountPaid = round2(currentPaid + amount)
    const isFullyPaid = newAmountPaid >= invoiceTotal - 0.01

    const updatedInvoice = await activeTx.serviceInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: { increment: amount },
        status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
      },
    })

    // 5. Update Customer outstandingBalance & CustomerLedger
    if (invoice.job.customerId) {
      await activeTx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${invoice.job.customerId} FOR UPDATE`
      await activeTx.customer.update({
        where: { id: invoice.job.customerId },
        data: {
          outstandingBalance: { decrement: amount },
        },
      })

      await activeTx.customerLedger.create({
        data: {
          customerId: invoice.job.customerId,
          type: TransactionType.CREDIT,
          amount,
          description: `Service Invoice Payment ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
        },
      })
    }

    // 6. Post Double-Entry General Ledger: Dr Cash/Bank, Cr Accounts Receivable
    const coaAccounts = await activeTx.chartOfAccount.findMany({
      where: {
        code: { in: ['1100', '1200', '1300', '5290', '5291', '5299'] },
      },
      select: { id: true, code: true },
    })
    const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))

    const cashAccountId = coaMap.get('1100')
    const bankAssetAccountId = coaMap.get('1200')
    const accountsReceivableAccountId = coaMap.get('1300')

    const ledgerEntries: Array<{
      accountId: string
      type: TransactionType
      amount: number
      description: string
      referenceId: string
      referenceType: string
      createdAt?: Date
    }> = []

    const assetAccountId = method === PaymentMethod.CASH ? cashAccountId : bankAssetAccountId
    if (!assetAccountId) {
      throw new Error(`Asset account for ${method === PaymentMethod.CASH ? 'Cash (1100)' : 'Bank (1200)'} not found in Chart of Accounts`)
    }
    if (!accountsReceivableAccountId) {
      throw new Error('Accounts receivable account (1300) not found in Chart of Accounts')
    }

    const paymentDate = payment.paidAt

    ledgerEntries.push({
      accountId: assetAccountId,
      type: TransactionType.DEBIT,
      amount,
      description: `Service Due Payment Received — Invoice ${invoice.invoiceNumber}`,
      referenceId: invoice.id,
      referenceType: 'ServiceInvoice',
      createdAt: paymentDate,
    })

    ledgerEntries.push({
      accountId: accountsReceivableAccountId,
      type: TransactionType.CREDIT,
      amount,
      description: `Accounts Receivable Settled — Service Invoice ${invoice.invoiceNumber}`,
      referenceId: invoice.id,
      referenceType: 'ServiceInvoice',
      createdAt: paymentDate,
    })

    if (feeAmount > 0) {
      const feeAccountId =
        method === PaymentMethod.BKASH ||
        method === PaymentMethod.NAGAD ||
        method === PaymentMethod.ROCKET
          ? coaMap.get('5290') || coaMap.get('5299')
          : coaMap.get('5291') || coaMap.get('5299')

      if (feeAccountId && assetAccountId) {
        ledgerEntries.push({
          accountId: feeAccountId,
          type: TransactionType.DEBIT,
          amount: feeAmount,
          description: `Transaction Fee — Service Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: paymentDate,
        })
        ledgerEntries.push({
          accountId: assetAccountId,
          type: TransactionType.CREDIT,
          amount: feeAmount,
          description: `Transaction Fee Deduction — Service Invoice ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          referenceType: 'ServiceInvoice',
          createdAt: paymentDate,
        })

        await activeTx.expense.create({
          data: {
            description: `MFS/Bank Transaction Fee (Service Invoice ${invoice.invoiceNumber})`,
            amount: feeAmount,
            accountId: feeAccountId,
            status: 'APPROVED',
            outletId: targetOutletId,
            createdById: user.id,
            approvedById: user.id,
            bankAccountId: bankAccountId || undefined,
            method,
          },
        })
      }
    }

    if (ledgerEntries.length > 0) {
      assertBalancedJournal(ledgerEntries)
      await activeTx.accountLedgerEntry.createMany({
        data: ledgerEntries,
      })
    }

    return { payment, invoice: updatedInvoice }
  }

  try {
    let result: any
    if (tx) {
      result = await executeCollect(tx)
    } else {
      result = await prisma.$transaction(async innerTx => await executeCollect(innerTx))
    }

    safeRevalidatePath('/service')
    safeRevalidatePath('/finances')
    safeRevalidatePath('/reports')
    return ok(result)
  } catch (error: any) {
    const dbFail = failIfDatabaseUnavailable(error)
    if (dbFail) return dbFail
    return fail(error?.message || 'Failed to collect service payment')
  }
}

export async function getServiceJobs() {
  const user = await requireAuth()
  return prisma.serviceJob.findMany({
    where: {
      ...(user.role === UserRole.SUPER_ADMIN ? {} : { outletId: user.outletId }),
    },
    include: {
      customer: { select: { name: true, phone: true } },
      technician: { select: { id: true, name: true } },
      serialUnit: { select: { id: true, serialNumber: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export async function getWarrantyClaims() {
  const user = await requireAuth()
  return prisma.serviceJob.findMany({
    where: {
      isWarranty: true,
      ...(user.role === UserRole.SUPER_ADMIN ? {} : { outletId: user.outletId }),
    },
    include: {
      customer: { select: { name: true, phone: true } },
      technician: { select: { id: true, name: true } },
      serialUnit: { select: { id: true, serialNumber: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export async function getServiceJobFormOptions() {
  await requireAuth()

  const [customers, technicians] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true },
      take: 500,
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          in: [
            UserRole.TECHNICIAN,
            UserRole.MANAGER,
            UserRole.ADMIN,
            UserRole.SUPER_ADMIN,
          ],
        },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
      take: 200,
    }),
  ])

  return { customers, technicians }
}

export async function getServiceInvoices() {
  const user = await requireAuth()
  return prisma.serviceInvoice.findMany({
    where: {
      ...(user.role === UserRole.SUPER_ADMIN ? {} : { job: { outletId: user.outletId } }),
    },
    include: {
      job: {
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
          technician: { select: { id: true, name: true, email: true } },
          outlet: true,
          serialUnit: {
            include: {
              product: {
                select: {
                  name: true,
                  sku: true,
                  brand: { select: { name: true } },
                },
              },
            },
          },
          parts: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
      },
      payments: {
        include: {
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        },
        orderBy: { paidAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
}

export async function getServiceInvoiceById(id: string) {
  const user = await requireAuth()
  if (!id?.trim()) return fail('Invoice ID is required')

  const invoice = await prisma.serviceInvoice.findFirst({
    where: {
      OR: [{ id }, { invoiceNumber: id }],
    },
    include: {
      job: {
        include: {
          customer: true,
          technician: { select: { id: true, name: true, email: true, role: true } },
          outlet: true,
          serialUnit: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  condition: true,
                  brand: { select: { name: true } },
                },
              },
            },
          },
          parts: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
      },
      payments: {
        include: {
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        },
        orderBy: { paidAt: 'asc' },
      },
    },
  })

  if (!invoice) return fail('Service invoice not found')
  if (
    user.role !== UserRole.SUPER_ADMIN &&
    invoice.job.outletId &&
    user.outletId &&
    invoice.job.outletId !== user.outletId
  ) {
    return fail('Forbidden: You do not have access to this outlet invoice')
  }

  return ok(invoice)
}

export async function getServiceInvoiceFormOptions() {
  const user = await requireAuth()
  const targetOutletId = user.outletId

  const [uninvoicedJobs, products, bankAccounts, openDrawer] = await Promise.all([
    prisma.serviceJob.findMany({
      where: {
        invoice: null,
        jobType: 'CUSTOMER',
        ...(user.role === UserRole.SUPER_ADMIN ? {} : { outletId: targetOutletId }),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        technician: { select: { id: true, name: true } },
        serialUnit: {
          select: {
            id: true,
            serialNumber: true,
            product: { select: { name: true } },
          },
        },
        parts: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.product.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        costPrice: true,
        requiresSerial: true,
        stockLayers: {
          where: targetOutletId ? { outletId: targetOutletId } : undefined,
          select: {
            quantityRemaining: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 300,
    }),
    prisma.bankAccount.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        isMfs: true,
        currentBalance: true,
      },
      orderBy: { bankName: 'asc' },
    }),
    targetOutletId
      ? prisma.cashDrawer.findFirst({
          where: {
            outletId: targetOutletId,
            status: 'OPEN',
          },
          select: { id: true },
          orderBy: { openedAt: 'desc' },
        })
      : null,
  ])

  return {
    uninvoicedJobs,
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      sellingPrice: Number(p.sellingPrice),
      costPrice: Number(p.costPrice),
      requiresSerial: p.requiresSerial,
      stockCount: p.stockLayers.reduce((sum, layer) => sum + layer.quantityRemaining, 0),
    })),
    bankAccounts: bankAccounts.map(b => ({
      id: b.id,
      bankName: b.bankName,
      accountName: b.accountName,
      accountNumber: b.accountNumber,
      isMfs: b.isMfs,
      currentBalance: Number(b.currentBalance),
    })),
    hasOpenCashDrawer: Boolean(openDrawer),
  }
}

