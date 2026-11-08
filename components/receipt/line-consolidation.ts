type NumericLike = number | string | { toString(): string }

export interface ConsolidatableLine {
  id: string
  description: string
  code?: string | null
  quantity: NumericLike
  unitPrice?: NumericLike
  discount?: NumericLike
  total?: NumericLike
  serials?: string[]
  isGift?: boolean
  note?: string | null
  parentLineId?: string | null
  specs?: string[]
}

function toNumber(val: unknown): number {
  if (val == null) return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

/**
 * Checks if a customer name indicates a Walk-in / Walking customer.
 */
export function isWalkInCustomerName(name?: string | null): boolean {
  if (!name) return true
  const n = name.toLowerCase().trim()
  return (
    n.includes('walk-in') ||
    n.includes('walk in') ||
    n.includes('walking') ||
    n === 'walkin'
  )
}

/**
 * Determines whether a customer's phone number should be displayed on invoices/receipts.
 * Returns false for Walk-in customers or system default placeholder numbers.
 */
export function shouldDisplayCustomerPhone(
  customerName?: string | null,
  phone?: string | null
): boolean {
  if (!phone || !phone.trim()) return false
  const p = phone.trim()
  if (p === '01700000000' || p === '00000000000') return false
  if (isWalkInCustomerName(customerName)) return false
  return true
}

/**
 * Consolidates lines representing the same product into a single line on invoices.
 * Merges quantities, totals, discounts, serial numbers, and specs.
 *
 * Additionally ensures gift items are kept on ONE line:
 * - If multiple identical gifts exist (e.g. 2 Laptop Bags), merges them into 1 line with quantity 2.
 * - If multiple distinct gifts are attached to a parent item (e.g. Bag + Mouse), merges them into 1 consolidated gift line.
 * - If parent items are merged, automatically re-parents their child gifts and consolidates them directly beneath the parent.
 */
export function consolidateInvoiceLines<T extends ConsolidatableLine>(
  rawLines: T[]
): T[] {
  if (!rawLines || rawLines.length === 0) return []

  // Step 1: Separate standard lines from gift lines
  const standardLines: T[] = []
  const giftLines: T[] = []

  for (const line of rawLines) {
    if (line.isGift) {
      giftLines.push({ ...line })
    } else {
      standardLines.push({ ...line })
    }
  }

  // Step 2: Consolidate identical standard lines (same product description, code, unitPrice)
  const consolidatedParents: T[] = []
  const parentGroupMap = new Map<string, number>()
  const parentIdRedirect = new Map<string, string>()

  for (const line of standardLines) {
    const desc = (line.description || '').trim()
    const code = (line.code || '').trim()
    const unitPrice =
      line.unitPrice !== undefined
        ? Math.round((toNumber(line.unitPrice) + Number.EPSILON) * 100)
        : 0
    const parentId = line.parentLineId || ''

    const key = `${desc}__${code}__${unitPrice}__${parentId}`

    if (parentGroupMap.has(key)) {
      const idx = parentGroupMap.get(key)!
      const target = consolidatedParents[idx]

      if (line.id && target.id && line.id !== target.id) {
        parentIdRedirect.set(line.id, target.id)
      }

      const newQty = toNumber(target.quantity) + toNumber(line.quantity)
      const newDiscount =
        target.discount !== undefined || line.discount !== undefined
          ? Math.round(
              (toNumber(target.discount ?? 0) +
                toNumber(line.discount ?? 0) +
                Number.EPSILON) *
                100
            ) / 100
          : undefined
      const newTotal =
        target.total !== undefined || line.total !== undefined
          ? Math.round(
              (toNumber(target.total ?? 0) +
                toNumber(line.total ?? 0) +
                Number.EPSILON) *
                100
            ) / 100
          : undefined

      const mergedSerials = Array.from(
        new Set([...(target.serials || []), ...(line.serials || [])])
      ).filter(Boolean)

      const mergedSpecs = Array.from(
        new Set([...(target.specs || []), ...(line.specs || [])])
      ).filter(Boolean)

      const notes = [target.note, line.note]
        .map(n => n?.trim())
        .filter((n): n is string => Boolean(n))
      const mergedNote = Array.from(new Set(notes)).join('; ') || null

      consolidatedParents[idx] = {
        ...target,
        quantity: newQty,
        discount: newDiscount !== undefined ? newDiscount : target.discount,
        total: newTotal !== undefined ? newTotal : target.total,
        serials: mergedSerials,
        specs: mergedSpecs,
        note: mergedNote,
      }
    } else {
      parentGroupMap.set(key, consolidatedParents.length)
      consolidatedParents.push({
        ...line,
        serials: line.serials ? [...line.serials] : [],
        specs: line.specs ? [...line.specs] : [],
      })
    }
  }

  // Chained parent ID redirection resolver
  function resolveParentId(id?: string | null): string | null {
    if (!id) return null
    let curr = id
    const visited = new Set<string>()
    while (parentIdRedirect.has(curr) && !visited.has(curr)) {
      visited.add(curr)
      curr = parentIdRedirect.get(curr)!
    }
    return curr
  }

  // Step 3: Re-parent gifts to canonical parent lines
  const updatedGifts: T[] = giftLines.map(g => ({
    ...g,
    parentLineId: resolveParentId(g.parentLineId) ?? g.parentLineId,
  }))

  // Step 4: Group gifts by parentLineId
  const giftsByParent = new Map<string, T[]>()
  const unlinkedGifts: T[] = []

  for (const gift of updatedGifts) {
    const pId = gift.parentLineId
    if (pId) {
      const list = giftsByParent.get(pId) || []
      list.push(gift)
      giftsByParent.set(pId, list)
    } else {
      unlinkedGifts.push(gift)
    }
  }

  // Helper: Consolidate a list of gifts into a single consolidated gift line
  function consolidateGiftGroup(group: T[], targetParentId: string | null): T[] {
    if (!group || group.length === 0) return []

    // 1. Group identical gifts first (by description and code)
    const productMap = new Map<
      string,
      { desc: string; code: string; qty: number; sample: T }
    >()

    for (const g of group) {
      const d = (g.description || '').trim()
      const c = (g.code || '').trim()
      const key = `${d}__${c}`
      const existing = productMap.get(key)
      const q = toNumber(g.quantity) || 1
      if (existing) {
        existing.qty += q
      } else {
        productMap.set(key, { desc: d, code: c, qty: q, sample: g })
      }
    }

    const distinctItems = Array.from(productMap.values())
    if (distinctItems.length === 0) return []

    // Merge notes, specs, and serials across all gifts in group
    const allNotes = Array.from(
      new Set(
        group
          .map(g => g.note?.trim())
          .filter((n): n is string => Boolean(n))
      )
    ).join('; ') || null

    const allSerials = Array.from(
      new Set(group.flatMap(g => g.serials || []))
    ).filter(Boolean)

    const allSpecs = Array.from(
      new Set(group.flatMap(g => g.specs || []))
    ).filter(Boolean)

    // Case A: Only 1 distinct gift product (e.g. multiple Laptop Bags)
    if (distinctItems.length === 1) {
      const item = distinctItems[0]
      return [
        {
          ...item.sample,
          id: item.sample.id || `gift-${targetParentId || 'unlinked'}`,
          description: item.desc,
          code: item.code || item.sample.code,
          quantity: item.qty,
          unitPrice: 0,
          discount: 0,
          total: 0,
          isGift: true,
          parentLineId: targetParentId,
          serials: allSerials,
          specs: allSpecs,
          note: allNotes,
        },
      ]
    }

    // Case B: Multiple distinct gift products (e.g. Laptop Bag + Mouse) -> Keep in one line
    const totalGiftQty = distinctItems.reduce((acc, it) => acc + it.qty, 0)
    const combinedDesc = distinctItems
      .map(it => (it.qty > 1 ? `${it.desc} (x${it.qty})` : it.desc))
      .join(', ')

    const combinedCodes = distinctItems
      .map(it => it.code)
      .filter(Boolean)
      .join(', ')

    const firstSample = distinctItems[0].sample

    return [
      {
        ...firstSample,
        id: `gift-${targetParentId || 'unlinked'}-combined`,
        description: combinedDesc,
        code: combinedCodes || firstSample.code,
        quantity: totalGiftQty,
        unitPrice: 0,
        discount: 0,
        total: 0,
        isGift: true,
        parentLineId: targetParentId,
        serials: allSerials,
        specs: allSpecs,
        note: allNotes,
      },
    ]
  }

  // Step 5: Interleave each parent line with its consolidated gift line directly underneath
  const result: T[] = []
  const assignedGiftParentIds = new Set<string>()

  if (consolidatedParents.length > 0) {
    for (const parent of consolidatedParents) {
      result.push(parent)

      if (parent.id && giftsByParent.has(parent.id)) {
        const pGifts = giftsByParent.get(parent.id)!
        const merged = consolidateGiftGroup(pGifts, parent.id)
        result.push(...merged)
        assignedGiftParentIds.add(parent.id)
      }
    }

    // Any gifts whose parentId wasn't matched to an active parent line
    const remainingGifts: T[] = []
    for (const [pId, list] of giftsByParent.entries()) {
      if (!assignedGiftParentIds.has(pId)) {
        remainingGifts.push(...list)
      }
    }
    remainingGifts.push(...unlinkedGifts)

    if (remainingGifts.length > 0) {
      const firstParentId = consolidatedParents[0]?.id || null
      const merged = consolidateGiftGroup(remainingGifts, firstParentId)
      result.push(...merged)
    }
  } else {
    // Only gifts exist without standard parent lines
    result.push(...consolidateGiftGroup(updatedGifts, null))
  }

  return result
}
