/**
 * Formats a comprehensive, specification-rich product name for display
 * across sales invoices, receipts, challans, products list, and exports.
 *
 * Example:
 * Base: "HP EliteBook 830 G5"
 * Specs: Intel Core i5 (8th Gen), 8 GB, 256 GB, 13.3" FHD IPS (1920x1080)
 * Output: "HP EliteBook 830 G5 | Intel Core i5 (8th Gen) | 8 GB RAM | 256 GB SSD | 13.3\" FHD IPS (1920x1080)"
 *
 * If the product name already contains pipes "|", it returns the name as-is
 * without duplicate spec concatenation.
 */
export function formatProductFullName(p: {
  name?: string | null
  processor?: string | { name?: string | null } | null
  processorGen?: string | { name?: string | null } | null
  ram?: string | { name?: string | null } | null
  storage?: string | { name?: string | null } | null
  display?: string | null
  displaySize?: string | null
  displayResolution?: string | null
}): string {
  if (!p) return ''
  const baseName = String(p.name ?? '').trim()
  if (!baseName) return ''
  if (baseName.includes('|')) return baseName

  const procName =
    typeof p.processor === 'object' && p.processor !== null
      ? p.processor.name
      : typeof p.processor === 'string'
        ? p.processor
        : null

  const procGenName =
    typeof p.processorGen === 'object' && p.processorGen !== null
      ? p.processorGen.name
      : typeof p.processorGen === 'string'
        ? p.processorGen
        : null

  const ramName =
    typeof p.ram === 'object' && p.ram !== null
      ? p.ram.name
      : typeof p.ram === 'string'
        ? p.ram
        : null

  const storageName =
    typeof p.storage === 'object' && p.storage !== null
      ? p.storage.name
      : typeof p.storage === 'string'
        ? p.storage
        : null

  const cpuParts: string[] = []
  if (procName?.trim()) cpuParts.push(procName.trim())
  if (
    procGenName?.trim() &&
    (!procName || !procName.toLowerCase().includes(procGenName.toLowerCase()))
  ) {
    cpuParts.push(procGenName.trim())
  }
  const cpu = cpuParts.join(' ')

  const ram = ramName?.trim()
    ? ramName.toUpperCase().includes('RAM')
      ? ramName.trim()
      : `${ramName.trim()} RAM`
    : null

  const storage = storageName?.trim()
    ? storageName.toUpperCase().includes('SSD') || storageName.toUpperCase().includes('HDD')
      ? storageName.trim()
      : `${storageName.trim()} SSD`
    : null

  const display =
    p.display?.trim() ||
    [p.displaySize?.trim(), p.displayResolution?.trim()].filter(Boolean).join(' ') ||
    null

  const parts = [baseName, cpu, ram, storage, display].filter(Boolean)
  return parts.join(' | ')
}
