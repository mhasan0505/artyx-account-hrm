'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  Crown,
  Edit3,
  Lock,
  Plus,
  Scale,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'
import { RecordDrawingModal } from '@/components/agency/drawing-modal'
import { deleteAgencyOwner } from '@/lib/actions/agency-equity'
import {
  deleteInvestorAction,
  deleteInvestorSegmentAction,
  deleteShareholderAction,
} from '@/lib/actions/ceo-cap-table'
import {
  EquityRebalanceModal,
  InvestorFormModal,
  InvestorSegmentFormModal,
  PartnerFormModal,
  ShareholderFormModal,
  type CapTableData,
  type ExecutiveCandidateItem,
  type InvestorItem,
  type InvestorSegmentItem,
  type PartnerItem,
  type ShareholderItem,
} from '@/components/equity/ceo-cap-table-modals'

export type CapTableTab = 'partners' | 'shareholders' | 'investors'

const TABS: Array<{ id: CapTableTab; label: string }> = [
  { id: 'partners', label: 'Partners & Equity' },
  { id: 'shareholders', label: 'Shareholders' },
  { id: 'investors', label: 'Investor Segments' },
]

const RIBBON_TONES = [
  'bg-primary',
  'bg-foreground/75',
  'bg-foreground/50',
  'bg-foreground/30',
  'bg-muted-foreground/50',
]

function fmt(val: number): string {
  return `৳${Math.round(val).toLocaleString('en-US')}`
}

