
export interface DiscountSettings {
  discount_limit_pct_cashier?: number | string | null
  discount_limit_pct_manager?: number | string | null
  [key: string]: any
}

/**
 * Returns the maximum discount percentage (0 - 100) allowed for a role.
 * - CASHIER: defaults to 0 (or Setting: discount_limit_pct_cashier)
 * - MANAGER: defaults to 10 (or Setting: discount_limit_pct_manager)
 * - ADMIN / SUPER_ADMIN: 100
 * - Other roles (ACCOUNTANT, HR, etc.): cashier limit
 */
export function getDiscountLimitPct(
  role: string,
  settings?: DiscountSettings | Map<string, string>
): number {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
    return 100
  }

  const getSettingVal = (key: string): number | null => {
    if (!settings) return null
    let raw: any
    if (settings instanceof Map) {
      raw = settings.get(key)
    } else {
      raw = settings[key]
    }
    if (raw === undefined || raw === null || raw === '') return null
    const num = Number(raw)
    return isNaN(num) ? null : Math.min(100, Math.max(0, num))
  }

  if (role === 'MANAGER') {
    const custom = getSettingVal('discount_limit_pct_manager')
    return custom !== null ? custom : 10
  }

  // Cashier and other roles
  const custom = getSettingVal('discount_limit_pct_cashier')
  return custom !== null ? custom : 0
}

export interface DiscretionaryDiscountParams {
  baseSubtotal: number // Sum of (qty * unitPrice) before any discount
  netSubtotal: number // After line discounts (baseSubtotal - totalLineDiscounts)
  totalDiscount: number // totalLineDiscounts + orderDiscountAmt
  groupDiscountPct?: number | null // Customer group discount percentage (if any)
}

export interface DiscretionaryDiscountResult {
  groupDiscountAmt: number
  discretionaryDiscountAmt: number
  discretionaryDiscountPct: number
}

/**
 * Computes discretionary discount that excludes customer-group discount.
 * - group discount amount = netSubtotal * groupPct / 100 (only when group discount applies)
 * - discretionary = total discount (line + order) - group discount amount (never below 0)
 * - discretionaryPct = discretionary / baseSubtotal * 100
 */
export function computeDiscretionaryDiscount(
  params: DiscretionaryDiscountParams
): DiscretionaryDiscountResult {
  const { baseSubtotal, netSubtotal, totalDiscount, groupDiscountPct } = params

  const groupPct = Number(groupDiscountPct) || 0
  let groupDiscountAmt = 0

  if (groupPct > 0 && netSubtotal > 0) {
    groupDiscountAmt = Math.round(((netSubtotal * groupPct) / 100) * 100) / 100
  }

  const discretionaryDiscountAmt = Math.max(
    0,
    Math.round((totalDiscount - groupDiscountAmt) * 100) / 100
  )

  const discretionaryDiscountPct =
    baseSubtotal > 0
      ? Math.round(((discretionaryDiscountAmt / baseSubtotal) * 100) * 100) / 100
      : 0

  return {
    groupDiscountAmt,
    discretionaryDiscountAmt,
    discretionaryDiscountPct,
  }
}

export interface SaleLineDiscountInput {
  quantity: number
  unitPrice: number
  discountPct?: number
  discountAmt?: number
  isGift?: boolean
  originalUnitPrice?: number // Benchmark unit price (original line price or product selling price)
}

export interface EvaluateDiscountApprovalParams {
  role: string
  lines: SaleLineDiscountInput[]
  orderDiscountPct?: number
  groupDiscountPct?: number | null
  settings?: DiscountSettings | Map<string, string>
  overrideApproverId?: string | null
  overridePin?: string | null
}

export interface EvaluateDiscountApprovalResult {
  baseSubtotal: number
  netSubtotal: number
  totalLineDiscounts: number
  orderDiscount: number
  totalDiscountAmt: number
  effectiveOrderDiscountPct: number
  discretionaryDiscountPct: number
  discretionaryDiscountAmt: number
  groupDiscountAmt: number
  userDiscountLimitPct: number
  requiresOverride: boolean
  hasApprovalCredentials: boolean
  error?: string
}

