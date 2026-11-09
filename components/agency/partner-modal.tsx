'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createAgencyOwner } from '@/lib/actions/agency-equity'
import { toast } from 'sonner'
import { Plus, UserPlus, Scale } from 'lucide-react'

export function CreatePartnerModal({
  onPartnerCreated,
  currentTotalEquity = 0,
  trigger,
}: {
  onPartnerCreated?: () => void
  currentTotalEquity?: number
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const remainingEquity = Math.max(0, 100 - currentTotalEquity)

  const [formData, setFormData] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    equityPercentage: remainingEquity > 0 ? remainingEquity.toString() : '20',
    initialCapital: '0',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.name.trim() || !formData.title.trim()) {
      toast.error('Partner Name and Role/Title are required')
      return
    }

    const equity = parseFloat(formData.equityPercentage)
    if (isNaN(equity) || equity <= 0 || equity > 100) {
      toast.error('Please enter a valid equity percentage between 0.1% and 100%')
      return
    }

    try {
      setLoading(true)
      const res = await createAgencyOwner({
        name: formData.name,
        title: formData.title,
        email: formData.email,
        phone: formData.phone,
        equityPercentage: equity,
        initialCapital: parseFloat(formData.initialCapital) || 0,
        notes: formData.notes,
      })

      if (res.success) {
        toast.success(`Partner ${res.owner.name} (${equity}% equity) added!`)
        setOpen(false)
        setFormData({
          name: '',
          title: '',
          email: '',
          phone: '',
          equityPercentage: '20',
          initialCapital: '0',
          notes: '',
        })
        onPartnerCreated?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add partner')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
            <Plus className="size-4 mr-1.5" />
            Add Partner / Owner
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Scale className="size-5 text-primary" />
            Register Agency Partner & Equity Share
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Partner Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                placeholder="e.g. Tanvir Ahmed"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Role / Title <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                placeholder="e.g. Managing Partner / CTO"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Email Address</Label>
              <Input
                type="email"
                placeholder="partner@artyx.digital"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Phone Number</Label>
              <Input
                placeholder="+880 1711 000000"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Equity Share Percentage (%) <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={formData.equityPercentage}
                onChange={e => setFormData({ ...formData, equityPercentage: e.target.value })}
                className="bg-background border-border text-foreground font-mono font-bold text-base"
              />
              <p className="text-[11px] text-muted-foreground">
                Available unallocated: {remainingEquity.toFixed(2)}%
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Initial Capital Contribution (৳)</Label>
              <Input
                type="number"
                value={formData.initialCapital}
                onChange={e => setFormData({ ...formData, initialCapital: e.target.value })}
                className="bg-background border-border text-foreground font-mono"
              />
              <p className="text-[11px] text-muted-foreground">Credited to partner equity account</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Notes / Agreement Details</Label>
            <Textarea
              placeholder="Shareholders agreement date, voting rights, or vesting schedule notes..."
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              className="bg-background border-border text-foreground min-h-[70px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
            >
              {loading ? 'Adding...' : 'Save Partner'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
