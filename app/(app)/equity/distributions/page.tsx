import { getAllDistributionBatches } from '@/lib/actions/agency-equity'
import { prisma } from '@/lib/db'
import { DistributionWizard } from '@/components/agency/distribution-wizard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock, Coins, History } from 'lucide-react'

export default async function DistributionsPage() {
  const batches = await getAllDistributionBatches()

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/equity">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Profit Share Distributions
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Calculate agency net profit, apply retained reserve, and allocate partner dividends
            </p>
          </div>
        </div>
      </div>

      {/* Calculator Wizard */}
      <DistributionWizard />

      {/* Historical Batches */}
      <div className="space-y-4 pt-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          Distribution Batches History
        </h2>

        {batches.length === 0 ? (
          <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No past profit share batches recorded. Use the calculator above to create your first distribution.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {batches.map(batch => (
              <Card key={batch.id} className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
                <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-muted text-amber-600 dark:text-amber-400 border border-border">
                        {batch.batchNumber}
                      </span>
                      <h3 className="text-base font-bold text-foreground">{batch.title}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Period: {new Date(batch.periodStartDate).toLocaleDateString()} to{' '}
                      {new Date(batch.periodEndDate).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      {batch.status}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-4 text-xs">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-muted/50 p-3 rounded-xl border border-border">
                    <div>
                      <span className="text-muted-foreground uppercase text-[10px] font-medium block">Total Revenue</span>
                      <span className="font-mono font-bold text-foreground">
                        ৳{Number(batch.totalRevenue).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase text-[10px] font-medium block">Net Profit</span>
                      <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                        ৳{Number(batch.netProfit).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase text-[10px] font-medium block">
                        Retained Reserve ({Number(batch.retainedReservePercentage)}%)
                      </span>
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        ৳{Number(batch.retainedReserveAmount).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase text-[10px] font-medium block">Total Distributed</span>
                      <span className="font-mono font-bold text-[#3E7000] dark:text-[#7FFF00]">
                        ৳{Number(batch.distributableProfit).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="space-y-2">
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] block">
                      Partner Allocations:
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {batch.lines.map(line => (
                        <div
                          key={line.id}
                          className="p-3 bg-card rounded-xl border border-border space-y-1.5 shadow-xs"
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-foreground">{line.owner.name}</span>
                            <span className="font-mono text-amber-600 dark:text-amber-400 text-xs font-bold">
                              {Number(line.equityPercentage)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-muted-foreground text-[11px]">
                            <span>Gross Share:</span>
                            <span className="font-mono text-foreground font-semibold">
                              ৳{Number(line.calculatedShare).toLocaleString()}
                            </span>
                          </div>
                          {Number(line.drawingsDeducted) > 0 && (
                            <div className="flex justify-between text-orange-600 dark:text-orange-400 text-[11px]">
                              <span>Drawings Deducted:</span>
                              <span className="font-mono font-semibold">
                                -৳{Number(line.drawingsDeducted).toLocaleString()}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold pt-1 border-t border-border">
                            <span>Net Payout:</span>
                            <span className="font-mono">
                              ৳{Number(line.netPayable).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
