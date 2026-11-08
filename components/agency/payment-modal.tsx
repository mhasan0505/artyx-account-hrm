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
import { recordAgencyPayment } from '@/lib/actions/agency-invoices'
import { toast } from 'sonner'
import { CreditCard, DollarSign } from 'lucide-react'

export function RecordPaymentModal({
  invoiceId,
  invoiceNumber,
  clientName,
  dueAmount,
  bankAccounts = [],
  onPaymentRecorded,
  trigger,
}: {
  invoiceId: string
  invoiceNumber: string
  clientName: string
  dueAmount: number
  bankAccounts?: Array<{ id: string; bankName: string; accountName: string; accountNumber: string }>
  onPaymentRecorded?: () => void
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    amount: dueAmount.toString(),
    paymentMethod: 'BANK_TRANSFER',
    bankAccountId: bankAccounts[0]?.id || '',
    reference: '',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payAmt = parseFloat(formData.amount)
    if (isNaN(payAmt) || payAmt <= 0) {
      toast.error('Please enter a valid payment amount')
      return
    }

    try {
      setLoading(true)
      const res = await recordAgencyPayment({
        invoiceId,
        amount: payAmt,
        paymentMethod: formData.paymentMethod,
        bankAccountId: formData.bankAccountId || undefined,
        reference: formData.reference,
        notes: formData.notes,
      })

      if (res.success) {
        toast.success(`Payment of ৳${payAmt.toLocaleString()} recorded for ${invoiceNumber}!`)
        setOpen(false)
        onPaymentRecorded?.()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
            <DollarSign className="size-3.5 mr-1" />
            Record Payment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <CreditCard className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Record Invoice Payment
          </DialogTitle>
        </DialogHeader>

        <div className="bg-muted/60 rounded-xl p-3 border border-border text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice:</span>
            <span className="font-mono font-semibold text-foreground">{invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Client:</span>
            <span className="font-medium text-foreground">{clientName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current Due:</span>
            <span className="font-bold text-[#3E7000] dark:text-[#7FFF00]">৳{dueAmount.toLocaleString()}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">
              Payment Amount (৳) <span className="text-rose-500">*</span>
            </Label>
            <Input
              required
              type="number"
              step="any"
              max={dueAmount}
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              className="bg-background border-border text-foreground font-mono text-base font-semibold"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Payment Channel / Method</Label>
            <Select
              value={formData.paymentMethod}
              onValueChange={val => setFormData({ ...formData, paymentMethod: val })}
            >
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-card-foreground">
                <SelectItem value="BANK_TRANSFER">Bank Wire / Electronic Transfer</SelectItem>
                <SelectItem value="BKASH">bKash (Merchant / Personal)</SelectItem>
                <SelectItem value="NAGAD">Nagad</SelectItem>
                <SelectItem value="ROCKET">Rocket (DBBL)</SelectItem>
                <SelectItem value="STRIPE">Stripe / Card Payment</SelectItem>
                <SelectItem value="WISE">Wise (TransferWise)</SelectItem>
                <SelectItem value="CHEQUE">Cheque</SelectItem>
                <SelectItem value="CASH">Cash in Hand</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {bankAccounts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Deposit Into Agency Account</Label>
              <Select
                value={formData.bankAccountId}
                onValueChange={val => setFormData({ ...formData, bankAccountId: val })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Select bank or MFS account" />
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
            <Label className="text-xs text-muted-foreground font-medium">Transaction Reference / TrxID</Label>
            <Input
              placeholder="e.g. TrxID 9K38271A or Bank Deposit Slip #"
              value={formData.reference}
              onChange={e => setFormData({ ...formData, reference: e.target.value })}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Notes / Remarks</Label>
            <Textarea
              placeholder="Payment confirmation notes..."
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
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
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
            >
              {loading ? 'Recording...' : 'Confirm Payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
