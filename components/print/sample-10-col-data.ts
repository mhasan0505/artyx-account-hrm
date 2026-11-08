import { ReportColumn, ReportKpi, ReportChartConfig, ReportMetadata } from './types'

export interface PosTransactionLedgerRow {
  sn: number
  invoiceNo: string
  dateTime: string
  cashier: string
  sku: string
  description: string
  qty: number
  unitPrice: number
  discount: number
  total: number
  paymentToken: string
}

/**
 * Standard 10-column POS ledger column definitions.
 */
export const POS_10_COLUMN_SCHEMA: ReportColumn<PosTransactionLedgerRow>[] = [
  {
    key: 'sn',
    header: 'SN',
    width: 4,
    align: 'center',
    type: 'number',
  },
  {
    key: 'invoiceNo',
    header: 'Invoice No',
    width: 10,
    align: 'left',
    type: 'code',
    isCode: true,
  },
  {
    key: 'dateTime',
    header: 'Date & Time',
    width: 10,
    align: 'left',
    type: 'datetime',
  },
  {
    key: 'cashier',
    header: 'Terminal / Cashier',
    width: 9,
    align: 'left',
    type: 'text',
  },
  {
    key: 'sku',
    header: 'SKU / Code',
    width: 8,
    align: 'left',
    type: 'code',
    isCode: true,
  },
  {
    key: 'description',
    header: 'Item Description',
    width: 33, // High allocation for multi-attribute products
    align: 'left',
    type: 'text',
  },
  {
    key: 'qty',
    header: 'Qty',
    width: 5,
    align: 'center',
    type: 'number',
  },
  {
    key: 'unitPrice',
    header: 'Rate',
    width: 7,
    align: 'right',
    type: 'currency',
    currencyOptions: { mode: 'none' }, // Clean numeric with comma formatting matching ledger
  },
  {
    key: 'discount',
    header: 'Dis',
    width: 5,
    align: 'right',
    type: 'currency',
    currencyOptions: { mode: 'none', showZeroAsDash: false },
  },
  {
    key: 'total',
    header: 'Total',
    width: 9,
    align: 'right',
    type: 'currency',
    currencyOptions: { mode: 'none' },
  },
]

export const SAMPLE_POS_METADATA: ReportMetadata = {
  title: 'Executive Sales & Transaction Ledger',
  subtitle: 'Comprehensive 10-Column Multi-Terminal Audit Report',
  dateRange: '01 Sep 2026 – 16 Sep 2026',
  companyName: 'Artyx Digital',
  outletName: 'Artyx Digital HQ',
  companyAddress: 'Level 4, House 12, Road 4, Sector 3, Uttara, Dhaka-1230',
  companyPhone: '+880 1800-000000',
  companyEmail: 'admin@artyxdigital.com',
  companyLogo: '/artyx-logo.webp',
  preparedBy: 'Lead Cashier & Audit Officer',
  approvedBy: 'Director of Finance & Retail Operations',
}

export const SAMPLE_POS_KPIS: ReportKpi[] = [
  {
    id: 'gross-sales',
    label: 'Gross Sales Revenue',
    value: '৳523,500.00',
    subtext: '+14.2% vs previous period',
    variant: 'primary',
  },
  {
    id: 'completed-txns',
    label: 'Completed Transactions',
    value: '142 Orders',
    subtext: 'Across 4 active registers',
    variant: 'success',
  },
  {
    id: 'total-discount',
    label: 'Total Promotional Discount',
    value: '৳14,500.00',
    subtext: 'Avg 2.7% discount rate',
    variant: 'warning',
  },
  {
    id: 'net-drawer',
    label: 'Net Drawer Settlements',
    value: '৳509,000.00',
    subtext: 'Reconciled with zero discrepancy',
    variant: 'info',
  },
]

export const SAMPLE_POS_CHARTS: ReportChartConfig[] = [
  {
    id: 'daily-revenue-chart',
    title: 'Daily Sales Trajectory (BDT Thousands)',
    type: 'bar',
    data: [
      { label: 'Sep 10', revenue: 42 },
      { label: 'Sep 11', revenue: 68 },
      { label: 'Sep 12', revenue: 54 },
      { label: 'Sep 13', revenue: 95 },
      { label: 'Sep 14', revenue: 110 },
      { label: 'Sep 15', revenue: 78 },
      { label: 'Sep 16', revenue: 76 },
    ],
    series: [{ dataKey: 'revenue', label: 'Revenue', color: '#1e293b' }],
  },
  {
    id: 'payment-methods-chart',
    title: 'Settlement Distribution by Channel',
    type: 'bar',
    data: [
      { label: 'Cash', value: 215 },
      { label: 'Credit Card', value: 160 },
      { label: 'bKash', value: 85 },
      { label: 'Nagad', value: 34 },
      { label: 'Bank', value: 15 },
    ],
    series: [{ dataKey: 'value', label: 'Settlement', color: '#0f172a' }],
  },
]

export const SAMPLE_EMBEDDED_LOGS = [
  {
    token: 'TXN-HASH-99482A1B',
    message: 'Cryptographic ledger snapshot hash verified against terminal blockchain seal.',
    timestamp: '16 Sep 2026, 14:00',
  },
  {
    token: 'DRAWER-RECON-771',
    message: 'Shift handover verified by Supervisor ID #USR-801; zero physical cash discrepancy.',
    timestamp: '16 Sep 2026, 14:05',
  },
]

