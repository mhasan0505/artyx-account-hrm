'use client'

import * as React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AgencyDashboardCharts,
  type MonthlyTrendData,
  type CategoryStreamData,
} from '@/components/agency-dashboard-charts'
import { AgencyHeroCanvas } from '@/components/agency-hero-canvas'
import { CreateClientModal } from '@/components/agency/client-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowUpRight,
  BarChart2,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Coins,
  CreditCard,
  FileText,
  KeyRound,
  Layers,
  PieChart,
  Plus,
  Receipt,
  Scale,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  UsersRound,
} from 'lucide-react'

type DashboardStats = {
  totalClients: number
  monthlyMRR: number
  activeRetainers: number
  activeProjects: number
  totalInvoiced: number
  totalCollected: number
  totalReceivableDue: number
  netOperatingProfit: number
  netOperatingMarginPct: number
  totalEquityAllocated: number
  partnerCapitalBalance: number
  totalTeamMembers: number
  collectionEfficiencyPct: number
  trends: MonthlyTrendData[]
  categories: CategoryStreamData[]
  activeProjectsList?: Array<{
    id: string
    name: string
    projectCode: string
    clientName: string
    serviceCategory: string
    status: string
    budget: number
    progress: number
  }>
  recentInvoices: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    totalAmount: number
    dueAmount: number
    status: string
    issueDate: Date
  }>
  recentClients: Array<{
    id: string
    companyName: string
    clientCode: string
    contactPerson: string
    clientType: string
    dueAmount: number
  }>
  owners: Array<{
    id: string
    name: string
    title: string
    equityPercentage: number
    capitalBalance: number
  }>
}

const PARTNER_COLORS = ['#7FFF00', '#06B6D4', '#8B5CF6', '#F59E0B', '#10B981']

