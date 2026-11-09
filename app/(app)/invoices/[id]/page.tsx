import { notFound } from 'next/navigation'
import { getAgencyInvoiceById } from '@/lib/actions/agency-invoices'
import { prisma } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RecordPaymentModal } from '@/components/agency/payment-modal'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Printer,
  Receipt,
} from 'lucide-react'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const invoice = await getAgencyInvoiceById(id)
  if (!invoice) {
    notFound()
  }

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
    },
  })

  const due = Number(invoice.dueAmount)

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Top Action Bar (hidden on print) */}
      <div className="flex justify-between items-center print:hidden border-b border-border pb-4">
        <Link href="/invoices">
          <Button size="sm" variant="outline" className="border-border text-foreground hover:bg-muted">
            <ArrowLeft className="size-4 mr-1.5" />
            Back to Invoices
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          {due > 0 && (
            <RecordPaymentModal
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              clientName={invoice.client.companyName}
              dueAmount={due}
              bankAccounts={bankAccounts}
            />
          )}

          <Link href={`/clients/${invoice.clientId}`}>
            <Button size="sm" variant="outline" className="border-border text-foreground hover:bg-muted">
              Client Profile
            </Button>
          </Link>
        </div>
      </div>

      {/* Printable Invoice Container */}
      <div className="bg-card print:bg-white text-card-foreground print:text-black border border-border/80 print:border-none rounded-2xl p-6 md:p-10 shadow-2xl space-y-8 artyx-card">
        {/* Header: Brand & Invoice Meta */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-border print:border-slate-200 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="size-10 rounded-lg bg-muted border border-border flex items-center justify-center p-1.5 shrink-0">
                <Image
                  src="/artyx-icon.svg"
                  alt="Artyx Digital"
                  width={32}
                  height={32}
                  unoptimized
                  className="size-full object-contain"
                />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-foreground print:text-black tracking-tight leading-none">
                  Artyx Digital
                </h2>
                <span className="text-[10px] font-mono font-semibold uppercase text-primary print:text-emerald-700 tracking-wider">
                  Software & Digital Marketing Agency
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground print:text-slate-600 max-w-xs leading-relaxed">
              Dhaka, Bangladesh · admin@artyxdigital.com · https://artyxdigital.com
            </p>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <div className="flex sm:justify-end items-center gap-2">
              <h1 className="text-2xl font-black font-mono text-foreground print:text-black">INVOICE</h1>
              <Badge
                className={
                  invoice.status === 'PAID'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs'
                    : invoice.status === 'PARTIAL'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs'
                      : 'bg-primary/10 text-primary dark:bg-lime/15 dark:text-lime border-primary/30 text-xs'
                }
              >
                {invoice.status}
              </Badge>
            </div>
            <p className="text-sm font-mono font-bold text-primary print:text-emerald-700">
              {invoice.invoiceNumber}
            </p>
            <div className="text-xs text-muted-foreground print:text-slate-600 space-y-0.5 pt-1">
              <div>Issue Date: {new Date(invoice.issueDate).toLocaleDateString()}</div>
              <div>Due Date: {new Date(invoice.dueDate).toLocaleDateString()}</div>
              {invoice.paymentTerms && <div>Terms: {invoice.paymentTerms}</div>}
            </div>
          </div>
        </div>

        {/* Billed To & Project Information */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          <div className="space-y-1.5 bg-muted/50 print:bg-slate-50 p-4 rounded-xl border border-border print:border-slate-200">
            <span className="text-[10px] font-mono uppercase tracking-wider text-primary print:text-emerald-700 font-bold">
              Billed To:
            </span>
            <p className="text-sm font-bold text-foreground print:text-black">{invoice.client.companyName}</p>
            <p className="text-muted-foreground print:text-slate-700">{invoice.client.contactPerson}</p>
            {invoice.client.email && <p className="text-muted-foreground print:text-slate-600">{invoice.client.email}</p>}
            {invoice.client.phone && <p className="text-muted-foreground print:text-slate-600 font-mono">{invoice.client.phone}</p>}
            {invoice.client.address && (
              <p className="text-muted-foreground print:text-slate-600">
                {invoice.client.address}, {invoice.client.city}
              </p>
            )}
            {invoice.client.taxId && (
              <p className="text-muted-foreground text-[11px]">BIN/Tax ID: {invoice.client.taxId}</p>
            )}
          </div>

          <div className="space-y-1.5 bg-muted/50 print:bg-slate-50 p-4 rounded-xl border border-border print:border-slate-200">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-bold">
              Project / Scope:
            </span>
            <p className="text-sm font-bold text-foreground print:text-black">
              {invoice.project?.name || 'Agency Digital Services'}
            </p>
            {invoice.project?.serviceCategory && (
              <p className="text-sky-600 dark:text-sky-400 print:text-sky-700 font-medium">{invoice.project.serviceCategory}</p>
            )}
            <p className="text-muted-foreground print:text-slate-600 pt-1">
              Billing Currency: <span className="font-mono font-bold text-foreground print:text-black">BDT (৳)</span>
            </p>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="rounded-xl border border-border print:border-slate-200 overflow-hidden bg-card">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 print:bg-slate-100 text-muted-foreground print:text-slate-700 uppercase text-[10px] font-semibold border-b border-border print:border-slate-200">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Deliverable / Service Description</th>
                <th className="px-4 py-3 text-center">Category</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-right">Unit Rate (৳)</th>
                <th className="px-4 py-3 text-right">Amount (৳)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border print:divide-slate-200">
              {invoice.items.map((item, index) => (
                <tr key={item.id} className="hover:bg-muted/40 print:hover:bg-transparent transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-foreground print:text-black">
                    {item.description}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground print:text-slate-600">
                    {item.serviceCategory || 'Service'}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-foreground print:text-slate-800">
                    {Number(item.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground print:text-slate-800">
                    ৳{Number(item.unitPrice).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-foreground print:text-black">
                    ৳{Number(item.totalPrice).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Calculation Summary */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
          <div className="space-y-2 max-w-sm text-xs">
            {invoice.notes && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium block">Notes:</span>
                <p className="text-muted-foreground print:text-slate-600 whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            )}
          </div>

          <div className="w-full sm:w-72 space-y-2 text-xs bg-muted/50 print:bg-slate-50 p-4 rounded-xl border border-border print:border-slate-200">
            <div className="flex justify-between text-muted-foreground print:text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono text-foreground print:text-black font-semibold">
                ৳{Number(invoice.subtotal).toLocaleString()}
              </span>
            </div>

            {Number(invoice.discount) > 0 && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 print:text-emerald-700">
                <span>Discount:</span>
                <span className="font-mono">-৳{Number(invoice.discount).toLocaleString()}</span>
              </div>
            )}

            {Number(invoice.taxAmount) > 0 && (
              <div className="flex justify-between text-muted-foreground print:text-slate-600">
                <span>Tax / VAT ({Number(invoice.taxRate)}%):</span>
                <span className="font-mono text-foreground print:text-black">
                  ৳{Number(invoice.taxAmount).toLocaleString()}
                </span>
              </div>
            )}

            <div className="flex justify-between text-base font-bold text-foreground print:text-black border-t border-border print:border-slate-200 pt-2">
              <span>Total Amount:</span>
              <span className="font-mono text-primary print:text-emerald-700">
                ৳{Number(invoice.totalAmount).toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 print:text-emerald-700 pt-1">
              <span>Paid to Date:</span>
              <span className="font-mono font-semibold">
                ৳{Number(invoice.paidAmount).toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between text-sm font-bold text-amber-600 dark:text-amber-400 print:text-amber-700 border-t border-border print:border-slate-200 pt-1.5">
              <span>Balance Due:</span>
              <span className="font-mono">৳{due.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Payments Recorded */}
        {invoice.payments.length > 0 && (
          <div className="pt-4 border-t border-border print:border-slate-200 space-y-2 text-xs">
            <h4 className="font-bold text-foreground print:text-black uppercase text-[11px] font-mono tracking-wider">
              Payments Received ({invoice.payments.length})
            </h4>
            <div className="divide-y divide-border print:divide-slate-200">
              {invoice.payments.map(p => (
                <div key={p.id} className="py-2 flex justify-between items-center text-foreground print:text-slate-700">
                  <div>
                    <span className="font-mono font-semibold text-foreground print:text-black mr-2">
                      {p.paymentNumber}
                    </span>
                    <span className="text-muted-foreground mr-2">
                      {new Date(p.paymentDate).toLocaleDateString()}
                    </span>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground print:border-slate-300">
                      {p.paymentMethod}
                    </Badge>
                    {p.reference && <span className="ml-2 font-mono text-[11px] text-muted-foreground">Ref: {p.reference}</span>}
                  </div>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-emerald-700 text-sm">
                    ৳{Number(p.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
