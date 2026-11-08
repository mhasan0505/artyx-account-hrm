/**
 * Centralized Date & Time Utility for Artyx Digital
 * 
 * Ensures consistent timezone handling (Asia/Dhaka / GMT+6) across:
 * 1. Server-side rendering (SSR) & Server Actions (UTC servers like Vercel/Neon)
 * 2. Client-side browser rendering (hydration consistency)
 * 3. Database query date boundaries (accurate business day queries)
 */

export const DEFAULT_TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || 'Asia/Dhaka'
export const DEFAULT_LOCALE = 'en-GB'

/**
 * Formats a Date/timestamp into local date format (e.g. "26 Aug 2026")
 */
export function formatLocalDate(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  if (!value) return '—'
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'

  const defaultOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
    ...options,
  }

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, defaultOptions).format(date)
}

/**
 * Formats a Date/timestamp into local date and time format (e.g. "26 Aug 2026, 06:25 PM")
 */
export function formatLocalDateTime(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  if (!value) return '—'
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'

  const defaultOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
    ...options,
  }

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, defaultOptions).format(date)
}

/**
 * Formats a Date/timestamp into local time only (e.g. "06:25 PM")
 */
export function formatLocalTime(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  if (!value) return '—'
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'

  const defaultOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
    ...options,
  }

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, defaultOptions).format(date)
}

/**
 * Converts a date to YYYY-MM-DD string in local timezone (Asia/Dhaka)
 * Prevents UTC day-shift bugs when calling new Date().toISOString() after 6 PM local time.
 */
export function toLocalISODate(
  value?: Date | string | number | null,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const date = value ? (typeof value === 'string' || typeof value === 'number' ? new Date(value) : value) : new Date()
  if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

/**
 * Generates exact UTC Date boundaries covering a local calendar business day or date range
 * (from local 00:00:00.000 of fromDate to local 23:59:59.999 of toDate) for Prisma / SQL database queries.
 * 
 * Centralized date utility that covers both single dates and ranges:
 * 1. Single Date: when only fromDate is given (or toDate is omitted/empty/equal) -> full local day (00:00:00.000 to 23:59:59.999)
 * 2. Date Range: start of fromDate to end of toDate in local timezone (Asia/Dhaka / GMT+6)
 * 3. Inversion Detection: flags `isInverted = true` if fromDate > toDate so callers can reject or warn
 * 4. Fallback: if neither is given, defaults to current local calendar day in Asia/Dhaka (+06:00)
 */
export function getLocalDateRangeBoundaries(
  fromDate?: string | null,
  toDate?: string | null,
  timeZoneOffsetHours: number = 6
): {
  start: Date
  end: Date
  fromStr: string
  toStr: string
  isSingleDate: boolean
  isInverted: boolean
} {
  const cleanFrom = fromDate?.trim() || ''
  const cleanTo = toDate?.trim() || ''

  const todayStr = toLocalISODate(new Date())
  const effectiveFrom = cleanFrom || cleanTo || todayStr
  const effectiveTo = cleanTo || cleanFrom || todayStr

  const isInverted = cleanFrom !== '' && cleanTo !== '' && cleanFrom > cleanTo

  const fromOnly = effectiveFrom.includes('T') ? effectiveFrom.split('T')[0] : effectiveFrom
  const fromParts = fromOnly.split('-').map(Number)
  let startMs: number

  if (fromParts.length === 3 && !fromParts.some(isNaN)) {
    const [year, month, day] = fromParts
    startMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - timeZoneOffsetHours * 3600 * 1000
  } else {
    const d = new Date(effectiveFrom)
    d.setHours(0, 0, 0, 0)
    startMs = d.getTime()
  }

  const toOnly = effectiveTo.includes('T') ? effectiveTo.split('T')[0] : effectiveTo
  const toParts = toOnly.split('-').map(Number)
  let endMs: number

  if (toParts.length === 3 && !toParts.some(isNaN)) {
    const [year, month, day] = toParts
    endMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - timeZoneOffsetHours * 3600 * 1000
  } else {
    const d = new Date(effectiveTo)
    d.setHours(23, 59, 59, 999)
    endMs = d.getTime()
  }

  const isSingleDate = fromOnly === toOnly

  return {
    start: new Date(startMs),
    end: new Date(endMs),
    fromStr: fromOnly,
    toStr: toOnly,
    isSingleDate,
    isInverted,
  }
}

export type DatePresetKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'thisMonth' | 'lastMonth' | 'thisYear'

/**
 * Returns timezone-safe start and end YYYY-MM-DD date strings for standard calendar presets
 * in the configured business timezone (Asia/Dhaka / GMT+6).
 */
export function getDatePresetRange(
  preset: DatePresetKey,
  referenceDate: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE
): { from: string; to: string } {
  const todayStr = toLocalISODate(referenceDate, timeZone)
  const [year, month, day] = todayStr.split('-').map(Number)

  if (preset === 'today') {
    return { from: todayStr, to: todayStr }
  }

  if (preset === 'yesterday') {
    const d = new Date(Date.UTC(year, month - 1, day - 1, 12, 0, 0))
    const yesterdayStr = toLocalISODate(d, timeZone)
    return { from: yesterdayStr, to: yesterdayStr }
  }

  if (preset === 'last7Days') {
    const d = new Date(Date.UTC(year, month - 1, day - 6, 12, 0, 0))
    const sevenDaysAgoStr = toLocalISODate(d, timeZone)
    return { from: sevenDaysAgoStr, to: todayStr }
  }

  if (preset === 'last30Days') {
    const d = new Date(Date.UTC(year, month - 1, day - 29, 12, 0, 0))
    const thirtyDaysAgoStr = toLocalISODate(d, timeZone)
    return { from: thirtyDaysAgoStr, to: todayStr }
  }

  if (preset === 'thisMonth') {
    const mm = String(month).padStart(2, '0')
    return { from: `${year}-${mm}-01`, to: todayStr }
  }

  if (preset === 'lastMonth') {
    const prevMonthDate = new Date(Date.UTC(year, month - 2, 1, 12, 0, 0))
    const prevYear = prevMonthDate.getUTCFullYear()
    const prevMonth = prevMonthDate.getUTCMonth() + 1
    const prevMm = String(prevMonth).padStart(2, '0')
    const lastDayDate = new Date(Date.UTC(year, month - 1, 0, 12, 0, 0))
    const lastDay = String(lastDayDate.getUTCDate()).padStart(2, '0')

    return {
      from: `${prevYear}-${prevMm}-01`,
      to: `${prevYear}-${prevMm}-${lastDay}`,
    }
  }

  if (preset === 'thisYear') {
    return { from: `${year}-01-01`, to: todayStr }
  }

  return { from: todayStr, to: todayStr }
}

