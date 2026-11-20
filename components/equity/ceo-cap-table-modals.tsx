'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createAgencyOwner,
  rebalancePartnerEquityAction,
  updateAgencyOwner,
} from '@/lib/actions/agency-equity'
import {
  createInvestorAction,
  createInvestorSegmentAction,
  createShareholderAction,
  updateInvestorAction,
  updateInvestorSegmentAction,
  updateShareholderAction,
} from '@/lib/actions/ceo-cap-table'

export type CapTableData = Awaited<
  ReturnType<typeof import('@/lib/actions/ceo-cap-table').getCeoCapTableData>
>
export type PartnerItem = CapTableData['owners'][number]
export type ExecutiveCandidateItem = CapTableData['executiveCandidates'][number]
export type ShareholderItem = CapTableData['shareholders'][number]
export type InvestorSegmentItem = CapTableData['segments'][number]
export type InvestorItem = CapTableData['investors'][number]

// ─────────────────────────────────────────────────────────────────────────────
// 1. PARTNER CREATE / EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function PartnerFormModal({
  open,
  onOpenChange,
  partner,
  remainingEquity,
  executiveCandidates = [],
  initialExecutive = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  partner?: PartnerItem | null
  remainingEquity: number
  executiveCandidates?: ExecutiveCandidateItem[]
  initialExecutive?: ExecutiveCandidateItem | null
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [selectedExecId, setSelectedExecId] = React.useState<string>('CUSTOM')
  const [form, setForm] = React.useState({
    name: '',
    title: '',
    stakeholderRole: 'PARTNER',
    email: '',
    phone: '',
    equityPercentage: '20',
    shareCount: '0',
    shareClass: 'COMMON',
    votingRights: true,
    vestingSchedule: '',
    initialCapital: '0',
    currentCapitalBalance: '0',
    isActive: true,
    notes: '',
  })

  React.useEffect(() => {
    if (!open) return
    if (partner) {
      setSelectedExecId('CUSTOM')
      setForm({
        name: partner.name,
        title: partner.title,
        stakeholderRole: partner.stakeholderRole || 'PARTNER',
        email: partner.email || '',
        phone: partner.phone || '',
        equityPercentage: String(partner.equityPercentage),
        shareCount: String(partner.shareCount || 0),
        shareClass: partner.shareClass || 'COMMON',
        votingRights: partner.votingRights,
        vestingSchedule: partner.vestingSchedule || '',
        initialCapital: String(partner.initialCapital),
        currentCapitalBalance: String(partner.currentCapitalBalance),
        isActive: partner.isActive,
        notes: partner.notes || '',
      })
    } else if (initialExecutive) {
      setSelectedExecId(initialExecutive.userId)
      setForm({
        name: initialExecutive.name,
        title: initialExecutive.suggestedTitle,
        stakeholderRole: initialExecutive.suggestedTier,
        email: initialExecutive.email,
        phone: initialExecutive.phone || '',
        equityPercentage:
          remainingEquity > 0 ? String(Number(remainingEquity.toFixed(2))) : '10',
        shareCount: '0',
        shareClass: 'COMMON',
        votingRights: true,
        vestingSchedule: 'Fully Vested',
        initialCapital: '0',
        currentCapitalBalance: '0',
        isActive: true,
        notes: `Promoted from existing Executive Role (${initialExecutive.roleBadge})`,
      })
    } else {
      setSelectedExecId('CUSTOM')
      setForm({
        name: '',
        title: '',
        stakeholderRole: 'PARTNER',
        email: '',
        phone: '',
        equityPercentage:
          remainingEquity > 0 ? String(Number(remainingEquity.toFixed(2))) : '10',
        shareCount: '0',
        shareClass: 'COMMON',
        votingRights: true,
        vestingSchedule: 'Fully Vested',
        initialCapital: '0',
        currentCapitalBalance: '0',
        isActive: true,
        notes: '',
      })
    }
  }, [open, partner, remainingEquity, initialExecutive])

  function handleExecutiveSelect(value: string) {
    setSelectedExecId(value)
    if (value === 'CUSTOM') return
    const exec = executiveCandidates.find(c => c.userId === value)
    if (!exec) return
    setForm(f => ({
      ...f,
      name: exec.name,
      title: exec.suggestedTitle,
      stakeholderRole: exec.suggestedTier,
      email: exec.email,
      phone: exec.phone || f.phone,
      notes: f.notes || `Promoted from existing Executive Role (${exec.roleBadge})`,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.title.trim()) {
      toast.error('Partner name and title are required.')
      return
    }
    const eq = Number(form.equityPercentage)
    if (!Number.isFinite(eq) || eq < 0 || eq > 100) {
      toast.error('Equity percentage must be between 0% and 100%.')
      return
    }

    try {
      setSaving(true)
      if (partner) {
        await updateAgencyOwner(partner.id, {
          name: form.name,
          title: form.title,
          stakeholderRole: form.stakeholderRole,
          email: form.email,
          phone: form.phone,
          equityPercentage: eq,
          shareCount: Number(form.shareCount) || 0,
          shareClass: form.shareClass,
          votingRights: form.votingRights,
          vestingSchedule: form.vestingSchedule,
          initialCapital: Number(form.initialCapital) || 0,
          currentCapitalBalance: Number(form.currentCapitalBalance) || 0,
          isActive: form.isActive,
          notes: form.notes,
        })
        toast.success(`Partner "${form.name.trim()}" updated.`)
      } else {
        await createAgencyOwner({
          name: form.name,
          title: form.title,
          stakeholderRole: form.stakeholderRole,
          email: form.email,
          phone: form.phone,
          equityPercentage: eq,
          shareCount: Number(form.shareCount) || 0,
          shareClass: form.shareClass,
          votingRights: form.votingRights,
          vestingSchedule: form.vestingSchedule,
          initialCapital: Number(form.initialCapital) || 0,
          notes: form.notes,
        })
        toast.success(`Partner "${form.name.trim()}" (${eq}%) created.`)
      }
      onOpenChange(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save partner')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {partner ? `Edit Partner — ${partner.name}` : 'Create Agency Partner / Founder'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          {!partner && executiveCandidates.length > 0 ? (
            <div className="space-y-1.5 rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
              <Label className="text-[11px] font-semibold text-foreground">
                Quick-Fill from Existing Executive Role
              </Label>
              <Select value={selectedExecId} onValueChange={handleExecutiveSelect}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose an executive or enter manually..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOM">Manual Entry (External / Custom)</SelectItem>
                  {executiveCandidates.map(exec => (
                    <SelectItem
                      key={exec.userId}
                      value={exec.userId}
                      disabled={exec.isAlreadyPartner}
                    >
                      {exec.name} · {exec.roleBadge}
                      {exec.isAlreadyPartner ? ' (Already Partner)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Auto-populates name, executive title, email, and phone from your active Users &amp; Executive Roles.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Full Name *</Label>
              <Input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Mehedi Hasan"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Role / Title *</Label>
              <Input
                required
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Managing Partner / CTO"
                className="bg-background"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Stakeholder Tier</Label>
              <Select
                value={form.stakeholderRole}
                onValueChange={v => setForm(f => ({ ...f, stakeholderRole: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FOUNDER">Founder</SelectItem>
                  <SelectItem value="MANAGING_PARTNER">Managing Partner</SelectItem>
                  <SelectItem value="PARTNER">Partner</SelectItem>
                  <SelectItem value="EQUITY_PARTNER">Equity Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Equity Share (%) *</Label>
              <Input
                required
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={form.equityPercentage}
                onChange={e =>
                  setForm(f => ({ ...f, equityPercentage: e.target.value }))
                }
                className="bg-background font-mono font-semibold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Share Class</Label>
              <Select
                value={form.shareClass}
                onValueChange={v => setForm(f => ({ ...f, shareClass: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMON">Common</SelectItem>
                  <SelectItem value="CLASS_A">Class A Voting</SelectItem>
                  <SelectItem value="CLASS_B">Class B Non-Voting</SelectItem>
                  <SelectItem value="PREFERRED">Preferred</SelectItem>
                  <SelectItem value="ADVISOR">Advisor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Share Units</Label>
              <Input
                type="number"
                min="0"
                value={form.shareCount}
                onChange={e => setForm(f => ({ ...f, shareCount: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Initial Capital (৳)</Label>
              <Input
                type="number"
                value={form.initialCapital}
                onChange={e => setForm(f => ({ ...f, initialCapital: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
            {partner ? (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Capital Balance (৳)</Label>
                <Input
                  type="number"
                  value={form.currentCapitalBalance}
                  onChange={e =>
                    setForm(f => ({ ...f, currentCapitalBalance: e.target.value }))
                  }
                  className="bg-background font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Vesting Schedule</Label>
                <Input
                  value={form.vestingSchedule}
                  onChange={e =>
                    setForm(f => ({ ...f, vestingSchedule: e.target.value }))
                  }
                  placeholder="4yr / 1yr cliff"
                  className="bg-background"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="partner@artyx.digital"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Phone</Label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+880 17..."
                className="bg-background"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.votingRights}
                onChange={e => setForm(f => ({ ...f, votingRights: e.target.checked }))}
                className="accent-primary"
              />
              <span>Voting Rights</span>
            </label>
            {partner ? (
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="accent-primary"
                />
                <span>Active Partner</span>
              </label>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Agreement Notes</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Board consent, vesting cliff, dividend terms..."
              className="bg-background min-h-[64px]"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : partner ? 'Save Changes' : 'Create Partner'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CEO BULK EQUITY REBALANCER MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function EquityRebalanceModal({
  open,
  onOpenChange,
  owners,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  owners: PartnerItem[]
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [allocations, setAllocations] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!open) return
    const init: Record<string, string> = {}
    for (const o of owners) {
      init[o.id] = String(o.equityPercentage)
    }
    setAllocations(init)
  }, [open, owners])

  const totalPct = React.useMemo(() => {
    return owners.reduce((s, o) => s + (Number(allocations[o.id]) || 0), 0)
  }, [owners, allocations])

  function handleNormalizeTo100() {
    if (totalPct <= 0) return
    const next: Record<string, string> = {}
    let running = 0
    owners.forEach((o, idx) => {
      const raw = Number(allocations[o.id]) || 0
      const isLast = idx === owners.length - 1
      const scaled = isLast
        ? Math.max(0, Number((100 - running).toFixed(2)))
        : Number(((raw / totalPct) * 100).toFixed(2))
      running += scaled
      next[o.id] = String(scaled)
    })
    setAllocations(next)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (totalPct > 100.01) {
      toast.error(`Total equity (${totalPct.toFixed(2)}%) exceeds 100%.`)
      return
    }
    try {
      setSaving(true)
      await rebalancePartnerEquityAction(
        owners.map(o => ({
          id: o.id,
          equityPercentage: Number(allocations[o.id]) || 0,
        }))
      )
      toast.success('Partner equity percentages rebalanced atomically.')
      onOpenChange(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to rebalance equity')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            CEO Bulk Equity Percentage Rebalancer
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 pt-2 text-xs">
          <div className="flex items-center justify-between rounded-xl border border-foreground/[0.08] bg-muted/35 px-3.5 py-2.5">
            <div>
              <span className="text-[11px] text-muted-foreground block">
                Total Allocated Equity
              </span>
              <span
                className={`font-mono text-base font-bold ${
                  totalPct > 100.01
                    ? 'text-rose-500'
                    : Math.abs(totalPct - 100) < 0.01
                    ? 'text-primary'
                    : 'text-amber-500'
                }`}
              >
                {totalPct.toFixed(2)}% / 100.00%
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleNormalizeTo100}
              className="h-8 text-[11px]"
            >
              Auto-Normalize to 100%
            </Button>
          </div>

          <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
            {owners.map(o => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-foreground/[0.06] bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{o.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{o.title}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={allocations[o.id] ?? '0'}
                    onChange={e =>
                      setAllocations(prev => ({ ...prev, [o.id]: e.target.value }))
                    }
                    className="h-8 w-24 bg-background text-right font-mono font-semibold"
                  />
                  <span className="font-mono text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || totalPct > 100.01}>
              {saving ? 'Applying...' : 'Commit Equity Split'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SHAREHOLDER CREATE / EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function ShareholderFormModal({
  open,
  onOpenChange,
  shareholder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shareholder?: ShareholderItem | null
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    phone: '',
    holderType: 'FOUNDER',
    shareClass: 'COMMON',
    shareCount: '1000',
    equityPercentage: '10',
    parValue: '100',
    investedCapital: '0',
    certificateNumber: '',
    vestingSchedule: '',
    votingRights: true,
    isActive: true,
    notes: '',
  })

  React.useEffect(() => {
    if (!open) return
    if (shareholder) {
      setForm({
        name: shareholder.name,
        email: shareholder.email || '',
        phone: shareholder.phone || '',
        holderType: shareholder.holderType,
        shareClass: shareholder.shareClass,
        shareCount: String(shareholder.shareCount),
        equityPercentage: String(shareholder.equityPercentage),
        parValue: String(shareholder.parValue),
        investedCapital: String(shareholder.investedCapital),
        certificateNumber: shareholder.certificateNumber || '',
        vestingSchedule: shareholder.vestingSchedule || '',
        votingRights: shareholder.votingRights,
        isActive: shareholder.isActive,
        notes: shareholder.notes || '',
      })
    } else {
      setForm({
        name: '',
        email: '',
        phone: '',
        holderType: 'FOUNDER',
        shareClass: 'COMMON',
        shareCount: '1000',
        equityPercentage: '5',
        parValue: '100',
        investedCapital: '0',
        certificateNumber: '',
        vestingSchedule: '4yr / 1yr cliff',
        votingRights: true,
        isActive: true,
        notes: '',
      })
    }
  }, [open, shareholder])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      const payload = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        holderType: form.holderType,
        shareClass: form.shareClass,
        shareCount: Math.max(0, Math.round(Number(form.shareCount) || 0)),
        equityPercentage: Math.max(0, Math.min(100, Number(form.equityPercentage) || 0)),
        parValue: Math.max(0, Number(form.parValue) || 0),
        investedCapital: Math.max(0, Number(form.investedCapital) || 0),
        certificateNumber: form.certificateNumber || null,
        vestingSchedule: form.vestingSchedule || null,
        votingRights: form.votingRights,
        isActive: form.isActive,
        notes: form.notes || null,
      }
      if (shareholder) {
        await updateShareholderAction(shareholder.id, payload)
        toast.success(`Shareholder "${form.name}" updated.`)
      } else {
        await createShareholderAction(payload)
        toast.success(`Shareholder "${form.name}" added to cap table.`)
      }
      onOpenChange(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save shareholder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {shareholder ? `Edit Shareholder — ${shareholder.name}` : 'Register Shareholder'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Shareholder Name *</Label>
              <Input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Individual or Entity Name"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Certificate #</Label>
              <Input
                value={form.certificateNumber}
                onChange={e =>
                  setForm(f => ({ ...f, certificateNumber: e.target.value }))
                }
                placeholder="e.g. CERT-2026-001"
                className="bg-background font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Holder Type</Label>
              <Select
                value={form.holderType}
                onValueChange={v => setForm(f => ({ ...f, holderType: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FOUNDER">Founder</SelectItem>
                  <SelectItem value="PARTNER">Operating Partner</SelectItem>
                  <SelectItem value="INVESTOR">Investor</SelectItem>
                  <SelectItem value="ADVISOR">Advisor</SelectItem>
                  <SelectItem value="EMPLOYEE_ESOP">Employee ESOP</SelectItem>
                  <SelectItem value="INSTITUTIONAL">Institutional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Share Class</Label>
              <Select
                value={form.shareClass}
                onValueChange={v => setForm(f => ({ ...f, shareClass: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMON">Common</SelectItem>
                  <SelectItem value="PREFERRED">Preferred</SelectItem>
                  <SelectItem value="SEED_PREFERRED">Seed Preferred</SelectItem>
                  <SelectItem value="CLASS_A">Class A</SelectItem>
                  <SelectItem value="CLASS_B">Class B</SelectItem>
                  <SelectItem value="ESOP">ESOP Option Pool</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Equity % *</Label>
              <Input
                required
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={form.equityPercentage}
                onChange={e =>
                  setForm(f => ({ ...f, equityPercentage: e.target.value }))
                }
                className="bg-background font-mono font-semibold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Shares Issued</Label>
              <Input
                type="number"
                min="0"
                value={form.shareCount}
                onChange={e => setForm(f => ({ ...f, shareCount: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Par Value (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.parValue}
                onChange={e => setForm(f => ({ ...f, parValue: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Paid-In Capital (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.investedCapital}
                onChange={e =>
                  setForm(f => ({ ...f, investedCapital: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Vesting Schedule</Label>
              <Input
                value={form.vestingSchedule}
                onChange={e =>
                  setForm(f => ({ ...f, vestingSchedule: e.target.value }))
                }
                placeholder="4yr / 1yr cliff"
                className="bg-background"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.votingRights}
                onChange={e => setForm(f => ({ ...f, votingRights: e.target.checked }))}
                className="accent-primary"
              />
              <span>Voting Rights</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="accent-primary"
              />
              <span>Active Holder</span>
            </label>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="bg-background min-h-[60px]"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : shareholder ? 'Update Shareholder' : 'Add Shareholder'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INVESTOR SEGMENT CREATE / EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function InvestorSegmentFormModal({
  open,
  onOpenChange,
  segment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  segment?: InvestorSegmentItem | null
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '',
    code: '',
    instrumentType: 'EQUITY',
    targetAllocation: '5000000',
    minTicketSize: '500000',
    equityPoolPct: '10',
    priority: '1',
    isActive: true,
    description: '',
  })

  React.useEffect(() => {
    if (!open) return
    if (segment) {
      setForm({
        name: segment.name,
        code: segment.code || '',
        instrumentType: segment.instrumentType,
        targetAllocation: String(segment.targetAllocation),
        minTicketSize: String(segment.minTicketSize),
        equityPoolPct: String(segment.equityPoolPct),
        priority: String(segment.priority),
        isActive: segment.isActive,
        description: segment.description || '',
      })
    } else {
      setForm({
        name: '',
        code: '',
        instrumentType: 'EQUITY',
        targetAllocation: '5000000',
        minTicketSize: '500000',
        equityPoolPct: '10',
        priority: '1',
        isActive: true,
        description: '',
      })
    }
  }, [open, segment])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      const payload = {
        name: form.name,
        code: form.code || null,
        instrumentType: form.instrumentType,
        targetAllocation: Math.max(0, Number(form.targetAllocation) || 0),
        minTicketSize: Math.max(0, Number(form.minTicketSize) || 0),
        equityPoolPct: Math.max(0, Math.min(100, Number(form.equityPoolPct) || 0)),
        priority: Math.max(1, Math.round(Number(form.priority) || 1)),
        isActive: form.isActive,
        description: form.description || null,
      }
      if (segment) {
        await updateInvestorSegmentAction(segment.id, payload)
        toast.success(`Investor segment "${form.name}" updated.`)
      } else {
        await createInvestorSegmentAction(payload)
        toast.success(`Investor segment "${form.name}" created.`)
      }
      onOpenChange(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save investor segment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {segment ? `Edit Segment — ${segment.name}` : 'Build New Investor Segment'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Segment Name *</Label>
              <Input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Angel Syndicate, Seed VC, Strategic Backers"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Code</Label>
              <Input
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="SEED-A"
                className="bg-background font-mono uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Primary Instrument</Label>
              <Select
                value={form.instrumentType}
                onValueChange={v => setForm(f => ({ ...f, instrumentType: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EQUITY">Priced Equity</SelectItem>
                  <SelectItem value="SAFE">SAFE Note</SelectItem>
                  <SelectItem value="CONVERTIBLE_NOTE">Convertible Note</SelectItem>
                  <SelectItem value="REVENUE_SHARE">Revenue Share</SelectItem>
                  <SelectItem value="DEBT">Venture Debt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Equity Pool Cap (%)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={form.equityPoolPct}
                onChange={e => setForm(f => ({ ...f, equityPoolPct: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Target Raise (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.targetAllocation}
                onChange={e =>
                  setForm(f => ({ ...f, targetAllocation: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Min Ticket (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.minTicketSize}
                onChange={e => setForm(f => ({ ...f, minTicketSize: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Priority</Label>
              <Input
                type="number"
                min="1"
                max="99"
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="bg-background font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Segment Thesis &amp; Terms</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Target investor profile, valuation cap, dividend or exit rights..."
              className="bg-background min-h-[64px]"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : segment ? 'Save Segment' : 'Create Segment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. INVESTOR CREATE / EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function InvestorFormModal({
  open,
  onOpenChange,
  investor,
  segments,
  defaultSegmentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  investor?: InvestorItem | null
  segments: InvestorSegmentItem[]
  defaultSegmentId?: string | null
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    segmentId: 'NONE',
    name: '',
    organization: '',
    email: '',
    phone: '',
    investorType: 'ANGEL',
    stage: 'COMMITTED',
    instrument: 'EQUITY',
    committedAmount: '1000000',
    investedAmount: '0',
    equityPercentage: '2.5',
    valuationCap: '',
    boardSeat: false,
    isActive: true,
    notes: '',
  })

  React.useEffect(() => {
    if (!open) return
    if (investor) {
      setForm({
        segmentId: investor.segmentId || 'NONE',
        name: investor.name,
        organization: investor.organization || '',
        email: investor.email || '',
        phone: investor.phone || '',
        investorType: investor.investorType,
        stage: investor.stage,
        instrument: investor.instrument,
        committedAmount: String(investor.committedAmount),
        investedAmount: String(investor.investedAmount),
        equityPercentage: String(investor.equityPercentage),
        valuationCap: investor.valuationCap ? String(investor.valuationCap) : '',
        boardSeat: investor.boardSeat,
        isActive: investor.isActive,
        notes: investor.notes || '',
      })
    } else {
      setForm({
        segmentId: defaultSegmentId || segments[0]?.id || 'NONE',
        name: '',
        organization: '',
        email: '',
        phone: '',
        investorType: 'ANGEL',
        stage: 'COMMITTED',
        instrument: 'EQUITY',
        committedAmount: '1000000',
        investedAmount: '0',
        equityPercentage: '2',
        valuationCap: '',
        boardSeat: false,
        isActive: true,
        notes: '',
      })
    }
  }, [open, investor, segments, defaultSegmentId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      const payload = {
        segmentId: form.segmentId === 'NONE' ? null : form.segmentId,
        name: form.name,
        organization: form.organization || null,
        email: form.email || null,
        phone: form.phone || null,
        investorType: form.investorType,
        stage: form.stage,
        instrument: form.instrument,
        committedAmount: Math.max(0, Number(form.committedAmount) || 0),
        investedAmount: Math.max(0, Number(form.investedAmount) || 0),
        equityPercentage: Math.max(0, Math.min(100, Number(form.equityPercentage) || 0)),
        valuationCap: form.valuationCap ? Number(form.valuationCap) : null,
        boardSeat: form.boardSeat,
        isActive: form.isActive,
        notes: form.notes || null,
      }
      if (investor) {
        await updateInvestorAction(investor.id, payload)
        toast.success(`Investor "${form.name}" updated.`)
      } else {
        await createInvestorAction(payload)
        toast.success(`Investor "${form.name}" added.`)
      }
      onOpenChange(false)
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save investor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {investor ? `Edit Investor — ${investor.name}` : 'Add Investor'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Investor Name *</Label>
              <Input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Tariq Rahman"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Fund / Organization</Label>
              <Input
                value={form.organization}
                onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
                placeholder="e.g. Dhaka Ventures"
                className="bg-background"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Investor Segment</Label>
              <Select
                value={form.segmentId}
                onValueChange={v => setForm(f => ({ ...f, segmentId: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Unassigned</SelectItem>
                  {segments.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Investor Type</Label>
              <Select
                value={form.investorType}
                onValueChange={v => setForm(f => ({ ...f, investorType: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANGEL">Angel</SelectItem>
                  <SelectItem value="VC">Venture Capital</SelectItem>
                  <SelectItem value="STRATEGIC">Strategic</SelectItem>
                  <SelectItem value="FAMILY_OFFICE">Family Office</SelectItem>
                  <SelectItem value="SYNDICATE">Syndicate</SelectItem>
                  <SelectItem value="CORPORATE">Corporate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Deal Stage</Label>
              <Select
                value={form.stage}
                onValueChange={v => setForm(f => ({ ...f, stage: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROSPECT">Prospect</SelectItem>
                  <SelectItem value="PITCHED">Pitched</SelectItem>
                  <SelectItem value="DUE_DILIGENCE">Due Diligence</SelectItem>
                  <SelectItem value="COMMITTED">Committed</SelectItem>
                  <SelectItem value="FUNDED">Funded</SelectItem>
                  <SelectItem value="PASSED">Passed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Committed (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.committedAmount}
                onChange={e =>
                  setForm(f => ({ ...f, committedAmount: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Funded / Received (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.investedAmount}
                onChange={e =>
                  setForm(f => ({ ...f, investedAmount: e.target.value }))
                }
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Equity %</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={form.equityPercentage}
                onChange={e =>
                  setForm(f => ({ ...f, equityPercentage: e.target.value }))
                }
                className="bg-background font-mono font-semibold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Instrument</Label>
              <Select
                value={form.instrument}
                onValueChange={v => setForm(f => ({ ...f, instrument: v }))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EQUITY">Priced Equity</SelectItem>
                  <SelectItem value="SAFE">SAFE</SelectItem>
                  <SelectItem value="CONVERTIBLE_NOTE">Convertible Note</SelectItem>
                  <SelectItem value="REVENUE_SHARE">Revenue Share</SelectItem>
                  <SelectItem value="DEBT">Debt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Valuation Cap (৳)</Label>
              <Input
                type="number"
                min="0"
                value={form.valuationCap}
                onChange={e => setForm(f => ({ ...f, valuationCap: e.target.value }))}
                placeholder="Optional"
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="bg-background"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.boardSeat}
                onChange={e => setForm(f => ({ ...f, boardSeat: e.target.checked }))}
                className="accent-primary"
              />
              <span>Board / Observer Seat</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="accent-primary"
              />
              <span>Active Record</span>
            </label>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="bg-background min-h-[60px]"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : investor ? 'Save Investor' : 'Add Investor'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
