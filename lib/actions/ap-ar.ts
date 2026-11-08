'use server'

import { requireAuth, requireRole } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { logAuditDirect } from '@/lib/audit/logger'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import {
  DrawerStatus,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
  SaleStatus,
  TransactionType,
  UserRole,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'
import {
  applyInvoicePayment,
  requireOpenDrawerForPurchase,
} from '@/lib/purchases/invoice-payment'

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100

export interface ApArOverviewData {
  liquidity: {
    totalCashBalance: number
    openDrawersCount: number
    drawers: Array<{
      id: string
      openedBy: string
      shift: string
      openingBalance: number
      currentBalance: number
      openedAt: Date
    }>
    totalBankBalance: number
    totalMfsBalance: number
    bankAccounts: Array<{
      id: string
      bankName: string
      accountName: string
      accountNumber: string
      branch: string | null
      isMfs: boolean
      currentBalance: number
      transactionChargePct: number
      cashoutChargePct: number
      chargeType: string
    }>
    netLiquidAssets: number
  }
  payables: {
    totalOutstanding: number
    overdueAmount: number
    dueThisWeek: number
    suppliersWithBalance: number
    suppliers: Array<{
      id: string
      name: string
      email: string | null
      phone: string | null
      address: string | null
      country: string | null
      outstandingBalance: number
      grossApBalance: number
      grossArBalance: number
      netBalance: number
      isB2BLinked: boolean
      linkedCustomerName?: string | null
      linkedCustomerId?: string | null
      overdueInvoicesCount: number
      openInvoicesCount: number
    }>
    outstandingInvoices: Array<{
      id: string
      invoiceNumber: string
      supplierId: string
      supplierName: string
      supplierPhone: string | null
      supplierEmail: string | null
      total: number
      amountPaid: number
      dueAmount: number
      dueDate: Date | null
      status: string
      createdAt: Date
    }>
  }
  receivables: {
    totalOutstanding: number
    overdueAmount: number
    dueThisWeek: number
    customersWithBalance: number
    customers: Array<{
      id: string
      name: string
      email: string | null
      phone: string | null
      address: string | null
      outstandingBalance: number
      grossArBalance: number
      grossApBalance: number
      netBalance: number
      isB2BLinked: boolean
      linkedSupplierName?: string | null
      linkedSupplierId?: string | null
    }>
    outstandingSales: Array<{
      id: string
      saleNumber: string
      customerId: string | null
      customerName: string
      customerPhone: string | null
      customerEmail: string | null
      total: number
      amountPaid: number
      dueAmount: number
      createdAt: Date
    }>
  }
  vouchers: Array<{
    id: string
    voucherNumber: string
    voucherType: 'PAYMENT' | 'RECEIPT' | 'CONTRA' | 'ADJUSTMENT'
    date: Date
    partyName: string
    partyPhone: string | null
    partyEmail: string | null
    partyAddress?: string | null
    accountName: string
    method: string
    amount: number
    reference: string | null
    description: string
    createdByName: string
    /** Human-readable invoice / sale number this voucher settles */
    invoiceRef: string | null
  }>
}

export async function getApArOverview(filters?: {
  startDate?: string
  endDate?: string
  outletId?: string
}): Promise<ApArOverviewData> {
  const user = await requireAuth()
  const targetOutletId = filters?.outletId || user.outletId

  return await withDatabaseReadFallback(
    async () => {
      // 1. Cash Drawers calculation
      const openDrawers = await prisma.cashDrawer.findMany({
        where: {
          ...(targetOutletId ? { outletId: targetOutletId } : {}),
          status: DrawerStatus.OPEN,
        },
        include: {
          openedBy: { select: { name: true } },
          transactions: true,
        },
      })

      const drawersList = openDrawers.map(drawer => {
        const openBal = Number(drawer.openingBalance || 0)
        const hasOpeningTx = drawer.transactions.some(tx => tx.type === 'OPENING')
        // The OPENING drawerTransaction already carries openingBalance as its amount.
        // If an OPENING transaction exists, start accumulator at 0 to avoid double-counting;
        // otherwise fallback to openBal for any legacy drawers missing an OPENING record.
        const currentBal = drawer.transactions.reduce((acc, tx) => {
          return acc + Number(tx.amount || 0)
        }, hasOpeningTx ? 0 : openBal)
        return {
          id: drawer.id,
          openedBy: drawer.openedBy?.name ?? '—',
          shift: String(drawer.shift),
          openingBalance: openBal,
          currentBalance: currentBal,
          openedAt: drawer.openedAt,
        }
      })

      const totalCashBalance = drawersList.reduce(
        (sum, d) => sum + d.currentBalance,
        0
      )

      // 2. Bank & MFS Accounts
      const bankAccountsRaw = await prisma.bankAccount.findMany({
        where: {
          ...(targetOutletId ? { outletId: targetOutletId } : {}),
          isActive: true,
        },
        orderBy: { bankName: 'asc' },
      })

      const bankAccounts = bankAccountsRaw.map(acc => ({
        id: acc.id,
        bankName: acc.bankName,
        accountName: acc.accountName,
        accountNumber: acc.accountNumber,
        branch: acc.branch,
        isMfs: acc.isMfs,
        currentBalance: Number(acc.currentBalance || 0),
        transactionChargePct: Number(acc.transactionChargePct || 0),
        cashoutChargePct: Number(acc.cashoutChargePct || 0),
        chargeType: acc.chargeType,
      }))

      const totalBankBalance = bankAccounts
        .filter(a => !a.isMfs)
        .reduce((sum, a) => sum + a.currentBalance, 0)
      const totalMfsBalance = bankAccounts
        .filter(a => a.isMfs)
        .reduce((sum, a) => sum + a.currentBalance, 0)

      // 3. Accounts Payable (Suppliers)
      const [suppliersRaw, suppliersWithBalCount, apAgg] = await Promise.all([
        prisma.supplier.findMany({
          where: {
            OR: [
              { outstandingBalance: { gt: 0 } },
              { purchaseInvoices: { some: { status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] } } } },
            ],
          },
          orderBy: { outstandingBalance: 'desc' },
          take: 100,
          include: {
            linkedCustomer: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                outstandingBalance: true,
              },
            },
          },
        }),
        prisma.supplier.count({
          where: { outstandingBalance: { gt: 0 } },
        }),
        prisma.supplier.aggregate({
          _sum: { outstandingBalance: true },
          where: { outstandingBalance: { gt: 0 } },
        }),
      ])

      const now = new Date()
      const startOfDay7 = new Date()
      startOfDay7.setDate(now.getDate() + 7)

      const totalApOutstanding = Number(apAgg._sum.outstandingBalance || 0)
      let apOverdueAmount = 0
      let apDueThisWeek = 0

      const suppliersList = suppliersRaw.map(sup => {
        const grossAp = Number(sup.outstandingBalance || 0)
        const grossAr = sup.linkedCustomer ? Number(sup.linkedCustomer.outstandingBalance || 0) : 0
        const netBalance = grossAr - grossAp

        return {
          id: sup.id,
          name: sup.name,
          email: sup.email,
          phone: sup.phone,
          address: sup.address,
          country: sup.country,
          outstandingBalance: grossAp,
          grossApBalance: grossAp,
          grossArBalance: grossAr,
          netBalance,
          isB2BLinked: Boolean(sup.linkedCustomer),
          linkedCustomerName: sup.linkedCustomer?.name ?? null,
          linkedCustomerId: sup.linkedCustomer?.id ?? null,
          overdueInvoicesCount: 0,
          openInvoicesCount: 0,
        }
      })

      const openPurchaseInvoicesRaw = await prisma.purchaseInvoice.findMany({
        where: {
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] },
          ...(filters?.startDate || filters?.endDate
            ? {
                createdAt: {
                  ...(filters.startDate
                    ? { gte: new Date(filters.startDate) }
                    : {}),
                  ...(filters.endDate
                    ? { lte: new Date(filters.endDate) }
                    : {}),
                },
              }
            : {}),
        },
        include: {
          supplier: {
            select: { name: true, phone: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const outstandingInvoices = openPurchaseInvoicesRaw.map(inv => {
        const tot = Number(inv.total || 0)
        const paid = Number(inv.amountPaid || 0)
        const due = Math.max(0, tot - paid)
        const isCredit = paid > tot
        const creditAmount = isCredit ? round2(paid - tot) : 0

        if (inv.dueDate && !isCredit) {
          const dueDt = new Date(inv.dueDate)
          if (dueDt < now) apOverdueAmount += due
          if (dueDt >= now && dueDt <= startOfDay7) apDueThisWeek += due
        }

        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplierId: inv.supplierId,
          supplierName: inv.supplier.name,
          supplierPhone: inv.supplier.phone,
          supplierEmail: inv.supplier.email,
          total: tot,
          amountPaid: paid,
          dueAmount: due,
          isCredit,
          creditAmount,
          dueDate: inv.dueDate,
          status: isCredit ? 'Advance / Credit' : String(inv.status),
          createdAt: inv.createdAt,
        }
      })

      // 4. Accounts Receivable (Customers)
      const [customersRaw, customersWithBalCount, arAgg] = await Promise.all([
        prisma.customer.findMany({
          where: {
            OR: [
              { outstandingBalance: { gt: 0 } },
              { sales: { some: { isQuotation: false, status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED] } } } },
            ],
          },
          orderBy: { outstandingBalance: 'desc' },
          take: 100,
          include: {
            linkedSupplier: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                outstandingBalance: true,
              },
            },
          },
        }),
        prisma.customer.count({
          where: { outstandingBalance: { gt: 0 } },
        }),
        prisma.customer.aggregate({
          _sum: { outstandingBalance: true },
          where: { outstandingBalance: { gt: 0 } },
        }),
      ])

      const totalArOutstanding = Number(arAgg._sum.outstandingBalance || 0)

      const customersList = customersRaw.map(cust => {
        const grossAr = Number(cust.outstandingBalance || 0)
        const grossAp = cust.linkedSupplier ? Number(cust.linkedSupplier.outstandingBalance || 0) : 0
        const netBalance = grossAr - grossAp

        return {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          phone: cust.phone,
          address: cust.address,
          outstandingBalance: grossAr,
          grossArBalance: grossAr,
          grossApBalance: grossAp,
          netBalance,
          isB2BLinked: Boolean(cust.linkedSupplier),
          linkedSupplierName: cust.linkedSupplier?.name ?? null,
          linkedSupplierId: cust.linkedSupplier?.id ?? null,
        }
      })

      // Strictly fetch unpaid sales at the PostgreSQL level to eliminate blind spots
      const openSalesRaw = await prisma.$queryRaw<
        {
          id: string
          saleNumber: string
          customerId: string | null
          total: any
          amountPaid: any
          createdAt: Date
          customerName: string | null
          customerPhone: string | null
          customerEmail: string | null
        }[]
      >`
        SELECT 
          s.id, 
          s."saleNumber", 
          s."customerId", 
          s.total, 
          s."amountPaid", 
          s."createdAt", 
          c.name as "customerName", 
          c.phone as "customerPhone", 
          c.email as "customerEmail" 
        FROM "Sale" s 
        LEFT JOIN "Customer" c ON s."customerId" = c.id 
        WHERE s."isQuotation" = false 
          AND s.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED') 
          AND s."amountPaid" < s.total 
          ${filters?.startDate ? Prisma.sql`AND s."createdAt" >= ${new Date(filters.startDate)}` : Prisma.empty}
          ${filters?.endDate ? Prisma.sql`AND s."createdAt" <= ${new Date(filters.endDate)}` : Prisma.empty}
        ORDER BY s."createdAt" DESC 
        LIMIT 100;
      `

      const openSalesList: ApArOverviewData['receivables']['outstandingSales'] =
        openSalesRaw.map(sale => {
          const tot = Number(sale.total || 0)
          const paid = Number(sale.amountPaid || 0)
          const due = Math.max(0, tot - paid)
          return {
            id: sale.id,
            saleNumber: sale.saleNumber,
            customerId: sale.customerId,
            customerName: sale.customerName || 'Walk-in Customer',
            customerPhone: sale.customerPhone || null,
            customerEmail: sale.customerEmail || null,
            total: tot,
            amountPaid: paid,
            dueAmount: due,
            createdAt: sale.createdAt,
          }
        })

      // Unpaid Service Invoices (Mismatch 1 fix: AP/AR receivables display for service dues)
      const openServiceInvoicesRaw = await prisma.serviceInvoice.findMany({
        where: {
          amountPaid: { lt: prisma.serviceInvoice.fields.total },
          ...(filters?.startDate || filters?.endDate
            ? {
                createdAt: {
                  ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
                  ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
                },
              }
            : {}),
        },
        include: {
          job: {
            include: {
              customer: { select: { id: true, name: true, phone: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      const outstandingServiceInvoices: ApArOverviewData['receivables']['outstandingSales'] =
        openServiceInvoicesRaw.map(inv => {
          const tot = Number(inv.total || 0)
          const paid = Number(inv.amountPaid || 0)
          const due = Math.max(0, tot - paid)
          return {
            id: inv.id,
            saleNumber: `${inv.invoiceNumber} (Service)`,
            customerId: inv.job.customerId,
            customerName: inv.job.customer?.name || 'Walk-in Customer',
            customerPhone: inv.job.customer?.phone || null,
            customerEmail: inv.job.customer?.email || null,
            total: tot,
            amountPaid: paid,
            dueAmount: due,
            createdAt: inv.createdAt,
          }
        })

      const outstandingSales: ApArOverviewData['receivables']['outstandingSales'] = [
        ...openSalesList,
        ...outstandingServiceInvoices,
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      // 5. Vouchers Log
      const dateQuery =
        filters?.startDate || filters?.endDate
          ? {
              createdAt: {
                ...(filters.startDate
                  ? { gte: new Date(filters.startDate) }
                  : {}),
                ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
              },
            }
          : {}

      const supplierTxRaw = await prisma.supplierTransaction.findMany({
        where: dateQuery,
        include: {
          supplier: true,
          createdBy: { select: { name: true } },
          bankAccount: { select: { bankName: true, accountName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      const customerLedgerRaw = await prisma.customerLedger.findMany({
        where: dateQuery,
        include: {
          customer: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      // Resolve saleNumbers for customer ledger entries that have a saleId as referenceId
      const custLedgerSaleIds = customerLedgerRaw
        .map(led => led.referenceId)
        .filter((r): r is string => !!r && r.startsWith('cm')) // cuid starts with 'cm'
      const saleNumberMap = new Map<string, string>()
      if (custLedgerSaleIds.length > 0) {
        const saleRows = await prisma.sale.findMany({
          where: { id: { in: custLedgerSaleIds } },
          select: { id: true, saleNumber: true },
        })
        saleRows.forEach(s => saleNumberMap.set(s.id, s.saleNumber))
      }

      const contraRaw = await prisma.contraTransfer.findMany({
        where: dateQuery,
        include: {
          createdBy: { select: { name: true } },
          bankAccount: { select: { bankName: true, accountName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      const vouchers: ApArOverviewData['vouchers'] = []

      supplierTxRaw.forEach(tx => {
        vouchers.push({
          id: `SUP-${tx.id}`,
          voucherNumber: tx.reference || `VCH-SUP-${tx.id.slice(-6)}`,
          voucherType: tx.type.includes('PAYMENT') ? 'PAYMENT' : 'ADJUSTMENT',
          date: tx.createdAt,
          partyName: tx.supplier.name,
          partyPhone: tx.supplier.phone,
          partyEmail: tx.supplier.email,
          partyAddress: tx.supplier.address || null,
          accountName: tx.bankAccount
            ? `${tx.bankAccount.bankName} (${tx.bankAccount.accountName})`
            : 'Cash Drawer',
          method: tx.method || 'CASH',
          amount: Number(tx.amount || 0),
          reference: tx.reference,
          description: tx.description,
          createdByName: tx.createdBy.name,
          invoiceRef: tx.invoice?.invoiceNumber || null,
        })
      })

      customerLedgerRaw.forEach(led => {
        const saleNum = led.referenceId ? saleNumberMap.get(led.referenceId) || null : null
        vouchers.push({
          id: `CUST-${led.id}`,
          voucherNumber: led.referenceId || `VCH-CUST-${led.id.slice(-6)}`,
          voucherType:
            led.type === TransactionType.CREDIT ? 'RECEIPT' : 'ADJUSTMENT',
          date: led.createdAt,
          partyName: led.customer.name,
          partyPhone: led.customer.phone,
          partyEmail: led.customer.email,
          partyAddress: led.customer.address || null,
          accountName: 'Cash / Bank',
          method: 'RECORDED',
          amount: Number(led.amount || 0),
          reference: led.referenceId,
          description: led.description,
          createdByName: 'System',
          invoiceRef: saleNum,
        })
      })

      contraRaw.forEach(con => {
        vouchers.push({
          id: `CON-${con.id}`,
          voucherNumber: `VCH-CON-${con.id.slice(-6)}`,
          voucherType: 'CONTRA',
          date: con.createdAt,
          partyName: 'Internal Transfer',
          partyPhone: null,
          partyEmail: null,
          accountName: con.bankAccount
            ? `${con.bankAccount.bankName} (${con.bankAccount.accountName})`
            : 'Cash Drawer ↔ Bank',
          method: con.type,
          amount: Number(con.amount || 0),
          reference: con.status,
          description: con.notes || `Contra transfer: ${con.type}`,
          createdByName: con.createdBy.name,
          invoiceRef: null,
        })
      })

      vouchers.sort((a, b) => b.date.getTime() - a.date.getTime())

      return {
        liquidity: {
          totalCashBalance,
          openDrawersCount: drawersList.length,
          drawers: drawersList,
          totalBankBalance,
          totalMfsBalance,
          bankAccounts,
          netLiquidAssets:
            totalCashBalance + totalBankBalance + totalMfsBalance,
        },
        payables: {
          totalOutstanding: totalApOutstanding,
          overdueAmount: apOverdueAmount,
          dueThisWeek: apDueThisWeek,
          suppliersWithBalance: suppliersWithBalCount,
          suppliers: suppliersList,
          outstandingInvoices,
        },
        receivables: {
          totalOutstanding: totalArOutstanding,
          overdueAmount: outstandingSales.reduce((s, sale) => {
            // Treat sales older than 30 days with outstanding balance as overdue
            const ageDays =
              (now.getTime() - new Date(sale.createdAt).getTime()) / 86_400_000
            return s + (ageDays > 30 ? sale.dueAmount : 0)
          }, 0),
          dueThisWeek: outstandingSales.reduce((s, sale) => {
            const ageDays =
              (now.getTime() - new Date(sale.createdAt).getTime()) / 86_400_000
            return s + (ageDays <= 7 ? sale.dueAmount : 0)
          }, 0),
          customersWithBalance: customersWithBalCount,
          customers: customersList,
          outstandingSales,
        },
        vouchers,
      }
    },
    {
      liquidity: {
        totalCashBalance: 0,
        openDrawersCount: 0,
        drawers: [],
        totalBankBalance: 0,
        totalMfsBalance: 0,
        bankAccounts: [],
        netLiquidAssets: 0,
      },
      payables: {
        totalOutstanding: 0,
        overdueAmount: 0,
        dueThisWeek: 0,
        suppliersWithBalance: 0,
        suppliers: [],
        outstandingInvoices: [],
      },
      receivables: {
        totalOutstanding: 0,
        overdueAmount: 0,
        dueThisWeek: 0,
        customersWithBalance: 0,
        customers: [],
        outstandingSales: [],
      },
      vouchers: [],
    }
  )
}

const recordSupplierPaymentSchema = z.object({
  supplierId: z.string().min(1),
  invoiceId: z.string().optional(),
  amount: z.coerce.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().min(1),
  chequeDate: z.string().optional(),
})

export async function recordSupplierPaymentAction(
  data: z.infer<typeof recordSupplierPaymentSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const parsed = recordSupplierPaymentSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { supplierId, invoiceId, amount, method, bankAccountId, reference, chequeDate } =
    parsed.data
  let description = parsed.data.description
  if (method === PaymentMethod.CHEQUE && chequeDate) {
    if (!description.includes('[Cheque Matures:')) {
      description += ` | [Cheque Matures: ${chequeDate}]`
    }
  }

  if (method !== PaymentMethod.CASH && !bankAccountId) {
    return fail('Bank account is required for electronic payments')
  }

  try {
    if (method === PaymentMethod.CASH) {
      await requireOpenDrawerForPurchase.rolloverBeforeTx(user.outletId)
    }

    await prisma.$transaction(async tx => {
      // 1. Enforce strict lock hierarchy: PurchaseOrder -> Supplier -> BankAccount -> PurchaseInvoice
      if (invoiceId) {
        const invPo = await tx.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          select: { poId: true },
        })
        if (invPo?.poId) {
          await tx.$executeRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${invPo.poId} FOR UPDATE`
        }
      }

      // 2. Lock Customer (if linked) then Supplier to enforce global Customer -> Supplier lock hierarchy
      let preCheck = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { linkedCustomer: { select: { id: true } } },
      })
      let lockedCustId = preCheck?.linkedCustomer?.id

      if (lockedCustId) {
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${lockedCustId} FOR UPDATE`
      }

      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

      // Re-verify the link after locking Supplier
      const supLockCheck = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { outstandingBalance: true, linkedCustomer: { select: { id: true } } },
      })
      if (supLockCheck?.linkedCustomer && supLockCheck.linkedCustomer.id !== lockedCustId) {
        lockedCustId = supLockCheck.linkedCustomer.id
        await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${lockedCustId} FOR UPDATE`
      }

      // 3. Lock BankAccount
      if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }

      // 4. Lock PurchaseInvoice
      let lockedInvoice: { id: string; total: any; amountPaid: any } | null = null
      if (invoiceId) {
        await tx.$executeRaw`SELECT id FROM "PurchaseInvoice" WHERE id = ${invoiceId} FOR UPDATE`
        lockedInvoice = await tx.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          select: { id: true, total: true, amountPaid: true },
        })
        if (!lockedInvoice) throw new Error('Purchase invoice not found')
      }

      // 5. Balance checks AFTER all locks are held
      if (!invoiceId && amount > Number(supLockCheck?.outstandingBalance || 0)) {
        throw new Error(
          `Payment amount (৳${amount.toLocaleString()}) exceeds the supplier's outstanding balance (৳${Number(
            supLockCheck?.outstandingBalance || 0
          ).toLocaleString()}).`
        )
      }

      if (lockedInvoice) {
        const remaining = round2(Number(lockedInvoice.total || 0) - Number(lockedInvoice.amountPaid || 0))
        if (amount > remaining) {
          throw new Error(
            `Payment amount (৳${amount.toLocaleString()}) exceeds remaining invoice balance (৳${remaining.toLocaleString()}).`
          )
        }
      }
      // 1. Create SupplierTransaction record
      const transaction = await tx.supplierTransaction.create({
        data: {
          supplierId,
          invoiceId: invoiceId || null,
          type: 'PAYMENT_OUT',
          amount,
          method,
          bankAccountId: bankAccountId || null,
          reference: reference || null,
          description,
          createdById: user.id,
          outletId: user.outletId,
        },
      })

      // 2. Add SupplierLedger entry
      await tx.supplierLedger.create({
        data: {
          supplierId,
          type: TransactionType.CREDIT,
          amount,
          description,
          method,
          bankAccountId: bankAccountId || null,
          reference: reference || null,
          transactionType: 'PAYMENT_OUT',
          createdById: user.id,
          invoiceId: invoiceId || null,
        },
      })

      // 3. Reduce supplier outstanding balance
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      // 4. Update invoice payment if invoiceId provided
      if (invoiceId) {
        const payment = await tx.purchasePayment.create({
          data: {
            invoiceId,
            outletId: user.outletId,
            amount,
            method,
            bankAccountId: bankAccountId || null,
            reference: reference || null,
          },
        })

        await tx.purchasePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId,
            amount,
          },
        })

        await applyInvoicePayment(tx, {
          invoiceId,
          deltaAmountPaid: amount,
        })
      }

      // 5. Handle payment method logic: Cash Drawer or Bank Account
      if (method === PaymentMethod.CASH) {
        const openDrawer = await requireOpenDrawerForPurchase(tx, user.outletId)

        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId: openDrawer.id },
          _sum: { amount: true },
        })

        // The OPENING drawerTransaction already carries the opening amount,
        // so the aggregate sum represents the true current balance.
        const cashBalance = Number(stats._sum.amount || 0)

        if (cashBalance < amount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${amount.toLocaleString()}`
          )
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.SUPPLIER_PAYMENT,
            amount: -amount,
            description: `Supplier Payment - ${description}`,
            referenceId: transaction.id,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
      } else if (bankAccountId) {
        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: bankAccountId },
          select: { currentBalance: true },
        })
        if (!bankAccount) throw new Error('Bank account not found')
        if (Number(bankAccount.currentBalance) < amount) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: {
              decrement: amount,
            },
          },
        })

        await tx.bankTransaction.create({
          data: {
            bankAccountId,
            type: 'WITHDRAWAL',
            amount,
            description: `Supplier Payment - ${description}`,
            referenceId: transaction.id,
            referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
          },
        })
      }

      // 6. Post Double-Entry General Ledger: Dr Accounts Payable (2100), Cr Cash (1100) / Bank (1200)
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1200', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const apAccId = coaMap.get('2100')
      const payCode = method === PaymentMethod.CASH ? '1100' : '1200'
      const creditAccId = coaMap.get(payCode)

      if (!apAccId || !creditAccId) {
        throw new Error(
          `Required Chart of Accounts (2100 or ${payCode}) not found for supplier payment.`
        )
      }

      const glEntries = [
        {
          accountId: apAccId,
          type: TransactionType.DEBIT,
          amount,
          description: `Supplier Payment - ${description}`,
          referenceId: transaction.id,
          referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
        },
        {
          accountId: creditAccId,
          type: TransactionType.CREDIT,
          amount,
          description: `Supplier Payment - ${description}`,
          referenceId: transaction.id,
          referenceType: BANK_TX_REF_TYPE.SUPPLIER_PAYMENT,
        },
      ]
      assertBalancedJournal(glEntries)
      await tx.accountLedgerEntry.createMany({ data: glEntries })
    }, { timeout: 35000 })

    revalidatePath('/accounts-payable-receivable')
    revalidatePath('/accounts-payable')
    revalidatePath('/finances/cash')
    revalidatePath('/finances/drawer')
    revalidatePath('/reports/cash')
    return ok({ message: 'Supplier payment recorded successfully' })
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to record supplier payment')
  }
}

const recordCustomerCollectionSchema = z.object({
  customerId: z.string().min(1),
  saleId: z.string().optional(),
  amount: z.coerce.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  bankAccountId: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().min(1),
  chequeDate: z.string().optional(),
})

export async function recordCustomerCollectionAction(
  data: z.infer<typeof recordCustomerCollectionSchema>
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const parsed = recordCustomerCollectionSchema.safeParse(data)
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { customerId, saleId, amount, method, bankAccountId, reference, chequeDate } =
    parsed.data
  let description = parsed.data.description
  if (method === PaymentMethod.CHEQUE && chequeDate) {
    if (!description.includes('[Cheque Matures:')) {
      description += ` | [Cheque Matures: ${chequeDate}]`
    }
  }

  try {
    await prisma.$transaction(async tx => {
      // Row-level locking on Customer, Linked Supplier (if any), Sale, and BankAccount
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
      const custLockCheck = await tx.customer.findUnique({
        where: { id: customerId },
        select: { outstandingBalance: true, linkedSupplierId: true },
      })
      if (custLockCheck?.linkedSupplierId) {
        await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${custLockCheck.linkedSupplierId} FOR UPDATE`
      }

      if (amount > Number(custLockCheck?.outstandingBalance || 0)) {
        throw new Error(
          `Collection amount (৳${amount.toLocaleString()}) exceeds the customer's outstanding balance (৳${Number(
            custLockCheck?.outstandingBalance || 0
          ).toLocaleString()}).`
        )
      }

      if (saleId) {
        await tx.$executeRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`
      }
      if (bankAccountId) {
        await tx.$executeRaw`SELECT id FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`
      }
      // 1. Customer Ledger Entry — store saleId as referenceId so vouchers can trace back the sale
      await tx.customerLedger.create({
        data: {
          customerId,
          type: TransactionType.CREDIT,
          amount,
          description,
          referenceId: saleId || reference || null,
        },
      })

      // 2. Reduce Customer Outstanding Balance
      await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalance: {
            decrement: amount,
          },
        },
      })

      // 3. Update Sale payment if saleId provided and/or auto-allocate FIFO across open sales
      let remaining = amount

      if (saleId) {
        const sale = await tx.sale.findUnique({
          where: { id: saleId },
        })
        if (sale) {
          const due = round2(Number(sale.total) - Number(sale.amountPaid || 0))
          const applied = round2(Math.min(remaining, Math.max(0, due)))
          if (applied > 0) {
            await tx.sale.update({
              where: { id: saleId },
              data: {
                amountPaid: round2(Number(sale.amountPaid || 0) + applied),
              },
            })
            await tx.salePayment.create({
              data: {
                saleId,
                amount: applied,
                method,
                bankAccountId: bankAccountId || null,
                reference: reference || null,
              },
            })
          }
          remaining = round2(remaining - applied)
        }
      }

      if (remaining > 0) {
        // Auto-allocate leftover (or the whole amount, if no saleId was given)
        // across this customer's outstanding sales, oldest first.
        // Use raw SQL to filter amountPaid < total at column level (avoids Prisma field-ref quirks).
        const openSalesRaw = await tx.$queryRaw<{ id: string; total: any; amountPaid: any }[]>(
          Prisma.sql`
            SELECT id, total, "amountPaid" FROM "Sale"
            WHERE "customerId" = ${customerId}
              AND "isQuotation" = false
              AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
              AND "amountPaid" < total
              ${saleId ? Prisma.sql`AND id != ${saleId}` : Prisma.empty}
            ORDER BY "createdAt" ASC
            FOR UPDATE
          `
        )

        for (const sale of openSalesRaw) {
          if (remaining <= 0) break
          const due = round2(Number(sale.total) - Number(sale.amountPaid || 0))
          if (due <= 0) continue
          const applied = round2(Math.min(remaining, due))
          await tx.sale.update({
            where: { id: sale.id },
            data: {
              amountPaid: round2(Number(sale.amountPaid || 0) + applied),
            },
          })
          await tx.salePayment.create({
            data: {
              saleId: sale.id,
              amount: applied,
              method,
              bankAccountId: bankAccountId || null,
              reference: reference || null,
            },
          })
          remaining = round2(remaining - applied)
        }
      }

      // 4. Handle payment method logic: Cash Drawer or Bank Account
      if (method === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, user.outletId)

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a cash drawer first.'
          )
        }

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.CUSTOMER_PAYMENT,
            amount: amount,
            description: `Customer Collection - ${description}`,
            referenceId: saleId || null,
            referenceType: BANK_TX_REF_TYPE.CUSTOMER_COLLECTION,
          },
        })
      } else if (bankAccountId) {
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: {
              increment: amount,
            },
          },
        })

        await tx.bankTransaction.create({
          data: {
            bankAccountId,
            type: 'DEPOSIT',
            amount,
            description: `Customer Receipt - ${description}`,
            referenceId: saleId || null,
            referenceType: BANK_TX_REF_TYPE.CUSTOMER_COLLECTION,
          },
        })
      }

      // 5. Post General Ledger Entries: Dr Cash/Bank, Cr Accounts Receivable (1300) (Finding #16)
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1100', '1110', '1200', '1300'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const cashAccId = coaMap.get('1100')
      const bankAccId = coaMap.get('1200') || coaMap.get('1110')
      const arAccId = coaMap.get('1300')

      const assetAccId = method === PaymentMethod.CASH ? cashAccId : (bankAccId || cashAccId)
      if (assetAccId && arAccId) {
        const refId = reference || saleId || customerId
        const gl = [
          {
            accountId: assetAccId,
            type: 'DEBIT' as const,
            amount,
            description: `Customer Collection - ${description}`,
            referenceId: refId,
            referenceType: 'CustomerCollection',
          },
          {
            accountId: arAccId,
            type: 'CREDIT' as const,
            amount,
            description: `Customer Collection - ${description}`,
            referenceId: refId,
            referenceType: 'CustomerCollection',
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })
      }
    })

    revalidatePath('/accounts-payable-receivable')
    revalidatePath('/accounts-receivable')
    revalidatePath('/finances/cash')
    revalidatePath('/finances/drawer')
    revalidatePath('/reports/cash')
    return ok({ message: 'Customer payment collection recorded successfully' })
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to record customer collection')
  }
}

