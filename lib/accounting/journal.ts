import { TransactionType } from '@prisma/client'

export interface JournalEntryLike {
  accountId: string
  type: TransactionType | 'DEBIT' | 'CREDIT'
  amount: number | string | { toString(): string }
  description?: string | null
  referenceId?: string | null
  referenceType?: string | null
  createdAt?: Date | string | null
}

/**
 * Asserts that a journal entry set is balanced (Total Debits == Total Credits within tolerance).
 * Throws a formatted error if unbalanced.
 */
export function assertBalancedJournal(
  entries: JournalEntryLike[],
  tolerance = 0.01
): void {
  let totalDebits = 0
  let totalCredits = 0
  let ref = 'unknown'

  for (const entry of entries) {
    const amt = Math.abs(Number(entry.amount) || 0)
    const t = String(entry.type)
    if (t === 'DEBIT') {
      totalDebits += amt
    } else if (t === 'CREDIT') {
      totalCredits += amt
    }
    if (entry.referenceId && ref === 'unknown') {
      ref = `${entry.referenceType || 'Ref'}:${entry.referenceId}`
    }
  }

  const diff = Math.abs(totalDebits - totalCredits)
  if (diff > tolerance) {
    throw new Error(
      `JOURNAL_UNBALANCED: Dr ${totalDebits.toFixed(2)} / Cr ${totalCredits.toFixed(2)} (ref ${ref})`
    )
  }
}


export interface BuildSaleJournalParams {
  saleId: string
  saleNumber: string
  effectiveSaleDate: Date
  afterDiscount: number
  cogsTotal: number
  taxAmt: number
  actualCashPaid: number
  actualBankPaid: number // Net of fee
  creditPaid: number
  totalFeeAmount: number
  accounts: {
    revenueAccountId?: string | null
    cogsAccountId?: string | null
    inventoryAccountId?: string | null
    cashAccountId?: string | null
    bankAssetAccountId?: string | null
    accountsReceivableAccountId?: string | null
    taxPayableAccountId?: string | null
    expenseAccountId?: string | null
  }
}

/**
 * Builds double-entry ledger records for checkout sales with exact Dr/Cr parity,
 * net bank payments, fee expense allocation, and unified effectiveSaleDate timestamps.
 */
export function buildSaleJournalEntries(params: BuildSaleJournalParams): JournalEntryLike[] {
  const {
    saleId,
    saleNumber,
    effectiveSaleDate,
    afterDiscount,
    cogsTotal,
    taxAmt,
    actualCashPaid,
    actualBankPaid,
    creditPaid,
    totalFeeAmount,
    accounts,
  } = params

  const entries: JournalEntryLike[] = []

  // Cr Sales Revenue
  if (accounts.revenueAccountId && afterDiscount > 0) {
    entries.push({
      accountId: accounts.revenueAccountId,
      type: TransactionType.CREDIT,
      amount: afterDiscount,
      description: `Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  // Dr COGS & Cr Inventory
  if (cogsTotal > 0) {
    if (accounts.cogsAccountId) {
      entries.push({
        accountId: accounts.cogsAccountId,
        type: TransactionType.DEBIT,
        amount: cogsTotal,
        description: `COGS — Sale ${saleNumber}`,
        referenceId: saleId,
        referenceType: 'Sale',
        createdAt: effectiveSaleDate,
      })
    }
    if (accounts.inventoryAccountId) {
      entries.push({
        accountId: accounts.inventoryAccountId,
        type: TransactionType.CREDIT,
        amount: cogsTotal,
        description: `COGS — Sale ${saleNumber}`,
        referenceId: saleId,
        referenceType: 'Sale',
        createdAt: effectiveSaleDate,
      })
    }
  }

  // Dr Cash in Hand
  if (accounts.cashAccountId && actualCashPaid > 0) {
    entries.push({
      accountId: accounts.cashAccountId,
      type: TransactionType.DEBIT,
      amount: actualCashPaid,
      description: `Cash Payment — Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  // Dr Bank Accounts (Net)
  if (accounts.bankAssetAccountId && actualBankPaid > 0) {
    entries.push({
      accountId: accounts.bankAssetAccountId,
      type: TransactionType.DEBIT,
      amount: actualBankPaid,
      description: `Bank Payment (Net) — Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  // Dr Accounts Receivable
  if (accounts.accountsReceivableAccountId && creditPaid > 0) {
    entries.push({
      accountId: accounts.accountsReceivableAccountId,
      type: TransactionType.DEBIT,
      amount: creditPaid,
      description: `Accounts Receivable — Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  // Cr Tax Payable (VAT)
  if (accounts.taxPayableAccountId && taxAmt > 0) {
    entries.push({
      accountId: accounts.taxPayableAccountId,
      type: TransactionType.CREDIT,
      amount: taxAmt,
      description: `VAT — Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  // Dr Bank/MFS Fee Expense
  if (accounts.expenseAccountId && totalFeeAmount > 0) {
    entries.push({
      accountId: accounts.expenseAccountId,
      type: TransactionType.DEBIT,
      amount: totalFeeAmount,
      description: `Bank/MFS Charges — Sale ${saleNumber}`,
      referenceId: saleId,
      referenceType: 'Sale',
      createdAt: effectiveSaleDate,
    })
  }

  return entries
}
