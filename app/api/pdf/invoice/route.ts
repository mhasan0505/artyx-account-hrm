import { prisma } from '@/lib/db'
import { verifyPdfToken } from '@/lib/security/pdf-token'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') as 'sale' | 'purchase' | null
  const id = searchParams.get('id')
  const token = searchParams.get('token')

  // 1. Strict Parameter & Security Check
  if (!type || (type !== 'sale' && type !== 'purchase') || !id || !token) {
    return NextResponse.json(
      { error: 'Missing or invalid authorization parameters' },
      { status: 401 }
    )
  }

  // 2. HMAC Token & Expiration Validation (Cross-type isolation checked here)
  const isValid = verifyPdfToken(type, id, token)
  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid or expired PDF access token' },
      { status: 401 }
    )
  }

  // 3. Fetch Data & Build PDF (Bypasses session check since token is cryptographically verified)
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    if (type === 'sale') {
      const sale = await prisma.sale.findUnique({
        where: { id },
        select: {
          id: true,
          saleNumber: true,
          subtotal: true,
          discountAmt: true,
          taxAmt: true,
          total: true,
          amountPaid: true,
          changeDue: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address: true,
            },
          },
          outlet: {
            select: {
              id: true,
              name: true,
              slogan: true,
              address: true,
              phone: true,
              email: true,
            },
          },
          lines: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              discountPct: true,
              discountAmt: true,
              total: true,
              isGift: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  processor: { select: { name: true } },
                  processorGen: { select: { name: true } },
                  ram: { select: { name: true } },
                  storage: { select: { name: true } },
                  display: true,
                },
              },
              serials: {
                select: {
                  serialUnit: {
                    select: {
                      id: true,
                      serialNumber: true,
                      sellingPrice: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!sale) {
        return NextResponse.json({ error: 'Sales invoice not found' }, { status: 404 }) } const lineNotes = await prisma.$queryRaw<Array<{ id: string; note: string | null }>>`SELECT id, "note" FROM "SaleLine" WHERE "saleId" = ${sale.id}`; const noteMap = new Map(lineNotes.map(r => [r.id, r.note])); sale.lines.forEach((l: any) => { l.note = noteMap.get(l.id) ?? l.note ?? null }); if (false) {
      }

      const termsSetting = await prisma.setting.findFirst({
        where: {
          key: {
            in: [
              `invoice_terms_sales_${sale.outlet.id}`,
              `invoice_terms_${sale.outlet.id}`,
            ],
          },
        },
      })
      const terms = termsSetting?.value ?? ''

      // Header
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(sale.outlet.name || 'Artyx Digital', 14, 18)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(sale.outlet.address || '', 14, 24)
      doc.text(`Phone: ${sale.outlet.phone || 'N/A'}`, 14, 29)

      // Title & Invoice Info
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('SALES INVOICE', 140, 18)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`Invoice #: ${sale.saleNumber}`, 140, 24)
      doc.text(`Date: ${new Date(sale.createdAt).toLocaleDateString('en-GB')}`, 140, 29)
      doc.text(`Customer: ${sale.customer?.name || 'Walk-In Customer'}`, 140, 34)

      doc.setDrawColor(220, 220, 220)
      doc.line(14, 38, 196, 38)

      const formatProductName = (p: any) => {
        if (!p) return ''
        const baseName = String(p.name ?? '').trim()
        if (baseName.includes('|')) return baseName
        const cpuParts: string[] = []
        if (p.processor?.name) cpuParts.push(p.processor.name.trim())
        if (p.processorGen?.name && (!p.processor?.name || !p.processor.name.toLowerCase().includes(p.processorGen.name.toLowerCase()))) {
          cpuParts.push(p.processorGen.name.trim())
        }
        const cpu = cpuParts.join(' ')
        const ram = p.ram?.name
          ? p.ram.name.toUpperCase().includes('RAM')
            ? p.ram.name.trim()
            : `${p.ram.name.trim()} RAM`
          : null
        const storage = p.storage?.name
          ? p.storage.name.toUpperCase().includes('SSD') || p.storage.name.toUpperCase().includes('HDD')
            ? p.storage.name.trim()
            : `${p.storage.name.trim()} SSD`
          : null
        const display = p.display ? p.display.trim() : null
        return [baseName, cpu, ram, storage, display].filter(Boolean).join(' | ')
      }

      // Table Lines
      const rawRows = sale.lines.map(line => {
        const itemTitle = formatProductName(line.product)
        const lineNote = (line as any).note ? String((line as any).note).trim() : ''
        const serials = line.serials.map(s => s.serialUnit.serialNumber)
        const unitPrice = Number(line.unitPrice)
        const discount =
          Number((line as any).discountAmt ?? 0) > 0
            ? Number((line as any).discountAmt)
            : Number(line.unitPrice) * line.quantity - Number(line.total)
        const total = Number(line.total)

        return {
          itemTitle,
          lineNote,
          serials,
          quantity: line.quantity,
          unitPrice,
          discount,
          total,
        }
      })

      const consolidatedPdfRows: typeof rawRows = []
      const pdfGroupMap = new Map<string, number>()
      for (const row of rawRows) {
        const key = `${row.itemTitle}__${row.unitPrice}`
        if (pdfGroupMap.has(key)) {
          const idx = pdfGroupMap.get(key)!
          const target = consolidatedPdfRows[idx]
          target.quantity += row.quantity
          target.discount += row.discount
          target.total += row.total
          target.serials = Array.from(new Set([...target.serials, ...row.serials]))
        } else {
          pdfGroupMap.set(key, consolidatedPdfRows.length)
          consolidatedPdfRows.push({ ...row, serials: [...row.serials] })
        }
      }

      const tableRows = consolidatedPdfRows.map((row, idx) => {
        const serialsStr = row.serials.join(', ')
        const noteLine = row.lineNote ? `Note: ${row.lineNote}\n` : ''
        const desc = serialsStr
          ? `${row.itemTitle}\n${noteLine}Serials: ${serialsStr}`
          : row.lineNote
            ? `${row.itemTitle}\n${noteLine.trim()}`
            : row.itemTitle

        return [
          (idx + 1).toString(),
          desc,
          row.quantity.toString(),
          `BDT ${row.unitPrice.toFixed(2)}`,
          `BDT ${row.discount.toFixed(2)}`,
          `BDT ${row.total.toFixed(2)}`,
        ]
      })

      autoTable(doc, {
        head: [['#', 'Item Description', 'Qty', 'Unit Price', 'Discount', 'Total']],
        body: tableRows,
        startY: 42,
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      })

      // Financial Totals
      const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 120
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(`Subtotal: BDT ${Number(sale.subtotal).toFixed(2)}`, 140, finalY)
      doc.text(`Discount: BDT ${Number(sale.discountAmt).toFixed(2)}`, 140, finalY + 5)
      doc.text(`Grand Total: BDT ${Number(sale.total).toFixed(2)}`, 140, finalY + 10)
      doc.text(`Paid Amount: BDT ${Number(sale.amountPaid).toFixed(2)}`, 140, finalY + 15)

      if (terms) {
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.text(`Terms: ${terms.slice(0, 150)}`, 14, finalY + 25)
      }
    } else {
      // Purchase Invoice
      const inv = await prisma.purchaseInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          amountPaid: true,
          createdAt: true,
          supplier: {
            select: {
              id: true,
              name: true,
              phone: true,
              address: true,
            },
          },
          po: {
            select: {
              id: true,
              orderDate: true,
              supplier: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  address: true,
                },
              },
              outlet: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                  phone: true,
                },
              },
              lines: {
                select: {
                  id: true,
                  quantity: true,
                  unitCost: true,
                  total: true,
                  product: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!inv) {
        return NextResponse.json({ error: 'Purchase invoice not found' }, { status: 404 })
      }

      const partyInfo = inv.po?.supplier ?? inv.supplier

      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(inv.po?.outlet?.name || 'Artyx Digital', 14, 18)

      doc.setFontSize(14)
      doc.text('PURCHASE INVOICE', 140, 18)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`Invoice #: ${inv.invoiceNumber}`, 140, 24)
      doc.text(`Date: ${new Date(inv.po?.orderDate ?? inv.createdAt).toLocaleDateString('en-GB')}`, 140, 29)
      doc.text(`Supplier: ${partyInfo?.name || 'N/A'}`, 140, 34)

      doc.setDrawColor(220, 220, 220)
      doc.line(14, 38, 196, 38)

      const purchaseLines = (inv.po?.lines ?? []).map((line: any, idx: number) => [
        (idx + 1).toString(),
        line.product?.name || 'Item',
        line.quantity.toString(),
        `BDT ${Number(line.unitCost ?? 0).toFixed(2)}`,
        `BDT ${Number(line.total).toFixed(2)}`,
      ])

      autoTable(doc, {
        head: [['#', 'Item Description', 'Qty', 'Unit Cost', 'Total']],
        body: purchaseLines,
        startY: 42,
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      })

      const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 120
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(`Total Amount: BDT ${Number(inv.total).toFixed(2)}`, 140, finalY)
      doc.text(`Paid Amount: BDT ${Number(inv.amountPaid).toFixed(2)}`, 140, finalY + 5)
    }

    const pdfArrayBuffer = doc.output('arraybuffer')

    return new Response(pdfArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${type}_invoice_${id}.pdf"`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (err: any) {
    console.error('[API:PDF:Invoice] Error rendering PDF:', err)
    return NextResponse.json({ error: err.message || 'Failed to render PDF' }, { status: 500 })
  }
}
