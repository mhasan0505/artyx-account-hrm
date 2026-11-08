'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  approveContraTransfer,
  rejectContraTransfer,
} from '@/lib/actions/transfers'
import { CheckCircle, Info, XCircle } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { CreateTransferDialog } from './create-transfer-dialog'

export function TransfersTable({
  transfers,
  bankAccounts,
  activeDrawerId,
  userRole,
}: {
  transfers: any[]
  bankAccounts: any[]
  activeDrawerId?: string
  userRole: string
}) {
  const [isPending, startTransition] = useTransition()

  const canApprove =
    userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'MANAGER'

  function onApprove(id: string) {
    if (
      !confirm(
        'Are you sure you want to approve this transfer? Funds will be moved immediately.'
      )
    )
      return

    startTransition(async () => {
      const res = await approveContraTransfer(id)
      if (res.success) {
        toast.success('Transfer approved successfully')
      } else {
        toast.error(res.error)
      }
    })
  }

  function onReject(id: string) {
    const reason = prompt('Enter rejection reason (optional):')
    if (reason === null) return // cancelled

    startTransition(async () => {
      const res = await rejectContraTransfer(id, reason)
      if (res.success) {
        toast.success('Transfer rejected')
      } else {
        toast.error(res.error)
      }
    })
  }

  function renderType(type: string) {
    switch (type) {
      case 'DRAWER_TO_BANK':
        return <Badge variant="outline">Cash → Bank</Badge>
      case 'BANK_TO_DRAWER':
        return <Badge variant="outline">Bank → Cash</Badge>
      default:
        return <Badge variant="outline">{type}</Badge>
    }
  }

  function renderStatus(status: string) {
    switch (status) {
      case 'APPROVED':
        return (
          <Badge className="bg-green-600 hover:bg-green-700">Approved</Badge>
        )
      case 'REJECTED':
        return <Badge variant="destructive">Rejected</Badge>
      default:
        return <Badge variant="secondary">Pending</Badge>
    }
  }

  function renderAccounts(t: any) {
    const from =
      t.type === 'DRAWER_TO_BANK' ? 'Cash Drawer' : t.bankAccount?.accountName
    const to =
      t.type === 'BANK_TO_DRAWER' ? 'Cash Drawer' : t.bankAccount?.accountName
    return (
      <span className="text-sm">
        {from} <span className="text-muted-foreground mx-1">→</span> {to}
      </span>
    )
  }

  function calculateCharge(t: any) {
    if (t.type !== 'BANK_TO_DRAWER' || !t.bankAccount) return null
    const chargePct = t.bankAccount.isMfs
      ? Number(t.bankAccount.cashoutChargePct || 0)
      : Number(t.bankAccount.transactionChargePct || 0)
    if (chargePct === 0) return null
    const amount = Number(t.amount)
    const chargeAmount = (amount * chargePct) / 100
    const netAmount = amount - chargeAmount
    return { chargePct, chargeAmount, netAmount, isMfs: t.bankAccount.isMfs }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateTransferDialog
          bankAccounts={bankAccounts}
          activeDrawerId={activeDrawerId}
        />
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Accounts</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Charge</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Initiated By</TableHead>
              {canApprove && (
                <TableHead className="text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  No transfers found.
                </TableCell>
              </TableRow>
            ) : (
              transfers.map(t => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium text-xs">
                      TRN-{t.id.slice(-6).toUpperCase()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  </TableCell>
                  <TableCell>{renderType(t.type)}</TableCell>
                  <TableCell>{renderAccounts(t)}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-blue-600">
                    ৳{Number(t.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => {
                      const charge = calculateCharge(t)
                      if (!charge)
                        return <span className="text-muted-foreground">-</span>
                      return (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-end gap-1 text-sm">
                                <span className="text-orange-600 font-medium">
                                  ৳{charge.chargeAmount.toFixed(2)}
                                </span>
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs space-y-1">
                                <div className="font-semibold">
                                  {charge.isMfs ? 'MFS' : 'Bank'} Charge
                                </div>
                                <div>Rate: {charge.chargePct}%</div>
                                <div>
                                  Charge: ৳{charge.chargeAmount.toFixed(2)}
                                </div>
                                <div className="border-t pt-1 mt-1">
                                  Net to Drawer:{' '}
                                  <span className="font-bold">
                                    ৳{charge.netAmount.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )
                    })()}
                  </TableCell>
                  <TableCell>{renderStatus(t.status)}</TableCell>
                  <TableCell className="text-sm">
                    {t.createdBy?.name}
                    {t.approvedBy && (
                      <div className="text-xs text-muted-foreground">
                        Auth: {t.approvedBy.name}
                      </div>
                    )}
                  </TableCell>
                  {canApprove && (
                    <TableCell className="text-right">
                      {t.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                            onClick={() => onApprove(t.id)}
                            disabled={isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onReject(t.id)}
                            disabled={isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
