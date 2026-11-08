'use client'

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
import { deleteBankAccount } from '@/lib/actions/bank'
import type { BankAccount } from '@prisma/client'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CreateBankDialog } from './create-bank-dialog'
import { EditBankDialog } from './edit-bank-dialog'

export function BankAccountsTable({ accounts }: { accounts: BankAccount[] }) {
  const router = useRouter()
  const [editTarget, setEditTarget] = useState<BankAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null)
  const [isDeleting, startDelete] = useTransition()

  function handleDeleted() {
    router.refresh()
  }

  function confirmDelete() {
    if (!deleteTarget) return
    startDelete(async () => {
      const res = await deleteBankAccount(deleteTarget.id)
      if (!res.success) {
        toast.error(res.error)
      } else {
        toast.success('Account deleted')
        handleDeleted()
      }
      setDeleteTarget(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateBankDialog />
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead>Bank / MFS</TableHead>
              <TableHead>Account No.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Charges (Txn / Cash-Out)</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  No accounts found.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map(account => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">
                    {account.accountName}
                  </TableCell>
                  <TableCell>{account.bankName}</TableCell>
                  <TableCell>{account.accountNumber}</TableCell>
                  <TableCell>
                    <Badge variant={account.isMfs ? 'secondary' : 'default'}>
                      {account.isMfs ? 'MFS' : 'Bank'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {account.isMfs ? (
                      <span className="text-sm">
                        {Number(account.cashoutChargePct)}% (Cash-Out)
                      </span>
                    ) : (
                      <span className="text-sm">
                        ৳{Number(account.transactionChargePct)} (Txn)
                      </span>
                    )}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      {account.chargeType === 'MERCHANT_BEARS'
                        ? 'Merchant Bears'
                        : 'Customer Pays'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ৳{Number(account.currentBalance).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Link href={`/finances/banks/${account.id}/statement`}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-primary hover:text-primary hover:bg-primary/10"
                          title="View Statement"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditTarget(account)}
                        title="Edit Account"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(account)}
                        title="Delete Account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editTarget && (
        <EditBankDialog
          account={editTarget}
          open={!!editTarget}
          onOpenChange={open => {
            if (!open) setEditTarget(null)
          }}
          onSuccess={() => {
            setEditTarget(null)
            router.refresh()
          }}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>{deleteTarget?.accountName}</strong>? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
