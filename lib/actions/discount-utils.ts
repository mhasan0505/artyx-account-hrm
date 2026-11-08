export const round2 = (num: number) =>
  Math.round((num + Number.EPSILON) * 100) / 100

/**
 * sale.discountAmt (as persisted) = sum(line.discountAmt) + trueOrderDiscount.
 * Given the sale-level discountAmt and the set of non-gift lines (with their
 * already-net `total` and their own `discountAmt`), recover the order-only
 * discount and return a per-line map of how much of it applies to each line,
 * proportional to each line's NET total (not gross subtotal).
 */
export function distributeOrderDiscount(
  saleDiscountAmt: number,
  nonGiftLines: Array<{ id: string; total: number; discountAmt: number }>
): Map<string, number> {
  const totalLineDiscounts = nonGiftLines.reduce((s, l) => s + Number(l.discountAmt), 0)
  const trueOrderDiscount = Math.max(0, round2(saleDiscountAmt - totalLineDiscounts))
  const netBasis = nonGiftLines.reduce((s, l) => s + Number(l.total), 0)

  const map = new Map<string, number>()
  if (netBasis <= 0 || trueOrderDiscount <= 0 || nonGiftLines.length === 0) {
    for (const l of nonGiftLines) map.set(l.id, 0)
    return map
  }

  let allocatedSum = 0
  let maxLineId = nonGiftLines[0].id
  let maxTotal = -Infinity

  for (const l of nonGiftLines) {
    const proportion = Number(l.total) / netBasis
    const amt = round2(proportion * trueOrderDiscount)
    map.set(l.id, amt)
    allocatedSum = round2(allocatedSum + amt)
    if (Number(l.total) > maxTotal) {
      maxTotal = Number(l.total)
      maxLineId = l.id
    }
  }

  // Finding #34: Residual correction to ensure sum(distributed) === trueOrderDiscount exactly
  const residual = round2(trueOrderDiscount - allocatedSum)
  if (residual !== 0 && map.has(maxLineId)) {
    const current = map.get(maxLineId) ?? 0
    map.set(maxLineId, round2(current + residual))
  }

  return map
}
