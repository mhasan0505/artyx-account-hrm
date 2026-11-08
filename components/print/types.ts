import { ReactNode } from 'react'
import { CurrencyFormatOptions } from './formatters'

export type Alignment = 'left' | 'center' | 'right'

export type ColumnDataType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'percentage' | 'code'

export interface ReportColumn<T = any> {
  /**
   * Data key or property accessor on row object T.
   */
  key: keyof T | string

  /**
   * Display header title.
   */
  header: string

  /**
   * Relative weight or percentage width (e.g. 5, 10, 50), or 'wrap' | 'auto' | 'full'.
   */
  width?: number | 'auto' | 'wrap' | 'full' | string

  /**
   * When true, column width hugs its text size tightly (cellWidth: 'wrap' / w-px whitespace-nowrap).
   */
  fitContent?: boolean

  /**
   * Text alignment: 'left' | 'center' | 'right'. Default is 'left'.
   */
  align?: Alignment

  /**
   * Vertical alignment: 'top' | 'middle' | 'bottom'. Default is 'top' for body rows.
   */
  valign?: 'top' | 'middle' | 'bottom'

  /**
   * Data type for automatic semantic formatting.
   */
  type?: ColumnDataType

  /**
   * For currency columns, optional overrides.
   */
  currencyOptions?: CurrencyFormatOptions

  /**
   * Custom formatter returning string for PDF and either string or ReactNode for visual rendering.
   */
  format?: (value: any, row: T, index: number, target: 'pdf' | 'visual') => string

  /**
   * Optional custom React renderer for visual preview & react-to-print.
   */
  render?: (value: any, row: T, index: number) => ReactNode

  /**
   * Mark as code/token/hash. Renders with isolated monospace code styling.
   */
  isCode?: boolean
}

export interface ReportKpi {
  id?: string
  label: string
  value: string | number
  subtext?: string
  variant?: 'default' | 'success' | 'info' | 'warning' | 'danger' | 'primary'
}

export interface ChartDataPoint {
  label: string
  [key: string]: string | number
}

export interface ChartSeries {
  dataKey: string
  label: string
  color: string
}

export interface ReportChartConfig {
  id?: string
  title: string
  type?: 'bar' | 'line' | 'area'
  data: ChartDataPoint[]
  series: ChartSeries[]
  height?: number
}

export interface ReportMetadata {
  title: string
  subtitle?: string
  dateRange?: string
  companyName?: string
  outletName?: string
  companyAddress?: string
  companyPhone?: string
  companyEmail?: string
  companyLogo?: string
  preparedBy?: string
  approvedBy?: string
  generatedAt?: string
  notes?: string
}

export type ReportMode = 'ledger' | 'dashboard'

export interface PrintManagerProps<T = any> {
  /**
   * Active display and print mode:
   * - 'ledger': Dense multi-page table optimized for jsPDF + autotable
   * - 'dashboard': Executive visual report with branding, KPIs, charts, and table
   */
  mode?: ReportMode

  /**
   * Array of data records.
   */
  data: T[]

  /**
   * Column definitions (e.g. 10-column layout or dynamic).
   */
  columns: ReportColumn<T>[]

  /**
   * Store and report metadata (title, outlet, dates, signatures).
   */
  metadata: ReportMetadata

  /**
   * Executive KPI metrics (shown in dashboard mode).
   */
  kpis?: ReportKpi[]

  /**
   * Visual chart configurations (shown in dashboard mode).
   */
  charts?: ReportChartConfig[]

  /**
   * Optional embedded audit logs or raw transaction tokens.
   */
  embeddedLogs?: Array<{ token: string; message: string; timestamp?: string }>

  /**
   * PDF filename without extension.
   */
  fileName?: string

  /**
   * Document paper orientation for PDF export ('landscape' or 'portrait'). Default: 'landscape'.
   */
  orientation?: 'landscape' | 'portrait'

  /**
   * Callback when print or PDF export completes.
   */
  onComplete?: (action: 'pdf' | 'print') => void
}

export interface PdfLedgerOptions<T = any> {
  data: T[]
  columns: ReportColumn<T>[]
  metadata: ReportMetadata
  fileName?: string
  orientation?: 'landscape' | 'portrait'
  format?: 'a4' | 'letter'
  fontSize?: number
  currencyMode?: 'symbol' | 'prefix' | 'code' | 'none'
  embeddedLogs?: Array<{ token: string; message: string; timestamp?: string }>
  totals?: Record<string, any>
  foot?: (string | number)[][]
}
