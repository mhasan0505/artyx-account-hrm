import { formatLocalDate } from '@/lib/date-utils'
import { DRAWER_TX_TYPE } from '@/lib/constants/transaction-types'

export interface CashFlowAccountColumn {
  id: string
  name: string
  type: 'CASH' | 'BANK'
}

export interface CashFlowLedgerRow {
  id: string
  timestamp: number
  date: string
  refNo: string
  referenceUrl?: string
  type: string
  accountAmounts: Record<string, number>
  totalIn: number
  totalOut: number
  balance: number
  remarks: string
}

export interface AccountReconciliation {
  accountId: string
  name: string
  openingBalance: number
  inflows: number
  outflows: number
  calculatedClosing: number
  actualBalance?: number
  difference?: number
  isReconciled: boolean
}

export interface BuildCashFlowRowsParams {
  drawerTxs: Array<{
    id: string
    type: string
    amount: number | string | { toString(): string }
    description: string
    referenceId?: string | null
    referenceType?: string | null
    createdAt: Date | string
  }>
  bankTxs: Array<{
    id: string
    bankAccountId: string
    type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'
    amount: number | string | { toString(): string }
    description: string
    referenceId?: string | null
    referenceType?: string | null
    transactionAt: Date | string
  }>
  unassignedPayments?: Array<{
    id: string
    saleId: string
    saleNumber?: string
    amount: number | string | { toString(): string }
    feeAmount?: number | string | { toString(): string }
    method: string
    createdAt: Date | string
    customerName?: string
  }>
  closedDrawers?: Array<{
    id: string
    variance: number | string | { toString(): string } | null
    closedAt?: Date | string | null
  }>
  accounts: CashFlowAccountColumn[]
  openingBalances: Record<string, number>
  enrichment?: {
    sales?: Map<string, { saleNumber: string; customerName?: string }>
    returns?: Map<string, { returnNumber: string; reason?: string }>
    expenses?: Map<string, { description: string; accountName?: string }>
    purchases?: Map<string, { invoiceNumber: string; supplierName?: string }>
    services?: Map<string, { invoiceNumber?: string; jobNumber?: string; device?: string; customerName?: string }>
    suppliers?: Map<string, { name: string }>
    employees?: Map<string, { name: string }>
    contraTransfers?: Map<string, { notes?: string; type?: string }>
  }
}

export function mapDrawerTxType(
  type?: string | null,
  referenceType?: string | null,
  isPositive = true
): string {
  const t = (type || '').toUpperCase()
  const ref = (referenceType || '').toUpperCase()

  if (t === DRAWER_TX_TYPE.SALE || t === 'SALEPAYMENT' || ref === 'SALE') return 'Sale'
  if (t === DRAWER_TX_TYPE.SERVICE_PAYMENT || t === 'SERVICEPAYMENT' || ref.includes('SERVICE')) return 'Service'
  if (t === DRAWER_TX_TYPE.CUSTOMER_PAYMENT || ref.includes('CUSTOMER')) return 'Collection'
  if (
    t === DRAWER_TX_TYPE.B2B_SALE ||
    t === DRAWER_TX_TYPE.B2B_PAYMENT ||
    t === DRAWER_TX_TYPE.B2B_PURCHASE ||
    t === DRAWER_TX_TYPE.B2B_PURCHASE_PAYMENT ||
    t === DRAWER_TX_TYPE.B2B_PURCHASE_REFUND ||
    t === DRAWER_TX_TYPE.B2B_SALE_REFUND ||
    ref.includes('B2B') ||
    ref.includes('SUPPLIER_SALE')
  ) {
    return 'B2B'
  }
  if (t === DRAWER_TX_TYPE.PURCHASE_REFUND || t === 'PURCHASERETURN') return 'Refund'
  if (t === DRAWER_TX_TYPE.REFUND || t === DRAWER_TX_TYPE.SERVICE_REFUND) return 'Refund'
  if (t === DRAWER_TX_TYPE.SUPPLIER_PAYMENT) return 'Supplier Payment'
  if (t === DRAWER_TX_TYPE.PURCHASE_PAYMENT || ref.includes('PURCHASE')) return 'Purchase'
  if (t === DRAWER_TX_TYPE.PAYROLL || ref.includes('PAYROLL')) return 'Payroll'
  if (t === DRAWER_TX_TYPE.ADVANCE || ref.includes('ADVANCE')) return 'Advance'
  if (t === DRAWER_TX_TYPE.FIXED_ASSET_PURCHASE || ref.includes('FIXED_ASSET')) return 'Fixed Asset'
  if (t === DRAWER_TX_TYPE.EXPENSE || ref === 'EXPENSE') return 'Expenses'
  if (t === DRAWER_TX_TYPE.CONTRA_TRANSFER || ref.includes('CONTRA')) return 'Transfer'
  if (t === DRAWER_TX_TYPE.CASH_IN) return 'Manual In'
  if (t === DRAWER_TX_TYPE.CASH_OUT) return 'Manual Out'

  return isPositive ? 'Manual In' : 'Manual Out'
}

