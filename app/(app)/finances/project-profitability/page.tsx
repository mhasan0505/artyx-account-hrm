import { getProjectProfitability } from '@/lib/actions/agency-profit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft, BarChart2, Building2, TrendingUp } from 'lucide-react'

export default async function ProjectProfitabilityPage() {
  const projects = await getProjectProfitability()

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/finances/profit-loss">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Project & Service Margins
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Analyze individual software development and digital marketing project profit margins
            </p>
          </div>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-2">
            <BarChart2 className="size-10 text-muted-foreground mx-auto opacity-60" />
            <p className="text-sm text-foreground">No projects recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Contract Value</th>
                <th className="px-4 py-3 text-right">Invoiced</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3 text-right">Direct Costs</th>
                <th className="px-4 py-3 text-right">Net Margin</th>
                <th className="px-4 py-3 text-center">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {projects.map(p => (
                <tr key={p.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-bold text-foreground block">{p.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{p.projectCode}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{p.clientName}</td>
                  <td className="px-4 py-3 text-sky-600 dark:text-sky-400 font-medium">{p.serviceCategory}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                    ৳{p.contractValue.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    ৳{p.totalInvoiced.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    ৳{p.totalCollected.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-orange-600 dark:text-orange-400">
                    ৳{p.directExpenses.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ৳{p.netMargin.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={
                        p.marginPct >= 50
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : p.marginPct >= 20
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                      }
                    >
                      {p.marginPct}%
                    </Badge>
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
