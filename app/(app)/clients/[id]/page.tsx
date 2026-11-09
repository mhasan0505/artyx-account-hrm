import { notFound } from 'next/navigation'
import { getAgencyClientById } from '@/lib/actions/agency-clients'
import { prisma } from '@/lib/db'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AddCredentialModal } from '@/components/agency/credential-modal'
import { RecordPaymentModal } from '@/components/agency/payment-modal'
import Link from 'next/link'
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  CreditCard,
  DollarSign,
  ExternalLink,
  Globe,
  KeyRound,
  Mail,
  Phone,
  Plus,
  Receipt,
  Shield,
  TrendingUp,
} from 'lucide-react'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const client = await getAgencyClientById(id)
  if (!client) {
    notFound()
  }

  // Fetch active bank accounts for payment modal
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
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/clients">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                {client.clientCode}
              </span>
              <Badge
                className={
                  client.status === 'ACTIVE'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-muted text-muted-foreground'
                }
              >
                {client.status}
              </Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mt-1 tracking-tight">
              {client.companyName}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AddCredentialModal clientId={client.id} />
          <Link href={`/invoices/new?clientId=${client.id}`}>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
              <Receipt className="size-4 mr-1.5" />
              Create Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* Top 360° Financial Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Lifetime Invoiced</CardTitle>
            <Receipt className="size-4 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              ৳{client.stats.totalInvoiced.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total billings generated</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Payments Collected</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{client.stats.totalPaid.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Received in agency accounts</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Outstanding Receivable</CardTitle>
            <TrendingUp className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              ৳{client.stats.totalDue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Current balance due</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Active Retainers & Projects</CardTitle>
            <Building2 className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              {client.stats.activeProjectsCount} Prj / {client.stats.activeRetainersCount} Ret
            </div>
            <p className="text-xs text-muted-foreground mt-1">Ongoing active work</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Section */}
      <Tabs defaultValue="credentials" className="space-y-4">
        <TabsList className="bg-muted border border-border text-muted-foreground p-1 rounded-xl">
          <TabsTrigger value="credentials" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Credentials Vault ({client.credentials.length})
          </TabsTrigger>
          <TabsTrigger value="invoices" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Invoices & Billing ({client.invoices.length})
          </TabsTrigger>
          <TabsTrigger value="projects" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Projects ({client.projects.length})
          </TabsTrigger>
          <TabsTrigger value="retainers" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Retainers ({client.retainers.length})
          </TabsTrigger>
          <TabsTrigger value="ledger" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Financial Ledger ({client.ledger.length})
          </TabsTrigger>
          <TabsTrigger value="profile" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-xs rounded-lg">
            Contact & Brief
          </TabsTrigger>
        </TabsList>

        {/* 1. CREDENTIALS VAULT */}
        <TabsContent value="credentials" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-foreground">Credentials & Access Vault</h3>
              <p className="text-xs text-muted-foreground">
                Securely stored domains, hostings, cPanels, CMS admin logins, and API keys
              </p>
            </div>
            <AddCredentialModal clientId={client.id} />
          </div>

          {client.credentials.length === 0 ? (
            <Card className="bg-card border-border/80 text-center py-8 rounded-2xl">
              <CardContent className="space-y-2">
                <Shield className="size-10 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm text-foreground font-medium">No credentials saved yet</p>
                <p className="text-xs text-muted-foreground">
                  Save domain registrars, hosting, cPanel, or CMS credentials for this client.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {client.credentials.map(cred => (
                <Card key={cred.id} className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono border-border text-muted-foreground">
                          {cred.category}
                        </Badge>
                        <h4 className="text-sm font-bold text-foreground mt-1.5">{cred.title}</h4>
                      </div>
                      <KeyRound className="size-4 text-amber-500" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {cred.loginUrl && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Login URL:</span>
                        <a
                          href={cred.loginUrl.startsWith('http') ? cred.loginUrl : `https://${cred.loginUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline font-mono truncate"
                        >
                          <span className="truncate">{cred.loginUrl}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </div>
                    )}
                    {cred.username && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Username / Email:</span>
                        <p className="font-mono bg-muted px-2 py-1 rounded border border-border text-foreground select-all">
                          {cred.username}
                        </p>
                      </div>
                    )}
                    {cred.password && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Password / Key:</span>
                        <p className="font-mono bg-muted px-2 py-1 rounded border border-border text-amber-600 dark:text-amber-300 font-semibold select-all">
                          {cred.password}
                        </p>
                      </div>
                    )}
                    {cred.apiKey && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">API Key / Token:</span>
                        <p className="font-mono bg-muted px-2 py-1 rounded border border-border text-sky-600 dark:text-sky-300 text-[11px] truncate select-all">
                          {cred.apiKey}
                        </p>
                      </div>
                    )}
                    {cred.notes && (
                      <p className="text-muted-foreground pt-1 text-[11px] border-t border-border">
                        {cred.notes}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 2. INVOICES & BILLING */}
        <TabsContent value="invoices" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-semibold text-foreground">Invoices & Payment Records</h3>
            <Link href={`/invoices/new?clientId=${client.id}`}>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
                <Plus className="size-3.5 mr-1" />
                New Invoice
              </Button>
            </Link>
          </div>

          {client.invoices.length === 0 ? (
            <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
              <CardContent className="space-y-2">
                <Receipt className="size-10 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm text-foreground">No invoices generated yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Invoice #</th>
                    <th className="px-4 py-3">Issue Date</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Due</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {client.invoices.map(inv => {
                    const due = Number(inv.dueAmount)
                    return (
                      <tr key={inv.id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-foreground">
                          <Link href={`/invoices/${inv.id}`} className="hover:underline text-sky-600 dark:text-sky-400">
                            {inv.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(inv.issueDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(inv.dueDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
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
                          {due > 0 && (
                            <RecordPaymentModal
                              invoiceId={inv.id}
                              invoiceNumber={inv.invoiceNumber}
                              clientName={client.companyName}
                              dueAmount={due}
                              bankAccounts={bankAccounts}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 3. PROJECTS */}
        <TabsContent value="projects" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-semibold text-foreground">Client Projects & Contracts</h3>
          </div>

          {client.projects.length === 0 ? (
            <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
              <CardContent className="space-y-2">
                <Building2 className="size-10 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm text-foreground">No projects registered yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {client.projects.map(proj => {
                const totalInvoiced = proj.invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
                const totalPaid = proj.invoices.reduce((s, i) => s + Number(i.paidAmount), 0)
                const totalExp = proj.expenses.reduce((s, e) => s + Number(e.amount), 0)
                const margin = totalInvoiced - totalExp

                return (
                  <Card key={proj.id} className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                            {proj.projectCode}
                          </span>
                          <h4 className="text-base font-bold text-foreground mt-1">{proj.name}</h4>
                          <p className="text-xs text-primary font-medium">{proj.serviceCategory}</p>
                        </div>
                        <Badge variant="outline" className="text-xs border-border text-foreground">
                          {proj.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs pt-1">
                      <div className="grid grid-cols-3 gap-2 bg-muted/60 p-2.5 rounded-xl border border-border">
                        <div>
                          <span className="text-[10px] text-muted-foreground uppercase font-medium block">Contract</span>
                          <span className="font-mono font-bold text-foreground">
                            ৳{Number(proj.contractValue).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground uppercase font-medium block">Invoiced</span>
                          <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                            ৳{totalInvoiced.toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground uppercase font-medium block">Net Margin</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            ৳{margin.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {proj.description && (
                        <p className="text-muted-foreground text-[11px]">{proj.description}</p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* 4. RETAINERS */}
        <TabsContent value="retainers" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-semibold text-foreground">Recurring Marketing & Maintenance Retainers</h3>
          </div>

          {client.retainers.length === 0 ? (
            <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
              <CardContent className="space-y-2">
                <Calendar className="size-10 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm text-foreground">No active monthly retainers</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {client.retainers.map(ret => (
                <Card key={ret.id} className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-base font-bold text-foreground">{ret.serviceName}</h4>
                        <p className="text-xs text-muted-foreground">
                          Billed on day {ret.billingDay} of each month
                        </p>
                      </div>
                      <Badge className={ret.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted'}>
                        {ret.isActive ? 'ACTIVE' : 'PAUSED'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex justify-between items-center bg-muted/60 p-2.5 rounded-xl border border-border">
                      <span className="text-muted-foreground font-medium">Monthly Retainer Fee:</span>
                      <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                        ৳{Number(ret.monthlyFee).toLocaleString()} / mo
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 5. CLIENT LEDGER */}
        <TabsContent value="ledger" className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">Client Financial Statement & Ledger</h3>
          {client.ledger.length === 0 ? (
            <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
              <CardContent>
                <p className="text-sm text-muted-foreground">No ledger transactions posted yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Debit (Invoiced)</th>
                    <th className="px-4 py-3 text-right">Credit (Paid)</th>
                    <th className="px-4 py-3 text-right">Closing Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {client.ledger.map(entry => (
                    <tr key={entry.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground">
                        {entry.reference || '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground">{entry.description}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-600 dark:text-amber-400">
                        {entry.type === 'DEBIT' ? `৳${Number(entry.amount).toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {entry.type === 'CREDIT' ? `৳${Number(entry.amount).toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                        ৳{Number(entry.balance).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 6. PROFILE & CONTACT DETAILS */}
        <TabsContent value="profile" className="space-y-4">
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground">Client Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Company Name</span>
                  <p className="font-semibold text-sm text-foreground">{client.companyName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Contact Person</span>
                  <p className="font-semibold text-sm text-foreground">{client.contactPerson}</p>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Email</span>
                  <p className="font-mono text-foreground">{client.email || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Phone</span>
                  <p className="font-mono text-foreground">{client.phone || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Tax ID / BIN</span>
                  <p className="font-mono text-foreground">{client.taxId || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Location</span>
                  <p className="text-foreground">{client.city || ''}, {client.country}</p>
                </div>
              </div>
              {client.notes && (
                <div className="pt-3 border-t border-border">
                  <span className="text-muted-foreground uppercase block text-[10px] font-medium">Notes & Brief</span>
                  <p className="text-foreground mt-1 whitespace-pre-wrap">{client.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