export function mapBankTxType(
  type: string,
  referenceType?: string | null
): string {
  const ref = (referenceType || '').toUpperCase()
  const isDeposit = type === 'DEPOSIT'

  if (ref === 'SALE' || ref === 'SALEPAYMENT') return 'Sale'
  if (ref.includes('SERVICE')) return 'Service'
  if (ref.includes('CUSTOMER')) return 'Collection'
  if (
    ref.includes('SUPPLIER_SALE') ||
    ref.includes('B2B') ||
    ref.includes('SUPPLIER_PURCHASE') ||
    ref.includes('SUPPLIER_EXCHANGE')
  ) {
    return 'B2B'
  }
  if (ref.includes('CAPITAL')) return 'Capital'
  if (ref.includes('CONTRA')) return 'Transfer'
  if (ref.includes('EXPENSE')) return 'Expenses'
  if (ref === 'SUPPLIER_PAYMENT' || ref === 'SUPPLIER_INVOICE_PAYMENT') return 'Supplier Payment'
  if (ref.includes('PURCHASE')) return 'Purchase'
  if (ref.includes('PAYROLL')) return 'Payroll'
  if (ref.includes('ADVANCE')) return 'Advance'
  if (ref.includes('FIXED_ASSET')) return 'Fixed Asset'
  if (ref.includes('RETURN') || ref.includes('REFUND')) return 'Refund'
  if (ref === 'MANUAL') return isDeposit ? 'Manual In' : 'Manual Out'

  return isDeposit ? 'Collection' : 'Manual Out'
}

