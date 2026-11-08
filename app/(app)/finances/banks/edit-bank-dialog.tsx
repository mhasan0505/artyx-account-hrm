'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Switch } from '@/components/ui/switch'
import { updateBankAccount } from '@/lib/actions/bank'
import type { BankAccount } from '@prisma/client'
import { useTransition } from 'react'
import { toast } from 'sonner'

interface EditBankDialogProps {
  account: BankAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditBankDialog({
  account,
  open,
  onOpenChange,
  onSuccess,
}: EditBankDialogProps) {
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      const isMfs = fd.get('isMfs') === 'on'
      const chargePct = Number(fd.get('chargePct') || 0)

      const res = await updateBankAccount(account.id, {
        accountName: String(fd.get('accountName')),
        accountNumber: String(fd.get('accountNumber')),
        bankName: String(fd.get('bankName')),
        branch: String(fd.get('branch') || ''),
        isMfs,
        transactionChargePct: isMfs ? 0 : chargePct,
        cashoutChargePct: isMfs ? chargePct : 0,
        chargeType: String(fd.get('chargeType')),
      })

      if (!res.success) {
        toast.error(res.error)
        return
      }

      toast.success('Account updated successfully')
      onOpenChange(false)
      onSuccess()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-1062.5">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>
              Update bank or MFS account details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-is-mfs"
                name="isMfs"
                defaultChecked={account.isMfs}
              />
              <Label htmlFor="edit-is-mfs">
                MFS Account (e.g. bKash, Nagad)
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{account.isMfs ? 'MFS Provider' : 'Bank Name'}</Label>
                <Input
                  name="bankName"
                  required
                  defaultValue={account.bankName}
                />
              </div>
              <div className="space-y-1">
                <Label>Account Name</Label>
                <Input
                  name="accountName"
                  required
                  defaultValue={account.accountName}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input
                  name="accountNumber"
                  required
                  defaultValue={account.accountNumber}
                />
              </div>
              <div className="space-y-1">
                <Label>Branch (Optional)</Label>
                <Input name="branch" defaultValue={account.branch ?? ''} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>
                  {account.isMfs
                    ? 'Cash-Out Charge (%)'
                    : 'Transaction Fee (৳)'}
                </Label>
                <Input
                  name="chargePct"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={String(
                    account.isMfs
                      ? Number(account.cashoutChargePct)
                      : Number(account.transactionChargePct)
                  )}
                />
              </div>
              <div className="space-y-1">
                <Label>Fee Behavior</Label>
                <Select name="chargeType" defaultValue={account.chargeType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MERCHANT_BEARS">
                      Merchant Bears Fee
                    </SelectItem>
                    <SelectItem value="CUSTOMER_PAYS">
                      Customer Pays Fee
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
