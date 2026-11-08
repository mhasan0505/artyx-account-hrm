/**
 * Canonical Transaction Types and Reference Types
 * 
 * Used across cash drawer transactions, bank transactions, and reports
 * to ensure consistent categorization without relying on description-text parsing.
 */

// ==========================================
// 1. DRAWER TRANSACTION TYPES (DrawerTransaction.type)
// ==========================================
export const DRAWER_TX_TYPE = {
  // --- Inflows ---
  SALE: 'SALE',
  SERVICE_PAYMENT: 'SERVICE_PAYMENT',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  B2B_SALE: 'B2B_SALE',
  B2B_PAYMENT: 'B2B_PAYMENT',
  PURCHASE_REFUND: 'PURCHASE_REFUND',
  B2B_PURCHASE_REFUND: 'B2B_PURCHASE_REFUND',
  CASH_IN: 'CASH_IN', // Generic/manual cash-in

  // --- Outflows ---
  EXPENSE: 'EXPENSE',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  PURCHASE_PAYMENT: 'PURCHASE_PAYMENT',
  B2B_PURCHASE: 'B2B_PURCHASE',
  B2B_PURCHASE_PAYMENT: 'B2B_PURCHASE_PAYMENT',
  PAYROLL: 'PAYROLL',
  ADVANCE: 'ADVANCE',
  FIXED_ASSET_PURCHASE: 'FIXED_ASSET_PURCHASE',
  REFUND: 'REFUND',
  SERVICE_REFUND: 'SERVICE_REFUND',
  B2B_SALE_REFUND: 'B2B_SALE_REFUND',
  CASH_OUT: 'CASH_OUT', // Generic/manual cash-out

  // --- System / Internal ---
  OPENING: 'OPENING',
  CONTRA_TRANSFER: 'CONTRA_TRANSFER',
} as const

export type DrawerTxType = typeof DRAWER_TX_TYPE[keyof typeof DRAWER_TX_TYPE]

// ==========================================
// 2. BANK TRANSACTION REFERENCE TYPES (BankTransaction.referenceType)
// ==========================================
export const BANK_TX_REF_TYPE = {
  // --- Inflows ---
  // Note: 'Sale' preserved for cascade delete compatibility in sales.ts
  SALE: 'Sale',
  SERVICE_PAYMENT: 'SERVICE_PAYMENT',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  CUSTOMER_COLLECTION: 'CUSTOMER_COLLECTION',
  // Note: 'SUPPLIER_SALE' preserved for cascade delete compatibility in b2b.ts
  B2B_SALE: 'SUPPLIER_SALE',
  B2B_SALE_PAYMENT: 'SUPPLIER_SALE_PAYMENT',
  PURCHASE_RETURN: 'PurchaseReturn',
  B2B_PURCHASE_REFUND: 'SUPPLIER_PURCHASE_REFUND',
  CAPITAL_INJECTION: 'CAPITAL_INJECTION',
  CONTRA_TRANSFER: 'ContraTransfer',

  // --- Outflows ---
  EXPENSE: 'Expense',
  PURCHASE_INVOICE: 'PurchaseInvoice',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  SUPPLIER_INVOICE_PAYMENT: 'SUPPLIER_INVOICE_PAYMENT',
  B2B_PURCHASE: 'SUPPLIER_PURCHASE',
  B2B_EXCHANGE: 'SUPPLIER_EXCHANGE',
  PAYROLL: 'PAYROLL',
  PAYROLL_PAYMENT: 'PAYROLL_PAYMENT',
  EMPLOYEE_ADVANCE: 'EMPLOYEE_ADVANCE',
  FIXED_ASSET: 'FIXED_ASSET',
  SALE_RETURN: 'SaleReturn',
  SERVICE_REFUND: 'SERVICE_REFUND',
  B2B_SALE_REFUND: 'SUPPLIER_SALE_REFUND',
  CAPITAL_WITHDRAWAL: 'CAPITAL_WITHDRAWAL',
  MANUAL: 'MANUAL',
} as const

export type BankTxRefType = typeof BANK_TX_REF_TYPE[keyof typeof BANK_TX_REF_TYPE]
