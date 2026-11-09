import { getAllRetainers } from '@/lib/actions/agency-clients'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft, CalendarCheck, DollarSign, UsersRound } from 'lucide-react'

export default async function RetainersPage() {
  const { retainers, stats } = await getAllRetainers()

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/clients">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Monthly Retainers & Contracts
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Active recurring digital marketing, SEO, and software maintenance retainers
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Monthly Recurring (MRR)</CardTitle>
            <DollarSign className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{stats.totalMonthlyMRR.toLocaleString()} / mo
            </div>
            <p className="text-xs text-muted-foreground mt-1">Guaranteed monthly recurring revenue</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Active Retainers</CardTitle>
            <CalendarCheck className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">{stats.activeCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Currently being billed</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Retainers Registered</CardTitle>
            <UsersRound className="size-4 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{stats.totalRetainers}</div>
            <p className="text-xs text-muted-foreground mt-1">Historical and active</p>
          </CardContent>
        </Card>
      </div>

      {/* Retainers Table */}
      {retainers.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <CalendarCheck className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No retainers found</h3>
            <p className="text-sm text-muted-foreground">
              Add monthly marketing or maintenance retainers directly from any client profile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Service Scope</th>
                <th className="px-4 py-3">Billing Day</th>
                <th className="px-4 py-3 text-right">Monthly Fee</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {retainers.map(r => (
                <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${r.client.id}`} className="font-bold text-foreground hover:underline">
                      {r.client.companyName}
                    </Link>
                    <span className="text-[11px] text-muted-foreground block">{r.client.contactPerson}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground font-medium">{r.serviceName}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono">Day {r.billingDay} of month</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ৳{Number(r.monthlyFee).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge className={r.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-muted'}>
                      {r.isActive ? 'ACTIVE' : 'PAUSED'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/clients/${r.client.id}`}>
                      <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-foreground">
                        Profile →
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
