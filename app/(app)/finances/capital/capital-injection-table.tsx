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
  approveCapitalInjection,
  rejectCapitalInjection,
} from '@/lib/actions/capital'
import { CheckCircle, XCircle } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { CreateCapitalInjectionDialog } from './create-capital-injection-dialog'

export function CapitalInjectionTable({
  injections,
  bankAccounts,
  userRole,
}: {
  injections: any[]
  bankAccounts: any[]
  userRole: string
}) {
  const [isPending, startTransition] = useTransition()

  const canApprove =
    userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'MANAGER'

  function onApprove(id: string) {
    if (
      !confirm(
        'Are you sure you want to approve this capital injection? Funds will be added to the bank account.'
      )
    )
      return

    startTransition(async () => {
      try {
        await approveCapitalInjection(id)
        toast.success('Capital injection approved successfully')
      } catch (error: any) {
        toast.error(error.message || 'Failed to approve capital injection')
      }
    })
  }

  function onReject(id: string) {
    const reason = prompt('Enter rejection reason (optional):')
    if (reason === null) return // cancelled

    startTransition(async () => {
      try {
        await rejectCapitalInjection(id)
        toast.success('Capital injection rejected')
      } catch (error: any) {
        toast.error(error.message || 'Failed to reject capital injection')
      }
    })
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateCapitalInjectionDialog bankAccounts={bankAccounts} />
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / ID</TableHead>
              <TableHead>Bank Account</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Initiated By</TableHead>
              {canApprove && (
                <TableHead className="text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {injections.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  No capital injections found.
                </TableCell>
              </TableRow>
            ) : (
              injections.map(injection => (
                <TableRow key={injection.id}>
                  <TableCell>
                    <div className="font-medium text-sm">
                      {new Date(injection.injectionDate).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {injection.id.slice(0, 8)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {injection.bankAccount?.accountName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{injection.description}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ৳{Number(injection.amount).toFixed(2)}
                  </TableCell>
                  <TableCell>{renderStatus(injection.status)}</TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {injection.createdBy?.name || injection.createdBy?.email}
                    </span>
                  </TableCell>
                  {canApprove && (
                    <TableCell className="text-right">
                      {injection.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onApprove(injection.id)}
                            disabled={isPending}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReject(injection.id)}
                            disabled={isPending}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
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
