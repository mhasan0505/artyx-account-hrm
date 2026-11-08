'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Wallet,
  Building2,
  Smartphone,
  ArrowRightLeft,
  Coins,
  CheckCircle2,
  Sparkles,
  DollarSign,
  TrendingUp,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import { ApArOverviewData } from '@/lib/actions/ap-ar'

const fmt = (n: number) =>
  `৳${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

interface Props {
  liquidity: ApArOverviewData['liquidity']
}

export function LiquiditySummary({ liquidity }: Props) {
  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Cash Balance */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default">
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Total Cash</p>
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <DollarSign className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl lg:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-foreground">
              {fmt(liquidity.totalCashBalance)}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                {liquidity.openDrawersCount} open drawer{liquidity.openDrawersCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Commercial Bank */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default">
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Bank Balance</p>
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <Building2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl lg:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-foreground">
              {fmt(liquidity.totalBankBalance)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2 font-medium">Commercial accounts total</p>
          </div>
        </div>

        {/* MFS Wallets */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default">
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">MFS Wallets</p>
              <div className="p-1.5 bg-muted text-muted-foreground rounded-lg">
                <Smartphone className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl lg:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-foreground">
              {fmt(liquidity.totalMfsBalance)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2 font-medium">bKash · Nagad · Rocket</p>
          </div>
        </div>

        {/* Net Liquidity */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default">
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                Net Liquidity
                <Sparkles className="w-3 h-3 text-primary" />
              </p>
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <Coins className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl lg:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-primary">
              {fmt(liquidity.netLiquidAssets)}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <TrendingUp className="w-3 h-3 text-primary" />
              <p className="text-[11px] text-muted-foreground font-medium">Cash + Bank + MFS</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contra Transfer Banner ── */}
      <div className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5">
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-primary/10 rounded-lg">
                <ArrowRightLeft className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-bold text-sm text-foreground">Liquidity & Fund Transfers</h3>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold uppercase tracking-wider">
                Contra Vouchers
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground pl-[34px]">
              Transfer funds between physical cash drawers and bank or mobile financial wallets.
            </p>
          </div>
          <Button
            asChild
            size="sm"
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm border-0 font-semibold text-xs rounded-xl h-9 shrink-0 pressable"
          >
            <Link href="/finances/transfers">
              <ArrowRightLeft className="w-3.5 h-3.5" />
              New Contra Transfer
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Cash Drawers Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
            Active Cash Registers
          </h4>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
            {liquidity.drawers.length}
          </span>
        </div>

        {liquidity.drawers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-border text-muted-foreground gap-2">
            <Wallet className="w-8 h-8 opacity-30" />
            <p className="text-sm font-medium">No open cash drawers at the moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liquidity.drawers.map(d => (
              <div
                key={d.id}
                className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                {/* Active badge */}
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Active
                  </span>
                </div>

                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{d.openedBy}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[11px] text-muted-foreground font-medium">Shift: {d.shift}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>Opening Balance</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">{fmt(d.openingBalance)}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Cash</span>
                    <span className="text-xl font-extrabold font-mono tabular-nums tracking-tight text-primary">
                      {fmt(d.currentBalance)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bank & MFS Accounts ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
            Bank & Mobile Financial Accounts
          </h4>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
            {liquidity.bankAccounts.length}
          </span>
        </div>

        {liquidity.bankAccounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-border text-muted-foreground gap-2">
            <Building2 className="w-8 h-8 opacity-30" />
            <p className="text-sm font-medium">No bank or MFS accounts configured yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liquidity.bankAccounts.map(acc => (
              <div
                key={acc.id}
                className="relative overflow-hidden rounded-2xl bg-card border border-transparent shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
                      {acc.isMfs ? <Smartphone className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground truncate max-w-[140px]">{acc.bankName}</p>
                      <p className="text-[11px] text-muted-foreground font-medium truncate max-w-[140px]">{acc.accountName}</p>
                    </div>
                  </div>
                  <Badge className="text-[10px] font-bold shrink-0 bg-muted text-muted-foreground">
                    {acc.isMfs ? 'MFS' : 'Bank'}
                  </Badge>
                </div>

                <p className="text-[11px] font-mono text-muted-foreground mb-3">{acc.accountNumber}</p>

                <div className="h-px bg-border mb-3" />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-medium">Current Balance</span>
                  <span className="text-xl font-extrabold font-mono tabular-nums tracking-tight text-primary">
                    {fmt(acc.currentBalance)}
                  </span>
                </div>

                {acc.isMfs && (
                  <div className="mt-3 flex justify-between text-[11px] bg-muted/40 rounded-xl px-3 py-2 font-medium text-muted-foreground">
                    <span>Tx Charge: <strong className="text-foreground tabular-nums">{acc.transactionChargePct}%</strong></span>
                    <span>Cashout: <strong className="text-foreground tabular-nums">{acc.cashoutChargePct}%</strong></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