// ─────────────────────────────────────────────
// B2B PARTY LINKING ACTIONS
// ─────────────────────────────────────────────

export async function linkCustomerSupplierAction(
  customerId: string,
  supplierId: string
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  try {
    const result = await prisma.$transaction(async tx => {
      // Row-level locks to prevent race conditions during linking
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} FOR UPDATE`

      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, phone: true, email: true },
      })
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, phone: true, email: true, linkedCustomer: { select: { id: true } } },
      })

      if (!customer || !supplier) {
        throw new Error('Customer or Supplier record not found')
      }

      // If this supplier was linked to another customer, clear that link first
      if (supplier.linkedCustomer && supplier.linkedCustomer.id !== customerId) {
        await tx.customer.update({
          where: { id: supplier.linkedCustomer.id },
          data: { linkedSupplierId: null },
        })
      }

      // Set link on Customer
      await tx.customer.update({
        where: { id: customerId },
        data: { linkedSupplierId: supplierId },
      })

      await logAuditDirect(
        user.id,
        'LINK_CUSTOMER_SUPPLIER',
        'Customer',
        customerId,
        {
          customerId,
          supplierId,
          customerName: customer.name,
          supplierName: supplier.name,
        }
      )

      return { customer, supplier }
    })

    revalidatePath('/accounts-payable-receivable')
    revalidatePath('/accounts-payable')
    revalidatePath('/accounts-receivable')
    revalidatePath('/reports/due')
    revalidatePath('/suppliers')
    revalidatePath('/crm')
    return ok({ message: `Successfully linked ${result.customer.name} with ${result.supplier.name}` })
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to link party')
  }
}

export async function unlinkCustomerSupplierAction(customerId: string) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
      await tx.customer.update({
        where: { id: customerId },
        data: { linkedSupplierId: null },
      })

      await logAuditDirect(
        user.id,
        'UNLINK_CUSTOMER_SUPPLIER',
        'Customer',
        customerId,
        { customerId }
      )
    })

    revalidatePath('/accounts-payable-receivable')
    revalidatePath('/accounts-payable')
    revalidatePath('/accounts-receivable')
    revalidatePath('/reports/due')
    revalidatePath('/suppliers')
    revalidatePath('/crm')
    return ok({ message: 'Party unlinked successfully' })
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to unlink party')
  }
}

export async function getPartyLinkCandidates(type: 'CUSTOMER' | 'SUPPLIER', partyId: string) {
  await requireAuth()

  try {
    if (type === 'CUSTOMER') {
      const customer = await prisma.customer.findUnique({
        where: { id: partyId },
        include: {
          linkedSupplier: {
            select: { id: true, name: true, phone: true, email: true, address: true, outstandingBalance: true },
          },
        },
      })
      if (!customer) return fail('Customer not found')

      const nameTerm = customer.name.trim()
      const phoneTerm = customer.phone?.trim()
      const emailTerm = customer.email?.trim()

      const orConditions: Prisma.SupplierWhereInput[] = []
      if (phoneTerm) orConditions.push({ phone: phoneTerm })
      if (emailTerm) orConditions.push({ email: { equals: emailTerm, mode: 'insensitive' } })
      if (nameTerm) orConditions.push({ name: { contains: nameTerm, mode: 'insensitive' } })
      if (customer.linkedSupplierId) orConditions.push({ id: customer.linkedSupplierId })

      const suppliers = await prisma.supplier.findMany({
        where: orConditions.length > 0 ? { OR: orConditions } : undefined,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          outstandingBalance: true,
          linkedCustomer: { select: { id: true } },
        },
        orderBy: { name: 'asc' },
        take: 20,
      })

      const normPhone = (p?: string | null) => (p ? p.replace(/\D/g, '') : '')
      const normEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : '')
      const custPhone = normPhone(customer.phone)
      const custEmail = normEmail(customer.email)

      const candidates = suppliers
        .filter(s => !s.linkedCustomer || s.linkedCustomer.id === partyId)
        .map(s => {
          const supPhone = normPhone(s.phone)
          const supEmail = normEmail(s.email)

          const phoneMatch = Boolean(custPhone && supPhone && custPhone === supPhone)
          const emailMatch = Boolean(custEmail && supEmail && custEmail === supEmail)
          const nameMatch = s.name.toLowerCase().includes(customer.name.toLowerCase()) || customer.name.toLowerCase().includes(s.name.toLowerCase())
          const isCurrentLink = customer.linkedSupplierId === s.id

          const phoneMismatch = Boolean(custPhone && supPhone && custPhone !== supPhone)
          const emailMismatch = Boolean(custEmail && supEmail && custEmail !== supEmail)

          return {
            supplier: {
              id: s.id,
              name: s.name,
              email: s.email,
              phone: s.phone,
              address: s.address,
              outstandingBalance: Number(s.outstandingBalance || 0),
            },
            isCurrentLink,
            phoneMatch,
            emailMatch,
            nameMatch,
            hasMismatchWarning: phoneMismatch || emailMismatch,
            mismatchDetails: {
              phoneMismatch,
              emailMismatch,
            },
          }
        })
        .sort((a, b) => {
          if (a.isCurrentLink) return -1
          if (b.isCurrentLink) return 1
          const aScore = (a.phoneMatch ? 4 : 0) + (a.emailMatch ? 4 : 0) + (a.nameMatch ? 2 : 0)
          const bScore = (b.phoneMatch ? 4 : 0) + (b.emailMatch ? 4 : 0) + (b.nameMatch ? 2 : 0)
          return bScore - aScore
        })

      return ok({
        party: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          outstandingBalance: Number(customer.outstandingBalance || 0),
          linkedSupplierId: customer.linkedSupplierId,
          linkedSupplier: customer.linkedSupplier
            ? {
                id: customer.linkedSupplier.id,
                name: customer.linkedSupplier.name,
                email: customer.linkedSupplier.email,
                phone: customer.linkedSupplier.phone,
                address: customer.linkedSupplier.address,
                outstandingBalance: Number(customer.linkedSupplier.outstandingBalance || 0),
              }
            : null,
        },
        candidates,
      })
    } else {
      const supplier = await prisma.supplier.findUnique({
        where: { id: partyId },
        include: {
          linkedCustomer: {
            select: { id: true, name: true, phone: true, email: true, address: true, outstandingBalance: true },
          },
        },
      })
      if (!supplier) return fail('Supplier not found')

      const nameTerm = supplier.name.trim()
      const phoneTerm = supplier.phone?.trim()
      const emailTerm = supplier.email?.trim()

      const orConditions: Prisma.CustomerWhereInput[] = []
      if (phoneTerm) orConditions.push({ phone: phoneTerm })
      if (emailTerm) orConditions.push({ email: { equals: emailTerm, mode: 'insensitive' } })
      if (nameTerm) orConditions.push({ name: { contains: nameTerm, mode: 'insensitive' } })
      if (supplier.linkedCustomer?.id) orConditions.push({ id: supplier.linkedCustomer.id })

      const customers = await prisma.customer.findMany({
        where: orConditions.length > 0 ? { OR: orConditions } : undefined,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          outstandingBalance: true,
          linkedSupplierId: true,
        },
        orderBy: { name: 'asc' },
        take: 20,
      })

      const normPhone = (p?: string | null) => (p ? p.replace(/\D/g, '') : '')
      const normEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : '')
      const supPhone = normPhone(supplier.phone)
      const supEmail = normEmail(supplier.email)

      const candidates = customers
        .filter(c => !c.linkedSupplierId || c.linkedSupplierId === partyId)
        .map(c => {
          const custPhone = normPhone(c.phone)
          const custEmail = normEmail(c.email)

          const phoneMatch = Boolean(supPhone && custPhone && supPhone === custPhone)
          const emailMatch = Boolean(supEmail && custEmail && supEmail === custEmail)
          const nameMatch = c.name.toLowerCase().includes(supplier.name.toLowerCase()) || supplier.name.toLowerCase().includes(c.name.toLowerCase())
          const isCurrentLink = supplier.linkedCustomer?.id === c.id

          const phoneMismatch = Boolean(supPhone && custPhone && supPhone !== custPhone)
          const emailMismatch = Boolean(supEmail && custEmail && supEmail !== custEmail)

          return {
            customer: {
              id: c.id,
              name: c.name,
              email: c.email,
              phone: c.phone,
              address: c.address,
              outstandingBalance: Number(c.outstandingBalance || 0),
            },
            isCurrentLink,
            phoneMatch,
            emailMatch,
            nameMatch,
            hasMismatchWarning: phoneMismatch || emailMismatch,
            mismatchDetails: {
              phoneMismatch,
              emailMismatch,
            },
          }
        })
        .sort((a, b) => {
          if (a.isCurrentLink) return -1
          if (b.isCurrentLink) return 1
          const aScore = (a.phoneMatch ? 4 : 0) + (a.emailMatch ? 4 : 0) + (a.nameMatch ? 2 : 0)
          const bScore = (b.phoneMatch ? 4 : 0) + (b.emailMatch ? 4 : 0) + (b.nameMatch ? 2 : 0)
          return bScore - aScore
        })

      return ok({
        party: {
          id: supplier.id,
          name: supplier.name,
          email: supplier.email,
          phone: supplier.phone,
          address: supplier.address,
          outstandingBalance: Number(supplier.outstandingBalance || 0),
          linkedCustomerId: supplier.linkedCustomer?.id ?? null,
          linkedCustomer: supplier.linkedCustomer
            ? {
                id: supplier.linkedCustomer.id,
                name: supplier.linkedCustomer.name,
                email: supplier.linkedCustomer.email,
                phone: supplier.linkedCustomer.phone,
                address: supplier.linkedCustomer.address,
                outstandingBalance: Number(supplier.linkedCustomer.outstandingBalance || 0),
              }
            : null,
        },
        candidates,
      })
    }
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to fetch link candidates')
  }
}

export async function recordB2BNettingSettlementAction(data: {
  customerId: string
  supplierId: string
  amount: number
  description: string
}) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  if (!data.customerId || !data.supplierId || data.amount <= 0 || !data.description) {
    return fail('Invalid netting parameters')
  }

  try {
    const result = await prisma.$transaction(async tx => {
      // 1. Lock both records FOR UPDATE to guarantee concurrency safety
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${data.customerId} FOR UPDATE`
      await tx.$executeRaw`SELECT id FROM "Supplier" WHERE id = ${data.supplierId} FOR UPDATE`

      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, name: true, outstandingBalance: true, linkedSupplierId: true },
      })
      const supplier = await tx.supplier.findUnique({
        where: { id: data.supplierId },
        select: { id: true, name: true, outstandingBalance: true },
      })

      if (!customer || !supplier) {
        throw new Error('Customer or Supplier record not found')
      }
      if (customer.linkedSupplierId !== data.supplierId) {
        throw new Error('These Customer and Supplier records are not linked as B2B parties')
      }

      const custBal = Number(customer.outstandingBalance || 0)
      const supBal = Number(supplier.outstandingBalance || 0)

      const maxNettable = Math.min(custBal, supBal)
      if (data.amount > custBal || data.amount > supBal) {
        throw new Error(
          `Netting amount (৳${data.amount.toLocaleString()}) cannot exceed either Customer A/R (৳${custBal.toLocaleString()}) or Supplier A/P (৳${supBal.toLocaleString()}). Maximum nettable amount is ৳${maxNettable.toLocaleString()}.`
        )
      }

      // 2. Reduce Customer Outstanding Balance
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          outstandingBalance: {
            decrement: data.amount,
          },
        },
      })

      // 3. Reduce Supplier Outstanding Balance
      await tx.supplier.update({
        where: { id: data.supplierId },
        data: {
          outstandingBalance: {
            decrement: data.amount,
          },
        },
      })

      // 4. Create Customer Ledger Entry
      await tx.customerLedger.create({
        data: {
          customerId: data.customerId,
          type: TransactionType.CREDIT,
          amount: data.amount,
          description: `B2B Netting Settlement - ${data.description} (Offset with Supplier ${supplier.name})`,
        },
      })

      // 5. Create Supplier Ledger Entry
      await tx.supplierLedger.create({
        data: {
          supplierId: data.supplierId,
          type: TransactionType.DEBIT,
          amount: data.amount,
          description: `B2B Netting Settlement - ${data.description} (Offset with Customer ${customer.name})`,
          transactionType: 'NETTING_OFFSET',
          createdById: user.id,
        },
      })

      // 6. Post General Ledger Entries: Dr Accounts Payable (2100), Cr Accounts Receivable (1300) (Finding #17)
      const coaAccounts = await tx.chartOfAccount.findMany({
        where: { code: { in: ['1300', '2100'] } },
        select: { id: true, code: true },
      })
      const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
      const arAccId = coaMap.get('1300')
      const apAccId = coaMap.get('2100')

      if (apAccId && arAccId) {
        const refId = `NET-${data.customerId}-${data.supplierId}-${Date.now()}`
        const gl = [
          {
            accountId: apAccId,
            type: 'DEBIT' as const,
            amount: data.amount,
            description: `B2B Netting Settlement: ${customer.name} / ${supplier.name}`,
            referenceId: refId,
            referenceType: 'B2B_NETTING',
          },
          {
            accountId: arAccId,
            type: 'CREDIT' as const,
            amount: data.amount,
            description: `B2B Netting Settlement: ${customer.name} / ${supplier.name}`,
            referenceId: refId,
            referenceType: 'B2B_NETTING',
          },
        ]
        assertBalancedJournal(gl)
        await tx.accountLedgerEntry.createMany({ data: gl })
      }

      await logAuditDirect(
        user.id,
        'B2B_NETTING_SETTLEMENT',
        'Customer',
        data.customerId,
        {
          customerId: data.customerId,
          supplierId: data.supplierId,
          nettedAmount: data.amount,
          customerName: customer.name,
          supplierName: supplier.name,
        }
      )

      return { customerName: customer.name, supplierName: supplier.name, amount: data.amount }
    })

    revalidatePath('/accounts-payable-receivable')
    revalidatePath('/accounts-payable')
    revalidatePath('/accounts-receivable')
    revalidatePath('/reports/due')
    revalidatePath('/suppliers')
    revalidatePath('/b2b')
    return ok({
      message: `Successfully settled ৳${result.amount.toLocaleString()} B2B netting offset between ${result.customerName} and ${result.supplierName}`,
    })
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : 'Failed to record B2B netting settlement')
  }
}