/**
 * Pure evaluation helper for determining whether submitted sale line/order discounts
 * exceed a user's role-based discount limit and require manager authorization.
 *
 * Reflects identical rules as POS checkout:
 * - Line gross & discount rounding to 2 decimals
 * - Net subtotal = baseSubtotal - totalLineDiscounts
 * - Effective order discount = Math.max(orderDiscountPct, groupDiscountPct)
 * - Excludes non-discretionary customer group discount
 * - Evaluates discretionary % against getDiscountLimitPct(role, settings)
 * - Treats price reductions below original/catalog sellingPrice as line discounts
 */
export function evaluateDiscountApproval(
  params: EvaluateDiscountApprovalParams
): EvaluateDiscountApprovalResult {
  const round2 = (val: number) => Math.round(val * 100) / 100

  let baseSubtotal = 0
  let totalLineDiscounts = 0

  for (const l of params.lines) {
    if (l.isGift) {
      continue
    }

    const benchmarkPrice =
      l.originalUnitPrice !== undefined && l.originalUnitPrice > 0
        ? l.originalUnitPrice
        : l.unitPrice

    const baseUnitPrice = Math.max(benchmarkPrice, l.unitPrice)
    const lineGross = round2(baseUnitPrice * l.quantity)
    const priceReduction = Math.max(0, round2((benchmarkPrice - l.unitPrice) * l.quantity))

    const submittedGross = round2(l.unitPrice * l.quantity)
    let explicitDiscount = 0
    if (l.discountAmt !== undefined && l.discountAmt > 0) {
      explicitDiscount = round2(Math.min(submittedGross, l.discountAmt))
    } else if (l.discountPct !== undefined && l.discountPct > 0) {
      explicitDiscount = round2(submittedGross * (l.discountPct / 100))
    }

    const lineDiscount = round2(priceReduction + explicitDiscount)
    baseSubtotal = round2(baseSubtotal + lineGross)
    totalLineDiscounts = round2(totalLineDiscounts + lineDiscount)
  }

  const netSubtotal = Math.max(0, round2(baseSubtotal - totalLineDiscounts))
  const groupDiscountPct = Number(params.groupDiscountPct) || 0
  const orderDiscountPct = Number(params.orderDiscountPct) || 0
  const effectiveOrderDiscountPct = Math.max(orderDiscountPct, groupDiscountPct)
  const orderDiscount = round2(netSubtotal * (effectiveOrderDiscountPct / 100))
  const totalDiscountAmt = round2(totalLineDiscounts + orderDiscount)

  const discretionaryCalc = computeDiscretionaryDiscount({
    baseSubtotal,
    netSubtotal,
    totalDiscount: totalDiscountAmt,
    groupDiscountPct,
  })

  const userDiscountLimitPct = getDiscountLimitPct(params.role, params.settings)
  const requiresOverride = discretionaryCalc.discretionaryDiscountPct > userDiscountLimitPct
  const hasApprovalCredentials = Boolean(
    params.overrideApproverId &&
    params.overrideApproverId.trim() &&
    params.overrideApproverId !== 'none' &&
    params.overridePin &&
    params.overridePin.trim()
  )

  let error: string | undefined
  if (requiresOverride && !hasApprovalCredentials) {
    error = `Discount (${discretionaryCalc.discretionaryDiscountPct}%) exceeds your limit (${userDiscountLimitPct}%). Authorizing manager approval is required.`
  }

  return {
    baseSubtotal,
    netSubtotal,
    totalLineDiscounts,
    orderDiscount,
    totalDiscountAmt,
    effectiveOrderDiscountPct,
    discretionaryDiscountPct: discretionaryCalc.discretionaryDiscountPct,
    discretionaryDiscountAmt: discretionaryCalc.discretionaryDiscountAmt,
    groupDiscountAmt: discretionaryCalc.groupDiscountAmt,
    userDiscountLimitPct,
    requiresOverride,
    hasApprovalCredentials,
    error,
  }
}

