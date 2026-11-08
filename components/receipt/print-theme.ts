/**
 * Centralized Print Design System & Tokens
 *
 * Defines the shared palette, typography weights, and CSS classes
 * used across all Invoices, Challans, and Vouchers.
 */

export const PRINT_THEME = {
  colors: {
    /** Primary text: #242424 for regular body text and item descriptions */
    textPrimary: '#242424',
    /** Secondary text: #3F4652 for labels, metadata, terms, and less prominent text */
    textSecondary: '#3F4652',
    /** Pure black: #000000 only where very small text needs maximum print clarity */
    textBlack: '#000000',
    /** Current brand blue for headings, totals, borders, and accents */
    brand: '#2b6fd6',
    /** Deep brand navy for major titles, table headers, and grand totals */
    brandDark: '#1e3a8a',
    /** Soft accent blue for customer strip and secondary highlight borders */
    brandLight: '#93c5fd',
    /** Standard document border color */
    border: '#2b6fd6',
    /** Subtle neutral border */
    borderSubtle: '#e2e8f0',
    /** Subtle neutral background tint */
    bgSubtle: '#f8fafc',
  },
  typography: {
    fontSans:
      "'Segoe UI', Tahoma, -apple-system, BlinkMacSystemFont, Arial, sans-serif",
    fontMono:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    sizes: {
      /** Prominent company header name (21px) */
      company: '21px',
      /** Document uppercase title like INVOICE, CHALLAN, VOUCHER (13px) */
      title: '13px',
      /** Strong identifiers: Invoice #, Challan #, Voucher #, Party Name, Address (11.5px) */
      detailLg: '11.5px',
      /** Standard metadata, dates, contact details, balance amounts (11px) */
      detail: '11px',
      /** Base document body, item descriptions, table rows, terms (10.5px) */
      body: '10.5px',
      /** Section titles: Terms & Conditions, Running Balance (10.5px) */
      sectionHeading: '10.5px',
      /** Compact, scannable table column headers (10px) */
      tableHeader: '10px',
      /** Secondary metadata, table row numbers, customer strip text, signatures (10px) */
      meta: '10px',
      /** Compact field labels, subtotal labels, amount in words (9.5px) */
      label: '9.5px',
      /** Serial numbers, line notes, reference codes (9px) */
      metaSm: '9px',
      /** Micro labels: Customer:, Specs:, SN: (8.5px) */
      micro: '8.5px',
      /** Tiny status badges: GIFT, Net B2B (7.5px) */
      badge: '7.5px',
      /** Table grand total amount (12px) */
      total: '12px',
      /** Large settlement amount for Voucher total box (14px) */
      totalLg: '14px',
    },
    lineHeights: {
      tight: 1.15,
      snug: 1.3,
      normal: 1.35,
      relaxed: 1.45,
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    classes: {
      company: 'print-company-name',
      title: 'print-doc-title',
      detailLg: 'print-detail-lg',
      detail: 'print-detail',
      body: 'print-body',
      sectionHeading: 'print-section-heading',
      th: 'print-th',
      meta: 'print-meta',
      label: 'print-label',
      metaSm: 'print-meta-sm',
      micro: 'print-micro',
      badge: 'print-badge',
      amountGrand: 'print-amount-grand',
      amountXl: 'print-amount-xl',
    },
  },
} as const
