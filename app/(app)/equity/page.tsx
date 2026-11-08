import { getAgencyOwners } from '@/lib/actions/agency-equity'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreatePartnerModal } from '@/components/agency/partner-modal'
import { RecordDrawingModal } from '@/components/agency/drawing-modal'
import Link from 'next/link'
import {
  ArrowDownRight,
  Coins,
  CreditCard,
  DollarSign,
  PieChart,
  Scale,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'

export default async function EquityPage() {
  const { owners, summary } = await getAgencyOwners()

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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              Owner Equity & Profit Sharing
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Partner shareholdings, capital pool, drawings, and automated dividend distribution
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/equity/drawings">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowDownRight className="size-4 mr-1.5 text-orange-600 dark:text-orange-400" />
              Drawings Log
            </Button>
          </Link>
          <Link href="/equity/distributions">
            <Button className="bg-[#3E7000] hover:bg-[#356000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
              <Coins className="size-4 mr-1.5" />
              Distribute Profit
            </Button>
          </Link>
          <CreatePartnerModal currentTotalEquity={summary.totalEquityPercentage} />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Equity Allocated</CardTitle>
            <Scale className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {summary.totalEquityPercentage.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.isEquityBalanced ? (
                <span className="text-[#3E7000] dark:text-[#7FFF00] font-medium font-mono">✓ 100% Fully Allocated</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-medium font-mono">
                  {(100 - summary.totalEquityPercentage).toFixed(1)}% Available unallocated
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Partner Capital Balance</CardTitle>
            <DollarSign className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{summary.totalCapitalPool.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Net partner capital remaining in agency</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Partner Drawings</CardTitle>
            <CreditCard className="size-4 text-orange-600 dark:text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-orange-600 dark:text-orange-400">
              ৳{summary.totalCumulativeDrawings.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cumulative personal withdrawals</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Profit Distributed to Date</CardTitle>
            <Coins className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{summary.totalCumulativeDistributed.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Net dividend payouts disbursed</p>
          </CardContent>
        </Card>
      </div>

      {/* Partners Grid */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Agency Partners & Ownership Structure
          </h2>
          <span className="text-xs text-muted-foreground">
            {owners.length} registered partner{owners.length === 1 ? '' : 's'}
          </span>
        </div>

        {owners.length === 0 ? (
          <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
            <CardContent className="space-y-3">
              <Scale className="size-12 text-muted-foreground mx-auto opacity-60" />
              <h3 className="text-lg font-semibold text-foreground">No partners configured yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Set up your agency founders and partners with their equity percentage to enable automated profit sharing.
              </p>
              <CreatePartnerModal currentTotalEquity={summary.totalEquityPercentage} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {owners.map(owner => {
              const eqPct = Number(owner.equityPercentage)
              const capBal = Number(owner.currentCapitalBalance)
              const drawings = Number(owner.totalDrawings)
              const distributed = Number(owner.totalProfitDistributed)

              return (
                <Card
                  key={owner.id}
                  className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between"
                >
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h3 className="text-base font-bold text-foreground leading-snug">{owner.name}</h3>
                        <p className="text-xs text-[#3E7000] dark:text-[#7FFF00] font-medium mt-0.5">{owner.title}</p>
                        {owner.email && <p className="text-[11px] text-muted-foreground font-mono mt-1">{owner.email}</p>}
                      </div>
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs font-mono font-bold">
                        {eqPct.toFixed(1)}% Share
                      </Badge>
                    </div>

                    {/* Equity visual bar */}
                    <div className="w-full bg-muted rounded-full h-2 mt-3 overflow-hidden border border-border">
                      <div
                        className="bg-[#3E7000] dark:bg-[#7FFF00] h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, eqPct)}%` }}
                      />
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-0 text-xs">
                    <div className="grid grid-cols-2 gap-2 bg-muted/60 p-3 rounded-xl border border-border">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-medium block">Capital Balance</span>
                        <span className="font-mono font-bold text-foreground">
                          ৳{capBal.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-medium block">Total Drawings</span>
                        <span className="font-mono font-bold text-orange-600 dark:text-orange-400">
                          ৳{drawings.toLocaleString()}
                        </span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium block">Total Dividends Distributed</span>
                        <span className="font-mono font-bold text-[#3E7000] dark:text-[#7FFF00]">
                          ৳{distributed.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <RecordDrawingModal
                        ownerId={owner.id}
                        ownerName={owner.name}
                        bankAccounts={bankAccounts}
                      />

                      <Link href={`/equity/${owner.id}`}>
                        <Button size="sm" variant="ghost" className="text-xs text-sky-600 dark:text-sky-400 hover:underline">
                          Equity Ledger →
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
    </div>
  )
}
