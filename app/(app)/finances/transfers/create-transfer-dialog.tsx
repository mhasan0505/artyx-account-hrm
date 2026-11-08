'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createContraTransfer,
  getTransferChargeEstimate,
} from '@/lib/actions/transfers'
import { Plus } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

export function CreateTransferDialog({
  bankAccounts,
  activeDrawerId,
}: {
  bankAccounts: any[]
  activeDrawerId?: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [type, setType] = useState<'DRAWER_TO_BANK' | 'BANK_TO_DRAWER'>(
    'DRAWER_TO_BANK'
  )
  const [amount, setAmount] = useState('')
  const [bankAccountId, setBankAccountId] = useState('none')
  const [notes, setNotes] = useState('')
  const [chargeEstimate, setChargeEstimate] = useState<{
    chargeAmount: number
    netAmount: number
    chargePct: number
  } | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)

  // Calculate charge estimate when amount or account changes
  useEffect(() => {
    if (
      type !== 'BANK_TO_DRAWER' ||
      !bankAccountId ||
      bankAccountId === 'none' ||
      !amount ||
      Number(amount) <= 0
    ) {
      setChargeEstimate(null)
      return
    }

    const timer = setTimeout(async () => {
      setIsCalculating(true)
      try {
        const res = await getTransferChargeEstimate(
          bankAccountId,
          Number(amount)
        )
        if (res.success) {
          setChargeEstimate(res.data)
        } else {
          setChargeEstimate(null)
        }
      } catch {
        setChargeEstimate(null)
      } finally {
        setIsCalculating(false)
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timer)
  }, [type, bankAccountId, amount])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!activeDrawerId) {
      toast.error('No active cash drawer found. Please open a drawer first.')
      return
    }
    if (bankAccountId === 'none') {
      toast.error('Please select a bank account.')
      return
    }

    startTransition(async () => {
      const res = await createContraTransfer({
        type,
        amount: Number(amount),
        bankAccountId,
        drawerId: activeDrawerId,
        notes,
      })

      if (!res.success) {
        toast.error(res.error)
        return
      }

      toast.success(
        'Transfer requested successfully. Awaiting managerial approval.'
      )
      setOpen(false)

      setAmount('')
      setNotes('')
      setBankAccountId('none')
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Initiate Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-106.25">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Initiate Transfer</DialogTitle>
            <DialogDescription>
              Request a fund transfer between accounts. This requires managerial
              approval.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-1">
              <Label>Transfer Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAWER_TO_BANK">
                    Cash Drawer to Bank/MFS
                  </SelectItem>
                  <SelectItem value="BANK_TO_DRAWER">
                    Bank/MFS to Cash Drawer
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>
                {type === 'DRAWER_TO_BANK'
                  ? 'Target Account'
                  : 'Source Account'}
              </Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>
                    Select Account
                  </SelectItem>
                  {bankAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.bankName} - {acc.accountName} (৳
                      {Number(acc.currentBalance).toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="৳ 0.00"
              />
            </div>

            {/* Charge Breakdown - only for BANK_TO_DRAWER */}
            {type === 'BANK_TO_DRAWER' &&
              bankAccountId !== 'none' &&
              amount &&
              Number(amount) > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Transfer Breakdown
                  </p>
                  {isCalculating ? (
                    <p className="text-sm text-muted-foreground animate-pulse">
                      Calculating charge...
                    </p>
                  ) : chargeEstimate ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Transfer Amount
                        </span>
                        <span className="font-mono">
                          ৳{Number(amount).toLocaleString()}
                        </span>
                      </div>
                      {chargeEstimate.chargeAmount > 0 && (
                        <div className="flex justify-between text-sm text-rose-600 dark:text-rose-400">
                          <span>Charge ({chargeEstimate.chargePct}%)</span>
                          <span className="font-mono">
                            -৳{chargeEstimate.chargeAmount.toLocaleString()}
                          </span>
                        </div>
                      )}
                      <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                        <span>Net to Drawer</span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">
                          ৳{chargeEstimate.netAmount.toLocaleString()}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No charge applies
                    </p>
                  )}
                </div>
              )}

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Reason for transfer..."
                className="resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
