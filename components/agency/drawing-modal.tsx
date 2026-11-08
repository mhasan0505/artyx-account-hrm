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
import { recordOwnerDrawing } from '@/lib/actions/agency-equity'
import { toast } from 'sonner'
import { ArrowDownRight, CreditCard, DollarSign } from 'lucide-react'

export function RecordDrawingModal({
  ownerId,
  ownerName,
  bankAccounts = [],
  onDrawingRecorded,
  trigger,
}: {
  ownerId: string
  ownerName: string
  bankAccounts?: Array<{ id: string; bankName: string; accountName: string; accountNumber: string }>
  onDrawingRecorded?: () => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    amount: '',
    paymentMethod: 'BANK_TRANSFER',
    bankAccountId: bankAccounts[0]?.id || '',
    reason: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const drawAmt = parseFloat(formData.amount)
    if (isNaN(drawAmt) || drawAmt <= 0) {
      toast.error('Please enter a valid drawing amount')
      return
    }

    try {
      setLoading(true)
      const res = await recordOwnerDrawing({
        ownerId,
        amount: drawAmt,
        paymentMethod: formData.paymentMethod,
        bankAccountId: formData.bankAccountId || undefined,
        reason: formData.reason,
      })

      if (res.success) {
        toast.success(`Drawing of ৳${drawAmt.toLocaleString()} recorded for ${ownerName}!`)
        setOpen(false)
        setFormData({
          amount: '',
          paymentMethod: 'BANK_TRANSFER',
          bankAccountId: bankAccounts[0]?.id || '',
          reason: '',
        })
        onDrawingRecorded?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to record drawing')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="border-orange-500/40 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10">
            <ArrowDownRight className="size-3.5 mr-1" />
            Record Drawing
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <CreditCard className="size-5 text-orange-600 dark:text-orange-400" />
            Record Partner Drawing / Withdrawal
          </DialogTitle>
        </DialogHeader>

        <div className="bg-muted/60 rounded-xl p-3 border border-border text-xs flex justify-between items-center">
          <span className="text-muted-foreground">Partner / Owner:</span>
          <span className="font-semibold text-foreground text-sm">{ownerName}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Withdrawal Amount (৳) <span className="text-rose-500">*</span>
            </Label>
            <Input
              required
              type="number"
              step="any"
              placeholder="e.g. 50000"
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              className="bg-background border-border text-foreground font-mono text-base font-semibold"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Disbursement Method</Label>
            <Select
              value={formData.paymentMethod}
              onValueChange={val => setFormData({ ...formData, paymentMethod: val })}
            >
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-card-foreground">
                <SelectItem value="BANK_TRANSFER">Bank Transfer (EFT / RTGS)</SelectItem>
                <SelectItem value="BKASH">bKash</SelectItem>
                <SelectItem value="NAGAD">Nagad</SelectItem>
                <SelectItem value="CHEQUE">Company Cheque</SelectItem>
                <SelectItem value="CASH">Petty Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {bankAccounts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Withdraw From Agency Bank</Label>
              <Select
                value={formData.bankAccountId}
                onValueChange={val => setFormData({ ...formData, bankAccountId: val })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-card-foreground">
                  {bankAccounts.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bankName} - {b.accountName} ({b.accountNumber})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Reason / Description</Label>
            <Textarea
              placeholder="e.g. Monthly personal drawing, advance against Q3 dividend..."
              value={formData.reason}
              onChange={e => setFormData({ ...formData, reason: e.target.value })}
              className="bg-background border-border text-foreground min-h-[60px]"
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
              className="bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-xs"
            >
              {loading ? 'Recording...' : 'Record Withdrawal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
