import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { verifyPdfToken } from '@/lib/security/pdf-token'
import { auth } from '@/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, AlertCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ saleId: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function PublicReceiptPage({ params, searchParams }: Props) {
  const { saleId } = await params
  const { token } = await searchParams

  const isValidToken = verifyPdfToken('sale', saleId, token)

  if (!isValidToken) {
    // Check if authenticated staff is viewing
    const session = await auth()
    if (session?.user) {
      redirect(`/sales-orders/invoices/${saleId}`)
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg border-red-100">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-2">
              <AlertCircle className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-800">
              Invalid or Expired Link
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-slate-600 space-y-4">
            <p>
              This receipt link is either invalid or has expired for security reasons.
            </p>
            <p className="text-xs text-slate-500">
              If you are a customer, please contact the store to request a new receipt link.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      outlet: {
        select: {
          name: true,
          address: true,
          phone: true,
          email: true,
        },
      },
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              name: true,
              processor: { select: { name: true } },
              processorGen: { select: { name: true } },
              ram: { select: { name: true } },
              storage: { select: { name: true } },
              display: true,
            },
          },
          serials: {
            include: {
              serialUnit: {
                select: {
                  serialNumber: true,
                  warrantyExpiry: true,
                },
              },
            },
          },
        },
      },
      payments: {
        select: {
          id: true,
          method: true,
          amount: true,
        },
      },
    },
  })

  if (!sale) notFound(); const lineNotes = await prisma.$queryRaw<Array<{ id: string; note: string | null }>>`SELECT id, "note" FROM "SaleLine" WHERE "saleId" = ${sale.id}`; const noteMap = new Map(lineNotes.map(r => [r.id, r.note])); sale.lines.forEach((l: any) => { l.note = noteMap.get(l.id) ?? l.note ?? null })

  const formattedDate = new Date(sale.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 flex justify-center items-start">
      <div className="w-full max-w-xl bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {sale.outlet?.name || 'Customer Receipt'}
              </h1>
              {sale.outlet?.address && (
                <p className="text-xs text-slate-300 mt-1 max-w-xs">{sale.outlet.address}</p>
              )}
              {sale.outlet?.phone && (
                <p className="text-xs text-slate-300">Tel: {sale.outlet.phone}</p>
              )}
            </div>
            <div className="text-right">
              <Badge variant="outline" className="bg-emerald-500/20 text-emerald-300 border-emerald-400/40 text-xs px-2 py-0.5">
                <CheckCircle2 className="w-3 h-3 mr-1 inline" /> Paid
              </Badge>
              <p className="text-xs font-mono text-slate-400 mt-2">#{sale.saleNumber}</p>
              <p className="text-xs text-slate-400">{formattedDate}</p>
            </div>
          </div>
        </div>

        {/* Customer Info */}
        {sale.customer && (
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 text-xs text-slate-600 flex justify-between">
            <span>Customer: <strong className="text-slate-800">{sale.customer.name}</strong></span>
            {sale.customer.phone && <span>Phone: {sale.customer.phone}</span>}
          </div>
        )}

        {/* Items List */}
        <div className="p-6 space-y-4">
          <div className="border rounded-lg overflow-hidden border-slate-200">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-2 text-center">Qty</th>
                  <th className="py-2.5 px-2 text-right">Price</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.lines.map((line) => {
                  const p = line.product as any
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
                  const baseName = String(p.name ?? '').trim()
                  const fullName = baseName.includes('|')
                    ? baseName
                    : [baseName, cpu, ram, storage, display].filter(Boolean).join(' | ')

                  return (
                    <tr key={line.id} className="text-slate-800">
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-slate-900">{fullName}</p>{(line as any).note && String((line as any).note).trim() && (<div className="my-1 px-1.5 py-0.5 rounded bg-blue-50 border-l-2 border-blue-600 text-[11px] font-semibold text-blue-900">Note: {(line as any).note}</div>)}
                      {line.serials && line.serials.length > 0 && (
                        <div className="text-[11px] text-slate-500 space-y-0.5 mt-0.5 font-mono">
                          {line.serials.map((s, idx) => (
                            <div key={idx}>
                              S/N: {s.serialUnit.serialNumber}
                              {s.serialUnit.warrantyExpiry && (
                                <span className="text-emerald-600 ml-1">
                                  (Warranty: {new Date(s.serialUnit.warrantyExpiry).toLocaleDateString('en-GB')})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-600">{line.quantity}</td>
                    <td className="py-2.5 px-2 text-right text-slate-600">৳{Number(line.unitPrice).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-medium">৳{Number(line.total).toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="space-y-1.5 pt-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-medium text-slate-800">৳{Number(sale.subtotal).toLocaleString()}</span>
            </div>
            {Number(sale.discountAmt) > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount:</span>
                <span>-৳{Number(sale.discountAmt).toLocaleString()}</span>
              </div>
            )}
            {Number(sale.taxAmt) > 0 && (
              <div className="flex justify-between">
                <span>Tax / VAT:</span>
                <span>৳{Number(sale.taxAmt).toLocaleString()}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex justify-between text-base font-bold text-slate-900 pt-1">
              <span>Grand Total:</span>
              <span>৳{Number(sale.total).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500 pt-1">
              <span>Amount Paid:</span>
              <span>৳{Number(sale.amountPaid).toLocaleString()}</span>
            </div>
            {Number(sale.changeDue) > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Change Returned:</span>
                <span>৳{Number(sale.changeDue).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Payment methods */}
          {sale.payments.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 border border-slate-100">
              <span className="font-semibold text-slate-700">Payment Breakdown:</span>
              <div className="mt-1 space-y-1">
                {sale.payments.map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>{p.method.replace('_', ' ')}:</span>
                    <span>৳{Number(p.amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center pt-6 border-t border-slate-100 text-xs text-slate-400">
            <p className="font-medium text-slate-600">Thank you for your business!</p>
            <p className="mt-1">Please preserve this receipt for warranty and return claims.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
