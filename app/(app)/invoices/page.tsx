import { getAgencyInvoices } from '@/lib/actions/agency-invoices'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordPaymentModal } from '@/components/agency/payment-modal'
import Link from 'next/link'
import {
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  Plus,
  Receipt,
  Search,
  TrendingUp,
} from 'lucide-react'

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>
}) {
  const resolvedParams = await searchParams
  const { invoices, summary } = await getAgencyInvoices({
    search: resolvedParams.search,
    status: resolvedParams.status,
  })

  // Fetch active bank accounts for quick payment recording
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
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              Service Invoices & Billing
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Software milestones, digital marketing retainers, and client payment receipts
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/accounts-receivable">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <TrendingUp className="size-4 mr-1.5 text-amber-600 dark:text-amber-400" />
              Accounts Receivable
            </Button>
          </Link>
          <Link href="/invoices/new">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
              <Plus className="size-4 mr-1.5" />
              Create Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Invoiced</CardTitle>
            <Receipt className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">৳{summary.totalInvoiced.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Across {summary.count} invoices</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Collected</CardTitle>
            <CheckCircle2 className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              ৳{summary.totalReceived.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cash received in agency accounts</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Outstanding Due</CardTitle>
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              ৳{summary.totalDue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pending client payment</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Status Filters */}
      <form method="get" className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            name="search"
            defaultValue={resolvedParams.search || ''}
            placeholder="Search invoice number, client company, contact..."
            className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          <select
            name="status"
            defaultValue={resolvedParams.status || 'ALL'}
            className="h-9 px-3 rounded-md bg-card border border-border text-xs text-foreground"
          >
            <option value="ALL">All Statuses</option>
            <option value="SENT">Sent / Unpaid</option>
            <option value="PARTIAL">Partially Paid</option>
            <option value="PAID">Fully Paid</option>
            <option value="OVERDUE">Overdue</option>
          </select>

          <Button type="submit" size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            Filter
          </Button>
        </div>
      </form>

      {/* Invoices Table */}
      {invoices.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Receipt className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No invoices found</h3>
            <p className="text-sm text-muted-foreground">Create your first client invoice.</p>
            <Link href="/invoices/new">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                Create Invoice
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Project / Scope</th>
                <th className="px-4 py-3">Issue Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3 text-right">Total Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Due</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
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
                      <p className="text-[11px] text-muted-foreground">{inv.client.contactPerson}</p>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {inv.project?.name || 'General Agency Services'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">
                      {new Date(inv.issueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-foreground">
                      ৳{Number(inv.totalAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      ৳{Number(inv.paidAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      ৳{due.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        className={
                          inv.status === 'PAID'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                            : inv.status === 'PARTIAL'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                              : 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
                        }
                      >
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end items-center gap-1.5">
                        {due > 0 && (
                          <RecordPaymentModal
                            invoiceId={inv.id}
                            invoiceNumber={inv.invoiceNumber}
                            clientName={inv.client.companyName}
                            dueAmount={due}
                            bankAccounts={bankAccounts}
                          />
                        )}
                        <Link href={`/invoices/${inv.id}`}>
                          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-foreground">
                            View
                          </Button>
                        </Link>
                      </div>
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