export const SAMPLE_10_COL_TRANSACTIONS: PosTransactionLedgerRow[] = [
  {
    sn: 1,
    invoiceNo: 'SEL140926101',
    dateTime: '2026-09-16T09:15:00',
    cashier: 'POS-01 / Tanvir',
    sku: 'ABA232P',
    description: 'Dell Latitude 9420 | Intel Core i7 11th Gen | 16GB RAM | 256GB SSD | 14" FHD IPS Display',
    qty: 1,
    unitPrice: 41500,
    discount: 0,
    total: 41500,
    paymentToken: 'AUTH_BKASH_9921',
  },
  {
    sn: 2,
    invoiceNo: 'SEL140926102',
    dateTime: '2026-09-16T09:42:00',
    cashier: 'POS-02 / Farhana',
    sku: 'ABA158P',
    description: 'HP EliteBook 745 G3 | AMD PRO A12 | 8GB DDR4 | 256GB NVMe SSD | AMD Radeon Graphics',
    qty: 1,
    unitPrice: 19000,
    discount: 0,
    total: 19000,
    paymentToken: 'AUTH_CASH_0192',
  },
  {
    sn: 3,
    invoiceNo: 'SEL140926103',
    dateTime: '2026-09-16T10:05:00',
    cashier: 'POS-01 / Tanvir',
    sku: 'ABA157P',
    description: 'HP EliteBook 745 G4 | AMD PRO A12 | 8GB DDR4 | 256GB NVMe SSD | 14" FHD Anti-Glare',
    qty: 1,
    unitPrice: 23000,
    discount: 500,
    total: 22500,
    paymentToken: 'AUTH_CARD_4491',
  },
  {
    sn: 4,
    invoiceNo: 'SEL140926104',
    dateTime: '2026-09-16T10:30:00',
    cashier: 'POS-03 / Shakil',
    sku: 'ABA117P',
    description: 'HP EliteBook 840 G7 | Intel Core i7 10th Gen | 8GB DDR4 | 256GB NVMe SSD | UHD Graphics',
    qty: 3,
    unitPrice: 36666.67,
    discount: 0,
    total: 110000,
    paymentToken: 'AUTH_NAGAD_8812',
  },
  {
    sn: 5,
    invoiceNo: 'SEL140926105',
    dateTime: '2026-09-16T11:12:00',
    cashier: 'POS-02 / Farhana',
    sku: 'ABA089P',
    description: 'HP EliteBook 845 G8 | AMD Ryzen 5 PRO 5650U | 8GB RAM | 256GB SSD | 14" FHD IPS Anti-Glare',
    qty: 1,
    unitPrice: 42000,
    discount: 0,
    total: 42000,
    paymentToken: 'AUTH_CASH_0201',
  },
  {
    sn: 6,
    invoiceNo: 'SEL140926106',
    dateTime: '2026-09-16T11:45:00',
    cashier: 'POS-01 / Tanvir',
    sku: 'ABA216P',
    description: 'HP EliteBook 845 G9 | AMD Ryzen 5 PRO 6650U | 12GB RAM | 512GB SSD | 14" WUXGA IPS (1920x1200)',
    qty: 1,
    unitPrice: 54000,
    discount: 1000,
    total: 53000,
    paymentToken: 'AUTH_CARD_7721',
  },
  {
    sn: 7,
    invoiceNo: 'SEL140926107',
    dateTime: '2026-09-16T12:15:00',
    cashier: 'POS-04 / Laboni',
    sku: 'ABA119P',
    description: 'HP Laptop EliteBook 820 G2 | Core i5 5th Gen | RAM 8GB | SSD 128GB | 13" HD Full LED Display',
    qty: 1,
    unitPrice: 19000,
    discount: 0,
    total: 19000,
    paymentToken: 'AUTH_CASH_0219',
  },
  {
    sn: 8,
    invoiceNo: 'SEL140926108',
    dateTime: '2026-09-16T12:50:00',
    cashier: 'POS-03 / Shakil',
    sku: 'ABA175P',
    description: 'HP Laptop EliteBook 835 G7 | AMD Ryzen 7 PRO 4650U | RAM 8GB | SSD 256GB | 13.5" FHD IPS (1920x1080)',
    qty: 2,
    unitPrice: 35750,
    discount: 0,
    total: 71500,
    paymentToken: 'AUTH_BKASH_9941',
  },
  {
    sn: 9,
    invoiceNo: 'SEL140926109',
    dateTime: '2026-09-16T13:20:00',
    cashier: 'POS-01 / Tanvir',
    sku: 'ABA023P',
    description: 'HP Laptop EliteBook 840 G8 | Core i5 11th Gen | RAM 8GB | SSD 256GB | 14" Full HD LED Backlit Anti-Glare',
    qty: 1,
    unitPrice: 36000,
    discount: 0,
    total: 36000,
    paymentToken: 'AUTH_CASH_0224',
  },
  {
    sn: 10,
    invoiceNo: 'SEL140926110',
    dateTime: '2026-09-16T13:45:00',
    cashier: 'POS-02 / Farhana',
    sku: 'ABA022P',
    description: 'HP Laptop EliteBook 840 G8 | Intel Core i7 11th Gen | RAM 8GB | SSD 256GB | 14" Full HD LED Backlit IPS',
    qty: 1,
    unitPrice: 39000,
    discount: 0,
    total: 39000,
    paymentToken: 'AUTH_CARD_3319',
  },
]
