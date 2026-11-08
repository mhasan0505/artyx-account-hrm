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
import { addClientCredential } from '@/lib/actions/agency-clients'
import { toast } from 'sonner'
import { KeyRound, Plus, Shield } from 'lucide-react'
import { CredentialCategory } from '@prisma/client'

export function AddCredentialModal({
  clientId,
  onCredentialAdded,
  trigger,
}: {
  clientId: string
  onCredentialAdded?: () => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    title: '',
    category: 'HOSTING' as CredentialCategory,
    loginUrl: '',
    username: '',
    password: '',
    apiKey: '',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.title.trim()) {
      toast.error('Title is required')
      return
    }

    try {
      setLoading(true)
      const res = await addClientCredential(clientId, formData)
      if (res.success) {
        toast.success(`Credential "${res.credential.title}" securely saved!`)
        setOpen(false)
        setFormData({
          title: '',
          category: 'HOSTING',
          loginUrl: '',
          username: '',
          password: '',
          apiKey: '',
          notes: '',
        })
        onCredentialAdded?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save credential')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
            <Plus className="size-3.5 mr-1" />
            Add Credential
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Shield className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Store Client Credential & Access
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Credential Title <span className="text-rose-500">*</span>
            </Label>
            <Input
              required
              placeholder="e.g. cPanel Hostinger / WordPress Admin / Namecheap"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Category</Label>
              <Select
                value={formData.category}
                onValueChange={(val: any) => setFormData({ ...formData, category: val })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-card-foreground">
                  <SelectItem value="DOMAIN">Domain Registrar</SelectItem>
                  <SelectItem value="HOSTING">Hosting / Server / cPanel</SelectItem>
                  <SelectItem value="CMS_ADMIN">CMS Admin (WordPress/Shopify)</SelectItem>
                  <SelectItem value="DATABASE">Database Access</SelectItem>
                  <SelectItem value="SOCIAL_MEDIA">Social Media Account</SelectItem>
                  <SelectItem value="API_KEY">API Key / Token</SelectItem>
                  <SelectItem value="OTHER">Other Credentials</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Login URL</Label>
              <Input
                placeholder="https://client.com/wp-admin"
                value={formData.loginUrl}
                onChange={e => setFormData({ ...formData, loginUrl: e.target.value })}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Username / Email</Label>
              <Input
                placeholder="admin@client.com"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                className="bg-background border-border text-foreground font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Password / Access Key</Label>
              <Input
                type="text"
                placeholder="Secure password or secret"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="bg-background border-border text-foreground font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">API Key / Secret Token (Optional)</Label>
            <Input
              placeholder="e.g. sk_live_xxxxxxxx"
              value={formData.apiKey}
              onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
              className="bg-background border-border text-foreground font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Notes & Server IP</Label>
            <Textarea
              placeholder="Server IP, port, nameservers, 2FA backup codes, or instructions..."
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
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
            >
              {loading ? 'Saving...' : 'Save Credential'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
