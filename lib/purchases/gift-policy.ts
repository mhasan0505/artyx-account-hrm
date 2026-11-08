/**
 * Pure helper to determine whether a product or purchase order line
 * is considered a gift item or accessory, exempting it from serial number tracking.
 */
export function isGiftOrAccessoryProduct(
  product?: {
    name?: string | null
    requiresSerial?: boolean | null
    category?: { name?: string | null } | null
    parent?: { name?: string | null } | null
  } | null,
  lineNote?: string | null
): boolean {
  if (!product) return false
  if (lineNote && lineNote.includes('[GIFT]')) return true
  const cat = product.category?.name?.toLowerCase() ?? ''
  const parent = product.parent?.name?.toLowerCase() ?? ''
  const name = product.name?.toLowerCase() ?? ''
  return (
    cat.includes('gift') ||
    parent.includes('gift') ||
    name.includes('gift') ||
    cat.includes('accessor') ||
    parent.includes('accessor')
  )
}
