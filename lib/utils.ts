import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns the image path for a product category icon located in /public/icons.
 * Prioritizes explicit Category and Sub-Category names first to ensure main product
 * types (like Laptops) are not misclassified by specs in the product title (like "8 GB RAM 256 GB SSD").
 */
export function getCategoryIconPath(
  categoryName?: string | null,
  subcategoryName?: string | null,
  productName?: string | null
): string {
  const cat = (categoryName || '').toLowerCase()
  const sub = (subcategoryName || '').toLowerCase()
  const name = (productName || '').toLowerCase()

  // ── LEVEL 1: Explicit Category & Sub-Category Matching ──────────────────────

  // 1. Laptop / Notebook
  if (
    cat.includes('laptop') ||
    sub.includes('laptop') ||
    cat.includes('notebook') ||
    sub.includes('notebook') ||
    cat.includes('macbook') ||
    sub.includes('macbook') ||
    cat.includes('ultrabook') ||
    sub.includes('ultrabook')
  ) {
    return '/icons/laptop.png'
  }

  // 2. RAM / Memory
  if (
    cat.includes('ram') ||
    sub.includes('ram') ||
    cat.includes('memory') ||
    sub.includes('memory')
  ) {
    return '/icons/ram-memory.png'
  }

  // 3. SSD / Storage / Hard Drive
  if (
    cat.includes('ssd') ||
    sub.includes('ssd') ||
    cat.includes('storage') ||
    sub.includes('storage') ||
    cat.includes('hard drive') ||
    sub.includes('hard drive') ||
    cat.includes('hdd') ||
    sub.includes('hdd')
  ) {
    return '/icons/ssd.png'
  }

  // 4. Charger / Power Adapter
  if (
    cat.includes('charger') ||
    sub.includes('charger') ||
    cat.includes('adapter') ||
    sub.includes('adapter')
  ) {
    return '/icons/charger.png'
  }

  // 5. AC Power Cable
  if (
    cat.includes('power cable') ||
    sub.includes('power cable') ||
    cat.includes('ac cable') ||
    sub.includes('ac cable')
  ) {
    return '/icons/ac_power-cable.png'
  }

  // 6. HDMI Cable
  if (
    cat.includes('hdmi') ||
    sub.includes('hdmi')
  ) {
    return '/icons/hdmi-cable.png'
  }

  // 7. Mouse Pad
  if (
    cat.includes('mouse pad') ||
    sub.includes('mouse pad') ||
    cat.includes('mousepad') ||
    sub.includes('mousepad')
  ) {
    return '/icons/mouse-pad.png'
  }

  // 8. Mouse
  if (
    cat.includes('mouse') ||
    sub.includes('mouse')
  ) {
    return '/icons/mouse.png'
  }

  // 9. Keyboard
  if (
    cat.includes('keyboard') ||
    sub.includes('keyboard') ||
    cat.includes('keyborad') ||
    sub.includes('keyborad')
  ) {
    return '/icons/keyborad.png'
  }

  // 10. Backpack / Bag
  if (
    cat.includes('bag') ||
    sub.includes('bag') ||
    cat.includes('backpack') ||
    sub.includes('backpack') ||
    cat.includes('case') ||
    sub.includes('case')
  ) {
    return '/icons/backpack.png'
  }

  // ── LEVEL 2: Product Name Fallback Matching ─────────────────────────────────
  // Evaluated only if category/subcategory did not yield a direct match.
  // Order matters: check main product types (Laptop) and compound terms (Charger) before sub-specs (RAM/SSD).

  if (
    name.includes('laptop charger') ||
    name.includes('power adapter') ||
    name.includes('charger')
  ) {
    return '/icons/charger.png'
  }

  if (
    name.includes('ac power cable') ||
    name.includes('power cable') ||
    name.includes('power cord')
  ) {
    return '/icons/ac_power-cable.png'
  }

  if (name.includes('hdmi')) {
    return '/icons/hdmi-cable.png'
  }

  if (
    name.includes('mouse pad') ||
    name.includes('mousepad') ||
    name.includes('mouse-pad')
  ) {
    return '/icons/mouse-pad.png'
  }

  if (
    name.includes('laptop') ||
    name.includes('notebook') ||
    name.includes('macbook') ||
    name.includes('ultrabook') ||
    name.includes('thinkpad') ||
    name.includes('surface')
  ) {
    return '/icons/laptop.png'
  }

  if (name.includes('mouse')) {
    return '/icons/mouse.png'
  }

  if (name.includes('keyboard') || name.includes('keyborad')) {
    return '/icons/keyborad.png'
  }

  if (name.includes('backpack') || name.includes('bag')) {
    return '/icons/backpack.png'
  }

  if (name.includes('ram') || name.includes('ddr4') || name.includes('ddr5')) {
    return '/icons/ram-memory.png'
  }

  if (name.includes('ssd') || name.includes('nvme') || name.includes('hdd')) {
    return '/icons/ssd.png'
  }

  // Default fallback category icon
  return '/icons/inventory.png'
}

/**
 * Formats database CUIDs (e.g. cms61fmcm000t0koc8st0d6nr) into clean, human-readable codes
 * e.g. CUST-104820 or SUPP-593810.
 */
export function formatClientCode(id: string | null | undefined, prefix: 'CUST' | 'SUPP' = 'CUST'): string {
  if (!id) return `${prefix}-000000`
  if (id.startsWith('CUST-') || id.startsWith('SUPP-')) return id

  let num = 0
  for (let i = 0; i < id.length; i++) {
    num = (num << 5) - num + id.charCodeAt(i)
    num |= 0
  }
  const positiveNum = Math.abs(num) % 900000 + 100000
  return `${prefix}-${positiveNum}`
}

export * from './date-utils'


