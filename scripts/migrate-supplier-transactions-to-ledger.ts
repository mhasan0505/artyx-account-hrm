import { prisma } from '../lib/db'
import { TransactionType } from '@prisma/client'

/**
 * ==============================================================================
 * SCRIPT: migrate-supplier-transactions-to-ledger.ts
 * ==============================================================================
 * Phase 1, Step 6 of purchase-b2b-cleanup-plan.md:
 * One-off, dry-run-by-default migration script that copies historical
 * SupplierTransaction records into SupplierLedger to ensure full data continuity
 * before SupplierTransaction is eventually retired.
 *
 * SAFETY INVARIANTS:
 * 1. Default mode is DRY-RUN: Read-only inspection and summary.
 * 2. Writes ONLY when explicit '--confirm' CLI argument is passed.
 * 3. IDEMPOTENT: Skips records already present in SupplierLedger (by referenceId,
 *    ledgerEntryId, or exact timestamp + supplier + amount match).
 * ==============================================================================
 */

function determineLedgerType(st: {
  type: string
  amount: any
  description?: string | null
}): TransactionType {
  const t = (st.type || '').toUpperCase()
  if (t === 'PURCHASE') {
    return TransactionType.DEBIT
  }
  if (
    t === 'SALE' ||
    t === 'PAYMENT_OUT' ||
    t === 'PAYMENT_IN' ||
    t === 'INVOICE_PAYMENT' ||
    t === 'RETURN' ||
    t === 'PURCHASE_RETURN' ||
    t === 'PARTY_NETTING'
  ) {
    return TransactionType.CREDIT
  }
  if (t === 'EXCHANGE') {
    if (st.description && st.description.includes('(in their favor)')) {
      return TransactionType.DEBIT
    }
    return TransactionType.CREDIT
  }
  if (t === 'ADJUSTMENT') {
    if (st.description && /increase|debit/i.test(st.description)) {
      return TransactionType.DEBIT
    }
    return TransactionType.CREDIT
  }
  return TransactionType.CREDIT
}

async function main() {
  const args = process.argv.slice(2)
  const isConfirm = args.includes('--confirm')

  console.log('=== HISTORICAL SUPPLIER TRANSACTION MIGRATION SCRIPT ===')
  console.log(`Execution Mode: ${isConfirm ? '🔴 LIVE WRITE (--confirm)' : '🟢 DRY RUN (Read-Only Preview)'}`)
  console.log('Timestamp:', new Date().toISOString())

  const totalTransactions = await prisma.supplierTransaction.count()
  console.log(`Found ${totalTransactions} total SupplierTransaction records.`)

  if (totalTransactions === 0) {
    console.log('No SupplierTransaction records found. Nothing to migrate.')
    return
  }

  const transactions = await prisma.supplierTransaction.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      invoice: {
        select: {
          id: true,
          poId: true,
          po: {
            select: {
              outletId: true,
            },
          },
        },
      },
    },
  })

  let alreadyMigratedCount = 0
  let toMigrateCount = 0
  const migrationPlan: Array<{
    stId: string
    supplierId: string
    type: TransactionType
    transactionType: string
    amount: number
    description: string
    referenceId: string
    reference: string | null
    method: any
    bankAccountId: string | null
    feeAmount: number
    invoiceId: string | null
    outletId: string | null
    purchaseOrderId: string | null
    purchaseReturnId: string | null
    createdById: string | null
    createdAt: Date
  }> = []

  for (const st of transactions) {
    // Duplicate detection / idempotency check
    const existingLedger = await prisma.supplierLedger.findFirst({
      where: {
        OR: [
          ...(st.ledgerEntryId ? [{ id: st.ledgerEntryId }] : []),
          { referenceId: st.id },
          {
            supplierId: st.supplierId,
            createdAt: st.createdAt,
            amount: st.amount,
          },
        ],
      },
    })

    if (existingLedger) {
      alreadyMigratedCount++
      continue
    }

    const type = determineLedgerType(st)
    const outletId = st.outletId || st.invoice?.po?.outletId || null
    const purchaseOrderId = st.purchaseOrderId || st.invoice?.poId || null

    migrationPlan.push({
      stId: st.id,
      supplierId: st.supplierId,
      type,
      transactionType: st.type,
      amount: Number(st.amount),
      description: st.description,
      referenceId: st.id,
      reference: st.reference || null,
      method: st.method,
      bankAccountId: st.bankAccountId || null,
      feeAmount: Number(st.feeAmount || 0),
      invoiceId: st.invoiceId || null,
      outletId,
      purchaseOrderId,
      purchaseReturnId: st.purchaseReturnId || null,
      createdById: st.createdById,
      createdAt: st.createdAt,
    })
    toMigrateCount++
  }

  console.log(`\nAnalysis Summary:`)
  console.log(`- Already represented in SupplierLedger: ${alreadyMigratedCount}`)
  console.log(`- Pending migration to SupplierLedger:   ${toMigrateCount}`)

  if (toMigrateCount === 0) {
    console.log('\nAll historical records are already represented in SupplierLedger.')
    return
  }

  console.log('\nSample records to migrate (up to 5):')
  for (const item of migrationPlan.slice(0, 5)) {
    console.log(
      `  [${item.stId}] ${item.createdAt.toISOString().slice(0, 10)} | ${item.transactionType} -> ${item.type} | ৳${item.amount} | Supplier: ${item.supplierId}`
    )
  }

  if (!isConfirm) {
    console.log('\n[DRY RUN COMPLETE] No records were modified.')
    console.log('To execute this migration against the database, run:')
    console.log('  pnpm tsx scripts/migrate-supplier-transactions-to-ledger.ts --confirm')
    return
  }

  console.log(`\n[LIVE WRITE] Migrating ${toMigrateCount} records to SupplierLedger...`)
  let writtenCount = 0

  await prisma.$transaction(
    async tx => {
      for (const item of migrationPlan) {
        const ledgerRow = await tx.supplierLedger.create({
          data: {
            supplierId: item.supplierId,
            type: item.type,
            amount: item.amount,
            description: item.description,
            referenceId: item.referenceId,
            reference: item.reference,
            transactionType: item.transactionType,
            method: item.method,
            bankAccountId: item.bankAccountId,
            feeAmount: item.feeAmount,
            invoiceId: item.invoiceId,
            outletId: item.outletId,
            purchaseOrderId: item.purchaseOrderId,
            purchaseReturnId: item.purchaseReturnId,
            createdById: item.createdById,
            createdAt: item.createdAt,
          },
        })

        // Also back-link ledgerEntryId on SupplierTransaction if possible
        await tx.supplierTransaction.update({
          where: { id: item.stId },
          data: { ledgerEntryId: ledgerRow.id },
        })

        writtenCount++
      }
    },
    { timeout: 60000 }
  )

  console.log(`\n[SUCCESS] Successfully migrated ${writtenCount} records to SupplierLedger.`)
}

main()
  .catch(err => {
    console.error('Fatal error during migration:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
