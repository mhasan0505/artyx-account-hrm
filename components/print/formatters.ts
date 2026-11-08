/**
 * Pure formatting utilities for the Unified POS Reporting and Print Framework.
 *
 * These functions have zero JSX, zero browser-only dependencies, and zero PDF-specific code.
 * They take raw values and produce deterministic, byte-identical strings for both
 * the PDF pipeline (Pipeline 1) and the visual template pipeline (Pipeline 2).
 */

export interface CurrencyFormatOptions {
  /**
   * 'symbol': Bengali Taka '৳12,345.00' (default for screen/visual print)
   * 'prefix': ASCII Taka 'Tk 12,345.00' (safe for default jsPDF fonts)
   * 'code': ISO code 'BDT 12,345.00' (safe for default jsPDF fonts)
   * 'none': Standard comma-separated number '12,345.00' (matches reference ledgers)
   */
  mode?: 'symbol' | 'prefix' | 'code' | 'none'
  decimals?: number
  showZeroAsDash?: boolean
}

/**
 * Deterministic currency formatter.
 * Handles negative numbers, near-zero rounding (-0.00 prevention), very large amounts,
 * zero-dash display, and null/undefined values.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  options: CurrencyFormatOptions = {}
): string {
  const { mode = 'symbol', decimals = 2, showZeroAsDash = false } = options

  if (amount === null || amount === undefined || amount === '') {
    if (showZeroAsDash) return '—'
  }

  let val: number
  if (typeof amount === 'number') {
    val = amount
  } else if (amount === null || amount === undefined || amount === '') {
    val = 0
  } else {
    const trimmed = String(amount).trim()
    if (trimmed === '' || trimmed === '—' || trimmed === '-') {
      return showZeroAsDash
        ? '—'
        : mode === 'symbol'
        ? '৳0.00'
        : mode === 'none'
        ? '0.00'
        : `${mode === 'prefix' ? 'Tk ' : 'BDT '}0.00`
    }

    // Clean string from currency symbols, commas, and spaces
    const cleaned = trimmed
      .replace(/[৳$]/g, '')
      .replace(/\b(Tk|BDT)\b/gi, '')
      .replace(/,/g, '')
      .replace(/\s+/g, '')

    val = Number(cleaned)
    if (isNaN(val)) {
      // If unparseable string (e.g. 'Pending', 'Unreconciled'), return original text
      return trimmed
    }
  }

  const absVal = Math.abs(val)
  const roundedUnits = Math.round((absVal + Number.EPSILON) * Math.pow(10, decimals))
  const isEffectivelyZero = roundedUnits === 0

  if (isEffectivelyZero && showZeroAsDash) return '—'

  // Prevent -0.00 artifact
  const isNegative = !isEffectivelyZero && val < 0

  const formattedNumber = absVal.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  let prefix = ''
  if (mode === 'symbol') prefix = '৳'
  else if (mode === 'prefix') prefix = 'Tk '
  else if (mode === 'code') prefix = 'BDT '
  else if (mode === 'none') prefix = ''

  return isNegative ? `-${prefix}${formattedNumber}` : `${prefix}${formattedNumber}`
}

/**
 * Standard number formatting with thousands separators.
 * Handles negative numbers, edge precision, zero display, and null/undefined.
 */
export function formatNumber(
  amount: number | string | null | undefined,
  decimals = 2,
  showZeroAsZeroString = true
): string {
  if (amount === null || amount === undefined || amount === '') {
    return decimals > 0 ? (0).toFixed(decimals) : '0'
  }

  const val = Number(amount)
  if (isNaN(val)) return decimals > 0 ? (0).toFixed(decimals) : '0'

  const absVal = Math.abs(val)
  const roundedUnits = Math.round((absVal + Number.EPSILON) * Math.pow(10, decimals))
  const isEffectivelyZero = roundedUnits === 0

  if (isEffectivelyZero && !showZeroAsZeroString) return '0'

  const isNegative = !isEffectivelyZero && val < 0
  const formatted = absVal.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return isNegative ? `-${formatted}` : formatted
}

