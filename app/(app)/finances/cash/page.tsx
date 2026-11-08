'use client'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getCashFlowAccounts,
  getOpenDrawer,
  recordDrawerTransaction,
} from '@/lib/actions/finance'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

type OpenDrawer = Awaited<ReturnType<typeof getOpenDrawer>>

export default function CashInOutPage() {
  const [drawer, setDrawer] = useState<OpenDrawer>(null)
  const [outletId, setOutletId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [throughAccountId, setThroughAccountId] = useState('')
  const [accounts, setAccounts] = useState<
    { id: string; code: string; name: string; type: string }[]
  >([])
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN')
  const [isPending, startTransition] = useTransition()

  async function load(oid: string) {
    if (!oid) return
    const d = await getOpenDrawer(oid)
    setDrawer(d)
  }

  async function loadAccounts() {
    try {
      const accountRows = await getCashFlowAccounts()
      setAccounts(accountRows)

      const defaultAccount =
        accountRows.find(a => a.code === '1200') ??
        accountRows.find(a => a.code === '2200') ??
        accountRows.find(a => a.code === '1100') ??
        null

      if (defaultAccount) {
        setThroughAccountId(defaultAccount.id)
      }
    } catch {
      setAccounts([])
      toast.error('Failed to load accounts for cash in/out')
    }
  }

  useEffect(() => {
    loadAccounts()

    fetch('/api/auth/session')
      .then(r => r.json())
      .then(s => {
        const oid = s?.user?.outletId ?? ''
        setOutletId(oid)
        if (oid) load(oid)
      })
  }, [])

  function handleSubmit() {
    if (!drawer) {
      toast.error('No open drawer session')
      return
    }
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!throughAccountId) {
      toast.error('Select an account')
      return
    }
    startTransition(async () => {
      const res = await recordDrawerTransaction({
        drawerId: drawer.id,
        type,
        amount: amt,
        throughAccountId,
        description:
          description || (type === 'CASH_IN' ? 'Cash in' : 'Cash out'),
      })
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success(`${type === 'CASH_IN' ? 'Cash in' : 'Cash out'} recorded`)
      setAmount('')
      setDescription('')
      await load(outletId)
    })
  }

  const entries = drawer?.transactions ?? []

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader title="Cash In / Out" />

      {!drawer && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 p-4 text-sm text-yellow-700">
          No open drawer session. Open a drawer first from Drawer Management.
        </div>
      )}

      {drawer && (
        <div className="rounded-lg border p-4 space-y-4 max-w-sm">
          <div className="flex gap-2">
            <Button
              variant={type === 'CASH_IN' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setType('CASH_IN')}
            >
              Cash In
            </Button>
            <Button
              variant={type === 'CASH_OUT' ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setType('CASH_OUT')}
            >
              Cash Out
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Amount (৳)</Label>
            <Input
              type="number"
              min={0.01}
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Through Account</Label>
            <select
              value={throughAccountId}
              onChange={e => setThroughAccountId(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select account</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active accounts found. Please create Chart of Accounts first.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Reason…"
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            className="w-full"
          >
            {isPending ? 'Saving…' : 'Record'}
          </Button>
        </div>
      )}

      {/* Transaction list */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-left font-medium">Description</th>
              <th className="px-4 py-3 text-left font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No transactions this session
                </td>
              </tr>
            )}
            {[...entries].reverse().map(e => {
              const amt = Number(e.amount)
              const isOut = amt < 0
              return (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        isOut
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {e.type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${isOut ? 'text-red-600' : 'text-green-600'}`}
                  >
                    {isOut ? '-' : '+'}৳{Math.abs(amt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {e.description}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
