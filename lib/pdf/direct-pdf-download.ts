'use client'

import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

export interface DirectPdfDownloadOptions {
  element: HTMLElement | null
  fileName?: string
  scale?: number
  quality?: number
}

/**
 * Converts CIE-Lab (D65) color to sRGB values [0-255, 0-255, 0-255]
 */
function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const y = (l + 16) / 116
  const x = a / 500 + y
  const z = y - b / 200

  const fn = (t: number) =>
    t > 0.2068966 ? Math.pow(t, 3) : (t - 16 / 116) / 7.787

  const X = 0.95047 * fn(x)
  const Y = 1.0 * fn(y)
  const Z = 1.08883 * fn(z)

  let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986
  let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415
  let bl = X * 0.0557 + Y * -0.204 + Z * 1.057

  const gamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055

  return [
    Math.min(255, Math.max(0, Math.round(gamma(r) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(g) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(bl) * 255))),
  ]
}

/**
 * Converts OKLCH color to sRGB values [0-255, 0-255, 0-255]
 */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  let r = +4.0767434772 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  const gamma = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055

  return [
    Math.min(255, Math.max(0, Math.round(gamma(r) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(g) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(bl) * 255))),
  ]
}

/**
 * Normalizes modern CSS color functions (like lab() and oklch() produced by Tailwind v4)
 * into standard rgb() or rgba() that html2canvas can safely parse.
 */