export function buildCashFlowRows(params: BuildCashFlowRowsParams): CashFlowLedgerRow[] {
  const {
    drawerTxs = [],
    bankTxs = [],
    unassignedPayments = [],
    closedDrawers = [],
    openingBalances,
    enrichment = {},
  } = params

  const rows: CashFlowLedgerRow[] = []
  const handledBankTxIds = new Set<string>()

  // 1. Process Drawer Transactions (exclude OPENING)
  for (const dt of drawerTxs) {
    const rawType = (dt.type || '').toUpperCase()
    if (rawType === 'OPENING') continue

    const amt = Number(dt.amount) || 0
    if (amt === 0) continue

    const isContra =
      rawType === 'CONTRA_TRANSFER' ||
      (dt.referenceType || '').toUpperCase() === 'CONTRATRANSFER'

    if (isContra && dt.referenceId) {
      // Find matching bank tx
      const matchingBankTx = bankTxs.find(
        bt =>
          !handledBankTxIds.has(bt.id) &&
          bt.referenceId === dt.referenceId &&
          (bt.referenceType || '').toUpperCase() === 'CONTRATRANSFER'
      )

      if (matchingBankTx) {
        handledBankTxIds.add(matchingBankTx.id)
        const bankAmt = Number(matchingBankTx.amount) || 0
        const signedBankAmt = matchingBankTx.type === 'DEPOSIT' ? bankAmt : -bankAmt
        const accountAmounts: Record<string, number> = {
          'main-cash': amt,
          [matchingBankTx.bankAccountId]: signedBankAmt,
        }

        const notes =
          enrichment.contraTransfers?.get(dt.referenceId)?.notes ||
          dt.description ||
          matchingBankTx.description ||
          'Contra Transfer'

        rows.push({
          id: `contra-${dt.referenceId || dt.id}`,
          timestamp: new Date(dt.createdAt).getTime(),
          date: formatLocalDate(new Date(dt.createdAt)),
          refNo: 'Contra Transfer',
          type: 'Transfer',
          accountAmounts,
          totalIn: 0,
          totalOut: 0,
          balance: 0,
          remarks: notes,
        })
        continue
      }
    }

    const isPositive = amt > 0
    const absAmt = Math.abs(amt)
    const rowType = mapDrawerTxType(dt.type, dt.referenceType, isPositive)

    let refNo = dt.description || (isPositive ? 'Cash In' : 'Cash Out')
    let referenceUrl: string | undefined = undefined
    let remarks = dt.description || ''

    if (dt.referenceType === 'Sale' && dt.referenceId) {
      const saleInfo = enrichment.sales?.get(dt.referenceId)
      if (saleInfo) {
        refNo = saleInfo.saleNumber
        referenceUrl = `/sales/${dt.referenceId}`
        remarks = saleInfo.customerName ? `Customer: ${saleInfo.customerName}` : ''
      }
    } else if (dt.referenceType === 'SaleReturn' && dt.referenceId) {
      const retInfo = enrichment.returns?.get(dt.referenceId)
      if (retInfo) {
        refNo = retInfo.returnNumber
        remarks = retInfo.reason || 'Customer Refund'
      }
    } else if (dt.referenceType === 'Expense' && dt.referenceId) {
      const expInfo = enrichment.expenses?.get(dt.referenceId)
      if (expInfo) {
        refNo = expInfo.description || 'Expense'
        remarks = expInfo.accountName || ''
      }
    } else if (
      (dt.referenceType === 'PurchaseInvoice' ||
        dt.referenceType === 'PurchasePayment' ||
        dt.referenceType === 'SUPPLIER_PAYMENT') &&
      dt.referenceId
    ) {
      const purInfo = enrichment.purchases?.get(dt.referenceId)
      if (purInfo) {
        refNo = purInfo.invoiceNumber
        remarks = purInfo.supplierName ? `Supplier: ${purInfo.supplierName}` : ''
      }
    } else if (
      (dt.referenceType === 'ServiceInvoice' ||
        dt.referenceType === 'ServiceJob' ||
        dt.referenceType === 'ServicePayment') &&
      dt.referenceId
    ) {
      const srvInfo = enrichment.services?.get(dt.referenceId)
      if (srvInfo) {
        refNo = srvInfo.invoiceNumber || srvInfo.jobNumber || 'Service'
        remarks = srvInfo.device ? `Device: ${srvInfo.device}` : srvInfo.customerName || ''
      }
    }

    rows.push({
      id: `dt-${dt.id}`,
      timestamp: new Date(dt.createdAt).getTime(),
      date: formatLocalDate(new Date(dt.createdAt)),
      refNo,
      referenceUrl,
      type: rowType,
      accountAmounts: { 'main-cash': amt },
      totalIn: isPositive ? absAmt : 0,
      totalOut: isPositive ? 0 : -absAmt,
      balance: 0,
      remarks,
    })
  }

  // 2. Process Bank Transactions
  for (const bt of bankTxs) {
    if (handledBankTxIds.has(bt.id)) continue

    const amt = Math.abs(Number(bt.amount)) || 0
    if (amt === 0) continue

    const isDeposit = bt.type === 'DEPOSIT'
    const rowType = mapBankTxType(bt.type, bt.referenceType)

    let refNo = bt.description || (isDeposit ? 'Bank Deposit' : 'Bank Withdrawal')
    let referenceUrl: string | undefined = undefined
    let remarks = bt.description || ''

    if (bt.referenceType === 'Sale' && bt.referenceId) {
      const saleInfo = enrichment.sales?.get(bt.referenceId)
      if (saleInfo) {
        refNo = saleInfo.saleNumber
        referenceUrl = `/sales/${bt.referenceId}`
        remarks = saleInfo.customerName ? `Customer: ${saleInfo.customerName}` : ''
      }
    } else if (bt.referenceType === 'SaleReturn' && bt.referenceId) {
      const retInfo = enrichment.returns?.get(bt.referenceId)
      if (retInfo) {
        refNo = retInfo.returnNumber
        remarks = retInfo.reason || 'Customer Refund'
      }
    } else if (bt.referenceType === 'Expense' && bt.referenceId) {
      const expInfo = enrichment.expenses?.get(bt.referenceId)
      if (expInfo) {
        refNo = expInfo.description || 'Expense'
        remarks = expInfo.accountName || ''
      }
    } else if (
      (bt.referenceType === 'PurchaseInvoice' ||
        bt.referenceType === 'PurchasePayment' ||
        bt.referenceType === 'SUPPLIER_PAYMENT') &&
      bt.referenceId
    ) {
      const purInfo = enrichment.purchases?.get(bt.referenceId)
      if (purInfo) {
        refNo = purInfo.invoiceNumber
        remarks = purInfo.supplierName ? `Supplier: ${purInfo.supplierName}` : ''
      }
    } else if (
      (bt.referenceType === 'ServiceInvoice' ||
        bt.referenceType === 'ServiceJob' ||
        bt.referenceType === 'ServicePayment') &&
      bt.referenceId
    ) {
      const srvInfo = enrichment.services?.get(bt.referenceId)
      if (srvInfo) {
        refNo = srvInfo.invoiceNumber || srvInfo.jobNumber || 'Service'
        remarks = srvInfo.device ? `Device: ${srvInfo.device}` : srvInfo.customerName || ''
      }
    }

    rows.push({
      id: `bt-${bt.id}`,
      timestamp: new Date(bt.transactionAt).getTime(),
      date: formatLocalDate(new Date(bt.transactionAt)),
      refNo,
      referenceUrl,
      type: rowType,
      accountAmounts: { [bt.bankAccountId]: isDeposit ? amt : -amt },
      totalIn: isDeposit ? amt : 0,
      totalOut: isDeposit ? 0 : -amt,
      balance: 0,
      remarks,
    })
  }

  // 3. Process Unassigned Bank Payments
  for (const up of unassignedPayments) {
    const netAmt = (Number(up.amount) || 0) - (Number(up.feeAmount) || 0)
    if (netAmt <= 0) continue

    rows.push({
      id: `up-${up.id}`,
      timestamp: new Date(up.createdAt).getTime(),
      date: formatLocalDate(new Date(up.createdAt)),
      refNo: up.saleNumber || 'Sale',
      referenceUrl: up.saleId ? `/sales/${up.saleId}` : undefined,
      type: 'Sale',
      accountAmounts: { 'unassigned-bank': netAmt },
      totalIn: netAmt,
      totalOut: 0,
      balance: 0,
      remarks: up.customerName
        ? `Customer: ${up.customerName} (${up.method})`
        : `Unassigned Bank (${up.method})`,
    })
  }

  // 4. Process Closed Drawer Variances
  for (const d of closedDrawers) {
    const v = Number(d.variance) || 0
    if (v === 0) continue

    const isSurplus = v > 0
    const absV = Math.abs(v)
    const txTime = d.closedAt ? new Date(d.closedAt) : new Date()

    rows.push({
      id: `var-${d.id}`,
      timestamp: txTime.getTime(),
      date: formatLocalDate(txTime),
      refNo: isSurplus ? 'Drawer Surplus' : 'Drawer Shortage',
      type: 'Adjustment',
      accountAmounts: { 'main-cash': v },
      totalIn: isSurplus ? absV : 0,
      totalOut: isSurplus ? 0 : -absV,
      balance: 0,
      remarks: 'Physical cash count variance',
    })
  }

  // 5. Chronological Sort
  rows.sort((a, b) => a.timestamp - b.timestamp)

  // 6. Running Balance Calculation
  const totalOpening = Object.values(openingBalances).reduce((s, a) => s + (Number(a) || 0), 0)
  let runningBalance = totalOpening

  for (const row of rows) {
    runningBalance += row.totalIn + row.totalOut // totalOut is negative
    row.balance = Math.round(runningBalance * 100) / 100
  }

  return rows
}
