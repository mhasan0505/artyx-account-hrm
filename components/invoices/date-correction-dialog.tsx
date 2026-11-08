'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateSaleDate } from '@/lib/actions/sales'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

export type DateCorrectionDialogProps = {
  saleId: string
  saleDate: Date
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function DateCorrectionDialog({
  saleId,
  saleDate,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
}: DateCorrectionDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (isControlled) {
      setControlledOpen?.(val)
    } else {
      setInternalOpen(val)
    }
  }
  const initialDate = useMemo(() => toDateInputValue(saleDate), [saleDate])
  const [nextDate, setNextDate] = useState(initialDate)
  const [reason, setReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    setIsSaving(true)
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
        toast.error('Enter a valid date')
        return
      }
      const dateParts = nextDate.split('-')
      const year = parseInt(dateParts[0], 10)
      const month = parseInt(dateParts[1], 10) - 1
      const day = parseInt(dateParts[2], 10)

      // Reject impossible dates like Feb 31 — Date would silently roll over to Mar 3.
      const probe = new Date(year, month, day)
      if (
        probe.getFullYear() !== year ||
        probe.getMonth() !== month ||
        probe.getDate() !== day
      ) {
        toast.error('That date does not exist (e.g. Feb 30)')
        return
      }

      const updatedDate = probe
      updatedDate.setHours(
        saleDate.getHours(),
        saleDate.getMinutes(),
        saleDate.getSeconds(),
        saleDate.getMilliseconds()
      )

      const result = await updateSaleDate({
        saleId,
        saleDate: updatedDate,
        reason,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Invoice date corrected')
      setOpen(false)
      setReason('')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (nextOpen) {
          setNextDate(initialDate)
        }
      }}
    >
      {trigger === null ? null : trigger !== undefined ? (
        trigger
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 text-xs font-medium border-border">
            Correct Date
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct Sales Invoice Date</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Invoice Date</Label>
            <Input
              type="date"
              value={nextDate}
              onChange={e => setNextDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Provide reason for correction"
            />
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving ? 'Saving...' : 'Save Date Correction'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
