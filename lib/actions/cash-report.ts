"use server"

import { requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { formatLocalDate, getLocalDateRangeBoundaries, toLocalISODate } from '@/lib/date-utils'
import { resolveDrawerSessionForDate } from '@/lib/actions/drawer-session-utils'
import { UserRole } from '@prisma/client'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'

export interface CashFlowCategoryItem {
  name: string
  cashAmount: number
  bankAmount: number
  total: number
  isInternal?: boolean
}

export interface AccountSummaryItem {
  accountId: string
  name: string
  type: 'CASH' | 'BANK'
  openingBalance: number
  inflows: number
  outflows: number
  variance: number
  closingBalance: number
}

import type {
  CashFlowAccountColumn,
  CashFlowLedgerRow,
} from '@/lib/reports/cash-flow'

export async function getDailyCashReport(dateStr: string) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.ACCOUNTANT,
      UserRole.CASHIER // exception: cashier needs daily cash summary for shift close
    )
    let outletId: string | null = user.outletId ?? null

    // Allow SUPER_ADMIN to default to first outlet if user has no assigned outletId
    if (!outletId && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN')) {
      const firstOutlet = await prisma.outlet.findFirst({ select: { id: true } })
      outletId = firstOutlet?.id ?? null
    }

    if (!outletId) {
      return fail('User is not assigned to an outlet')
    }

    // 1. Timezone-Safe Calendar Boundaries for Asia/Dhaka (+06:00)
    const { start, end } = getLocalDateRangeBoundaries(dateStr, dateStr, 6)

    // 2. Fetch Active Bank Accounts for Outlet
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { outletId, isActive: true },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        currentBalance: true,
      },
    })
    const bankAccountIds = bankAccounts.map(b => b.id)

    // 3. Reverse-calculate Bank Account Historical Opening Balances & Daily Flows
    const [futureBankTxs, todayBankTxs, todayBankDetailedTxs] = await Promise.all([
      bankAccountIds.length > 0
        ? prisma.bankTransaction.groupBy({
            by: ['bankAccountId', 'type'],
            _sum: { amount: true },
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gte: start },
            },
          })
        : [],
      bankAccountIds.length > 0
        ? prisma.bankTransaction.groupBy({
            by: ['bankAccountId', 'type'],
            _sum: { amount: true },
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gte: start, lte: end },
            },
          })
        : [],
      bankAccountIds.length > 0
        ? prisma.bankTransaction.findMany({
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gte: start, lte: end },
            },
            select: {
              type: true,
              amount: true,
              description: true,
              referenceType: true,
              bankAccountId: true,
            },
          })
        : [],
    ])

    const futureMap = new Map<string, { deposits: number; withdrawals: number; transfersOut: number }>()
    for (const row of futureBankTxs) {
      const entry = futureMap.get(row.bankAccountId) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const amt = Number(row._sum.amount || 0)
      if (row.type === 'DEPOSIT') {
        entry.deposits += amt
      } else if (row.type === 'WITHDRAWAL') {
        entry.withdrawals += amt
      } else if (row.type === 'TRANSFER') {
        entry.transfersOut += amt
      }
      futureMap.set(row.bankAccountId, entry)
    }

    const todayMap = new Map<string, { deposits: number; withdrawals: number; transfersOut: number }>()
    for (const row of todayBankTxs) {
      const entry = todayMap.get(row.bankAccountId) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const amt = Number(row._sum.amount || 0)
      if (row.type === 'DEPOSIT') {
        entry.deposits += amt
      } else if (row.type === 'WITHDRAWAL') {
        entry.withdrawals += amt
      } else if (row.type === 'TRANSFER') {
        entry.transfersOut += amt
      }
      todayMap.set(row.bankAccountId, entry)
    }

    const bankSummaries: AccountSummaryItem[] = bankAccounts.map(account => {
      const future = futureMap.get(account.id) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const today = todayMap.get(account.id) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }

      const openingBalance = Number(account.currentBalance) - future.deposits + future.withdrawals + future.transfersOut
      const todayIn = today.deposits
      const todayOut = today.withdrawals + today.transfersOut
      const closingBalance = openingBalance + todayIn - todayOut

      return {
        accountId: account.id,
        name: `${account.bankName}${account.accountName ? ` - ${account.accountName}` : ''}`,
        type: 'BANK',
        openingBalance,
        inflows: todayIn,
        outflows: todayOut,
        variance: 0,
        closingBalance,
      }
    })

    // 4. Historical Cash Drawer Opening Balance (Non-Compounding & Lineage-Safe)
    const resolvedSession = await resolveDrawerSessionForDate(outletId, dateStr, prisma, {
      earliestOnDate: true,
    })
    const mainCashOpening = resolvedSession.openingBalance

    // 5. Query Today's Cash Drawer Transactions (Excluding Seed 'OPENING')
    const [todayDrawerInflow, todayDrawerOutflow, todayDrawerTxs, drawersClosedToday] = await Promise.all([
      prisma.drawerTransaction.aggregate({
        _sum: { amount: true },
        where: {
          drawer: { outletId },
          createdAt: { gte: start, lte: end },
          type: { not: 'OPENING' },
          amount: { gt: 0 },
        },
      }),
      prisma.drawerTransaction.aggregate({
        _sum: { amount: true },
        where: {
          drawer: { outletId },
          createdAt: { gte: start, lte: end },
          type: { not: 'OPENING' },
          amount: { lt: 0 },
        },
      }),
      prisma.drawerTransaction.findMany({
        where: {
          drawer: { outletId },
          createdAt: { gte: start, lte: end },
          type: { not: 'OPENING' },
        },
        select: {
          type: true,
          amount: true,
          description: true,
          referenceType: true,
        },
      }),
      prisma.cashDrawer.findMany({
        where: {
          outletId,
          status: 'CLOSED',
          closedAt: { gte: start, lte: end },
        },
        select: {
          id: true,
          variance: true,
        },
      }),
    ])

    const totalDrawerVariance = drawersClosedToday.reduce((s, d) => s + Number(d.variance || 0), 0)
    const mainCashIn = Number(todayDrawerInflow._sum.amount || 0)
    const mainCashOut = Math.abs(Number(todayDrawerOutflow._sum.amount || 0))
    const mainCashClosing = mainCashOpening + mainCashIn - mainCashOut + totalDrawerVariance

    const mainCashSummary: AccountSummaryItem = {
      accountId: 'main-cash',
      name: 'Main Cash (Drawer)',
      type: 'CASH',
      openingBalance: mainCashOpening,
      inflows: mainCashIn,
      outflows: mainCashOut,
      variance: totalDrawerVariance,
      closingBalance: mainCashClosing,
    }

    const accountsSummary: AccountSummaryItem[] = [mainCashSummary, ...bankSummaries]

    // 6. Detailed Consolidated Inflow Classification (Cash + Bank/MFS)
    const inflowCategories: Record<string, { cash: number; bank: number; isInternal?: boolean }> = {
      'Retail Sales': { cash: 0, bank: 0 },
      'Service & Repair': { cash: 0, bank: 0 },
      'Customer Due Collections (AR)': { cash: 0, bank: 0 },
      'B2B Sales & Collections': { cash: 0, bank: 0 },
      'Supplier / Purchase Refunds': { cash: 0, bank: 0 },
      'Capital Injections': { cash: 0, bank: 0 },
      'Internal Transfers In (Contra)': { cash: 0, bank: 0, isInternal: true },
      'Other Inflows': { cash: 0, bank: 0 },
    }

    for (const dt of todayDrawerTxs) {
      const amt = Number(dt.amount || 0)
      if (amt <= 0) continue

      const type = (dt.type || '').toUpperCase()
      const refType = (dt.referenceType || '').toUpperCase()

      if (type === 'SALE' || type === 'SALEPAYMENT') {
        inflowCategories['Retail Sales'].cash += amt
      } else if (type === 'SERVICE_PAYMENT' || type === 'SERVICEPAYMENT') {
        inflowCategories['Service & Repair'].cash += amt
      } else if (type === 'CUSTOMER_PAYMENT' || type === 'CUSTOMER_COLLECTION' || type === 'CUSTOMERPAYMENT') {
        inflowCategories['Customer Due Collections (AR)'].cash += amt
      } else if (type === 'B2B_SALE' || type === 'B2B_PAYMENT') {
        inflowCategories['B2B Sales & Collections'].cash += amt
      } else if (type === 'PURCHASE_REFUND' || type === 'B2B_PURCHASE_REFUND' || type === 'PURCHASERETURN') {
        inflowCategories['Supplier / Purchase Refunds'].cash += amt
      } else if (type === 'CONTRA_TRANSFER' || refType === 'CONTRATRANSFER') {
        inflowCategories['Internal Transfers In (Contra)'].cash += amt
      } else {
        inflowCategories['Other Inflows'].cash += amt
      }
    }

    for (const bt of todayBankDetailedTxs) {
      const amt = Number(bt.amount || 0)
      if (bt.type !== 'DEPOSIT' || amt <= 0) continue

      const refType = (bt.referenceType || '').toUpperCase()

      if (refType === 'SALE' || refType === 'SALEPAYMENT') {
        inflowCategories['Retail Sales'].bank += amt
      } else if (
        refType === 'SERVICE_PAYMENT' ||
        refType === 'SERVICEPAYMENT' ||
        refType === 'SERVICEINVOICE' ||
        refType === 'SERVICEJOB'
      ) {
        inflowCategories['Service & Repair'].bank += amt
      } else if (refType === 'CUSTOMER_PAYMENT' || refType === 'CUSTOMER_COLLECTION' || refType === 'CUSTOMERPAYMENT') {
        inflowCategories['Customer Due Collections (AR)'].bank += amt
      } else if (
        refType === 'SUPPLIER_SALE' ||
        refType === 'SUPPLIER_SALE_PAYMENT' ||
        refType === 'B2B_SALE' ||
        refType === 'B2B_PAYMENT' ||
        refType === 'SUPPLIER_EXCHANGE'
      ) {
        inflowCategories['B2B Sales & Collections'].bank += amt
      } else if (refType === 'PURCHASERETURN' || refType === 'PURCHASE_RETURN' || refType === 'SUPPLIER_PURCHASE_REFUND') {
        inflowCategories['Supplier / Purchase Refunds'].bank += amt
      } else if (refType === 'CAPITAL_INJECTION' || refType === 'CAPITALINJECTION') {
        inflowCategories['Capital Injections'].bank += amt
      } else if (refType === 'CONTRATRANSFER') {
        inflowCategories['Internal Transfers In (Contra)'].bank += amt
      } else {
        inflowCategories['Other Inflows'].bank += amt
      }
    }

    const revenues: CashFlowCategoryItem[] = []
    for (const [name, cat] of Object.entries(inflowCategories)) {
      const total = cat.cash + cat.bank
      if (total > 0) {
        revenues.push({
          name,
          cashAmount: cat.cash,
          bankAmount: cat.bank,
          total,
          isInternal: cat.isInternal,
        })
      }
    }

    // 7. Detailed Consolidated Outflow Classification (Cash + Bank/MFS)
    const outflowCategories: Record<string, { cash: number; bank: number; isInternal?: boolean }> = {
      'Operating Expenses': { cash: 0, bank: 0 },
      'Supplier Payments (AP / Inventory)': { cash: 0, bank: 0 },
      'Payroll & Employee Advances': { cash: 0, bank: 0 },
      'Fixed Asset Purchases': { cash: 0, bank: 0 },
      'Customer Sales & Service Refunds': { cash: 0, bank: 0 },
      'Internal Transfers Out (Contra)': { cash: 0, bank: 0, isInternal: true },
      'Other Outflows': { cash: 0, bank: 0 },
    }

    for (const dt of todayDrawerTxs) {
      const amt = Number(dt.amount || 0)
      if (amt >= 0) continue
      const positiveAmt = Math.abs(amt)

      const type = (dt.type || '').toUpperCase()
      const refType = (dt.referenceType || '').toUpperCase()

      if (type === 'EXPENSE') {
        outflowCategories['Operating Expenses'].cash += positiveAmt
      } else if (
        type === 'SUPPLIER_PAYMENT' ||
        type === 'PURCHASE_PAYMENT' ||
        type === 'B2B_PURCHASE' ||
        type === 'B2B_PURCHASE_PAYMENT' ||
        refType === 'PURCHASEINVOICE' ||
        refType === 'SUPPLIER_PAYMENT' ||
        refType === 'SUPPLIER_INVOICE_PAYMENT' ||
        refType === 'SUPPLIER_PURCHASE'
      ) {
        outflowCategories['Supplier Payments (AP / Inventory)'].cash += positiveAmt
      } else if (
        type === 'PAYROLL' ||
        type === 'ADVANCE' ||
        type === 'EMPLOYEE_ADVANCE' ||
        type === 'PAYROLL_PAYMENT' ||
        type === 'PAYOUT'
      ) {
        outflowCategories['Payroll & Employee Advances'].cash += positiveAmt
      } else if (type === 'FIXED_ASSET_PURCHASE' || refType === 'FIXED_ASSET' || refType === 'FIXEDASSET') {
        outflowCategories['Fixed Asset Purchases'].cash += positiveAmt
      } else if (
        type === 'REFUND' ||
        type === 'SERVICE_REFUND' ||
        type === 'B2B_SALE_REFUND' ||
        refType === 'SALERETURN'
      ) {
        outflowCategories['Customer Sales & Service Refunds'].cash += positiveAmt
      } else if (type === 'CONTRA_TRANSFER' || refType === 'CONTRATRANSFER') {
        outflowCategories['Internal Transfers Out (Contra)'].cash += positiveAmt
      } else {
        outflowCategories['Other Outflows'].cash += positiveAmt
      }
    }

    for (const bt of todayBankDetailedTxs) {
      const amt = Number(bt.amount || 0)
      if (amt <= 0) continue

      if (bt.type === 'TRANSFER') {
        outflowCategories['Internal Transfers Out (Contra)'].bank += amt
        continue
      }

      if (bt.type !== 'WITHDRAWAL') continue

      const refType = (bt.referenceType || '').toUpperCase()

      if (refType === 'EXPENSE') {
        outflowCategories['Operating Expenses'].bank += amt
      } else if (
        refType === 'PURCHASEINVOICE' ||
        refType === 'PURCHASE_INVOICE' ||
        refType === 'PURCHASEPAYMENT' ||
        refType === 'SUPPLIER_PAYMENT' ||
        refType === 'SUPPLIER_INVOICE_PAYMENT' ||
        refType === 'SUPPLIER_PURCHASE' ||
        refType === 'SUPPLIER_PURCHASE_PAYMENT' ||
        refType === 'SUPPLIER_EXCHANGE'
      ) {
        outflowCategories['Supplier Payments (AP / Inventory)'].bank += amt
      } else if (
        refType === 'PAYROLL' ||
        refType === 'PAYROLL_PAYMENT' ||
        refType === 'PAYROLLPAYMENT' ||
        refType === 'EMPLOYEE_ADVANCE' ||
        refType === 'EMPLOYEEADVANCE'
      ) {
        outflowCategories['Payroll & Employee Advances'].bank += amt
      } else if (refType === 'FIXED_ASSET' || refType === 'FIXEDASSET') {
        outflowCategories['Fixed Asset Purchases'].bank += amt
      } else if (
        refType === 'SALERETURN' ||
        refType === 'SALE_RETURN' ||
        refType === 'SERVICE_REFUND' ||
        refType === 'SERVICEREFUND' ||
        refType === 'SUPPLIER_SALE_REFUND'
      ) {
        outflowCategories['Customer Sales & Service Refunds'].bank += amt
      } else if (refType === 'CONTRATRANSFER') {
        outflowCategories['Internal Transfers Out (Contra)'].bank += amt
      } else {
        outflowCategories['Other Outflows'].bank += amt
      }
    }

    // Include Drawer Shortage if variance was negative (physical loss)
    if (totalDrawerVariance < 0) {
      outflowCategories['Drawer Cash Shortage (Variance)'] = {
        cash: Math.abs(totalDrawerVariance),
        bank: 0,
      }
    } else if (totalDrawerVariance > 0) {
      inflowCategories['Drawer Cash Surplus (Variance)'] = {
        cash: totalDrawerVariance,
        bank: 0,
      }
    }

    const expenses: CashFlowCategoryItem[] = []
    for (const [name, cat] of Object.entries(outflowCategories)) {
      const total = cat.cash + cat.bank
      if (total > 0) {
        expenses.push({
          name,
          cashAmount: cat.cash,
          bankAmount: cat.bank,
          total,
          isInternal: cat.isInternal,
        })
      }
    }

    // 8. Totals and Balanced Tally Reconciliation
    const totalOpening = accountsSummary.reduce((s, a) => s + a.openingBalance, 0)
    const totalClosing = accountsSummary.reduce((s, a) => s + a.closingBalance, 0)
    const totalInflows = accountsSummary.reduce((s, a) => s + a.inflows, 0)
    const totalOutflows = accountsSummary.reduce((s, a) => s + a.outflows, 0)
    const netCashFlow = totalInflows - totalOutflows

    // Operating vs Non-Operating figures
    const operatingInflows = revenues.filter(r => !r.isInternal).reduce((s, r) => s + r.total, 0)
    const operatingOutflows = expenses.filter(e => !e.isInternal).reduce((s, e) => s + e.total, 0)
    const netOperatingCashFlow = operatingInflows - operatingOutflows

    const estimatedClosing = totalOpening + totalInflows - totalOutflows + totalDrawerVariance

    // Independent Source Balance Computation for Audit Tally
    const todayDhakaStr = toLocalISODate(new Date(), 'Asia/Dhaka')
    const isToday = dateStr === todayDhakaStr

    let independentCashClosing = 0
    let independentBankClosing = 0

    if (isToday) {
      // For "today": Live physical / system state
      const [openDrawers, closedDrawersToday] = await Promise.all([
        prisma.cashDrawer.findMany({
          where: { outletId, status: 'OPEN' },
          select: { id: true, openingBalance: true },
        }),
        prisma.cashDrawer.findMany({
          where: {
            outletId,
            status: 'CLOSED',
            closedAt: { gte: start, lte: end },
          },
          select: { closingBalance: true },
        }),
      ])

      let liveOpenDrawerCash = 0
      for (const od of openDrawers) {
        const txSum = await prisma.drawerTransaction.aggregate({
          _sum: { amount: true },
          where: {
            drawerId: od.id,
            type: { not: 'OPENING' },
          },
        })
        liveOpenDrawerCash += Number(od.openingBalance || 0) + Number(txSum._sum?.amount || 0)
      }

      const closedDrawerCash = closedDrawersToday.reduce((s, d) => s + Number(d.closingBalance || 0), 0)
      independentCashClosing = liveOpenDrawerCash + closedDrawerCash

      // Bank: sum of current active bank accounts' live currentBalance
      independentBankClosing = bankAccounts.reduce((s, a) => s + Number(a.currentBalance || 0), 0)
    } else {
      // For historical dates (past):
      // Cash: stamped closingBalance of drawer(s) closed on that date
      const drawersClosedOnDate = await prisma.cashDrawer.findMany({
        where: {
          outletId,
          status: 'CLOSED',
          closedAt: { gte: start, lte: end },
        },
        select: { closingBalance: true },
      })

      if (drawersClosedOnDate.length > 0) {
        independentCashClosing = drawersClosedOnDate.reduce((s, d) => s + Number(d.closingBalance || 0), 0)
      } else {
        const spanningDrawer = await prisma.cashDrawer.findFirst({
          where: {
            outletId,
            openedAt: { lte: end },
            OR: [
              { status: 'OPEN' },
              { closedAt: { gt: end } },
            ],
          },
          orderBy: { openedAt: 'desc' },
          select: { id: true, openingBalance: true },
        })

        if (spanningDrawer) {
          const txsBeforeEnd = await prisma.drawerTransaction.aggregate({
            _sum: { amount: true },
            where: {
              drawerId: spanningDrawer.id,
              createdAt: { lte: end },
              type: { not: 'OPENING' },
            },
          })
          independentCashClosing = Number(spanningDrawer.openingBalance || 0) + Number(txsBeforeEnd._sum?.amount || 0)
        }
      }

      // Bank: independent reconstructed balance as-of end of that day
      const postEndBankTxs = bankAccountIds.length > 0
        ? await prisma.bankTransaction.groupBy({
            by: ['bankAccountId', 'type'],
            _sum: { amount: true },
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gt: end },
            },
          })
        : []

      const postEndMap = new Map<string, { deposits: number; withdrawals: number; transfersOut: number }>()
      for (const row of postEndBankTxs) {
        const entry = postEndMap.get(row.bankAccountId) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
        const amt = Number(row._sum.amount || 0)
        if (row.type === 'DEPOSIT') {
          entry.deposits += amt
        } else if (row.type === 'WITHDRAWAL') {
          entry.withdrawals += amt
        } else if (row.type === 'TRANSFER') {
          entry.transfersOut += amt
        }
        postEndMap.set(row.bankAccountId, entry)
      }

      independentBankClosing = bankAccounts.reduce((sum, account) => {
        const post = postEndMap.get(account.id) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
        const balAtEnd = Number(account.currentBalance) - post.deposits + post.withdrawals + post.transfersOut
        return sum + balAtEnd
      }, 0)
    }

    const independentTotalClosing = independentCashClosing + independentBankClosing
    const tallyDifference = Math.round(Math.abs(totalClosing - independentTotalClosing) * 100) / 100

    return ok({
      date: dateStr,
      yesterdayClosing: totalOpening, // Kept for backwards compatibility
      openingBalance: totalOpening,
      openingBreakdown: accountsSummary.map(a => ({ account: a.name, amount: a.openingBalance })),
      revenues: revenues.map(r => ({ source: r.name, amount: r.total, cash: r.cashAmount, bank: r.bankAmount, isInternal: r.isInternal })),
      totalRevenue: operatingInflows, // Backwards compatible label: true operating revenue & receipts
      totalInflows,
      expenses: expenses.map(e => ({ name: e.name, amount: e.total, cash: e.cashAmount, bank: e.bankAmount, isInternal: e.isInternal })),
      totalExpense: operatingOutflows, // Backwards compatible label: true operating disbursements
      totalOutflows,
      netCashFlow,
      operatingInflows,
      operatingOutflows,
      netOperatingCashFlow,
      drawerVariance: totalDrawerVariance,
      closingBalance: totalClosing,
      estimatedClosing,
      tallyDifference,
      accountWiseSummary: accountsSummary,
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to generate Daily Cash Report')
  }
}

