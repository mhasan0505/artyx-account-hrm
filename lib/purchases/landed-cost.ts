/**
 * Pure Landed Cost & Variable Delivery Cost Allocation Engine
 *
 * Implements strict accounting principles for inventory landed costs:
 * 1. Proportional allocation by batch net goods value (after line discount).
 * 2. Fallback to quantity-based allocation when batch goods value is 0 (sample/free items).
 * 3. Exact penny reconciliation: remainder pushed to the final line so total allocated freight
 *    equals the exact freight invoice amount down to the penny.
 * 4. Layer-level exact penny allocation across multi-unit lines to prevent fractional drift.
 */

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100
}

export function round4(num: number): number {
  return Math.round((num + Number.EPSILON) * 10000) / 10000
}

export interface ReceiveLineAllocationInput {
  poLineId: string
  productId: string
  quantityToReceive: number
  baseUnitCost: number
  lineDiscount?: number
}

export interface LineLandedCostResult {
  poLineId: string
  productId: string
  quantityToReceive: number
  baseUnitCost: number
  lineDiscount: number
  lineNetBase: number
  allocatedFreight: number
  lineLandedTotal: number
  unitLandedCost: number
  unitExtraCost: number
  layerUnitCosts: number[]
}

export interface LandedCostAllocationResult {
  allocations: LineLandedCostResult[]
  totalBatchNetBase: number
  totalAllocatedFreight: number
  totalLandedBatchAmount: number
}

export function allocateLandedCosts(
  lines: ReceiveLineAllocationInput[],
  totalFreightAndOtherCost: number,
  method: 'VALUE' | 'QUANTITY' = 'VALUE'
): LandedCostAllocationResult {
  const cleanFreight = round2(Math.max(0, totalFreightAndOtherCost || 0))

  if (lines.length === 0) {
    return {
      allocations: [],
      totalBatchNetBase: 0,
      totalAllocatedFreight: 0,
      totalLandedBatchAmount: 0,
    }
  }

  // 1. Calculate net base goods value for this batch (after discount)
  let totalBatchNetBase = 0
  let totalBatchUnits = 0

  const preparedLines = lines.map(line => {
    const qty = Math.max(0, line.quantityToReceive)
    const baseCost = round2(Math.max(0, line.baseUnitCost))
    const discount = round2(Math.max(0, line.lineDiscount || 0))
    const lineNetBase = Math.max(0, round2(qty * baseCost - discount))

    totalBatchNetBase = round2(totalBatchNetBase + lineNetBase)
    totalBatchUnits += qty

    return {
      ...line,
      quantityToReceive: qty,
      baseUnitCost: baseCost,
      lineDiscount: discount,
      lineNetBase,
    }
  })

  // 2. Allocate freight across lines
  let runningAllocatedFreight = 0
  const allocations: LineLandedCostResult[] = []

  const activeLines = preparedLines.filter(l => l.quantityToReceive > 0)

  for (let i = 0; i < activeLines.length; i++) {
    const line = activeLines[i]
    const isLast = i === activeLines.length - 1

    let allocatedFreight = 0
    if (cleanFreight > 0) {
      if (isLast) {
        allocatedFreight = round2(cleanFreight - runningAllocatedFreight)
      } else if (method === 'QUANTITY' && totalBatchUnits > 0) {
        // Quantity-based allocation (equal per unit received)
        allocatedFreight = round2(
          cleanFreight * (line.quantityToReceive / totalBatchUnits)
        )
      } else if (totalBatchNetBase > 0) {
        // Value-based allocation (proportional to net goods value)
        allocatedFreight = round2(
          cleanFreight * (line.lineNetBase / totalBatchNetBase)
        )
      } else if (totalBatchUnits > 0) {
        // Quantity-based fallback when goods net total is 0
        allocatedFreight = round2(
          cleanFreight * (line.quantityToReceive / totalBatchUnits)
        )
      }
      runningAllocatedFreight = round2(
        runningAllocatedFreight + allocatedFreight
      )
    }

    const lineLandedTotal = round2(line.lineNetBase + allocatedFreight)
    const unitExtraCost =
      line.quantityToReceive > 0
        ? round4(allocatedFreight / line.quantityToReceive)
        : 0
    const unitLandedCost =
      line.quantityToReceive > 0
        ? round4(lineLandedTotal / line.quantityToReceive)
        : 0

    // Exact penny reconciliation across individual units within this line
    const layerUnitCosts: number[] = []
    if (line.quantityToReceive > 0) {
      const basePennies = Math.floor(
        (lineLandedTotal / line.quantityToReceive) * 100
      )
      const baseUnit = basePennies / 100
      const remainderPennies = Math.round(
        (lineLandedTotal - baseUnit * line.quantityToReceive) * 100
      )

      for (let u = 0; u < line.quantityToReceive; u++) {
        // Distribute remainder pennies to the last units
        const extraCent =
          u >= line.quantityToReceive - remainderPennies ? 0.01 : 0
        layerUnitCosts.push(round2(baseUnit + extraCent))
      }
    }

    allocations.push({
      poLineId: line.poLineId,
      productId: line.productId,
      quantityToReceive: line.quantityToReceive,
      baseUnitCost: line.baseUnitCost,
      lineDiscount: line.lineDiscount,
      lineNetBase: line.lineNetBase,
      allocatedFreight,
      lineLandedTotal,
      unitLandedCost: round2(unitLandedCost),
      unitExtraCost: round2(unitExtraCost),
      layerUnitCosts,
    })
  }

  const totalAllocatedFreight = round2(
    allocations.reduce((s, a) => s + a.allocatedFreight, 0)
  )
  const totalLandedBatchAmount = round2(
    allocations.reduce((s, a) => s + a.lineLandedTotal, 0)
  )

  return {
    allocations,
    totalBatchNetBase,
    totalAllocatedFreight,
    totalLandedBatchAmount,
  }
}

export interface NonSerializedStockLayerSplit {
  quantity: number
  unitCost: number
  totalCost: number
}

/**
 * Splits a non-serialized received line into at most two StockLayers
 * so that sum(layer.quantity * layer.unitCost) equals lineLandedTotal to the exact penny.
 *
 * Example: 3 units @ 100.00 total ->
 *   2 units @ 33.33 (66.66) + 1 unit @ 33.34 (33.34) = 100.00
 */
export function getNonSerializedStockLayers(
  quantity: number,
  lineLandedTotal: number
): NonSerializedStockLayerSplit[] {
  if (quantity <= 0) return []
  const cleanTotal = round2(lineLandedTotal)
  const totalCents = Math.round(cleanTotal * 100)
  const baseCents = Math.floor(totalCents / quantity)
  const baseUnit = baseCents / 100
  const remainderPennies = totalCents - baseCents * quantity

  if (remainderPennies === 0) {
    return [
      {
        quantity,
        unitCost: baseUnit,
        totalCost: cleanTotal,
      },
    ]
  }

  const baseQty = quantity - remainderPennies
  const higherQty = remainderPennies
  const higherUnit = round2(baseUnit + 0.01)

  const layers: NonSerializedStockLayerSplit[] = []
  if (baseQty > 0) {
    layers.push({
      quantity: baseQty,
      unitCost: baseUnit,
      totalCost: round2(baseQty * baseUnit),
    })
  }
  if (higherQty > 0) {
    layers.push({
      quantity: higherQty,
      unitCost: higherUnit,
      totalCost: round2(higherQty * higherUnit),
    })
  }
  return layers
}

