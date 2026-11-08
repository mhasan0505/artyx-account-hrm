import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { Briefcase, Building2, Coins, Receipt, Users } from 'lucide-react'
import Link from 'next/link'

async function loadSearchResults(query: string) {
  return Promise.all([
    prisma.agencyClient.findMany({
      where: {
        OR: [
          { companyName: { contains: query, mode: 'insensitive' } },
          { clientCode: { contains: query, mode: 'insensitive' } },
          { contactPerson: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      select: {
        id: true,
        companyName: true,
        clientCode: true,
        contactPerson: true,
        clientType: true,
        outstandingBalance: true,
      },
    }),
    prisma.agencyInvoice.findMany({
      where: {
        OR: [
          { invoiceNumber: { contains: query, mode: 'insensitive' } },
          { client: { companyName: { contains: query, mode: 'insensitive' } } },
          { client: { contactPerson: { contains: query, mode: 'insensitive' } } },
        ],
      },
      take: 10,
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        dueAmount: true,
        status: true,
        issueDate: true,
        client: { select: { companyName: true } },
      },
      orderBy: { issueDate: 'desc' },
    }),
    prisma.agencyProject.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { projectCode: { contains: query, mode: 'insensitive' } },
          { serviceCategory: { contains: query, mode: 'insensitive' } },
          { client: { companyName: { contains: query, mode: 'insensitive' } } },
        ],
      },
      take: 10,
      select: {
        id: true,
        name: true,
        projectCode: true,
        serviceCategory: true,
        contractValue: true,
        status: true,
        client: { select: { id: true, companyName: true } },
      },
    }),
  ])
}

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = q?.trim()

  if (!query) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Search" />
        <div className="mt-8 text-center text-muted-foreground">
          <p>
            Please enter a search term in the header to find clients, invoices, or projects.
          </p>
        </div>
      </div>
    )
  }

  const [clients, invoices, projects] = await withDatabaseReadFallback(
    () => loadSearchResults(query),
    [[], [], []] as Awaited<ReturnType<typeof loadSearchResults>>,
    'GlobalSearchPage:loadSearchResults'
  )

  const totalResults = clients.length + invoices.length + projects.length

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="border-b border-border pb-4">
        <PageHeader title={`Search Results for "${query}"`} />
        <p className="text-sm text-muted-foreground mt-2">
          Found {totalResults} result{totalResults === 1 ? '' : 's'} across agency modules.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* CLIENTS */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Building2 className="size-5 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-bold text-foreground">
              Clients ({clients.length})
            </h2>
          </div>
          {clients.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No clients found.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {clients.map(client => (
                <div
                  key={client.id}
                  className="rounded-xl border border-border bg-card p-3.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <p className="font-bold text-sm text-foreground">{client.companyName}</p>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {client.clientCode}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{client.contactPerson}</p>
                  <div className="flex items-center justify-between pt-1 border-t border-border text-xs">
                    <span className="text-muted-foreground">Due:</span>
                    <span className="font-mono font-bold text-foreground">
                      ৳{Number(client.outstandingBalance).toLocaleString()}
                    </span>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full h-7 text-xs border-border">
                    <Link href={`/clients/${client.id}`}>Profile 360°</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* INVOICES */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Receipt className="size-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-bold text-foreground">
              Invoices ({invoices.length})
            </h2>
          </div>
          {invoices.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No invoices found.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {invoices.map(inv => (
                <div
                  key={inv.id}
                  className="rounded-xl border border-border bg-card p-3.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-sky-600 dark:text-sky-400">
                      {inv.invoiceNumber}
                    </span>
                    <span className="text-xs font-mono font-bold text-foreground">
                      ৳{Number(inv.totalAmount).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-foreground truncate">
                    {inv.client.companyName}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Due: ৳{Number(inv.dueAmount).toLocaleString()}</span>
                    <span>{new Date(inv.issueDate).toLocaleDateString()}</span>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full h-7 text-xs border-border">
                    <Link href={`/invoices/${inv.id}`}>View Invoice</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PROJECTS */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Briefcase className="size-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-base font-bold text-foreground">
              Projects ({projects.length})
            </h2>
          </div>
          {projects.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No projects found.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {projects.map(proj => (
                <div
                  key={proj.id}
                  className="rounded-xl border border-border bg-card p-3.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors"
                >
                  <p className="font-bold text-sm text-foreground truncate">{proj.name}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{proj.serviceCategory}</span>
                    <span className="font-mono font-bold text-foreground">
                      ৳{Number(proj.contractValue).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{proj.client.companyName}</p>
                  <Button asChild variant="outline" size="sm" className="w-full h-7 text-xs border-border">
                    <Link href={`/clients/${proj.client.id}`}>Client Profile</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
