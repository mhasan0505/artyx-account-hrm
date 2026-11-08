/**
 * Checkout payment validation logic.
 * Enforces:
 * 1. Total payments must cover the grand total (no underpayments allowed).
 * 2. Non-cash payments cannot exceed the grand total (change may only be given on cash payments).
 * 3. Individual fee amounts must be non-negative and not exceed the payment amount.
 * 4. Credit payment method is prohibited for walk-in customers (requires a verified account).
 */

export interface SalePaymentInput {
  method: string
  amount: number
  feeAmount?: number
  bankAccountId?: string
  reference?: string
}

export interface ValidateSalePaymentsParams {
  total: number
  payments: SalePaymentInput[]
  customer?: { id?: string | null; name?: string; phone?: string | null } | null
  walkInCustomerId?: string | null
  isQuotation?: boolean
}

export interface PaymentValidationResult {
  isValid: boolean
  error?: string
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

/**
 * Checks whether a customer ID matches the configured walk-in customer ID.
 * Returns true if customer ID matches the walk_in_customer_id setting (or if customer ID is omitted).
 */
export function isWalkInCustomer(
  customerIdOrObj: { id?: string | null } | string | null | undefined,
  walkInCustomerId?: string | null | undefined
): boolean {
  const custId =
    typeof customerIdOrObj === 'string' ? customerIdOrObj : customerIdOrObj?.id
  if (!custId) return true
  if (!walkInCustomerId) return false
  return custId === walkInCustomerId
}

export function validateSalePayments(
  params: ValidateSalePaymentsParams
): PaymentValidationResult {
  const { total, payments, customer, walkInCustomerId, isQuotation } = params

  if (isQuotation) {
    return { isValid: true }
  }

  if (!payments || payments.length === 0) {
    return {
      isValid: false,
      error: 'Enter at least one payment amount.',
    }
  }

  for (const p of payments) {
    if (typeof p.amount !== 'number' || isNaN(p.amount) || p.amount <= 0) {
      return {
        isValid: false,
        error: 'Each payment amount must be greater than zero.',
      }
    }
    if (p.feeAmount !== undefined) {
      if (typeof p.feeAmount !== 'number' || isNaN(p.feeAmount) || p.feeAmount < 0) {
        return {
          isValid: false,
          error: 'Payment fee amount cannot be negative.',
        }
      }
      if (p.feeAmount > p.amount) {
        return {
          isValid: false,
          error: `Fee amount (৳${p.feeAmount.toFixed(2)}) cannot exceed payment amount (৳${p.amount.toFixed(2)}).`,
        }
      }
    }
  }

  const roundedTotal = round2(total)
  const totalPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0))

  // 1. Total paid must cover grand total
  if (totalPaid < roundedTotal - 0.01) {
    const shortfall = round2(roundedTotal - totalPaid)
    return {
      isValid: false,
      error: `Payments total (৳${totalPaid.toFixed(2)}) is less than total amount due (৳${roundedTotal.toFixed(2)}). Remaining shortfall: ৳${shortfall.toFixed(2)}.`,
    }
  }

  // 2. Non-cash payments cannot exceed grand total
  const nonCashPaid = round2(
    payments
      .filter(p => p.method !== 'CASH')
      .reduce((sum, p) => sum + p.amount, 0)
  )

  if (nonCashPaid > roundedTotal + 0.01) {
    return {
      isValid: false,
      error: `Non-cash payments (৳${nonCashPaid.toFixed(2)}) cannot exceed total amount (৳${roundedTotal.toFixed(2)}). Change can only be provided from cash payments.`,
    }
  }

  // 3. CREDIT payments require a registered non-walk-in customer
  const hasCreditPayment = payments.some(p => p.method === 'CREDIT')
  if (hasCreditPayment) {
    if (!customer || !customer.id) {
      return {
        isValid: false,
        error: 'Credit payments require a registered customer on file.',
      }
    }
    if (!walkInCustomerId) {
      return {
        isValid: false,
        error:
          'Walk-in customer configuration is missing (setting walk_in_customer_id not found). Credit payments cannot be validated.',
      }
    }
    if (isWalkInCustomer(customer.id, walkInCustomerId)) {
      return {
        isValid: false,
        error:
          'Credit payments are not allowed for walk-in customers. Please select or create a registered customer account.',
      }
    }
  }

  return { isValid: true }
}
