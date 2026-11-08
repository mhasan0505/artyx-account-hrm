import type jsPDF from 'jspdf'

let cachedRegularBase64: string | null = null
let cachedBoldBase64: string | null = null
let fontLoadAttempted = false

/**
 * Loads and registers Cambria serif font (regular and bold) into a jsPDF instance.
 * Font files are never kept in public/ (not publicly downloadable).
 * They are loaded via dynamic import of a generated base64 module in lib/pdf/fonts/.
 *
 * Bold is registered from the bold file/base64.
 * Until cambria-regular.ttf and cambria-bold.ttf are supplied, it falls back to 'times'.
 *
 * @param doc jsPDF document instance
 * @returns The active font family name ('Cambria' or 'times')
 */
export async function setupPdfFont(doc: jsPDF): Promise<string> {
  try {
    if (!fontLoadAttempted) {
      fontLoadAttempted = true

      // 1. Dynamic import of generated base64 module from lib/pdf/fonts/cambria-base64
      try {
        const fontModule = (await import('@/lib/pdf/fonts/cambria-base64')) as any
        if (fontModule?.cambriaRegularBase64) {
          cachedRegularBase64 = fontModule.cambriaRegularBase64
        }
        if (fontModule?.cambriaBoldBase64) {
          cachedBoldBase64 = fontModule.cambriaBoldBase64
        }
      } catch {
        // Module not generated/supplied yet
      }

      // 2. Server-side / Node.js fallback: check local non-public files in lib/pdf/fonts/
      if (typeof window === 'undefined') {
        try {
          const fs = await import('fs')
          const path = await import('path')
          const fontsDir = path.join(process.cwd(), 'lib', 'pdf', 'fonts')
          const regPath = path.join(fontsDir, 'cambria-regular.ttf')
          const boldPath = path.join(fontsDir, 'cambria-bold.ttf')

          if (!cachedRegularBase64 && fs.existsSync(regPath)) {
            cachedRegularBase64 = fs.readFileSync(regPath).toString('base64')
          }
          if (!cachedBoldBase64 && fs.existsSync(boldPath)) {
            cachedBoldBase64 = fs.readFileSync(boldPath).toString('base64')
          }
        } catch {
          // Ignore Node.js fs error, fall back to times
        }
      }
    }

    // Must have regular font available to register Cambria; if bold is available, register from bold file
    if (cachedRegularBase64) {
      doc.addFileToVFS('Cambria-Regular.ttf', cachedRegularBase64)
      doc.addFont('Cambria-Regular.ttf', 'Cambria', 'normal')

      if (cachedBoldBase64) {
        doc.addFileToVFS('Cambria-Bold.ttf', cachedBoldBase64)
        doc.addFont('Cambria-Bold.ttf', 'Cambria', 'bold')
      } else {
        doc.addFont('Cambria-Regular.ttf', 'Cambria', 'bold')
      }

      doc.setFont('Cambria', 'normal')
      return 'Cambria'
    }
  } catch (err) {
    console.warn('[setupPdfFont] Falling back to "times":', err)
  }

  doc.setFont('times', 'normal')
  return 'times'
}

/**
 * Synchronous font setup fallback if cached font is already loaded,
 * otherwise returns 'times'.
 */
export function setupPdfFontSync(doc: jsPDF): string {
  try {
    if (cachedRegularBase64) {
      doc.addFileToVFS('Cambria-Regular.ttf', cachedRegularBase64)
      doc.addFont('Cambria-Regular.ttf', 'Cambria', 'normal')
      if (cachedBoldBase64) {
        doc.addFileToVFS('Cambria-Bold.ttf', cachedBoldBase64)
        doc.addFont('Cambria-Bold.ttf', 'Cambria', 'bold')
      } else {
        doc.addFont('Cambria-Regular.ttf', 'Cambria', 'bold')
      }
      doc.setFont('Cambria', 'normal')
      return 'Cambria'
    }
  } catch {
    // Ignore and fallback
  }

  doc.setFont('times', 'normal')
  return 'times'
}
