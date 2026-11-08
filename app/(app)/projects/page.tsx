import { getAllAgencyProjects, getAgencyClients } from '@/lib/actions/agency-clients'
import { CreateProjectModal } from '@/components/agency/project-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import {
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Plus,
  Receipt,
  Search,
  TrendingUp,
} from 'lucide-react'

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>
}) {
  const resolvedParams = await searchParams
  const { projects, stats } = await getAllAgencyProjects(
    resolvedParams.status,
    resolvedParams.category
  )

  const { clients } = await getAgencyClients()
  const simpleClients = clients.map(c => ({
    id: c.id,
    companyName: c.companyName,
    clientCode: c.clientCode,
  }))

  const categories = [
    { label: 'All Categories', value: 'ALL' },
    { label: 'Software Development', value: 'Software Development' },
    { label: 'Performance Marketing', value: 'Performance Marketing' },
    { label: 'UI/UX Design', value: 'UI/UX Design' },
    { label: 'SEO & Growth', value: 'SEO & Growth' },
    { label: 'Cloud & DevOps', value: 'Cloud & DevOps' },
  ]

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              Agency Projects & Contracts
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Deliverables, contract values, milestone billings, and real-time delivery margins
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/finances/project-profitability">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <TrendingUp className="size-4 mr-1.5 text-cyan-600 dark:text-cyan-400" />
              Margin Analysis
            </Button>
          </Link>
          <CreateProjectModal clients={simpleClients} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Projects</CardTitle>
            <Briefcase className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{stats.totalProjects}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.activeCount} currently in progress
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Contract Pipeline</CardTitle>
            <DollarSign className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{stats.totalContractValue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total agreed contract value</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Billed to Date</CardTitle>
            <Receipt className="size-4 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-sky-600 dark:text-sky-400">
              ৳{stats.totalInvoiced.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Milestone invoices issued</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Collected Cash</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{stats.totalCollected.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Received into agency bank</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Category Pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => {
          const isActive = (resolvedParams.category || 'ALL') === cat.value
          return (
            <Link
              key={cat.value}
              href={cat.value !== 'ALL' ? `/projects?category=${encodeURIComponent(cat.value)}` : '/projects'}
            >
              <Button
                size="sm"
                variant={isActive ? 'default' : 'outline'}
                className={
                  isActive
                    ? 'bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs'
                    : 'border-border text-foreground hover:bg-muted'
                }
              >
                {cat.label}
              </Button>
            </Link>
          )
        })}
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Briefcase className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No projects found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Start by registering your first software development or digital marketing contract.
            </p>
            <CreateProjectModal clients={simpleClients} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map(proj => {
            const invoiced = proj.invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
            const collected = proj.invoices.reduce((s, i) => s + Number(i.paidAmount), 0)
            const expenses = proj.expenses.reduce((s, e) => s + Number(e.amount), 0)
            const margin = invoiced - expenses
            const contractVal = Number(proj.contractValue)

            return (
              <Card
                key={proj.id}
                className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                          {proj.projectCode}
                        </span>
                        <Link
                          href={`/clients/${proj.client.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground font-medium truncate max-w-[150px]"
                        >
                          {proj.client.companyName}
                        </Link>
                      </div>
                      <h3 className="text-base font-bold text-foreground mt-1.5 leading-snug">
                        {proj.name}
                      </h3>
                      <p className="text-xs text-[#3E7000] dark:text-[#7FFF00] font-medium mt-0.5">
                        {proj.serviceCategory}
                      </p>
                    </div>

                    <Badge
                      className={
                        proj.status === 'COMPLETED'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : proj.status === 'IN_PROGRESS'
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
                            : 'bg-muted text-muted-foreground'
                      }
                    >
                      {proj.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0 text-xs">
                  <div className="grid grid-cols-3 gap-2 bg-muted/60 p-2.5 rounded-xl border border-border">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-medium block">Contract</span>
                      <span className="font-mono font-bold text-foreground">
                        ৳{contractVal.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-medium block">Invoiced</span>
                      <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                        ৳{invoiced.toLocaleString()}
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
                    <p className="text-muted-foreground text-[11px] line-clamp-2">
                      {proj.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Started: {new Date(proj.startDate).toLocaleDateString()}
                    </span>

                    <div className="flex items-center gap-2">
                      <Link href={`/invoices/new?clientId=${proj.client.id}`}>
                        <Button size="sm" variant="ghost" className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 h-7 px-2">
                          + Invoice
                        </Button>
                      </Link>
                      <Link href={`/clients/${proj.client.id}`}>
                        <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-foreground h-7 px-2">
                          Client 360° →
                        </Button>
                      </Link>
                    </div>
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