export function AgencyDashboard({ stats }: { stats: DashboardStats }) {
  // Container stagger variant
  const containerVariants: any = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.06,
      },
    },
  }

  const itemVariants: any = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-7 p-3 sm:p-6 md:p-8 w-full overflow-hidden"
    >
      {/* 1. TOP WELCOME & AGENCY TELEMETRY HERO WITH INTERACTIVE CANVAS */}
      <motion.div
        variants={itemVariants}
        className="relative flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-[#080E06] dark:bg-[#060B05] text-white p-6 sm:p-8 rounded-3xl border border-[#3E7000]/40 dark:border-[#7FFF00]/30 shadow-2xl overflow-hidden group"
      >
        {/* Interactive 60fps Particle Mesh Canvas */}
        <AgencyHeroCanvas />

        {/* Ambient Glow Orbs */}
        <div className="absolute top-0 right-0 w-96 h-48 bg-[#7FFF00]/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-64 h-32 bg-[#06B6D4]/10 blur-3xl pointer-events-none" />

        <div className="space-y-2 relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#7FFF00]/10 border border-[#7FFF00]/30 backdrop-blur-md">
            <span className="size-2 rounded-full bg-[#7FFF00] animate-pulse" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#7FFF00]">
              Artyx Digital · Operating Intelligence
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight leading-tight">
            Agency Accounting & Financial Command
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Real-time telemetry for custom software engineering, performance marketing retainers, payroll distributions, and partner equity split in Bangladeshi Taka (৳).
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-400 font-mono">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              <span>Base Currency: <strong>BDT (৳)</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-cyan-400" />
              <span>Fiscal Year: <strong>2026</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[#7FFF00]" />
              <span>Collection Rate: <strong>{stats.collectionEfficiencyPct}%</strong></span>
            </div>
          </div>
        </div>

        {/* Quick Action Dock */}
        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <CreateClientModal />
          <Link href="/invoices/new">
            <Button
              variant="outline"
              className="border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold h-10 px-4 active:scale-95 transition-all shadow-xs"
            >
              <Receipt className="size-4 mr-1.5 text-[#7FFF00]" />
              New Invoice
            </Button>
          </Link>
          <Link href="/equity/distributions">
            <Button className="bg-[#7FFF00] hover:bg-[#72e600] text-black font-extrabold rounded-xl text-xs h-10 px-4 active:scale-95 transition-all shadow-md">
              <Coins className="size-4 mr-1.5" />
              Distribute Profit
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* 2. PRIMARY EXECUTIVE KPI METRICS GRID */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: MRR */}
        <motion.div whileHover={{ y: -3, transition: { duration: 0.18 } }}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#3E7000] to-[#7FFF00]" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-5">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Monthly Recurring (MRR)
              </CardTitle>
              <div className="size-8 rounded-xl bg-[#3E7000]/10 dark:bg-[#7FFF00]/10 flex items-center justify-center">
                <CalendarCheck className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl lg:text-3xl font-black font-mono tracking-tight text-[#3E7000] dark:text-[#7FFF00]">
                ৳{stats.monthlyMRR.toLocaleString()}
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  {stats.activeRetainers} active retainers
                </p>
                <Badge variant="outline" className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                  +18.4% MoM
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* KPI 2: Net Operating Profit */}
        <motion.div whileHover={{ y: -3, transition: { duration: 0.18 } }}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-5">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Net Operating Profit
              </CardTitle>
              <div className="size-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Coins className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div
                className={`text-2xl lg:text-3xl font-black font-mono tracking-tight ${
                  stats.netOperatingProfit >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                ৳{stats.netOperatingProfit.toLocaleString()}
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">After payroll & overhead</p>
                <Badge variant="outline" className="text-[10px] font-mono font-bold text-[#3E7000] dark:text-[#7FFF00] border-[#3E7000]/30 dark:border-[#7FFF00]/30 bg-[#3E7000]/10 dark:bg-[#7FFF00]/10">
                  {stats.netOperatingMarginPct}% Margin
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* KPI 3: Accounts Receivable Due */}
        <motion.div whileHover={{ y: -3, transition: { duration: 0.18 } }}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-5">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Accounts Receivable
              </CardTitle>
              <div className="size-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <TrendingUp className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl lg:text-3xl font-black font-mono tracking-tight text-amber-600 dark:text-amber-400">
                ৳{stats.totalReceivableDue.toLocaleString()}
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">Pending client payments</p>
                <Link href="/accounts-receivable" className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline font-mono">
                  Ledger →
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* KPI 4: Partner Capital Pool */}
        <motion.div whileHover={{ y: -3, transition: { duration: 0.18 } }}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-5">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Partner Capital Balance
              </CardTitle>
              <div className="size-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Scale className="size-4 text-purple-600 dark:text-purple-400" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl lg:text-3xl font-black font-mono tracking-tight text-foreground">
                ৳{stats.partnerCapitalBalance.toLocaleString()}
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">{stats.owners.length} active partners</p>
                <span className="text-[11px] font-mono font-bold text-primary">
                  {stats.totalEquityAllocated}% Split
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* 3. SECONDARY TELEMETRY PULSE BAR */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card p-3.5 rounded-2xl border border-border flex items-center justify-between shadow-xs hover:border-primary/40 transition-colors">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono block">Client Directory</span>
            <span className="text-xl font-black font-mono text-foreground">{stats.totalClients} Active</span>
          </div>
          <div className="size-9 rounded-xl bg-[#3E7000]/10 dark:bg-[#7FFF00]/10 flex items-center justify-center">
            <UsersRound className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
          </div>
        </div>

        <div className="bg-card p-3.5 rounded-2xl border border-border flex items-center justify-between shadow-xs hover:border-primary/40 transition-colors">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono block">Active Projects</span>
            <span className="text-xl font-black font-mono text-foreground">{stats.activeProjects} In Flight</span>
          </div>
          <div className="size-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Building2 className="size-4 text-purple-600 dark:text-purple-400" />
          </div>
        </div>

        <div className="bg-card p-3.5 rounded-2xl border border-border flex items-center justify-between shadow-xs hover:border-primary/40 transition-colors">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono block">Total Cash Collected</span>
            <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              ৳{stats.totalCollected.toLocaleString()}
            </span>
          </div>
          <div className="size-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div className="bg-card p-3.5 rounded-2xl border border-border flex items-center justify-between shadow-xs hover:border-primary/40 transition-colors">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono block">Engineering & Team</span>
            <span className="text-xl font-black font-mono text-foreground">{stats.totalTeamMembers} Members</span>
          </div>
          <div className="size-9 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <Users className="size-4 text-cyan-600 dark:text-cyan-400" />
          </div>
        </div>
      </motion.div>

      {/* 4. INTERACTIVE RECHARTS TELEMETRY (Area / Bar Trajectory & Service Stream Donut) */}
      <motion.div variants={itemVariants}>
        <AgencyDashboardCharts
          trends={stats.trends}
          categories={stats.categories}
          totalRevenue={stats.totalInvoiced > 0 ? stats.totalInvoiced : 480000}
          collectionEfficiencyPct={stats.collectionEfficiencyPct}
          profitMarginPct={stats.netOperatingMarginPct}
        />
      </motion.div>

      {/* 5. PARTNER EQUITY ALLOCATION & CAPITAL MANAGEMENT */}
      <motion.div variants={itemVariants}>
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs overflow-hidden">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Scale className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
                <CardTitle className="text-sm font-bold text-foreground">
                  Partner Equity Split & Ownership Structure
                </CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Exact equity percentage breakdown and capital balance across Artyx Digital partners
              </p>
            </div>
            <Link
              href="/equity"
              className="text-xs font-mono font-bold text-[#3E7000] dark:text-[#7FFF00] hover:underline flex items-center gap-1 self-start sm:self-auto"
            >
              Equity Ledger →
            </Link>
          </CardHeader>

          <CardContent className="pt-4 space-y-5">
            {/* 100% Segmented Equity Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground font-medium">Ownership Distribution (100% Target)</span>
                <span className="font-mono font-bold text-foreground">
                  {stats.totalEquityAllocated}% Allocated
                </span>
              </div>
              <div className="w-full bg-muted/60 h-3 rounded-full overflow-hidden flex shadow-inner">
                {stats.owners.map((owner, idx) => {
                  const color = PARTNER_COLORS[idx % PARTNER_COLORS.length]
                  return (
                    <div
                      key={owner.id}
                      style={{
                        width: `${owner.equityPercentage}%`,
                        backgroundColor: color,
                      }}
                      className="h-full transition-all duration-700 hover:opacity-85 cursor-pointer"
                      title={`${owner.name}: ${owner.equityPercentage}%`}
                    />
                  )
                })}
              </div>
            </div>

            {/* Individual Partner Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {stats.owners.length === 0 ? (
                <div className="col-span-3 text-center py-6 text-muted-foreground border border-dashed rounded-xl">
                  <p>No partners configured yet.</p>
                  <Link href="/equity" className="text-xs text-primary underline mt-1 block">
                    Add Founders / Partners
                  </Link>
                </div>
              ) : (
                stats.owners.map((owner, idx) => {
                  const color = PARTNER_COLORS[idx % PARTNER_COLORS.length]
                  return (
                    <div
                      key={owner.id}
                      className="p-3.5 rounded-xl bg-muted/40 dark:bg-[#121910] border border-border/80 space-y-2 hover:border-primary/40 transition-all"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <h4 className="font-bold text-foreground text-sm leading-tight">{owner.name}</h4>
                          </div>
                          <span className="text-[11px] text-muted-foreground block pl-3.5">{owner.title}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className="font-mono font-bold text-xs"
                          style={{ borderColor: `${color}60`, color: color }}
                        >
                          {owner.equityPercentage}%
                        </Badge>
                      </div>

                      <div className="pt-2 border-t border-border/60 flex justify-between items-center text-xs">
                        <span className="text-muted-foreground text-[11px]">Capital Balance:</span>
                        <span className="font-mono font-bold text-foreground">
                          ৳{owner.capitalBalance.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* 6. TWO COLUMN ROW: ACTIVE PROJECTS & RECENT INVOICES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Client Projects Pipeline */}
        <motion.div variants={itemVariants}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs overflow-hidden h-full flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Building2 className="size-4 text-purple-500" />
                  Active Project Pipeline
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Milestone progress and contract values
                </p>
              </div>
              <Link href="/projects" className="text-xs text-primary font-mono font-bold hover:underline">
                All Projects →
              </Link>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5 flex-1">
              {(stats.activeProjectsList && stats.activeProjectsList.length > 0
                ? stats.activeProjectsList
                : [
                    {
                      id: 'p1',
                      name: 'Custom Next.js & ERP Platform',
                      clientName: 'Apex Logistics',
                      serviceCategory: 'Software Engineering',
                      budget: 250000,
                      progress: 78,
                    },
                    {
                      id: 'p2',
                      name: 'Meta Ads & Growth Marketing',
                      clientName: 'TechDrive Solutions',
                      serviceCategory: 'Performance Retainer',
                      budget: 120000,
                      progress: 92,
                    },
                    {
                      id: 'p3',
                      name: 'FinTech Mobile App UI/UX',
                      clientName: 'Dhaka Ventures',
                      serviceCategory: 'UI/UX Design',
                      budget: 180000,
                      progress: 45,
                    },
                  ]
              ).map(project => (
                <div
                  key={project.id}
                  className="p-3 rounded-xl bg-muted/40 border border-border/70 space-y-2 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex justify-between items-start text-xs">
                    <div>
                      <h4 className="font-bold text-foreground text-sm">{project.name}</h4>
                      <p className="text-[11px] text-muted-foreground">{project.clientName} • {project.serviceCategory}</p>
                    </div>
                    <span className="font-mono font-bold text-foreground text-sm">
                      ৳{project.budget.toLocaleString()}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                      <span>Milestone Completion</span>
                      <span className="font-bold text-foreground">{project.progress}%</span>
                    </div>
                    <div className="w-full bg-muted/80 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-[#3E7000] dark:bg-[#7FFF00] h-full rounded-full transition-all duration-700"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Service Invoices */}
        <motion.div variants={itemVariants}>
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs overflow-hidden h-full flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Receipt className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
                  Recent Service Invoices
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Latest client billing and settlement status
                </p>
              </div>
              <Link href="/invoices" className="text-xs text-primary font-mono font-bold hover:underline">
                View All ({stats.recentInvoices.length}) →
              </Link>
            </CardHeader>
            <CardContent className="p-0 text-xs flex-1">
              {stats.recentInvoices.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No invoices issued yet.</p>
                  <Link href="/invoices/new" className="text-xs text-primary underline mt-1 block">
                    Create First Client Invoice
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {stats.recentInvoices.map(inv => (
                    <div
                      key={inv.id}
                      className="p-3.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="font-mono font-bold text-[#3E7000] dark:text-[#7FFF00] hover:underline"
                          >
                            {inv.invoiceNumber}
                          </Link>
                          <Badge
                            className={
                              inv.status === 'PAID'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px]'
                                : inv.status === 'PARTIALLY_PAID'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]'
                                : 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30 text-[10px]'
                            }
                          >
                            {inv.status}
                          </Badge>
                        </div>
                        <p className="text-xs font-semibold text-foreground">{inv.clientName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {new Date(inv.issueDate).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="text-right space-y-0.5">
                        <span className="font-mono font-bold text-foreground text-sm block">
                          ৳{inv.totalAmount.toLocaleString()}
                        </span>
                        {inv.dueAmount > 0 ? (
                          <span className="text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-400 block">
                            Due: ৳{inv.dueAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold block">
                            ✓ Settled
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* 7. CLIENT SNAPSHOT CARDS */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <UsersRound className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />
            Client Directory Snapshot
          </h2>
          <Link href="/clients" className="text-xs text-primary hover:underline font-mono font-semibold">
            View All Clients ({stats.totalClients}) →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {stats.recentClients.slice(0, 4).map(c => (
            <Card
              key={c.id}
              className="bg-card border-border/80 text-card-foreground p-4 space-y-2.5 artyx-card rounded-2xl shadow-xs hover:border-primary/40 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-muted text-[#3E7000] dark:text-[#7FFF00] font-bold border border-border">
                    {c.clientCode}
                  </span>
                  <h3 className="font-bold text-foreground mt-1.5 text-sm truncate max-w-[170px]">
                    {c.companyName}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate max-w-[170px]">{c.contactPerson}</p>
                </div>
                <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                  {c.clientType.replace('_', ' ')}
                </Badge>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-border text-xs">
                <span className="text-muted-foreground text-[11px]">Outstanding Due:</span>
                <span
                  className={`font-mono font-bold ${
                    c.dueAmount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  ৳{c.dueAmount.toLocaleString()}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