function fmtCompact(val: number): string {
  const abs = Math.abs(val)
  if (abs >= 10_000_000) return `৳${(val / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `৳${(val / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `৳${(val / 1_000).toFixed(0)}k`
  return `৳${Math.round(val)}`
}

export function CeoEquityCommandClient({
  data,
  initialTab = 'partners',
}: {
  data: CapTableData
  initialTab?: CapTableTab
}) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const [tab, setTab] = React.useState<CapTableTab>(initialTab)
  const [selectedSegmentFilter, setSelectedSegmentFilter] = React.useState<string>('ALL')

  // Partner modals
  const [partnerModalOpen, setPartnerModalOpen] = React.useState(false)
  const [editingPartner, setEditingPartner] = React.useState<PartnerItem | null>(null)
  const [selectedExecutive, setSelectedExecutive] =
    React.useState<ExecutiveCandidateItem | null>(null)
  const [rebalanceOpen, setRebalanceOpen] = React.useState(false)

  // Shareholder modals
  const [shModalOpen, setShModalOpen] = React.useState(false)
  const [editingSh, setEditingSh] = React.useState<ShareholderItem | null>(null)

  // Segment & Investor modals
  const [segModalOpen, setSegModalOpen] = React.useState(false)
  const [editingSeg, setEditingSeg] = React.useState<InvestorSegmentItem | null>(null)
  const [invModalOpen, setInvModalOpen] = React.useState(false)
  const [editingInv, setEditingInv] = React.useState<InvestorItem | null>(null)
  const [defaultInvSegId, setDefaultInvSegId] = React.useState<string | null>(null)

  const {
    isCeo,
    summary,
    owners,
    shareholders,
    segments,
    investors,
    bankAccounts,
    executiveCandidates,
  } = data
  const availableExecutives = React.useMemo(
    () => executiveCandidates.filter(c => !c.isAlreadyPartner),
    [executiveCandidates]
  )
  const remainingPartnerEquity = Math.max(0, 100 - summary.totalPartnerEquityPct)

  const filteredInvestors = React.useMemo(() => {
    if (selectedSegmentFilter === 'ALL') return investors
    if (selectedSegmentFilter === 'UNASSIGNED') {
      return investors.filter(i => !i.segmentId)
    }
    return investors.filter(i => i.segmentId === selectedSegmentFilter)
  }, [investors, selectedSegmentFilter])

  async function handleDeletePartner(p: PartnerItem) {
    if (
      !window.confirm(
        `Permanently remove partner "${p.name}" (${p.equityPercentage}% equity) and their linked ledger/drawing history?`
      )
    ) {
      return
    }
    try {
      await deleteAgencyOwner(p.id)
      toast.success(`Partner "${p.name}" removed.`)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete partner')
    }
  }

  async function handleDeleteShareholder(sh: ShareholderItem) {
    if (!window.confirm(`Delete shareholder "${sh.name}" from the cap table?`)) return
    try {
      await deleteShareholderAction(sh.id)
      toast.success(`Shareholder "${sh.name}" deleted.`)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete shareholder')
    }
  }

  async function handleDeleteSegment(seg: InvestorSegmentItem) {
    if (
      !window.confirm(
        `Delete investor segment "${seg.name}"? Investors in this segment will be unassigned (not deleted).`
      )
    ) {
      return
    }
    try {
      await deleteInvestorSegmentAction(seg.id)
      toast.success(`Segment "${seg.name}" deleted.`)
      if (selectedSegmentFilter === seg.id) setSelectedSegmentFilter('ALL')
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete segment')
    }
  }

  async function handleDeleteInvestor(inv: InvestorItem) {
    if (!window.confirm(`Delete investor "${inv.name}"?`)) return
    try {
      await deleteInvestorAction(inv.id)
      toast.success(`Investor "${inv.name}" deleted.`)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete investor')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* CEO CRUD Modals */}
      {isCeo ? (
        <>
          <PartnerFormModal
            open={partnerModalOpen}
            onOpenChange={open => {
              setPartnerModalOpen(open)
              if (!open) setSelectedExecutive(null)
            }}
            partner={editingPartner}
            remainingEquity={remainingPartnerEquity}
            executiveCandidates={executiveCandidates}
            initialExecutive={selectedExecutive}
          />
          <EquityRebalanceModal
            open={rebalanceOpen}
            onOpenChange={setRebalanceOpen}
            owners={owners.filter(o => o.isActive)}
          />
          <ShareholderFormModal
            open={shModalOpen}
            onOpenChange={setShModalOpen}
            shareholder={editingSh}
          />
          <InvestorSegmentFormModal
            open={segModalOpen}
            onOpenChange={setSegModalOpen}
            segment={editingSeg}
          />
          <InvestorFormModal
            open={invModalOpen}
            onOpenChange={setInvModalOpen}
            investor={editingInv}
            segments={segments}
            defaultSegmentId={defaultInvSegId}
          />
        </>
      ) : null}

      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            {isCeo ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                <Crown className="size-3" />
                CEO ULTIMATE AUTHORITY
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/[0.12] bg-muted/60 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                <Lock className="size-3" />
                READ-ONLY · CEO GOVERNANCE REQUIRED
              </span>
            )}
            <span className="opacity-35">/</span>
            <span>CAP TABLE, SHAREHOLDERS &amp; INVESTORS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Equity, Shareholders &amp; Investor Command
          </h1>
          <p className="text-xs text-muted-foreground">
            Centralized ownership governance — manage partners, rebalance equity percentages, maintain the shareholder registry, and build investor segments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/equity/drawings"
            className="inline-flex h-9 items-center rounded-xl border border-foreground/[0.1] bg-card px-3 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Drawings Log
          </Link>
          <Link
            href="/equity/distributions"
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-foreground/[0.1] bg-card px-3 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            <span>Distribute Profit</span>
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Link>
          {isCeo && tab === 'partners' ? (
            <>
              {owners.filter(o => o.isActive).length > 0 ? (
                <button
                  type="button"
                  onClick={() => setRebalanceOpen(true)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground hover:bg-muted/60"
                >
                  <SlidersHorizontal className="size-3.5" />
                  <span>Rebalance %</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEditingPartner(null)
                  setPartnerModalOpen(true)
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
              >
                <Plus className="size-3.5" />
                <span>New Partner</span>
              </button>
            </>
          ) : null}
          {isCeo && tab === 'shareholders' ? (
            <button
              type="button"
              onClick={() => {
                setEditingSh(null)
                setShModalOpen(true)
              }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
            >
              <Plus className="size-3.5" />
              <span>Add Shareholder</span>
            </button>
          ) : null}
          {isCeo && tab === 'investors' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingSeg(null)
                  setSegModalOpen(true)
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground hover:bg-muted/60"
              >
                <Plus className="size-3.5" />
                <span>New Segment</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingInv(null)
                  setDefaultInvSegId(
                    selectedSegmentFilter !== 'ALL' &&
                      selectedSegmentFilter !== 'UNASSIGNED'
                      ? selectedSegmentFilter
                      : null
                  )
                  setInvModalOpen(true)
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:brightness-105"
              >
                <Plus className="size-3.5" />
                <span>Add Investor</span>
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* Architectural KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Partner Equity Split</span>
            <span className={summary.isPartnerEquityBalanced ? 'text-primary' : 'text-amber-500'}>
              {summary.isPartnerEquityBalanced ? '100% Balanced' : `${remainingPartnerEquity.toFixed(1)}% Open`}
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.totalPartnerEquityPct.toFixed(2)}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {summary.activePartners} active partner(s) · Pool {fmtCompact(summary.totalCapitalPool)}
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Shareholders Registry
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.totalShareholders} Holders
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {summary.totalIssuedShares.toLocaleString()} shares · {summary.totalShareholderEquityPct}% recorded
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Investor Capital Funded
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-primary">
            {fmtCompact(summary.totalInvestorFunded)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Committed: <strong className="font-mono text-foreground">{fmtCompact(summary.totalInvestorCommitted)}</strong> · {summary.totalInvestorEquityPct}% eq
          </p>
        </div>

        <div className="p-5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Investor Segments
          </span>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.totalSegments} Segments
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {summary.totalInvestors} tracked investor(s) · Distributed {fmtCompact(summary.totalDistributed)}
          </p>
        </div>
      </section>

      {/* Spring Pill Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          className="inline-flex items-center rounded-xl border border-foreground/[0.08] bg-muted/50 p-1"
        >
          {TABS.map(item => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={cn(
                  'relative cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="ceo-equity-tab-pill"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 460, damping: 34 }
                    }
                    className="absolute inset-0 rounded-lg bg-card shadow-2xs ring-1 ring-foreground/[0.08]"
                  />
                ) : null}
                <span className="relative z-10">{item.label}</span>
              </button>
            )
          })}
        </div>

        {!isCeo ? (
          <p className="text-[11px] text-muted-foreground">
            Only the <strong className="text-foreground">CEO</strong> can create, edit, rebalance, or delete cap-table records.
          </p>
        ) : null}
      </div>

      {/* ── TAB 1: PARTNERS & EQUITY SPLIT ── */}
      {tab === 'partners' ? (
        <section className="space-y-5">
          {/* Quick-Add Existing Executives Strip (CEO Only) */}
          {isCeo && availableExecutives.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-foreground/[0.08] bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-foreground">
                  Add Partner from Existing Executive Roles
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Click any active executive to grant equity &amp; add them directly to the partner cap table
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {availableExecutives.map(exec => (
                  <button
                    key={exec.userId}
                    type="button"
                    onClick={() => {
                      setEditingPartner(null)
                      setSelectedExecutive(exec)
                      setPartnerModalOpen(true)
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-primary/15"
                  >
                    <Plus className="size-3 text-primary" />
                    <span>{exec.name}</span>
                    <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                      {exec.roleBadge}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* 100% Ownership Ribbon */}
          <div className="rounded-2xl border border-foreground/[0.08] bg-card p-5">
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="font-medium text-foreground">
                Active Ownership Distribution Ribbon
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {summary.totalPartnerEquityPct.toFixed(2)}% Allocated
              </span>
            </div>
            <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-muted/60 p-0.5">
              {owners
                .filter(o => o.isActive && o.equityPercentage > 0)
                .map((owner, idx) => (
                  <motion.div
                    key={owner.id}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { duration: 0.55, delay: idx * 0.05, ease: EASE.entrance }
                    }
                    style={{
                      width: `${Math.min(100, owner.equityPercentage)}%`,
                      transformOrigin: 'left',
                    }}
                    className={cn(
                      'h-full rounded-full',
                      RIBBON_TONES[idx % RIBBON_TONES.length]
                    )}
                    title={`${owner.name}: ${owner.equityPercentage}%`}
                  />
                ))}
            </div>
          </div>

          {owners.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-foreground/15 bg-card py-14 text-center space-y-3">
              <Scale className="size-8 mx-auto text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">No partners registered yet</p>
              {isCeo ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPartner(null)
                    setPartnerModalOpen(true)
                  }}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                >
                  <Plus className="size-3.5" /> Create First Partner
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {owners.map(owner => (
                <div
                  key={owner.id}
                  className={cn(
                    'flex flex-col justify-between rounded-2xl border border-foreground/[0.08] bg-card p-5 space-y-4 transition-colors hover:border-foreground/15',
                    !owner.isActive && 'opacity-60'
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {owner.name}
                          </h3>
                          {!owner.isActive ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                              INACTIVE
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {owner.title} · {owner.shareClass}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-xs font-bold text-primary">
                        {owner.equityPercentage}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/35 p-3 text-xs">
                      <div>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground block">
                          Capital Balance
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {fmt(owner.currentCapitalBalance)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground block">
                          Shares / Voting
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {owner.shareCount > 0 ? owner.shareCount.toLocaleString() : '—'} ·{' '}
                          {owner.votingRights ? 'Vote' : 'Non-Vote'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground block">
                          Drawings
                        </span>
                        <span className="font-mono font-medium text-amber-600 dark:text-amber-400">
                          {fmt(owner.totalDrawings)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground block">
                          Distributed
                        </span>
                        <span className="font-mono font-medium text-primary">
                          {fmt(owner.totalProfitDistributed)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/[0.06] pt-3">
                    <div className="flex items-center gap-1.5">
                      <RecordDrawingModal
                        ownerId={owner.id}
                        ownerName={owner.name}
                        bankAccounts={bankAccounts}
                      />
                      <Link
                        href={`/equity/${owner.id}`}
                        className="rounded-lg border border-foreground/[0.08] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        Ledger →
                      </Link>
                    </div>

                    {isCeo ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPartner(owner)
                            setPartnerModalOpen(true)
                          }}
                          className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Edit Partner & Equity"
                        >
                          <Edit3 className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePartner(owner)}
                          className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                          title="Delete Partner"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ── TAB 2: SHAREHOLDERS REGISTRY ── */}
      {tab === 'shareholders' ? (
        <section className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card">
          <div className="flex items-center justify-between border-b border-foreground/[0.06] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Shareholders Cap-Table Registry
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Issued share certificates, share classes, voting rights, and vesting schedules
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {shareholders.length} record(s)
            </span>
          </div>

          {shareholders.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <p className="text-sm font-medium text-foreground">No shareholders registered yet</p>
              <p className="text-xs text-muted-foreground">
                Register founders, ESOP option holders, advisors, and institutional shareholders.
              </p>
              {isCeo ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSh(null)
                    setShModalOpen(true)
                  }}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                >
                  <Plus className="size-3.5" /> Add First Shareholder
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="border-b border-foreground/[0.08] bg-muted/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Shareholder</th>
                    <th className="px-4 py-3">Type / Class</th>
                    <th className="px-4 py-3 text-right">Shares</th>
                    <th className="px-4 py-3 text-right">Ownership %</th>
                    <th className="px-4 py-3 text-right">Paid-In Capital</th>
                    <th className="px-4 py-3">Vesting / Rights</th>
                    {isCeo ? <th className="px-4 py-3 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.06]">
                  {shareholders.map(sh => (
                    <tr
                      key={sh.id}
                      className={cn(
                        'transition-colors hover:bg-muted/30',
                        !sh.isActive && 'opacity-50'
                      )}
                    >
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-foreground">{sh.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {sh.certificateNumber || 'No Cert #'}
                          {sh.email ? ` · ${sh.email}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-medium text-foreground block">
                          {sh.holderType.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {sh.shareClass.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                        {sh.shareCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold tabular-nums text-primary">
                        {sh.equityPercentage}%
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                        {fmt(sh.investedCapital)}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        <span className="block">{sh.vestingSchedule || 'Fully Vested'}</span>
                        <span className="font-mono text-[10px]">
                          {sh.votingRights ? 'Voting' : 'Non-Voting'}
                        </span>
                      </td>
                      {isCeo ? (
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSh(sh)
                                setShModalOpen(true)
                              }}
                              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Edit Shareholder"
                            >
                              <Edit3 className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShareholder(sh)}
                              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                              title="Delete Shareholder"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ── TAB 3: INVESTOR SEGMENTS & INVESTORS ── */}
      {tab === 'investors' ? (
        <section className="space-y-6">
          {/* Investor Segment Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Investor Segments ({segments.length})
              </h2>
              {selectedSegmentFilter !== 'ALL' ? (
                <button
                  type="button"
                  onClick={() => setSelectedSegmentFilter('ALL')}
                  className="cursor-pointer text-xs text-primary hover:underline"
                >
                  Show All Segments
                </button>
              ) : null}
            </div>

            {segments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-foreground/15 bg-card p-10 text-center space-y-2.5">
                <p className="text-sm font-medium text-foreground">
                  No investor segments built yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Create structured fundraising segments like Angel Syndicate, Seed VC, Strategic Partners, or Revenue-Share Backers.
                </p>
                {isCeo ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSeg(null)
                      setSegModalOpen(true)
                    }}
                    className="mt-2 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                  >
                    <Plus className="size-3.5" /> Build First Segment
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {segments.map(seg => {
                  const pctFunded =
                    seg.targetAllocation > 0
                      ? Math.min(100, Math.round((seg.fundedTotal / seg.targetAllocation) * 100))
                      : 0
                  const isSelected = selectedSegmentFilter === seg.id
                  return (
                    <div
                      key={seg.id}
                      onClick={() =>
                        setSelectedSegmentFilter(isSelected ? 'ALL' : seg.id)
                      }
                      className={cn(
                        'cursor-pointer rounded-2xl border bg-card p-5 space-y-3.5 transition-all',
                        isSelected
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-foreground/[0.08] hover:border-foreground/20'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-foreground">
                              {seg.name}
                            </h3>
                            {seg.code ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {seg.code}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {seg.instrumentType.replace(/_/g, ' ')} · Pool {seg.equityPoolPct}% · Min {fmtCompact(seg.minTicketSize)}
                          </p>
                        </div>

                        {isCeo ? (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSeg(seg)
                                setSegModalOpen(true)
                              }}
                              className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Edit Segment"
                            >
                              <Edit3 className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSegment(seg)}
                              className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                              title="Delete Segment"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {seg.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {seg.description}
                        </p>
                      ) : null}

                      <div className="space-y-1.5">
                        <div className="flex justify-between font-mono text-[11px] tabular-nums">
                          <span className="text-muted-foreground">
                            Funded {fmtCompact(seg.fundedTotal)} / {fmtCompact(seg.targetAllocation)}
                          </span>
                          <span className="font-semibold text-primary">{pctFunded}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${pctFunded}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-muted-foreground pt-0.5">
                          <span>{seg.investorCount} investor(s)</span>
                          <span>Committed {fmtCompact(seg.committedTotal)} · {seg.allocatedEquityPct}% eq</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Investor Roster Table */}
          <div className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/[0.06] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Investor Roster ({filteredInvestors.length})
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Track commitments, wired capital, valuation caps, and equity stakes
                </p>
              </div>
            </div>

            {filteredInvestors.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No investors in this view yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="border-b border-foreground/[0.08] bg-muted/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Investor &amp; Fund</th>
                      <th className="px-4 py-3">Segment</th>
                      <th className="px-4 py-3">Stage</th>
                      <th className="px-4 py-3 text-right">Committed</th>
                      <th className="px-4 py-3 text-right">Funded</th>
                      <th className="px-4 py-3 text-right">Equity %</th>
                      {isCeo ? <th className="px-4 py-3 text-right">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/[0.06]">
                    {filteredInvestors.map(inv => (
                      <tr key={inv.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-foreground">{inv.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {inv.organization || inv.investorType} · {inv.instrument}
                            {inv.boardSeat ? ' · Board Seat' : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {inv.segmentName || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold',
                              inv.stage === 'FUNDED'
                                ? 'bg-primary/15 text-primary'
                                : inv.stage === 'COMMITTED'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : inv.stage === 'PASSED'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            )}
                          >
                            {inv.stage.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                          {fmt(inv.committedAmount)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold tabular-nums text-primary">
                          {fmt(inv.investedAmount)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                          {inv.equityPercentage}%
                        </td>
                        {isCeo ? (
                          <td className="px-4 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingInv(inv)
                                  setInvModalOpen(true)
                                }}
                                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Edit Investor"
                              >
                                <Edit3 className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteInvestor(inv)}
                                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                title="Delete Investor"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
