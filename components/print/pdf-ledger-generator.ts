import jsPDF from 'jspdf'
import autoTable, { UserOptions } from 'jspdf-autotable'
import { formatCellValue } from './formatters'
import { PdfLedgerOptions, ReportColumn, ReportMetadata } from './types'
import { setupPdfFont } from '@/lib/pdf/fonts'
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_PHONE,
  DEFAULT_COMPANY_EMAIL,
  resolveLogoDataUrl,
} from './brand-assets'

export const DEFAULT_ROW_COUNT_SAFEGUARD = 2500

/**
 * Calculates column styles and widths based on column weights and wrap rules.
 * Fix 14 standard: Table body font size: exactly 9pt. Table headers: 9pt bold.
 * No dynamic downscaling below 7.5pt — instead, switch to landscape orientation when columns >= 6,
 * and wrap text within cells.
 */
export function calculateDynamicColumnStyles<T>(
  columns: ReportColumn<T>[],
  tableWidth: number
): {
  fontSize: number
  headerFontSize: number
  cellPadding: number
  columnStyles: { [key: number]: { cellWidth?: number | 'auto' | 'wrap'; halign?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom' } }
} {
  // Fix 14: Enforce uniform 9pt table body and headers across all reports
  const fontSize = 9
  const headerFontSize = 9
  const cellPadding = 3.5

  // Calculate column widths
  const hasWrapOrAuto = columns.some(
    col => col.fitContent || col.width === 'wrap' || col.width === 'auto' || col.width === 'full'
  )
  const columnStyles: { [key: number]: { cellWidth?: number | 'auto' | 'wrap'; halign?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom' } } = {}

  columns.forEach((col, idx) => {
    let cellWidth: number | 'auto' | 'wrap' | undefined = undefined

    if (col.fitContent || col.width === 'wrap') {
      cellWidth = 'wrap'
    } else if (col.width === 'auto' || col.width === 'full') {
      cellWidth = 'auto'
    } else if (typeof col.width === 'number') {
      if (hasWrapOrAuto) {
        cellWidth = col.width
      } else {
        const totalWeight = columns.reduce((acc, c) => acc + (typeof c.width === 'number' ? c.width : 10), 0)
        cellWidth = ((col.width || 10) / (totalWeight || 1)) * tableWidth
      }
    } else if (!hasWrapOrAuto) {
      const totalWeight = columns.reduce((acc, c) => acc + (typeof c.width === 'number' ? c.width : 10), 0)
      cellWidth = (10 / (totalWeight || 1)) * tableWidth
    }

    columnStyles[idx] = {
      ...(cellWidth !== undefined ? { cellWidth } : {}),
      halign: col.align || 'left',
      valign: col.valign || 'top',
    }
  })

  return {
    fontSize,
    headerFontSize,
    cellPadding,
    columnStyles,
  }
}

export interface DrawReportPdfHeaderOptions {
  doc: jsPDF
  metadata: ReportMetadata
  activeFont: string
  margin?: number
  currentY?: number
}

/**
 * Renders the official Artyx Digital header banner with logo, company identity,
 * store address, phone/email contact, report title, date range, and divider.
 */
export function drawReportPdfHeader(options: DrawReportPdfHeaderOptions): {
  headerBottomY: number
  nextTableStartY: number
} {
  const { doc, metadata, activeFont } = options
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = options.margin ?? 28
  const startY = options.currentY ?? margin

  // Clean currency symbols from metadata (never output ৳ to PDF)
  const safeTitle = (metadata.title || 'Report').replace(/৳/g, 'Tk ')
  const safeSubtitle = metadata.subtitle ? metadata.subtitle.replace(/৳/g, 'Tk ') : ''
  const safeCompanyName = (metadata.companyName || DEFAULT_COMPANY_NAME).replace(/৳/g, 'Tk ')
  const safeOutletName = metadata.outletName ? metadata.outletName.replace(/৳/g, 'Tk ') : ''
  const safeCompanyAddress = (metadata.companyAddress || DEFAULT_COMPANY_ADDRESS).replace(/৳/g, 'Tk ')
  const safeCompanyPhone = (metadata.companyPhone || DEFAULT_COMPANY_PHONE).replace(/৳/g, 'Tk ')
  const safeCompanyEmail = (metadata.companyEmail || DEFAULT_COMPANY_EMAIL).replace(/৳/g, 'Tk ')
  const safeDateRange = metadata.dateRange ? metadata.dateRange.replace(/৳/g, 'Tk ') : ''

  // 1. Draw Company Logo on the top left
  const logoData = resolveLogoDataUrl(metadata.companyLogo)
  const logoHeight = 36
  const logoWidth = 41.3 // 36 * (70 / 61)
  let logoDrawn = false

  if (logoData) {
    try {
      doc.addImage(logoData, 'PNG', margin, startY, logoWidth, logoHeight)
      logoDrawn = true
    } catch (e) {
      console.warn('[PDF] Failed to embed company logo, continuing with text branding', e)
    }
  }

  // 2. Left Column: Store Branding, Outlet & Address
  const brandX = logoDrawn ? margin + logoWidth + 10 : margin
  const availableContentWidth = pageWidth - margin * 2
  const isLandscape = pageWidth > 700
  const maxBrandWidth = availableContentWidth * (isLandscape ? 0.58 : 0.52)

  let leftCursorY = startY + 11

  // Company Name: 13pt bold
  doc.setFont(activeFont, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42) // Slate 900
  doc.text(safeCompanyName, brandX, leftCursorY)

  // Outlet Name (if provided and distinct)
  if (safeOutletName && safeOutletName.toLowerCase() !== safeCompanyName.toLowerCase()) {
    leftCursorY += 10.5
    doc.setFont(activeFont, 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(51, 65, 85) // Slate 700
    doc.text(`Outlet: ${safeOutletName}`, brandX, leftCursorY)
  }

  // Store Address (8pt normal, wrapped)
  if (safeCompanyAddress) {
    leftCursorY += 10
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105) // Slate 600
    const addressLines = doc.splitTextToSize(safeCompanyAddress, maxBrandWidth)
    addressLines.forEach((line: string) => {
      doc.text(line, brandX, leftCursorY)
      leftCursorY += 9.5
    })
  }

  // Contact (Phone & Email)
  const contactParts: string[] = []
  if (safeCompanyPhone) contactParts.push(`Tel: ${safeCompanyPhone}`)
  if (safeCompanyEmail) contactParts.push(`Email: ${safeCompanyEmail}`)
  if (contactParts.length > 0) {
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139) // Slate 500
    doc.text(contactParts.join('   |   '), brandX, leftCursorY)
    leftCursorY += 8
  }

  const leftBottomY = Math.max(startY + logoHeight, leftCursorY)

  // 3. Right Column: Report Title, Subtitle, Period & Generation Details
  const rightX = pageWidth - margin
  let rightCursorY = startY + 11

  // Report Title: 13pt bold
  doc.setFont(activeFont, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42) // Slate 900
  doc.text(safeTitle, rightX, rightCursorY, { align: 'right' })

  // Subtitle (8.5pt normal)
  if (safeSubtitle) {
    rightCursorY += 11
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(71, 85, 105) // Slate 600
    doc.text(safeSubtitle, rightX, rightCursorY, { align: 'right' })
  }

  // Date Range / Period (8.5pt bold)
  if (safeDateRange) {
    rightCursorY += 11
    doc.setFont(activeFont, 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(30, 41, 59) // Slate 800
    doc.text(`Period: ${safeDateRange}`, rightX, rightCursorY, { align: 'right' })
  }

  // Printed by & Generation Timestamp (7.5pt normal)
  rightCursorY += 10
  doc.setFont(activeFont, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139) // Slate 500
  const printedBy = metadata.preparedBy || (metadata as any).printedBy
  const generatedTimestamp =
    metadata.generatedAt ||
    new Date().toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const metaLine = [printedBy ? `Printed by: ${printedBy}` : '', `Generated: ${generatedTimestamp}`]
    .filter(Boolean)
    .join('  |  ')
  doc.text(metaLine, rightX, rightCursorY, { align: 'right' })
  rightCursorY += 8

  // 3b. Optional Summary / Notes Line (e.g. inventory valuation totals)
  let notesHeight = 0
  if (metadata.notes) {
    const safeNotes = metadata.notes.replace(/৳/g, 'Tk ')
    const notesY = Math.max(leftBottomY, rightCursorY) + 4
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(51, 65, 85) // Slate 700
    doc.text(safeNotes, margin, notesY)
    notesHeight = 11
  }

  // 4. Clean divider line
  const headerBottomY = Math.max(leftBottomY, rightCursorY) + notesHeight + 6
  doc.setDrawColor(203, 213, 225) // Slate 300
  doc.setLineWidth(0.75)
  doc.line(margin, headerBottomY, pageWidth - margin, headerBottomY)

  const nextTableStartY = headerBottomY + 10

  return {
    headerBottomY,
    nextTableStartY,
  }
}

/**
 * Generates and downloads or returns a dense, multi-page ledger PDF
 * using jsPDF and jspdf-autotable with Cambria 9pt typography and Tk/BDT formatting.
 */
export async function generatePdfLedger<T = any>(
  options: PdfLedgerOptions<T>
): Promise<{ doc: jsPDF; pageCount: number; durationMs: number }> {
  const startTime = performance.now()
  const {
    data,
    columns,
    metadata,
    fileName,
    format = 'a4',
    currencyMode = 'prefix',
    embeddedLogs,
  } = options

  // Fix 14: Default orientation switches to landscape when columns >= 6
  const effectiveOrientation = options.orientation || (columns.length >= 6 ? 'landscape' : 'portrait')

  // 1. Row count safeguard check
  if (data.length > DEFAULT_ROW_COUNT_SAFEGUARD) {
    console.warn(
      `[generatePdfLedger] Dataset contains ${data.length} rows, which exceeds safeguard threshold (${DEFAULT_ROW_COUNT_SAFEGUARD}). Generation may take several seconds.`
    )
  }

  // 2. Initialize jsPDF
  const doc = new jsPDF({
    orientation: effectiveOrientation,
    unit: 'pt',
    format,
  })

  // Fix 14: Load Cambria font with 'times' fallback
  const activeFont = await setupPdfFont(doc)

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 28
  const tableWidth = pageWidth - margin * 2

  // 3. Render Top Branded Header with Logo and Address
  const { nextTableStartY } = drawReportPdfHeader({
    doc,
    metadata,
    activeFont,
    margin,
    currentY: margin,
  })
  let currentY = nextTableStartY

  // 4. Calculate dynamic column widths and font scaling
  const { fontSize, headerFontSize, cellPadding, columnStyles } = calculateDynamicColumnStyles(
    columns,
    tableWidth
  )

  // 5. Prepare Table Headers and Body
  const headers = columns.map(c => c.header)
  const body = data.map((row, rowIdx) => {
    return columns.map(col => {
      // Use shared formatter ensuring byte-identical values with visual pipeline
      return formatCellValue(
        {
          ...col,
          currencyOptions: {
            mode: currencyMode,
            ...col.currencyOptions,
          },
        },
        row,
        rowIdx,
        'pdf'
      )
    })
  })

  // 6. Execute autotable with Pure White styling and explicit light gray strokes
  const foot = options.foot || (options.totals ? [
    columns.map(col => {
      const val = options.totals?.[col.key as string]
      if (val === undefined || val === null) return ''
      return formatCellValue(
        {
          ...col,
          currencyOptions: {
            mode: currencyMode,
            ...col.currencyOptions,
          },
        },
        options.totals as any,
        0,
        'pdf'
      )
    })
  ] : undefined)

  const safeTitle = (metadata.title || 'Report').replace(/৳/g, 'Tk ')
  const safeCompanyName = (metadata.companyName || DEFAULT_COMPANY_NAME).replace(/৳/g, 'Tk ')

  const autoTableFn = (autoTable as any).default || autoTable
  autoTableFn(doc, {
    head: [headers],
    body,
    ...(foot ? { foot } : {}),
    footStyles: {
      fillColor: [248, 250, 252],
      textColor: [15, 23, 42],
      font: activeFont,
      fontStyle: 'bold',
      fontSize: 9,
      lineColor: [203, 213, 225],
      lineWidth: 0.75,
      valign: 'top',
    },
    startY: currentY,
    margin: { top: 40, right: margin, bottom: 32, left: margin },
    tableWidth: 'auto',
    theme: 'plain',
    styles: {
      font: activeFont,
      fontSize: 9,
      cellPadding,
      overflow: 'linebreak',
      textColor: [26, 26, 26], // High contrast dark text #1a1a1a
      fillColor: [255, 255, 255], // Pure white background
      lineColor: [226, 232, 240], // Light grey row strokes #e2e8f0
      lineWidth: 0.5,
      valign: 'top',
    },
    headStyles: {
      fillColor: [248, 250, 252], // Subtle light header background #f8fafc
      textColor: [15, 23, 42], // Slate 900 bold
      font: activeFont,
      fontStyle: 'bold',
      fontSize: 9,
      lineColor: [203, 213, 225], // Slate 300 border
      lineWidth: 0.75,
      valign: 'middle',
    },
    bodyStyles: {
      valign: 'top',
    },
    columnStyles,
    alternateRowStyles: {
      fillColor: [255, 255, 255], // Enforce white background on all rows
    },
    didDrawPage: data => {
      // Optional header repeater on subsequent pages
      if (data.pageNumber > 1) {
        doc.setFont(activeFont, 'normal')
        doc.setFontSize(9)
        doc.setTextColor(148, 163, 184)
        doc.text(
          `${safeTitle}  |  ${safeCompanyName}`,
          margin,
          24
        )
      }
    },
  } as UserOptions)

  // 7. Optional Embedded Transaction Logs Section
  if (embeddedLogs && embeddedLogs.length > 0) {
    const finalY = (doc as any).lastAutoTable?.finalY ?? currentY + 40
    let logY = finalY + 16

    if (logY + 60 > pageHeight - 32) {
      doc.addPage()
      logY = 40
    }

    doc.setFont(activeFont, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text('Embedded Transaction & Audit Tokens', margin, logY)
    logY += 10

    const logRows = embeddedLogs.map(l => [l.token, l.message, l.timestamp || '—'])
    autoTableFn(doc, {
      head: [['Token / Hash', 'Event Description', 'Timestamp']],
      body: logRows,
      startY: logY,
      margin: { top: 32, right: margin, bottom: 32, left: margin },
      theme: 'plain',
      styles: {
        font: 'courier',
        fontSize: 7.5,
        cellPadding: 3,
        textColor: [15, 23, 42],
        fillColor: [255, 255, 255],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        font: activeFont,
        fontStyle: 'bold',
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontSize: 8,
      },
    } as UserOptions)
  }

  // 8. Fixed Footer ("Page X of Y" + Timestamp) across all pages
  const totalPages = (doc as any).getNumberOfPages
    ? (doc as any).getNumberOfPages()
    : (doc.internal as any).pages
    ? (doc.internal as any).pages.length - 1
    : 1
  const generatedTimestamp = metadata.generatedAt || new Date().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139) // Slate 500

    // Left footer: generated timestamp & company
    const leftText = `Generated: ${generatedTimestamp}  |  ${safeCompanyName}${metadata.outletName ? ` (${metadata.outletName})` : ''}`
    doc.text(leftText, margin, pageHeight - 16)

    // Right footer: Page X of Y
    const rightText = `Page ${i} of ${totalPages}`
    doc.text(rightText, pageWidth - margin, pageHeight - 16, { align: 'right' })

    // Footer divider line
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.5)
    doc.line(margin, pageHeight - 26, pageWidth - margin, pageHeight - 26)
  }

  // 9. Auto-save if in browser environment
  if (typeof window !== 'undefined') {
    const rawName = (
      fileName || `${metadata.title.toLowerCase().replace(/\s+/g, '-')}-ledger`
    ).replace(/\.pdf$/i, '')
    const safeName = rawName.replace(/[^a-zA-Z0-9-_]/g, '') || 'report-ledger'
    doc.save(`${safeName}.pdf`)
  }

  const durationMs = performance.now() - startTime
  return { doc, pageCount: totalPages, durationMs }
}
