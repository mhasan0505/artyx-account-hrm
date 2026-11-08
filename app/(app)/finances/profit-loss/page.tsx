import { getAgencyProfitAndLoss } from '@/lib/actions/agency-profit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  BarChart2,
  Calendar,
  CheckCircle2,
  Coins,
  DollarSign,
  PieChart,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

export default async function ProfitLossPage() {
  const pl = await getAgencyProfitAndLoss()

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              Agency Profit & Loss (P&L) Statement
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time revenue, direct delivery costs, overheads, gross margin, and net profit
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/finances/project-profitability">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              <BarChart2 className="size-4 mr-1.5 text-cyan-600 dark:text-cyan-400" />
              Project Margins
            </Button>
          </Link>
          <Link href="/equity/distributions">
            <Button className="bg-[#3E7000] hover:bg-[#356000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
              <Coins className="size-4 mr-1.5" />
              Distribute Net Profit
            </Button>
          </Link>
        </div>
      </div>

      {/* Top Margin Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Agency Revenue</CardTitle>
            <TrendingUp className="size-4 text-sky-600 dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              ৳{pl.revenue.total.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Gross client billings</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Gross Profit (Margin %)</CardTitle>
            <PieChart className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[#3E7000] dark:text-[#7FFF00]">
              ৳{pl.grossProfit.toLocaleString()}
            </div>
            <p className="text-xs text-[#3E7000] dark:text-[#7FFF00] font-semibold mt-1 font-mono">
              {pl.grossMarginPct}% Gross Margin
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Net Operating Profit (EBITDA)</CardTitle>
            <Coins className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${pl.netProfit >= 0 ? 'text-[#3E7000] dark:text-[#7FFF00]' : 'text-rose-600 dark:text-rose-400'}`}>
              ৳{pl.netProfit.toLocaleString()}
            </div>
            <p className={`text-xs font-semibold mt-1 font-mono ${pl.netProfit >= 0 ? 'text-[#3E7000] dark:text-[#7FFF00]' : 'text-rose-600 dark:text-rose-400'}`}>
              {pl.netMarginPct}% Net Operating Margin
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Formal P&L Statement */}
      <Card className="bg-card border-border/80 text-card-foreground overflow-hidden artyx-card rounded-2xl shadow-xs">
        <CardHeader className="bg-muted/50 dark:bg-[#141b12] border-b border-border py-4">
          <div className="flex justify-between items-center">
            <CardTitle className="text-base font-bold text-foreground">Income Statement (P&L)</CardTitle>
            <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
              Annual Cumulative BDT (৳)
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0 divide-y divide-border text-xs">
          {/* 1. REVENUE SECTION */}
          <div className="p-5 space-y-3">
            <div className="flex justify-between items-center font-bold text-sm">
              <span className="uppercase text-xs tracking-wider text-sky-700 dark:text-sky-400">1. Operating Revenue</span>
              <span className="font-mono text-foreground font-bold">৳{pl.revenue.total.toLocaleString()}</span>
            </div>

            <div className="space-y-2 pl-4 text-slate-700 dark:text-slate-300">
              <div className="flex justify-between">
                <span>Software & Web Development Deliverables</span>
                <span className="font-mono font-medium text-foreground">৳{pl.revenue.softwareDevelopment.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Digital Marketing & SEO Monthly Retainers</span>
                <span className="font-mono font-medium text-foreground">৳{pl.revenue.digitalMarketing.toLocaleString()}</span>
              </div>
              {pl.revenue.otherServices > 0 && (
                <div className="flex justify-between">
                  <span>Other Creative & Technical Consulting</span>
                  <span className="font-mono font-medium text-foreground">৳{pl.revenue.otherServices.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* 2. DIRECT DELIVERY COSTS (COGS) */}
          <div className="p-5 space-y-3 bg-muted/20 dark:bg-[#0d120c]/40">
            <div className="flex justify-between items-center font-bold text-sm">
              <span className="uppercase text-xs tracking-wider text-amber-700 dark:text-amber-400">
                2. Cost of Delivery / Direct Project Costs
              </span>
              <span className="font-mono text-amber-700 dark:text-amber-400 font-bold">
                -৳{pl.directCosts.total.toLocaleString()}
              </span>
            </div>

            <div className="space-y-2 pl-4 text-slate-700 dark:text-slate-300">
              <div className="flex justify-between">
                <span>External Freelancers, Specialized Contractors & Media Buyers</span>
                <span className="font-mono font-medium text-foreground">৳{pl.directCosts.contractorAndFreelance.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Client Ad Spend Disbursements (Meta / Google Ads Pass-through)</span>
                <span className="font-mono font-medium text-foreground">৳{pl.directCosts.clientAdSpendDisbursement.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* GROSS PROFIT ROW */}
          <div className="p-5 flex justify-between items-center font-bold text-base bg-muted/40 dark:bg-[#141b12]/80">
            <div>
              <span className="text-foreground">GROSS PROFIT</span>
              <span className="text-xs text-[#3E7000] dark:text-[#7FFF00] font-medium block">
                {pl.grossMarginPct}% of gross revenue
              </span>
            </div>
            <span className="font-mono text-[#3E7000] dark:text-[#7FFF00] text-lg font-extrabold">
              ৳{pl.grossProfit.toLocaleString()}
            </span>
          </div>

          {/* 3. OPERATING OVERHEAD (SG&A) */}
          <div className="p-5 space-y-3">
            <div className="flex justify-between items-center font-bold text-sm">
              <span className="uppercase text-xs tracking-wider text-rose-700 dark:text-rose-400">
                3. Operating Expenses & Overheads
              </span>
              <span className="font-mono text-rose-700 dark:text-rose-400 font-bold">
                -৳{pl.operatingExpenses.total.toLocaleString()}
              </span>
            </div>

            <div className="space-y-2 pl-4 text-slate-700 dark:text-slate-300">
              <div className="flex justify-between">
                <span>Team Salaries & Payroll Disbursements</span>
                <span className="font-mono font-medium text-foreground">
                  ৳{pl.operatingExpenses.teamPayroll.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Cloud & SaaS Subscriptions (AWS, Vercel, Figma, OpenAI, Adobe, G-Suite)</span>
                <span className="font-mono font-medium text-foreground">
                  ৳{pl.operatingExpenses.saasAndCloudSubscriptions.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Office Rent, Electricity & High-Speed Internet</span>
                <span className="font-mono font-medium text-foreground">
                  ৳{pl.operatingExpenses.officeRentAndUtilities.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Team Welfare, Refreshments & Office Supplies</span>
                <span className="font-mono font-medium text-foreground">
                  ৳{pl.operatingExpenses.teamWelfareAndRefreshment.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>General Administrative, Legal & Trade Fees</span>
                <span className="font-mono font-medium text-foreground">
                  ৳{pl.operatingExpenses.generalAdministrative.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* NET OPERATING PROFIT ROW */}
          <div className="p-5 flex justify-between items-center font-bold text-lg bg-[#070B06] text-white border-t-2 border-[#3E7000] dark:border-[#7FFF00]/40">
            <div>
              <span className="text-white">NET OPERATING PROFIT (EBITDA)</span>
              <span className="text-xs text-[#7FFF00] font-normal block font-mono">
                Available for retained reserve and partner dividend distribution
              </span>
            </div>
            <span className={`font-mono text-xl font-extrabold ${pl.netProfit >= 0 ? 'text-[#7FFF00]' : 'text-rose-400'}`}>
              ৳{pl.netProfit.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
