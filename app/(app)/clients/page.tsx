import { getAgencyClients } from '@/lib/actions/agency-clients'
import { CreateClientModal } from '@/components/agency/client-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import {
  Building2,
  CalendarCheck,
  CreditCard,
  ExternalLink,
  Mail,
  Phone,
  Search,
  UsersRound,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; type?: string }>
}) {
  const resolvedParams = await searchParams
  const { clients, summary } = await getAgencyClients({
    search: resolvedParams.search,
    status: resolvedParams.status as any,
    clientType: resolvedParams.type as any,
  })

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header & New Client Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              Agency Clients
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            CRM, client contracts, credentials vault, retainers, and financial ledger
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/clients/retainers">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <CalendarCheck className="size-4 mr-1.5 text-emerald-600 dark:text-emerald-400" />
              Retainers
            </Button>
          </Link>
          <Link href="/clients/credentials">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <ShieldCheck className="size-4 mr-1.5 text-amber-600 dark:text-amber-400" />
              Credentials Vault
            </Button>
          </Link>
          <CreateClientModal />
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Clients</CardTitle>
            <UsersRound className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{summary.totalClients}</div>
            <p className="text-xs text-muted-foreground mt-1">Active business relationships</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Monthly Retainer MRR</CardTitle>
            <CalendarCheck className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{summary.activeRetainersMonthlyValue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across {summary.activeRetainersCount} monthly contracts
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Outstanding Due</CardTitle>
            <TrendingUp className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              ৳{summary.totalOutstanding.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Unpaid invoices in Accounts Receivable</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Primary Currency</CardTitle>
            <CreditCard className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">BDT (৳)</div>
            <p className="text-xs text-muted-foreground mt-1">Agency billing in Bangladesh Taka</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter / Search Bar */}
      <form method="get" className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            name="search"
            defaultValue={resolvedParams.search || ''}
            placeholder="Search by company name, contact person, code, phone, or email..."
            className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          <select
            name="type"
            defaultValue={resolvedParams.type || ''}
            className="h-9 px-3 rounded-md bg-card border border-border text-xs text-foreground"
          >
            <option value="">All Types</option>
            <option value="PROJECT_BASED">Project Based</option>
            <option value="RETAINER">Retainer</option>
            <option value="HYBRID">Hybrid</option>
            <option value="HOURLY_CONSULTING">Hourly</option>
          </select>

          <select
            name="status"
            defaultValue={resolvedParams.status || ''}
            className="h-9 px-3 rounded-md bg-card border border-border text-xs text-foreground"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="LEAD">Lead</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <Button type="submit" size="sm" className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold">
            Filter
          </Button>
        </div>
      </form>

      {/* Clients Grid */}
      {clients.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Building2 className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No clients found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Get started by registering your first software or digital marketing client.
            </p>
            <CreateClientModal />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => {
            const due = Number(client.outstandingBalance)
            return (
              <Card
                key={client.id}
                className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {client.clientCode}
                      </span>
                      <h3 className="text-base font-bold text-foreground mt-1.5 leading-snug">
                        {client.companyName}
                      </h3>
                      <p className="text-xs text-muted-foreground">{client.contactPerson}</p>
                    </div>

                    <Badge
                      className={
                        client.clientType === 'RETAINER'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : client.clientType === 'HYBRID'
                            ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                            : 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
                      }
                    >
                      {client.clientType.replace('_', ' ')}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="space-y-1.5 text-xs text-foreground">
                    {client.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono">{client.phone}</span>
                      </div>
                    )}
                    {client.email && (
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}
                  </div>

                  {/* Badges for counts */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border text-[11px] text-muted-foreground">
                    <span className="px-2 py-0.5 rounded bg-muted/60 border border-border">
                      {client._count.projects} Projects
                    </span>
                    <span className="px-2 py-0.5 rounded bg-muted/60 border border-border">
                      {client._count.retainers} Retainers
                    </span>
                    <span className="px-2 py-0.5 rounded bg-muted/60 border border-border">
                      {client._count.credentials} Vault
                    </span>
                  </div>

                  {/* Outstanding Balance & Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                        Receivable Due
                      </span>
                      <span
                        className={`text-sm font-bold font-mono ${
                          due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[#3E7000] dark:text-[#7FFF00]'
                        }`}
                      >
                        ৳{due.toLocaleString()}
                      </span>
                    </div>

                    <Link href={`/clients/${client.id}`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground hover:text-foreground gap-1 pr-1.5"
                      >
                        Profile 360°
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
