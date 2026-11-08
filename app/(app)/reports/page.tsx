import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  BarChart2,
  BookOpen,
  ChevronRight,
  CreditCard,
  FileText,
  PieChart,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'

const AGENCY_REPORTS = [
  {
    id: 'pnl',
    title: 'Profit & Loss (P&L) Statement',
    description: 'EBITDA, Net Operating Profit margin, software deliverable revenue, and agency overhead breakdown.',
    href: '/finances/profit-loss',
    icon: PieChart,
    badge: 'Real-Time Telemetry',
    color: 'text-[#3E7000] dark:text-[#7FFF00]',
  },
  {
    id: 'project-profitability',
    title: 'Project & Service Margins',
    description: 'Detailed contract values, billings collected, direct freelancer/SaaS costs, and net delivery margins.',
    href: '/finances/project-profitability',
    icon: BarChart2,
    badge: 'Margin Intelligence',
    color: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    id: 'accounts-receivable',
    title: 'Accounts Receivable & Aging',
    description: 'Aging buckets (Current, 1-30, 31-60, 60+ days overdue), unpaid client invoices, and collections ledger.',
    href: '/accounts-receivable',
    icon: TrendingUp,
    badge: 'Cash Flow',
    color: 'text-amber-600 dark:text-amber-400',
  },
  {
    id: 'general-ledger',
    title: 'General Ledger & Transactions',
    description: 'Complete double-entry journal entries, chart of accounts debits and credits, and transaction audit trails.',
    href: '/ledger/transactions',
    icon: BookOpen,
    badge: 'Audit Grade',
    color: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    id: 'audit-logs',
    title: 'System Audit Logs',
    description: 'Security log of user actions, authorization events, equity updates, and master record modifications.',
    href: '/reports/audit',
    icon: ShieldAlert,
    badge: 'Compliance',
    color: 'text-rose-600 dark:text-rose-400',
  },
]

export default function ReportsHubPage() {
  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="border-b border-border pb-5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#3E7000] dark:bg-[#7FFF00]" />
          <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
            Agency Financial & Audit Reports
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Executive financial reporting, profitability telemetry, and compliance audit records for Artyx Digital
        </p>
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {AGENCY_REPORTS.map(rep => {
          const Icon = rep.icon
          return (
            <Card
              key={rep.id}
              className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between hover:border-primary/40 transition-all group"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 rounded-xl bg-muted/60 border border-border group-hover:bg-muted transition-colors">
                    <Icon className={`size-5 ${rep.color}`} />
                  </div>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                    {rep.badge}
                  </span>
                </div>
                <CardTitle className="text-base font-bold text-foreground mt-3 group-hover:text-primary transition-colors">
                  {rep.title}
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4 pt-0 text-xs text-muted-foreground">
                <p className="line-clamp-2 leading-relaxed">{rep.description}</p>
                <div className="pt-2 border-t border-border flex justify-end">
                  <Link href={rep.href}>
                    <Button size="sm" variant="ghost" className="text-xs text-foreground group-hover:text-primary gap-1">
                      Open Report
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
