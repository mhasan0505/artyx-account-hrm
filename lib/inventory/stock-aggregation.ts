/**
 * Aggregates required quantities by productId across sale or transfer lines.
 * This ensures that duplicate line items for the same product in a single transaction
 * correctly sum their demand before checking available stock.
 */
export function aggregateRequiredStockByProduct(
  lines: Array<{ productId: string; quantity: number }>
): Map<string, number> {
  const aggregated = new Map<string, number>()

  for (const line of lines) {
    if (!line.productId || line.quantity <= 0) continue
    const current = aggregated.get(line.productId) ?? 0
    aggregated.set(line.productId, current + line.quantity)
  }

  return aggregated
}
