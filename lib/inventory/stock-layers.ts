import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export interface ConsumedLayerBatch {
  layerId: string
  supplierId: string | null
  purchaseOrderId: string | null
  unitCost: number
  quantityConsumed: number
  totalCost: number
}

/**
 * Consumes FIFO stock layers for a product inside an active transaction.
 *
 * Defaults to `allowSyntheticLayer: false`, throwing a distinct
 * `FIFO_LAYER_DEFICIT:"<productName>"|<layersAvailable>|<required>` error
 * if stock layers are insufficient for the needed quantity.
 */
export async function consumeStockLayers(
  tx: PrismaTx | Prisma.TransactionClient,
  params: {
    productId: string
    outletId: string
    quantityNeeded: number
    supplierId?: string
    purchaseOrderId?: string
    allowSyntheticLayer?: boolean
  }
): Promise<ConsumedLayerBatch[]> {
  const {
    productId,
    outletId,
    quantityNeeded,
    supplierId,
    purchaseOrderId,
    allowSyntheticLayer = false,
  } = params

  if (quantityNeeded <= 0) return []

  // 1. Lock matching StockLayer rows with FOR UPDATE to prevent concurrency race conditions
  if (supplierId && purchaseOrderId) {
    await tx.$executeRaw`
      SELECT id FROM "StockLayer"
      WHERE "productId" = ${productId}
        AND "outletId" = ${outletId}
        AND "supplierId" = ${supplierId}
        AND "purchaseOrderId" = ${purchaseOrderId}
        AND "quantityRemaining" > 0
      FOR UPDATE
    `
  } else if (supplierId) {
    await tx.$executeRaw`
      SELECT id FROM "StockLayer"
      WHERE "productId" = ${productId}
        AND "outletId" = ${outletId}
        AND "supplierId" = ${supplierId}
        AND "quantityRemaining" > 0
      FOR UPDATE
    `
  } else if (purchaseOrderId) {
    await tx.$executeRaw`
      SELECT id FROM "StockLayer"
      WHERE "productId" = ${productId}
        AND "outletId" = ${outletId}
        AND "purchaseOrderId" = ${purchaseOrderId}
        AND "quantityRemaining" > 0
      FOR UPDATE
    `
  } else {
    await tx.$executeRaw`
      SELECT id FROM "StockLayer"
      WHERE "productId" = ${productId}
        AND "outletId" = ${outletId}
        AND "quantityRemaining" > 0
      FOR UPDATE
    `
  }

  // 2. Fetch locked layers in FIFO order
  const layers = await tx.stockLayer.findMany({
    where: {
      productId,
      outletId,
      ...(supplierId ? { supplierId } : {}),
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      quantityRemaining: { gt: 0 },
    },
    orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
  })

  const totalAvailable = layers.reduce((sum, l) => sum + l.quantityRemaining, 0)
  if (totalAvailable < quantityNeeded) {
    if (!allowSyntheticLayer || supplierId || purchaseOrderId) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { name: true },
      })
      const productName = product?.name || 'Item'
      throw new Error(
        `FIFO_LAYER_DEFICIT:"${productName}"|${totalAvailable}|${quantityNeeded}`
      )
    }

    const shortfall = quantityNeeded - totalAvailable
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { costPrice: true, name: true },
    })

    const unitCost = Number(product?.costPrice || 0)
    console.warn(
      `[consumeStockLayers] Synthetic layer created for product ${productId} (${product?.name || 'unknown'}) — shortfall: ${shortfall} units. COGS will use catalog cost ৳${unitCost}`
    )
    const syntheticLayer = await tx.stockLayer.create({
      data: {
        productId,
        outletId,
        quantityReceived: shortfall,
        quantityRemaining: shortfall,
        unitCost,
        receivedAt: new Date(),
      },
    })

    layers.push(syntheticLayer)
  }

  let remainingToDeduct = quantityNeeded
  const consumedBatches: ConsumedLayerBatch[] = []

  for (const layer of layers) {
    if (remainingToDeduct <= 0) break

    const takeQty = Math.min(layer.quantityRemaining, remainingToDeduct)
    const unitCost = Number(layer.unitCost)
    const totalCost = takeQty * unitCost

    await tx.stockLayer.update({
      where: { id: layer.id },
      data: {
        quantityRemaining: { decrement: takeQty },
      },
    })

    consumedBatches.push({
      layerId: layer.id,
      supplierId: layer.supplierId,
      purchaseOrderId: layer.purchaseOrderId,
      unitCost,
      quantityConsumed: takeQty,
      totalCost,
    })

    remainingToDeduct -= takeQty
  }

  return consumedBatches
}
