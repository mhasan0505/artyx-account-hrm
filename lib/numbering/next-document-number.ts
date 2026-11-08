import { Prisma } from '@prisma/client'

export type DocumentType =
  | 'sale'
  | 'quotation'
  | 'sale_return'
  | 'purchase_order'
  | 'purchase_invoice'
  | 'purchase_return'
  | 'service_job'
  | 'service_invoice'
  | 'internal_repair'
  | 'b2b_sale_invoice'
  | 'goods_received_note'

export const DOCUMENT_PREFIXES: Record<DocumentType, string> = {
  sale: 'SAL',
  quotation: 'QTN',
  sale_return: 'RTN',
  purchase_order: 'PO',
  purchase_invoice: 'PINV',
  purchase_return: 'PRTN',
  service_job: 'SVC',
  service_invoice: 'SINV',
  internal_repair: 'IRP',
  b2b_sale_invoice: 'BINV',
  goods_received_note: 'GRN',
}

/**
 * Formats a document counter value into a collision-free sequential number.
 * Pattern: <PREFIX><4-digit zero-padded number> (minimum 4 digits, never truncated)
 * e.g. SAL0001, SAL0002 ... SAL9999, SAL10000
 */
export function formatDocumentNumber(docType: DocumentType, value: number): string {
  const prefix = DOCUMENT_PREFIXES[docType]
  if (!prefix) {
    throw new Error(`Unknown document type: ${docType}`)
  }
  const intVal = Math.max(1, Math.floor(value))
  const padded = String(intVal).padStart(4, '0')
  return `${prefix}${padded}`
}

/**
 * Atomically generates the next sequential document number inside the caller's transaction.
 * Uses an atomic INSERT ... ON CONFLICT ("docType") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
 * statement so that:
 * 1. Counters are collision-free across concurrent checkouts/operations
 * 2. Rolled-back transactions do not leave gaps (gap-free)
 * 3. It MUST NEVER be called outside a database transaction.
 */
export async function nextDocumentNumber(
  tx: any,
  docType: DocumentType
): Promise<string> {
  if (!tx || typeof tx.$queryRaw !== 'function') {
    throw new Error(
      `nextDocumentNumber must NEVER be called outside a database transaction. docType: ${docType}`
    )
  }

  const result = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "DocumentCounter" ("id", "docType", "value", "updatedAt")
    VALUES (gen_random_uuid(), ${docType}, 1, NOW())
    ON CONFLICT ("docType")
    DO UPDATE SET "value" = "DocumentCounter"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `

  const nextVal = result[0]?.value
  if (nextVal === undefined || nextVal === null) {
    throw new Error(`Failed to generate sequential document number for docType: ${docType}`)
  }

  return formatDocumentNumber(docType, Number(nextVal))
}
