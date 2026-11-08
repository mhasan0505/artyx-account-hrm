/**
 * Supplier activity types for unified timeline view
 */

export type SupplierActivityType =
  | 'PURCHASE_ORDER_CREATED'
  | 'PURCHASE_ORDER_RECEIVED'
  | 'PURCHASE_ORDER_CANCELLED'
  | 'INVOICE_CREATED'
  | 'INVOICE_PAID'
  | 'INVOICE_PARTIALLY_PAID'
  | 'INVOICE_OVERDUE'
  | 'PAYMENT_SENT'
  | 'PAYMENT_RECEIVED'
  | 'RETURN_CREATED'
  | 'LEDGER_DEBIT'
  | 'LEDGER_CREDIT'
  | 'NOTE_ADDED'
  | 'STATUS_CHANGE'

export interface SupplierActivity {
  id: string
  type: SupplierActivityType
  timestamp: Date
  title: string
  description: string
  amount?: number
  status?: string
  actor?: string
  metadata?: Record<string, any>
  details?: {
    items?: Array<{
      name: string
      quantity?: number
      unitCost?: number
      total?: number
    }>
    payments?: Array<{
      amount: number
      method: string
      date: Date
      reference?: string
    }>
    [key: string]: any
  }
}

export interface ActivityFilter {
  types?: SupplierActivityType[]
  dateRange?: {
    from?: Date
    to?: Date
  }
}
