// Browser-safe enum objects and types matching Prisma schema without importing Node runtime

export const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  BKASH: 'BKASH',
  NAGAD: 'NAGAD',
  ROCKET: 'ROCKET',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CREDIT: 'CREDIT',
  CHEQUE: 'CHEQUE',
} as const
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod]

export const ServiceJobStatus = {
  RECEIVED: 'RECEIVED',
  DIAGNOSED: 'DIAGNOSED',
  REPAIRING: 'REPAIRING',
  WAITING_PARTS: 'WAITING_PARTS',
  COMPLETED: 'COMPLETED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const
export type ServiceJobStatus = (typeof ServiceJobStatus)[keyof typeof ServiceJobStatus]

export const AssetCategory = {
  FURNITURE: 'FURNITURE',
  EQUIPMENT: 'EQUIPMENT',
  OFFICE_DEPOSIT: 'OFFICE_DEPOSIT',
  INVESTMENT: 'INVESTMENT',
  OTHER: 'OTHER',
} as const
export type AssetCategory = (typeof AssetCategory)[keyof typeof AssetCategory]

export const FundingSource = {
  HISTORICAL: 'HISTORICAL',
  NEW_PURCHASE: 'NEW_PURCHASE',
} as const
export type FundingSource = (typeof FundingSource)[keyof typeof FundingSource]

export const ProductCondition = {
  NEW: 'NEW',
  USED: 'USED',
  REFURBISHED: 'REFURBISHED',
} as const
export type ProductCondition = (typeof ProductCondition)[keyof typeof ProductCondition]

export const SerialStatus = {
  IN_STOCK: 'IN_STOCK',
  SOLD: 'SOLD',
  IN_SERVICE: 'IN_SERVICE',
  DEFECTIVE: 'DEFECTIVE',
  RETURNED_TO_SUPPLIER: 'RETURNED_TO_SUPPLIER',
  TRANSFER_TRANSIT: 'TRANSFER_TRANSIT',
} as const
export type SerialStatus = (typeof SerialStatus)[keyof typeof SerialStatus]
