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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAgencyClient } from '@/lib/actions/agency-clients'
import { toast } from 'sonner'
import { Plus, UserPlus } from 'lucide-react'

export function CreateClientModal({
  onClientCreated,
  trigger,
}: {
  onClientCreated?: () => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    companyName: '',
    contactPerson: '',
    email: '',
    phone: '',
    whatsapp: '',
    website: '',
    address: '',
    city: 'Dhaka',
    country: 'Bangladesh',
    taxId: '',
    clientType: 'PROJECT_BASED' as 'PROJECT_BASED' | 'RETAINER' | 'HOURLY_CONSULTING' | 'HYBRID',
    openingBalance: '0',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.companyName.trim() || !formData.contactPerson.trim()) {
      toast.error('Company Name and Contact Person are required')
      return
    }

    try {
      setLoading(true)
      const res = await createAgencyClient({
        ...formData,
        openingBalance: parseFloat(formData.openingBalance) || 0,
      })

      if (res.success) {
        toast.success(`Client ${res.client.companyName} created successfully!`)
        setOpen(false)
        setFormData({
          companyName: '',
          contactPerson: '',
          email: '',
          phone: '',
          whatsapp: '',
          website: '',
          address: '',
          city: 'Dhaka',
          country: 'Bangladesh',
          taxId: '',
          clientType: 'PROJECT_BASED',
          openingBalance: '0',
          notes: '',
        })
        onClientCreated?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
            <Plus className="size-4 mr-1.5" />
            New Client
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-card border-border text-card-foreground max-h-[90vh] overflow-y-auto shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
            <UserPlus className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Register New Agency Client
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Company / Brand Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                placeholder="e.g. NextGen Retail Ltd"
                value={formData.companyName}
                onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Primary Contact Person <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                placeholder="e.g. Rafiqul Islam (CEO)"
                value={formData.contactPerson}
                onChange={e => setFormData({ ...formData, contactPerson: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Email Address</Label>
              <Input
                type="email"
                placeholder="client@company.com"
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

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">WhatsApp / Telegram</Label>
              <Input
                placeholder="+880 1711 000000"
                value={formData.whatsapp}
                onChange={e => setFormData({ ...formData, whatsapp: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Client Website</Label>
              <Input
                placeholder="https://company.com"
                value={formData.website}
                onChange={e => setFormData({ ...formData, website: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Client Engagement Model</Label>
              <Select
                value={formData.clientType}
                onValueChange={(val: any) => setFormData({ ...formData, clientType: val })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-card-foreground">
                  <SelectItem value="PROJECT_BASED">Project-Based (Fixed Software / Branding)</SelectItem>
                  <SelectItem value="RETAINER">Monthly Retainer (Marketing / SEO)</SelectItem>
                  <SelectItem value="HYBRID">Hybrid (Retainer + Custom Dev)</SelectItem>
                  <SelectItem value="HOURLY_CONSULTING">Hourly Consulting</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Opening Receivable Balance (৳)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={formData.openingBalance}
                onChange={e => setFormData({ ...formData, openingBalance: e.target.value })}
                className="bg-background border-border text-foreground font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Tax ID / BIN / Trade License</Label>
              <Input
                placeholder="BIN-123456789"
                value={formData.taxId}
                onChange={e => setFormData({ ...formData, taxId: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">City / Location</Label>
              <Input
                placeholder="Gulshan, Dhaka"
                value={formData.city}
                onChange={e => setFormData({ ...formData, city: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Billing Address</Label>
            <Input
              placeholder="Road 11, Banani, Dhaka-1213"
              value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Notes & Briefing</Label>
            <Textarea
              placeholder="Specific client requirements, billing cycles, or special terms..."
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              className="bg-background border-border text-foreground min-h-[80px]"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
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
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
            >
              {loading ? 'Creating...' : 'Create Client'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
