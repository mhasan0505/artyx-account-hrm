'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  getOfflineSaleConflicts,
  removeOfflineSaleConflict,
  clearOfflineSaleConflicts,
  type OfflineSaleConflict,
} from '@/lib/offline/sale-queue'
import { toast } from 'sonner'

interface OfflineConflictsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConflictsUpdated?: () => void
}

export function OfflineConflictsModal({
  open,
  onOpenChange,
  onConflictsUpdated,
}: OfflineConflictsModalProps) {
  const [conflicts, setConflicts] = React.useState<OfflineSaleConflict[]>([])
  const [loading, setLoading] = React.useState(false)
  const [retryingId, setRetryingId] = React.useState<string | null>(null)
  const [confirmDiscardAllOpen, setConfirmDiscardAllOpen] = React.useState(false)

  const loadConflicts = React.useCallback(async () => {
    try {
      setLoading(true)
      const list = await getOfflineSaleConflicts()
      setConflicts(list)
    } catch (err) {
      console.error('Failed to load offline conflicts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      loadConflicts()
    }
  }, [open, loadConflicts])

  const handleRetry = async (conflict: OfflineSaleConflict) => {
    setRetryingId(conflict.tempId)
    try {
      const response = await fetch('/api/offline/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...conflict.payload,
          createdAt: conflict.createdAt,
        }),
      })

      if (response.ok) {
        toast.success('Sale successfully synchronized with server!')
        await removeOfflineSaleConflict(conflict.tempId)
        await loadConflicts()
        onConflictsUpdated?.()
      } else {
        const body = await response.json().catch(() => ({ error: 'Sync failed' }))
        toast.error(`Sync failed: ${body.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      toast.error(`Network or server error: ${err?.message || 'Sync failed'}`)
    } finally {
      setRetryingId(null)
    }
  }

  const handleDiscard = async (tempId: string) => {
    try {
      await removeOfflineSaleConflict(tempId)
      toast.info('Conflicted offline sale discarded')
      await loadConflicts()
      onConflictsUpdated?.()
    } catch {
      toast.error('Failed to discard conflict')
    }
  }

  const handleDiscardAll = async () => {
    try {
      await clearOfflineSaleConflicts()
      toast.info('All conflicted offline sales discarded')
      await loadConflicts()
      onConflictsUpdated?.()
    } catch {
      toast.error('Failed to clear conflicts')
    }
  }

  const confirmDiscardAll = async () => {
    setConfirmDiscardAllOpen(false)
    await handleDiscardAll()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader className="pb-2 border-b border-border/60">
          <div className="flex items-center gap-2 text-rose-500">
            <AlertTriangle className="size-5 shrink-0" />
            <DialogTitle className="text-lg font-bold">
              Offline Sale Conflicts ({conflicts.length})
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            These offline sales could not be synchronized automatically due to inventory, serial, or business rule validation errors.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <RefreshCw className="size-5 animate-spin text-muted-foreground" />
              <span>Loading conflicts...</span>
            </div>
          ) : conflicts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <CheckCircle2 className="size-8 text-emerald-500" />
              <p className="font-semibold text-foreground">No conflicts detected</p>
              <p className="text-xs text-muted-foreground">All offline records are either synced or in regular queue.</p>
            </div>
          ) : (
            conflicts.map((conflict) => {
              const items = Array.isArray(conflict.payload?.items)
                ? (conflict.payload.items as any[])
                : []
              const itemCount = items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)
              const totalAmount = conflict.payload?.finalTotal ?? conflict.payload?.totalAmount ?? null

              return (
                <div
                  key={conflict.tempId}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 space-y-3 text-sm transition-colors hover:border-rose-500/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <FileWarning className="size-4 text-rose-500 shrink-0" />
                        <span className="font-semibold text-foreground text-xs font-mono">
                          ID: {conflict.tempId.slice(0, 8)}...
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(conflict.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>Items: <strong className="text-foreground">{itemCount}</strong></span>
                        {totalAmount !== null && (
                          <span>Total: <strong className="text-foreground">৳{Number(totalAmount).toFixed(2)}</strong></span>
                        )}
                        {typeof conflict.payload?.customerName === 'string' && (
                          <span>Customer: <strong className="text-foreground">{conflict.payload.customerName}</strong></span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs border-sky-400/40 text-sky-400 hover:bg-sky-500/10 cursor-pointer"
                        disabled={retryingId === conflict.tempId}
                        onClick={() => handleRetry(conflict)}
                      >
                        <RefreshCw className={`size-3.5 ${retryingId === conflict.tempId ? 'animate-spin' : ''}`} />
                        Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                        onClick={() => handleDiscard(conflict.tempId)}
                      >
                        <Trash2 className="size-3.5" />
                        Discard
                      </Button>
                    </div>
                  </div>

                  <div className="rounded bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400 font-mono break-words">
                    <strong>Error:</strong> {conflict.error}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="pt-2 border-t border-border/60 flex items-center justify-between">
            <Button
              size="sm"
              variant="destructive"
              className="text-xs gap-1.5 cursor-pointer"
              onClick={handleDiscardAll}
            >
              <Trash2 className="size-3.5" />
              Discard All Conflicts
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs cursor-pointer"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
