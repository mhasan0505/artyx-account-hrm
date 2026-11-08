export type InvoiceTermsCategory = 'sales' | 'purchase' | 'service' | 'warranty'

export const SALES_TERMS_DEFAULT = [
  'Goods sold are eligible for return/replacement within 7 days with original invoice.',
  'Warranty or replacement policy depends on product category and manufacturer policy.',
  'Physical, liquid, electrical, or burn damage is not covered under warranty.',
  'Opened or used software and consumable items are non-refundable.',
  'Please preserve this invoice for all warranty, return, and support claims.',
]

export const PURCHASE_TERMS_DEFAULT = [
  'All items must match the exact specifications, part numbers, and quantities in the purchase order.',
  'Defective, substandard, or damaged goods will be rejected and debited to supplier account.',
  'Payment terms are subject to inspection and quality verification upon delivery.',
  'Suppliers must provide official warranty and serial tracking documentation with every delivery.',
]

export const SERVICE_TERMS_DEFAULT = [
  'Customers must back up all data before service intake; the service center is not liable for data loss.',
  '30-day service warranty applies exclusively to replacement parts itemized on this invoice.',
  'Physical drop damage, liquid ingress, electric surges, or unauthorized tampering voids service warranty.',
  'Repaired devices must be collected within 30 days of readiness notification.',
  'Diagnostic fees are non-refundable regardless of repair outcome.',
]

export const WARRANTY_TERMS_DEFAULT = [
  'Warranty coverage is strictly subject to manufacturer and authorized service center terms.',
  'Original purchase invoice and intact serial/warranty stickers are mandatory for all warranty claims.',
  'Turnaround time for RMA/warranty processing is typically 7 to 21 working days.',
  'Physical damage, lightning/power surge, liquid spill, or unauthorized disassembly void warranty.',
  'Replacements or credit notes will only be issued if repair is deemed impossible by the manufacturer.',
]

export const INVOICE_TERMS_DEFAULT = SALES_TERMS_DEFAULT