function normalizeColorToRgb(colorStr: string): string {
  if (!colorStr) return ''
  const trimmed = colorStr.trim()
  if (!trimmed.includes('lab(') && !trimmed.includes('oklch(')) {
    return trimmed
  }

  // 1. Try native browser 2D canvas normalization
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#000000'
      ctx.fillStyle = trimmed
      const normalized = ctx.fillStyle
      if (
        normalized &&
        !normalized.includes('lab(') &&
        !normalized.includes('oklch(')
      ) {
        return normalized
      }
    }
  } catch {
    // Canvas conversion fallback below
  }

  // 2. Parse lab(L a b / alpha)
  const labMatch = trimmed.match(
    /lab\(\s*([\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i
  )
  if (labMatch) {
    const l = parseFloat(labMatch[1])
    const a = parseFloat(labMatch[2])
    const b = parseFloat(labMatch[3])
    const alphaStr = labMatch[4]
    const alpha = alphaStr
      ? alphaStr.endsWith('%')
        ? parseFloat(alphaStr) / 100
        : parseFloat(alphaStr)
      : 1
    const [r, g, bl] = labToRgb(l, a, b)
    return alpha < 1
      ? `rgba(${r}, ${g}, ${bl}, ${alpha})`
      : `rgb(${r}, ${g}, ${bl})`
  }

  // 3. Parse oklch(L C H / alpha)
  const oklchMatch = trimmed.match(
    /oklch\(\s*([\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i
  )
  if (oklchMatch) {
    let l = parseFloat(oklchMatch[1])
    if (oklchMatch[1].endsWith('%')) l = l / 100
    else if (l > 1) l = l / 100
    const c = parseFloat(oklchMatch[2])
    const h = parseFloat(oklchMatch[3])
    const alphaStr = oklchMatch[4]
    const alpha = alphaStr
      ? alphaStr.endsWith('%')
        ? parseFloat(alphaStr) / 100
        : parseFloat(alphaStr)
      : 1
    const [r, g, bl] = oklchToRgb(l, c, h)
    return alpha < 1
      ? `rgba(${r}, ${g}, ${bl}, ${alpha})`
      : `rgb(${r}, ${g}, ${bl})`
  }

  return 'rgb(0, 0, 0)'
}

/**
 * Direct PDF Download utility
 * Captures an HTML invoice/document element and downloads it directly as a crisp,
 * high-resolution A4 PDF across all modern desktop and mobile browsers.
 */
export async function downloadElementAsPdf({
  element,
  fileName = 'Invoice',
  scale = 2,
  quality = 0.98,
}: DirectPdfDownloadOptions): Promise<{ success: boolean; error?: string }> {
  if (!element) {
    return { success: false, error: 'Document element not found' }
  }

  // Target the core invoice element if a container wrapper was passed
  const target =
    (element.querySelector('.sales-invoice-root') as HTMLElement) ||
    (element.querySelector('.a4-invoice-container') as HTMLElement) ||
    (element.querySelector('.invoice-shell') as HTMLElement) ||
    (element.querySelector('.a4-voucher-root') as HTMLElement) ||
    (element.querySelector('.voucher-page-container') as HTMLElement) ||
    (element.querySelector('#supplier-statement-print') as HTMLElement) ||
    element

  try {
    // 1. Temporarily hide any toolbar/action items if nested
    const ignoredElements = target.querySelectorAll<HTMLElement>(
      '.no-print, .print\\:hidden, button'
    )
    const prevVisibilities: string[] = []
    ignoredElements.forEach((el, i) => {
      prevVisibilities[i] = el.style.visibility
      el.style.visibility = 'hidden'
    })

    // 2. Render element to high-res canvas (scale 2 = 300 DPI clarity)
    const canvas = await html2canvas(target, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 1200,
      scrollY: 0,
      scrollX: 0,
      imageTimeout: 15000,
      onclone: (clonedDoc, clonedElement) => {
        // Enforce solid white root surfaces
        if (clonedDoc.documentElement) {
          clonedDoc.documentElement.style.backgroundColor = '#ffffff'
        }
        if (clonedDoc.body) {
          clonedDoc.body.style.backgroundColor = '#ffffff'
          clonedDoc.body.style.margin = '0'
          clonedDoc.body.style.padding = '0'
        }

        const clonedTarget = (clonedElement ||
          clonedDoc.querySelector(
            '.sales-invoice-root, .a4-invoice-container, .invoice-shell, .a4-voucher-root, .voucher-page-container, #supplier-statement-print'
          ) ||
          clonedDoc.getElementById('a4-invoice-container')) as HTMLElement | null

        if (clonedTarget) {
          // Un-pad immediate parent container if needed so invoice is not constricted
          if (clonedTarget.parentElement) {
            clonedTarget.parentElement.style.padding = '0'
            clonedTarget.parentElement.style.margin = '0 auto'
            clonedTarget.parentElement.style.overflow = 'visible'
          }

          // Force exact A4 dimensions on target (210mm at 96 DPI = 794px)
          clonedTarget.style.width = '794px'
          clonedTarget.style.minWidth = '794px'
          clonedTarget.style.maxWidth = '794px'
          clonedTarget.style.boxSizing = 'border-box'
          clonedTarget.style.boxShadow = 'none'
          clonedTarget.style.margin = '0 auto'
          clonedTarget.style.backgroundColor = '#ffffff'
          clonedTarget.style.minHeight = 'auto'
        }

        // Sanitize every cloned element against Tailwind v4 lab() / oklch() color crash
        const colorProperties = [
          'color',
          'background-color',
          'border-top-color',
          'border-right-color',
          'border-bottom-color',
          'border-left-color',
          'outline-color',
          'text-decoration-color',
        ]

        const allClonedElements = clonedDoc.querySelectorAll<HTMLElement>('*')
        allClonedElements.forEach((el) => {
          try {
            const cs = window.getComputedStyle(el)
            for (const prop of colorProperties) {
              const val = cs.getPropertyValue(prop)
              if (val && (val.includes('lab(') || val.includes('oklch('))) {
                const normalized = normalizeColorToRgb(val)
                el.style.setProperty(prop, normalized, 'important')
              }
            }
          } catch {
            // Ignore sub-tree style access errors
          }
        })
      },
    })

    // 3. Restore visibility of any hidden elements
    ignoredElements.forEach((el, i) => {
      el.style.visibility = prevVisibilities[i] || ''
    })

    // 4. Validate canvas dimensions and calculate exact A4 dimensions
    if (!canvas || !canvas.width || !canvas.height) {
      return { success: false, error: 'Document canvas rendering failed' }
    }

    const imgWidth = 210 // mm
    const pageHeight = 297 // mm
    const rawImgHeight = (canvas.height * imgWidth) / canvas.width
    const imgHeight = isNaN(rawImgHeight) || rawImgHeight <= 0 ? pageHeight : rawImgHeight

    // 5. Initialize jsPDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    })

    const imgData = canvas.toDataURL('image/jpeg', quality)

    // Allow 3mm subpixel tolerance so standard 1-page documents never add an accidental empty page
    if (imgHeight <= pageHeight + 3) {
      // Single A4 sheet (standard for POS/Sales invoices)
      const renderHeight = Math.min(imgHeight, pageHeight)
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, renderHeight, undefined, 'FAST')
    } else {
      // Multi-page handling if invoice has dozens of line items
      let heightLeft = imgHeight
      let position = 0

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
      heightLeft -= pageHeight

      while (heightLeft > 0) {
        position -= pageHeight
        pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
        heightLeft -= pageHeight
      }
    }

    // 6. Direct file download
    const sanitizedName = (fileName || 'Invoice')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .trim()
    const finalFileName = sanitizedName.toLowerCase().endsWith('.pdf')
      ? sanitizedName
      : `${sanitizedName}.pdf`

    pdf.save(finalFileName)

    return { success: true }
  } catch (err: any) {
    console.error('Failed to export PDF:', err)
    return {
      success: false,
      error: err?.message || 'Failed to generate PDF document',
    }
  }
}
