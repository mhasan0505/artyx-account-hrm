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
import { createAgencyProject } from '@/lib/actions/agency-clients'
import { toast } from 'sonner'
import { Plus, Briefcase } from 'lucide-react'

export function CreateProjectModal({
  clients = [],
  onProjectCreated,
  trigger,
}: {
  clients: Array<{ id: string; companyName: string; clientCode: string }>
  onProjectCreated?: () => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    clientId: clients[0]?.id || '',
    name: '',
    serviceCategory: 'Software Development',
    billingType: 'FIXED_PRICE',
    contractValue: '',
    startDate: new Date().toISOString().split('T')[0],
    targetEndDate: '',
    description: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.clientId) {
      toast.error('Please select an agency client')
      return
    }
    if (!formData.name.trim()) {
      toast.error('Project Name is required')
      return
    }
    const val = parseFloat(formData.contractValue)
    if (isNaN(val) || val <= 0) {
      toast.error('Please enter a valid contract value in BDT')
      return
    }

    try {
      setLoading(true)
      const res = await createAgencyProject({
        clientId: formData.clientId,
        name: formData.name,
        serviceCategory: formData.serviceCategory,
        billingType: formData.billingType,
        contractValue: val,
        startDate: new Date(formData.startDate),
        targetEndDate: formData.targetEndDate ? new Date(formData.targetEndDate) : undefined,
        description: formData.description,
      })

      if (res.success) {
        toast.success(`Project "${res.project.name}" registered successfully!`)
        setOpen(false)
        setFormData({
          clientId: clients[0]?.id || '',
          name: '',
          serviceCategory: 'Software Development',
          billingType: 'FIXED_PRICE',
          contractValue: '',
          startDate: new Date().toISOString().split('T')[0],
          targetEndDate: '',
          description: '',
        })
        onProjectCreated?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project')
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
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Briefcase className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Register Agency Project
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Client <span className="text-rose-500">*</span>
            </Label>
            <Select
              value={formData.clientId}
              onValueChange={val => setFormData({ ...formData, clientId: val })}
            >
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue placeholder="Select Client" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-card-foreground">
                {clients.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.companyName} ({c.clientCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Project Name <span className="text-rose-500">*</span>
            </Label>
            <Input
              required
              placeholder="e.g. Next.js Headless E-Commerce Platform"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Service Category</Label>
              <Select
                value={formData.serviceCategory}
                onValueChange={val => setFormData({ ...formData, serviceCategory: val })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-card-foreground">
                  <SelectItem value="Software Development">Software Development</SelectItem>
                  <SelectItem value="Performance Marketing">Performance Marketing</SelectItem>
                  <SelectItem value="UI/UX Design">UI/UX Design</SelectItem>
                  <SelectItem value="SEO & Growth">SEO & Growth</SelectItem>
                  <SelectItem value="Cloud & DevOps">Cloud & DevOps</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                Contract Value (৳) <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                type="number"
                placeholder="e.g. 250000"
                value={formData.contractValue}
                onChange={e => setFormData({ ...formData, contractValue: e.target.value })}
                className="bg-background border-border text-foreground font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Start Date</Label>
              <Input
                type="date"
                value={formData.startDate}
                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Target Delivery Date</Label>
              <Input
                type="date"
                value={formData.targetEndDate}
                onChange={e => setFormData({ ...formData, targetEndDate: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Scope & Milestone Deliverables</Label>
            <Textarea
              placeholder="Key project deliverables, tech stack, milestones, or SLA..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
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
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
            >
              {loading ? 'Creating...' : 'Register Project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
