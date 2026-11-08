'use client'

import { deleteSale } from '@/lib/actions/sales'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface DeleteInvoiceButtonProps {
  saleId: string
  saleNumber: string
}

export function DeleteInvoiceButton({
  saleId,
  saleNumber,
}: DeleteInvoiceButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const result = await deleteSale(saleId)
        if (result.success) {
          toast.success(`Invoice ${saleNumber} deleted successfully.`)
          setOpen(false)
          // Refresh the server component list so the deleted row disappears immediately.
          router.refresh()
        } else {
          toast.error(result.error || 'Failed to delete invoice.')
        }
      } catch (err: any) {
        toast.error(err.message || 'An error occurred.')
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer rounded-full transition-all duration-200"
          title="Delete Invoice"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border border-red-100 shadow-xl bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive flex items-center gap-2">
            <Trash2 className="h-5 w-5 animate-pulse" />
            Delete Invoice {saleNumber}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground mt-2">
            Are you absolutely sure? This action is permanent and will reverse:
            <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
              <li>Stock quantities & serial number status</li>
              <li>Bank account transactions & balance adjustments</li>
              <li>Cash drawer session record adjustments</li>
              <li>COGS and revenue ledger entries</li>
            </ul>
            <p className="mt-3 text-red-500/80 font-medium text-xs bg-red-50/50 p-2 rounded border border-red-100/50">
              Warning: This operation cannot be undone.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleDelete()
            }}
            disabled={isPending}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground flex items-center gap-1.5"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deleting...
              </>
            ) : (
              'Confirm Delete'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