/**
 * Formats integers with comma separators (e.g. quantities, counts).
 */
export function formatInteger(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0'
  const num = Math.round(Number(val))
  if (isNaN(num)) return '0'
  return num.toLocaleString('en-US')
}

/**
 * Formats percentage values (e.g. 0.15 -> '15.0%', 15 -> '15.0%').
 */
export function formatPercentage(
  val: number | string | null | undefined,
  decimals = 1,
  isFraction = false
): string {
  if (val === null || val === undefined || val === '') return '0.0%'
  const num = Number(val)
  if (isNaN(num)) return '0.0%'
  const effective = isFraction ? num * 100 : num
  return `${effective.toFixed(decimals)}%`
}

/**
 * Formats date into standard POS audit string (e.g., '16 Sep 2026' or 'YYYY-MM-DD').
 */
export function formatDate(
  val: string | Date | null | undefined,
  formatStyle: 'short' | 'iso' | 'full' = 'short'
): string {
  if (!val || val === '—') return '—'
  const date = typeof val === 'string' ? new Date(val) : val
  if (isNaN(date.getTime())) return String(val)

  if (formatStyle === 'iso') {
    return date.toISOString().slice(0, 10)
  }

  if (formatStyle === 'full') {
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Formats timestamp with hours and minutes.
 */
export function formatDateTime(val: string | Date | null | undefined): string {
  if (!val || val === '—') return '—'
  const date = typeof val === 'string' ? new Date(val) : val
  if (isNaN(date.getTime())) return String(val)

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Clean sanitization for transaction tokens, serials, and SKU codes.
 */
export function formatCodeOrToken(val: string | null | undefined): string {
  if (val === null || val === undefined) return '—'
  const str = String(val).trim()
  return str.length === 0 ? '—' : str
}

/**
 * Dedicated PDF currency formatter that strictly enforces ASCII 'Tk ' or 'BDT ' prefix,
 * completely preventing Bengali currency symbol ৳ (U+09F3) from appearing in PDF generation.
 */
export function formatPdfCurrency(
  amount: number | string | null | undefined,
  options: CurrencyFormatOptions = {}
): string {
  const opts = { ...options }
  if (!opts.mode || opts.mode === 'symbol') {
    opts.mode = 'prefix'
  }
  const result = formatCurrency(amount, opts)
  return result.replace(/৳/g, 'Tk ')
}

export function formatCellValue<T = any>(
  column: {
    key: keyof T | string
    type?: string
    currencyOptions?: CurrencyFormatOptions
    format?: (value: any, row: T, index: number, target: 'pdf' | 'visual') => string
  },
  row: T,
  index: number,
  target: 'pdf' | 'visual'
): string {
  const rawValue = (row as any)?.[column.key]

  let result = ''
  if (column.format) {
    result = column.format(rawValue, row, index, target)
  } else {
    switch (column.type) {
      case 'currency': {
        const currencyOpts = { ...column.currencyOptions }
        if (target === 'pdf' && (!currencyOpts.mode || currencyOpts.mode === 'symbol')) {
          currencyOpts.mode = 'prefix'
        }
        result = formatCurrency(rawValue, currencyOpts)
        break
      }
      case 'number':
        result = formatNumber(rawValue)
        break
      case 'date':
        result = formatDate(rawValue)
        break
      case 'datetime':
        result = formatDateTime(rawValue)
        break
      case 'percentage':
        result = formatPercentage(rawValue)
        break
      case 'code':
        result = formatCodeOrToken(rawValue)
        break
      default:
        result = rawValue !== undefined && rawValue !== null && rawValue !== '' ? String(rawValue) : '—'
    }
  }

  // Strict Fix 14 rule: Never output ৳ (U+09F3) into PDFs
  if (target === 'pdf' && typeof result === 'string' && result.includes('৳')) {
    result = result.replace(/৳/g, 'Tk ')
  }

  return result
}
