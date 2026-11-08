import { getAccountsReceivable } from '@/lib/actions/agency-invoices'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RecordPaymentModal } from '@/components/agency/payment-modal'
import Link from 'next/link'
import { ArrowLeft, Clock, DollarSign, Receipt, TrendingUp } from 'lucide-react'

export default async function AccountsReceivablePage() {
  const { invoices, agingSummary } = await getAccountsReceivable()

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
    },
  })

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Accounts Receivable & Aging
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Track outstanding client invoices, overdue payments, and aging buckets
            </p>
          </div>
        </div>
      </div>

      {/* Aging Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase">
              Current (Not Due)
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{agingSummary.current.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase">
              1 – 30 Days Overdue
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-300">
              ৳{agingSummary.days1To30.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase">
              31 – 60 Days Overdue
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-xl font-bold font-mono text-orange-600 dark:text-amber-500">
              ৳{agingSummary.days31To60.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase">
              60+ Days Overdue
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400">
              ৳{agingSummary.days60Plus.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs col-span-2 lg:col-span-1">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase">
              Total Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{agingSummary.totalOutstanding.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices List */}
      {invoices.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-2">
            <Receipt className="size-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <h3 className="text-base font-semibold text-foreground">All invoices are settled!</h3>
            <p className="text-xs text-muted-foreground">There are currently no overdue receivables.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3 text-center">Overdue Days</th>
                <th className="px-4 py-3 text-right">Invoice Total</th>
                <th className="px-4 py-3 text-right">Balance Due</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {invoices.map(inv => {
                const due = Number(inv.dueAmount)
                return (
                  <tr key={inv.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-sky-600 dark:text-sky-400">
                      <Link href={`/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/clients/${inv.client.id}`} className="font-semibold text-foreground hover:underline">
                        {inv.client.companyName}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">{inv.client.contactPerson} ({inv.client.phone || ''})</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.overdueDays > 0 ? (
                        <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30">
                          {inv.overdueDays} days late
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          On time
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-foreground">
                      ৳{Number(inv.totalAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 text-sm">
                      ৳{due.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RecordPaymentModal
                        invoiceId={inv.id}
                        invoiceNumber={inv.invoiceNumber}
                        clientName={inv.client.companyName}
                        dueAmount={due}
                        bankAccounts={bankAccounts}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
