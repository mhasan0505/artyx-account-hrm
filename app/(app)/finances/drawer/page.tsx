'use client'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  autoOpenDrawerFromLastClose,
  getDrawerSessions,
  getLastClosedDrawer,
  getOpenDrawer,
  getReconciliationSummary,
  openDrawer,
} from '@/lib/actions/finance'
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  History,
  Info,
  Layers,
  RefreshCw,
  Sparkles,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap, 
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

type DrawerSession = Awaited<ReturnType<typeof getDrawerSessions>>[number]
type OpenDrawer = Awaited<ReturnType<typeof getOpenDrawer>>
type LastClosed = Awaited<ReturnType<typeof getLastClosedDrawer>>

function toLocalDateTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function DrawerManagementPage() {
  const [sessions, setSessions] = useState<DrawerSession[]>([])
  const [openSession, setOpenSession] = useState<OpenDrawer>(null)
  const [lastClosed, setLastClosed] = useState<LastClosed>(null)
  const [bankAccounts, setBankAccounts] = useState<any[]>([])
  const [outletId, setOutletId] = useState<string>('')
  const [opening, setOpening] = useState('0')
  const [openingAt, setOpeningAt] = useState(() =>
    toLocalDateTimeInputValue(new Date())
  )
  const [physicalCount, setPhysicalCount] = useState('')
  const [showCountVerification, setShowCountVerification] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function load(oid: string) {
    if (!oid) return
    const [all, current, recon, lc] = await Promise.all([
      getDrawerSessions(oid),
      getOpenDrawer(oid),
      getReconciliationSummary(oid),
      getLastClosedDrawer(oid),
    ])
    setSessions(all)
    setOpenSession(current)
    setBankAccounts(recon.bankAccounts)
    setLastClosed(lc)
  }

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(s => {
        const oid = s?.user?.outletId ?? ''
        setOutletId(oid)
        if (oid) load(oid)
      })
  }, [])

  // ── Auto-open (one-click carry-forward if needed) ──────────────────────────
  function handleAutoOpen() {
    if (!outletId) return
    startTransition(async () => {
      const res = await autoOpenDrawerFromLastClose(outletId)

      if (res.opened) {
        toast.success(
          `Drawer opened — ৳${res.openingBalance.toLocaleString('en-IN')} carried forward`
        )
        await load(outletId)
        return
      }

      switch (res.reason) {
        case 'already_open':
          toast.info('Drawer is already open for today')
          await load(outletId)
          break
        case 'no_history':
          setLastClosed(null)
          toast.info('No previous session found — enter starting float below')
          break
        case 'invalid_closing_balance':
          toast.error('Previous closing balance is invalid. Open manually.')
          setLastClosed(null)
          break
        case 'error':
        default:
          toast.error(res.message || 'Failed to open drawer')
          break
      }
    })
  }

  // ── Manual initial float setup ─────────────────────────────────────────────
  function handleOpen() {
    const amt = Number(opening)
    if (isNaN(amt) || amt < 0) {
      toast.error('Enter valid starting float (0 or more)')
      return
    }

    const selectedOpenedAt = openingAt ? new Date(openingAt) : undefined
    if (selectedOpenedAt && Number.isNaN(selectedOpenedAt.getTime())) {
      toast.error('Enter a valid opening date')
      return
    }

    if (selectedOpenedAt && selectedOpenedAt.getTime() > Date.now()) {
      toast.error('Open date cannot be in the future')
      return
    }

    startTransition(async () => {
      const res = await openDrawer(amt, outletId, selectedOpenedAt)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('Starting cash drawer initialized and opened!')
      setOpening('0')
      setOpeningAt(toLocalDateTimeInputValue(new Date()))
      await load(outletId)
    })
  }

  // ── Calculated Breakdowns ──────────────────────────────────────────────────
  const txList = openSession?.transactions ?? []
  const openingBal = Number(openSession?.openingBalance || 0)

  let cashSalesTotal = 0
  let cashInflowsTotal = 0
  let cashOutflowsTotal = 0

  for (const t of txList) {
    const amt = Number(t.amount || 0)
    if (t.type === 'OPENING') continue

    if (t.type === 'SALE') {
      cashSalesTotal += amt
    } else if (amt > 0) {
      cashInflowsTotal += amt
    } else {
      cashOutflowsTotal += Math.abs(amt)
    }
  }

  const runningBalance = txList.length > 0
    ? txList.reduce(
        (s, t) => s + Number(t.amount),
        txList.some(t => t.type === 'OPENING') ? 0 : openingBal
      )
    : openingBal

  const totalBankBalance = useMemo(() => {
    return bankAccounts.reduce((sum, b) => sum + Number(b.currentBalance || 0), 0)
  }, [bankAccounts])

  const totalLiquidity = (openSession ? runningBalance : 0) + totalBankBalance

  const parsedPhysicalCount = physicalCount !== '' ? Number(physicalCount) : null
  const variance = parsedPhysicalCount !== null && !isNaN(parsedPhysicalCount)
    ? parsedPhysicalCount - runningBalance
    : null

  return (
    <div className="w-full space-y-6 pb-12">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        title="Cash Drawer & Daily Reconciliation"
        description="Automated daily cash drawer with midnight balance rollover, continuous ledger audit, and liquidity reconciliation."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(outletId)}
              disabled={isPending || !outletId}
              className="pressable gap-1.5 shadow-2xs h-9 px-3"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Link href="/finances/cash">
              <Button size="sm" className="pressable gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-3.5">
                <Coins className="h-4 w-4" />
                Cash In / Cash Out
              </Button>
            </Link>
          </div>
        }
      />

      {/* ── Top Metric Cards (Full-Width 4-Card Responsive Grid) ────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Cash in Drawer */}
        <Card className="shadow-xs border bg-card transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Cash in Drawer
              </p>
              <div className="text-2xl font-bold tracking-tight text-foreground font-mono mt-1">
                {openSession ? `৳${runningBalance.toLocaleString('en-IN')}` : '৳0'}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                {openSession ? (
                  <>
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">Register Open</span>
                  </>
                ) : (
                  <>
                    <span className="size-1.5 rounded-full bg-slate-400" />
                    <span>Not Initialized</span>
                  </>
                )}
              </div>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Metric 2: Today's Cash Sales */}
        <Card className="shadow-xs border bg-card transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Today&apos;s Cash Sales
              </p>
              <div className="text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 font-mono mt-1">
                +৳{cashSalesTotal.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Direct POS counter receipts
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Metric 3: Total Bank & MFS Accounts */}
        <Card className="shadow-xs border bg-card transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Bank & MFS Balance
              </p>
              <div className="text-2xl font-bold tracking-tight text-foreground font-mono mt-1">
                ৳{totalBankBalance.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {bankAccounts.length} {bankAccounts.length === 1 ? 'account' : 'accounts'} connected
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Metric 4: Total Liquid Assets */}
        <Card className="shadow-xs border bg-card transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Liquidity
              </p>
              <div className="text-2xl font-bold tracking-tight text-primary font-mono mt-1">
                ৳{totalLiquidity.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Total Cash + Bank balances
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Layers className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Active Session or Initializer Card (Full Width) ─────────────────── */}
      {openSession ? (
        /* ── Active Auto-Managed Drawer ────────────────────────────────────── */
        <Card className="shadow-xs border border-emerald-200/90 bg-gradient-to-b from-emerald-50/40 via-card to-card dark:from-emerald-950/20 dark:via-card dark:to-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                </span>
                <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
                  Active Cash Drawer Session
                </h3>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700">
                  AUTO-MANAGED
                </span>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
                Session opened on{' '}
                <strong className="text-foreground">
                  {new Date(openSession.openedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </strong>{' '}
                at{' '}
                <strong className="text-foreground">
                  {new Date(openSession.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </strong>
                {openSession.openedBy?.name ? ` · Cashier: ${openSession.openedBy.name}` : ''}
              </p>
            </div>

            <div className="sm:text-right bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 rounded-xl px-4 py-2.5">
              <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
                Current Till Balance
              </span>
              <div className="text-3xl font-extrabold font-mono text-emerald-950 dark:text-emerald-50">
                ৳{runningBalance.toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          <CardContent className="p-5 sm:p-6 space-y-6">
            {/* 4 Inflow/Outflow Breakdown Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border bg-card p-4 space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-muted-foreground/80" /> Opening Float
                </span>
                <p className="text-xl font-bold font-mono text-foreground">
                  ৳{openingBal.toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-muted-foreground">Carried from previous midnight</p>
              </div>

              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/30 dark:bg-emerald-950/10 p-4 space-y-1">
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
                  <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" /> Cash Sales
                </span>
                <p className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                  +৳{cashSalesTotal.toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-muted-foreground">Counter sales cash payments</p>
              </div>

              <div className="rounded-xl border border-sky-200/80 bg-sky-50/30 dark:bg-sky-950/10 p-4 space-y-1">
                <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wide flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-sky-600" /> Cash Inflows
                </span>
                <p className="text-xl font-bold font-mono text-sky-700 dark:text-sky-400">
                  +৳{cashInflowsTotal.toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-muted-foreground">Cash In, customer receipts</p>
              </div>

              <div className="rounded-xl border border-rose-200/80 bg-rose-50/30 dark:bg-rose-950/10 p-4 space-y-1">
                <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wide flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-600" /> Cash Outflows
                </span>
                <p className="text-xl font-bold font-mono text-rose-700 dark:text-rose-400">
                  -৳{cashOutflowsTotal.toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-muted-foreground">Expenses, cash out, refunds</p>
              </div>
            </div>



            {/* Optional Physical Count Verification Accordion */}
            <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
              <button
                type="button"
                onClick={() => setShowCountVerification(v => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold text-foreground hover:text-primary transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-primary" />
                  Optional: Verify Physical Cash in Till
                </span>
                {showCountVerification ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showCountVerification && (
                <div className="pt-2 border-t space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Physical counts are completely optional. Enter what you currently count in the till to instantly check for variances without interrupting the session.
                  </p>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="w-full sm:w-72 space-y-1">
                      <Label className="text-xs">Physical Cash Count (৳)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={physicalCount}
                        onChange={e => setPhysicalCount(e.target.value)}
                        placeholder="e.g. 15000"
                        className="font-mono"
                      />
                    </div>
                    {variance !== null && (
                      <div className="text-xs font-semibold sm:mt-5">
                        {variance === 0 ? (
                          <span className="text-emerald-600 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg">
                            <CheckCircle2 className="w-4 h-4" /> Exact Match (৳0 variance)
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
                            variance > 0
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                          }`}>
                            {variance > 0 ? `+৳${variance.toLocaleString('en-IN')} Surplus` : `-৳${Math.abs(variance).toLocaleString('en-IN')} Shortage`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : lastClosed ? (
        /* ── Re-Open from Prior Session Banner ─────────────────────────────── */
        <Card className="border-sky-200 bg-sky-50/50 dark:bg-sky-950/20 shadow-xs p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-sky-600 shrink-0" />
                <h4 className="font-semibold text-base text-sky-950 dark:text-sky-100">
                  Ready to Start Today&apos;s Drawer
                </h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                The previous drawer session closed with <strong>৳{Number(lastClosed.closingBalance).toLocaleString('en-IN')}</strong>. Click below to open today&apos;s drawer with this carried-forward amount, or it will automatically open on the next cash transaction.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">Carry-forward float</span>
                <div className="text-2xl font-bold font-mono text-sky-950 dark:text-sky-50">
                  ৳{Number(lastClosed.closingBalance).toLocaleString('en-IN')}
                </div>
              </div>
              <Button
                id="auto-open-drawer-btn"
                onClick={handleAutoOpen}
                disabled={isPending || !outletId}
                className="pressable gap-2 bg-sky-600 hover:bg-sky-700 text-white shadow-xs"
              >
                <Zap className="w-4 h-4" />
                Open Today&apos;s Drawer
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        /* ── First-Time Register Initializer (Clean Full-Width Grid) ────────── */
        <Card className="shadow-xs border bg-card max-w-xl">
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Wallet className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-foreground">
                  Initialize Starting Cash Register
                </h3>
                <p className="text-xs text-muted-foreground">
                  Enter your physical cash float to open the register.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="initial-opening-float" className="text-xs font-medium">
                  Opening Float (৳)
                </Label>
                <Input
                  id="initial-opening-float"
                  type="number"
                  min={0}
                  step="1"
                  value={opening}
                  onChange={e => setOpening(e.target.value)}
                  placeholder="0"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="initial-opening-date" className="text-xs font-medium">
                  Date & Time
                </Label>
                <Input
                  id="initial-opening-date"
                  type="datetime-local"
                  value={openingAt}
                  onChange={e => setOpeningAt(e.target.value)}
                  max={toLocalDateTimeInputValue(new Date())}
                  className="text-xs"
                />
              </div>
            </div>

            <Button
              id="initialize-drawer-btn"
              onClick={handleOpen}
              disabled={isPending || !outletId}
              className="w-full sm:w-auto h-9 pressable gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs px-4 text-xs"
            >
              <Zap className="w-3.5 h-3.5" />
              Initialize & Open Register
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Connected Bank & MFS Accounts (Full Width Strip) ────────────────── */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4.5 h-4.5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">
              Connected Bank & MFS Accounts
            </h3>
          </div>
          <Link href="/finances/bank">
            <Button variant="outline" size="sm" className="text-xs h-8 px-3">
              Manage Accounts
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {bankAccounts.map(acc => {
            const isMfs = acc.isMfs || acc.bankName?.toLowerCase().includes('bkash') || acc.bankName?.toLowerCase().includes('nagad')
            return (
              <Card key={acc.id} className="shadow-2xs border hover:shadow-xs transition-all bg-card">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="space-y-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                        {isMfs ? <Smartphone className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
                      </div>
                      <p className="font-semibold text-sm text-foreground truncate">
                        {acc.bankName}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate pl-9">
                      {acc.accountName} {acc.accountNumber ? `· ${acc.accountNumber}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold font-mono text-foreground">
                      ৳{Number(acc.currentBalance || 0).toLocaleString('en-IN')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {bankAccounts.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
              No bank or MFS accounts configured yet.
            </div>
          )}
        </div>
      </div>

      {/* ── Daily Sessions History (Clean Full-Width Table) ─────────────────── */}
      <div className="space-y-3 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4.5 h-4.5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">
              Daily Sessions History
            </h3>
          </div>
          <span className="text-xs text-muted-foreground">
            Showing last 50 daily cash drawer sessions
          </span>
        </div>

        <Card className="shadow-xs border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-5 py-3.5 text-left">Session / Date</th>
                  <th className="px-5 py-3.5 text-left">Opened By</th>
                  <th className="px-5 py-3.5 text-center">Method</th>
                  <th className="px-5 py-3.5 text-right">Opening Float</th>
                  <th className="px-5 py-3.5 text-right">Closing Balance</th>
                  <th className="px-5 py-3.5 text-right">Variance</th>
                  <th className="px-5 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-12 text-center text-muted-foreground text-sm"
                    >
                      No cash drawer sessions recorded yet.
                    </td>
                  </tr>
                )}
                {sessions.map(s => {
                  const isAuto = (s as any).openMethod === 'AUTO' || (s as any).closeMethod === 'AUTO'
                  return (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-xs text-foreground">
                          {new Date(s.openedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {s.closedAt ? ` → ${new Date(s.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (current)'}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-foreground font-medium">
                        {s.openedBy?.name ?? 'System Rollover'}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                            isAuto
                              ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isAuto ? 'AUTO' : 'MANUAL'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-foreground">
                        ৳{Number(s.openingBalance || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-foreground">
                        {s.closingBalance != null
                          ? `৳${Number(s.closingBalance).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td
                        className={`px-5 py-3.5 text-right font-mono text-xs ${
                          s.variance != null && Number(s.variance) !== 0
                            ? 'text-rose-600 font-bold'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {s.variance != null
                          ? `৳${Number(s.variance).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            s.status === 'OPEN'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