import {
  type AccountReconciliation,
  type BuildCashFlowRowsParams,
  mapDrawerTxType,
  mapBankTxType,
  buildCashFlowRows,
} from '@/lib/reports/cash-flow'

export type { AccountReconciliation, BuildCashFlowRowsParams }

export async function getCashFlowReport(fromDate: string, toDate?: string, outletIdParam?: string) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.ACCOUNTANT
    )
    let outletId: string | null = outletIdParam ?? user.outletId ?? null

    if (!outletId && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN')) {
      const firstOutlet = await prisma.outlet.findFirst({ select: { id: true } })
      outletId = firstOutlet?.id ?? null
    }

    if (!outletId) {
      return fail('User is not assigned to an outlet')
    }

    validateOutletAccess(user, outletId)

    const { start, end, toStr: effectiveTo, isInverted } = getLocalDateRangeBoundaries(fromDate, toDate, 6)
    if (isInverted) return fail('From date cannot be after To date')

    const formattedFrom = formatLocalDate(start)
    const formattedTo = formatLocalDate(end)
    const dayBeforeDate = new Date(start.getTime() - 24 * 60 * 60 * 1000)
    const dayBeforeFormatted = formatLocalDate(dayBeforeDate)

    // 1. Fetch active Bank Accounts for outlet
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { outletId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        currentBalance: true,
      },
    })
    const bankAccountIds = bankAccounts.map(b => b.id)

    // 2. Historical Bank Account opening balances at start of fromDate
    const futureBankTxs =
      bankAccountIds.length > 0
        ? await prisma.bankTransaction.groupBy({
            by: ['bankAccountId', 'type'],
            _sum: { amount: true },
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gte: start },
            },
          })
        : []

    const futureMap = new Map<string, { deposits: number; withdrawals: number; transfersOut: number }>()
    for (const row of futureBankTxs) {
      const entry = futureMap.get(row.bankAccountId) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const amt = Number(row._sum.amount || 0)
      if (row.type === 'DEPOSIT') {
        entry.deposits += amt
      } else if (row.type === 'WITHDRAWAL') {
        entry.withdrawals += amt
      } else if (row.type === 'TRANSFER') {
        entry.transfersOut += amt
      }
      futureMap.set(row.bankAccountId, entry)
    }

    const openingBalances: Record<string, number> = {}
    for (const acc of bankAccounts) {
      const future = futureMap.get(acc.id) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const bal = Number(acc.currentBalance) - future.deposits + future.withdrawals + future.transfersOut
      openingBalances[acc.id] = bal
    }

    // 3. Historical Cash Drawer Opening Balance
    const resolvedSession = await resolveDrawerSessionForDate(outletId, fromDate)
    const mainCashOpening = resolvedSession.openingBalance
    openingBalances['main-cash'] = mainCashOpening

    const accounts: CashFlowAccountColumn[] = [
      { id: 'main-cash', name: 'Main Cash', type: 'CASH' },
      ...bankAccounts.map(b => ({
        id: b.id,
        name: `${b.bankName}${b.accountName ? ` - ${b.accountName}` : ''}`,
        type: 'BANK' as const,
      })),
    ]

    // 4. Source of Truth: Fetch Drawer Transactions and Bank Transactions in date range
    const [rawDrawerTxs, bankTxs, closedDrawers, unassignedSalePayments] = await Promise.all([
      prisma.drawerTransaction.findMany({
        where: {
          drawer: { outletId },
          createdAt: { gte: start, lte: end },
          type: { not: 'OPENING' },
        },
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          referenceId: true,
          referenceType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      bankAccountIds.length > 0
        ? prisma.bankTransaction.findMany({
            where: {
              bankAccountId: { in: bankAccountIds },
              transactionAt: { gte: start, lte: end },
            },
            select: {
              id: true,
              bankAccountId: true,
              type: true,
              amount: true,
              description: true,
              referenceId: true,
              referenceType: true,
              transactionAt: true,
            },
            orderBy: { transactionAt: 'asc' },
          })
        : [],
      prisma.cashDrawer.findMany({
        where: {
          outletId,
          status: 'CLOSED',
          closedAt: { gte: start, lte: end },
        },
        select: { id: true, variance: true, closedAt: true },
      }),
      prisma.salePayment.findMany({
        where: {
          sale: {
            outletId,
            isQuotation: false,
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
          },
          paidAt: { gte: start, lte: end },
          method: { not: 'CASH' },
          bankAccountId: null,
        },
        select: {
          id: true,
          saleId: true,
          amount: true,
          feeAmount: true,
          method: true,
          paidAt: true,
          sale: {
            select: {
              saleNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { paidAt: 'asc' },
      }),
    ])

    // 5. Gather unique reference IDs for domain enrichment
    const saleIds = new Set<string>()
    const returnIds = new Set<string>()
    const expenseIds = new Set<string>()
    const purchaseIds = new Set<string>()
    const serviceIds = new Set<string>()
    const contraIds = new Set<string>()

    for (const dt of rawDrawerTxs) {
      if (!dt.referenceId) continue
      const ref = (dt.referenceType || '').toUpperCase()
      const t = (dt.type || '').toUpperCase()
      if (ref === 'SALE') saleIds.add(dt.referenceId)
      else if (ref === 'SALERETURN' || t === 'REFUND') returnIds.add(dt.referenceId)
      else if (ref === 'EXPENSE' || t === 'EXPENSE') expenseIds.add(dt.referenceId)
      else if (ref.includes('PURCHASE') || t.includes('PURCHASE') || t.includes('SUPPLIER')) purchaseIds.add(dt.referenceId)
      else if (ref.includes('SERVICE') || t.includes('SERVICE')) serviceIds.add(dt.referenceId)
      else if (ref.includes('CONTRA') || t.includes('CONTRA')) contraIds.add(dt.referenceId)
    }

    for (const bt of bankTxs) {
      if (!bt.referenceId) continue
      const ref = (bt.referenceType || '').toUpperCase()
      if (ref === 'SALE') saleIds.add(bt.referenceId)
      else if (ref.includes('RETURN') || ref.includes('REFUND')) returnIds.add(bt.referenceId)
      else if (ref.includes('EXPENSE')) expenseIds.add(bt.referenceId)
      else if (ref.includes('PURCHASE') || ref.includes('SUPPLIER')) purchaseIds.add(bt.referenceId)
      else if (ref.includes('SERVICE')) serviceIds.add(bt.referenceId)
      else if (ref.includes('CONTRA')) contraIds.add(bt.referenceId)
    }

    const [
      salesData,
      returnsData,
      expensesData,
      purchaseInvoicesData,
      serviceInvoicesData,
      contraTransfersData,
    ] = await Promise.all([
      saleIds.size > 0
        ? prisma.sale.findMany({
            where: { id: { in: Array.from(saleIds) } },
            select: { id: true, saleNumber: true, customer: { select: { name: true } } },
          })
        : [],
      returnIds.size > 0
        ? prisma.saleReturn.findMany({
            where: { id: { in: Array.from(returnIds) } },
            select: { id: true, returnNumber: true, reason: true },
          })
        : [],
      expenseIds.size > 0
        ? prisma.expense.findMany({
            where: { id: { in: Array.from(expenseIds) } },
            select: { id: true, description: true, account: { select: { name: true } } },
          })
        : [],
      purchaseIds.size > 0
        ? prisma.purchaseInvoice.findMany({
            where: { id: { in: Array.from(purchaseIds) } },
            select: { id: true, invoiceNumber: true, supplier: { select: { name: true } } },
          })
        : [],
      serviceIds.size > 0
        ? prisma.serviceInvoice.findMany({
            where: { id: { in: Array.from(serviceIds) } },
            select: {
              id: true,
              invoiceNumber: true,
              job: { select: { jobNumber: true, device: true } },
            },
          })
        : [],
      contraIds.size > 0
        ? prisma.contraTransfer.findMany({
            where: { id: { in: Array.from(contraIds) } },
            select: { id: true, notes: true, type: true },
          })
        : [],
    ])

    const enrichment = {
      sales: new Map(
        salesData.map(s => [
          s.id,
          { saleNumber: s.saleNumber, customerName: s.customer?.name || undefined },
        ])
      ),
      returns: new Map(
        returnsData.map(r => [
          r.id,
          { returnNumber: r.returnNumber, reason: r.reason || undefined },
        ])
      ),
      expenses: new Map(
        expensesData.map(e => [
          e.id,
          { description: e.description || 'Expense', accountName: e.account?.name || undefined },
        ])
      ),
      purchases: new Map(
        purchaseInvoicesData.map(p => [
          p.id,
          { invoiceNumber: p.invoiceNumber, supplierName: p.supplier?.name || undefined },
        ])
      ),
      services: new Map(
        serviceInvoicesData.map(s => [
          s.id,
          {
            invoiceNumber: s.invoiceNumber || undefined,
            jobNumber: s.job?.jobNumber || undefined,
            device: s.job?.device || undefined,
          },
        ])
      ),
      contraTransfers: new Map(
        contraTransfersData.map(c => [
          c.id,
          { notes: c.notes || undefined, type: c.type || undefined },
        ])
      ),
    }

    const unassignedRows = unassignedSalePayments.map(p => ({
      id: p.id,
      saleId: p.saleId,
      saleNumber: p.sale?.saleNumber,
      amount: p.amount,
      feeAmount: p.feeAmount,
      method: p.method,
      createdAt: p.paidAt,
      customerName: p.sale?.customer?.name,
    }))

    if (unassignedRows.length > 0) {
      accounts.push({ id: 'unassigned-bank', name: 'Unassigned Bank', type: 'BANK' })
      openingBalances['unassigned-bank'] = 0
    }

    // 6. Build Rows using pure function (single source of truth)
    const rows = buildCashFlowRows({
      drawerTxs: rawDrawerTxs,
      bankTxs,
      unassignedPayments: unassignedRows,
      closedDrawers,
      accounts,
      openingBalances,
      enrichment,
    })

    const totalOpening = Object.values(openingBalances).reduce((s, a) => s + (Number(a) || 0), 0)
    const finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : totalOpening

    const closingBalances: Record<string, number> = {}
    for (const acc of accounts) {
      const open = openingBalances[acc.id] || 0
      const sumMovements = rows.reduce((s, r) => s + (r.accountAmounts[acc.id] || 0), 0)
      closingBalances[acc.id] = Math.round((open + sumMovements) * 100) / 100
    }

    const totalInflows = rows.reduce((s, r) => s + r.totalIn, 0)
    const totalOutflows = rows.reduce((s, r) => s + Math.abs(r.totalOut), 0)
    const netCashFlow = totalInflows - totalOutflows

    const accountWiseSummary: AccountSummaryItem[] = accounts.map(acc => {
      const open = openingBalances[acc.id] || 0
      const inAmt = rows.reduce(
        (s, r) =>
          s +
          (r.accountAmounts[acc.id] && r.accountAmounts[acc.id] > 0
            ? r.accountAmounts[acc.id]
            : 0),
        0
      )
      const outAmt = rows.reduce(
        (s, r) =>
          s +
          (r.accountAmounts[acc.id] && r.accountAmounts[acc.id] < 0
            ? Math.abs(r.accountAmounts[acc.id])
            : 0),
        0
      )
      const close = closingBalances[acc.id] || 0
      return {
        accountId: acc.id,
        name: acc.name,
        type: acc.type,
        openingBalance: open,
        inflows: inAmt,
        outflows: outAmt,
        variance:
          acc.id === 'main-cash'
            ? closedDrawers.reduce((s, d) => s + Number(d.variance || 0), 0)
            : 0,
        closingBalance: close,
      }
    })

    // 7. Balance Reconciliation as of end date:
    // Query GL 1100, GL 1200 and latest drawer expected balance as of end date
    const [gl1100, gl1200] = await Promise.all([
      prisma.chartOfAccount.findUnique({
        where: { code: '1100' },
        select: { id: true },
      }),
      prisma.chartOfAccount.findUnique({
        where: { code: '1200' },
        select: { id: true },
      }),
    ])
    let gl1100EndBalance: number | null = null
    if (gl1100) {
      const glAgg = await prisma.accountLedgerEntry.groupBy({
        by: ['type'],
        _sum: { amount: true },
        where: {
          accountId: gl1100.id,
          createdAt: { lte: end },
        },
      })
      const dr = Number(glAgg.find(g => g.type === 'DEBIT')?._sum.amount || 0)
      const cr = Number(glAgg.find(g => g.type === 'CREDIT')?._sum.amount || 0)
      gl1100EndBalance = Math.round((dr - cr) * 100) / 100
    }

    let gl1200EndBalance: number | null = null
    if (gl1200) {
      const glAgg = await prisma.accountLedgerEntry.groupBy({
        by: ['type'],
        _sum: { amount: true },
        where: {
          accountId: gl1200.id,
          createdAt: { lte: end },
        },
      })
      const dr = Number(glAgg.find(g => g.type === 'DEBIT')?._sum.amount || 0)
      const cr = Number(glAgg.find(g => g.type === 'CREDIT')?._sum.amount || 0)
      gl1200EndBalance = Math.round((dr - cr) * 100) / 100
    }

    const latestDrawerAtEnd = await prisma.cashDrawer.findFirst({
      where: {
        outletId,
        openedAt: { lte: end },
      },
      orderBy: { openedAt: 'desc' },
      select: {
        id: true,
        status: true,
        openingBalance: true,
        closingBalance: true,
        variance: true,
        closedAt: true,
      },
    })
    let drawerExpectedBalanceAtEnd: number | null = null
    if (latestDrawerAtEnd) {
      if (latestDrawerAtEnd.status === 'CLOSED' && latestDrawerAtEnd.closedAt && latestDrawerAtEnd.closedAt <= end) {
        drawerExpectedBalanceAtEnd = Number(latestDrawerAtEnd.closingBalance || 0)
      } else {
        const txsBeforeEnd = await prisma.drawerTransaction.aggregate({
          _sum: { amount: true },
          where: {
            drawerId: latestDrawerAtEnd.id,
            createdAt: { lte: end },
            type: { not: 'OPENING' },
          },
        })
        drawerExpectedBalanceAtEnd = Math.round(
          (Number(latestDrawerAtEnd.openingBalance || 0) + Number(txsBeforeEnd._sum.amount || 0)) * 100
        ) / 100
      }
    }

    // Query Bank Transactions strictly AFTER end date to back-calculate bank balances at end date
    const bankTxsAfterEnd = bankAccountIds.length > 0
      ? await prisma.bankTransaction.groupBy({
          by: ['bankAccountId', 'type'],
          _sum: { amount: true },
          where: {
            bankAccountId: { in: bankAccountIds },
            transactionAt: { gt: end },
          },
        })
      : []

    const afterEndMap = new Map<string, { deposits: number; withdrawals: number; transfersOut: number }>()
    for (const row of bankTxsAfterEnd) {
      const entry = afterEndMap.get(row.bankAccountId) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
      const amt = Number(row._sum.amount || 0)
      if (row.type === 'DEPOSIT') {
        entry.deposits += amt
      } else if (row.type === 'WITHDRAWAL') {
        entry.withdrawals += amt
      } else if (row.type === 'TRANSFER') {
        entry.transfersOut += amt
      }
      afterEndMap.set(row.bankAccountId, entry)
    }

    const reconciliationAccounts: AccountReconciliation[] = accounts.map(acc => {
      const open = openingBalances[acc.id] || 0
      const inAmt = rows.reduce(
        (s, r) =>
          s +
          (r.accountAmounts[acc.id] && r.accountAmounts[acc.id] > 0
            ? r.accountAmounts[acc.id]
            : 0),
        0
      )
      const outAmt = rows.reduce(
        (s, r) =>
          s +
          (r.accountAmounts[acc.id] && r.accountAmounts[acc.id] < 0
            ? Math.abs(r.accountAmounts[acc.id])
            : 0),
        0
      )
      const calculatedClosing = Math.round((open + inAmt - outAmt) * 100) / 100
      const bankAcc = bankAccounts.find(b => b.id === acc.id)

      let actualBalance: number | undefined
      if (acc.id === 'main-cash') {
        actualBalance = drawerExpectedBalanceAtEnd ?? gl1100EndBalance ?? calculatedClosing
      } else if (bankAcc) {
        const afterEnd = afterEndMap.get(bankAcc.id) ?? { deposits: 0, withdrawals: 0, transfersOut: 0 }
        // End date balance = currentBalance - (deposits after end) + (withdrawals after end) + (transfers after end)
        actualBalance = Math.round((Number(bankAcc.currentBalance) - afterEnd.deposits + afterEnd.withdrawals + afterEnd.transfersOut) * 100) / 100
      }

      const difference =
        actualBalance !== undefined
          ? Math.round(Math.abs(calculatedClosing - actualBalance) * 100) / 100
          : 0

      return {
        accountId: acc.id,
        name: acc.name,
        openingBalance: open,
        inflows: inAmt,
        outflows: outAmt,
        calculatedClosing,
        actualBalance,
        difference,
        isReconciled: difference < 0.01,
      }
    })

    // Item 5: Add a row comparing the sum of all bank account closing balances (as of end date)
    // with GL 1200 balance as of end date (Σdebits − Σcredits, createdAt <= end).
    const bankReconAccounts = reconciliationAccounts.filter(a => a.accountId !== 'main-cash')
    const totalBankOpen = Math.round(bankReconAccounts.reduce((s, a) => s + a.openingBalance, 0) * 100) / 100
    const totalBankIn = Math.round(bankReconAccounts.reduce((s, a) => s + a.inflows, 0) * 100) / 100
    const totalBankOut = Math.round(bankReconAccounts.reduce((s, a) => s + a.outflows, 0) * 100) / 100
    const totalBankClosing = Math.round(
      bankReconAccounts.reduce((s, a) => s + (a.actualBalance ?? a.calculatedClosing), 0) * 100
    ) / 100

    const gl1200Diff = gl1200EndBalance !== null
      ? Math.round(Math.abs(totalBankClosing - gl1200EndBalance) * 100) / 100
      : undefined

    reconciliationAccounts.push({
      accountId: 'gl-1200',
      name: 'All Banks Total vs GL 1200',
      openingBalance: totalBankOpen,
      inflows: totalBankIn,
      outflows: totalBankOut,
      calculatedClosing: totalBankClosing,
      actualBalance: gl1200EndBalance ?? undefined,
      difference: gl1200Diff ?? 0,
      isReconciled: gl1200Diff !== undefined ? gl1200Diff < 0.01 : true,
    })

    const reconciliation = {
      isBalanced: reconciliationAccounts.every(a => a.isReconciled),
      accounts: reconciliationAccounts,
      unassignedBankCount: unassignedRows.length,
      warning:
        unassignedRows.length > 0
          ? `${unassignedRows.length} non-cash payment(s) without assigned bank account`
          : null,
    }

    const openingBreakdown = accounts.map(a => ({
      account: a.name,
      amount: openingBalances[a.id] || 0,
    }))

    return ok({
      fromDate,
      toDate: effectiveTo,
      formattedFrom,
      formattedTo,
      dayBeforeFormatted,
      accounts,
      openingBalances,
      totalOpeningBalance: totalOpening,
      rows,
      closingBalances,
      finalBalance,
      // Backward compatibility fields for executive metric cards
      openingBalance: totalOpening,
      yesterdayClosing: totalOpening,
      totalInflows,
      totalOutflows,
      netCashFlow,
      closingBalance: finalBalance,
      tallyDifference: 0,
      accountWiseSummary,
      openingBreakdown,
      revenues: [],
      expenses: [],
      operatingInflows: totalInflows,
      operatingOutflows: totalOutflows,
      netOperatingCashFlow: netCashFlow,
      drawerVariance: closedDrawers.reduce((s, d) => s + Number(d.variance || 0), 0),
      estimatedClosing: finalBalance,
      reconciliation,
      unassignedBankCount: unassignedRows.length,
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to generate Cash Flow Report')
  }
}
