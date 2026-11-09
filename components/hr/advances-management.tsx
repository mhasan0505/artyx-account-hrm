'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { giveEmployeeAdvance } from '@/lib/actions/payroll'
import { toast } from 'sonner'
import { Coins, Plus, DollarSign, CheckCircle2, ArrowDownRight, Clock } from 'lucide-react'

type Employee = {
  id: string
  name: string
  employeeCode: string
  outletId: string
  department?: { name: string } | null
  designation?: { name: string } | null
}

type BankAccount = {
  id: string
  bankName: string
  accountName: string
  accountNumber: string
}

type AdvanceRow = {
  id: string
  employee: {
    id: string
    name: string
    employeeCode: string
    department?: { name: string } | null
    designation?: { name: string } | null
  }
  amount: number
  recoveredAmount: number
  givenDate: Date | string
  status: string
}

export function AdvancesManagement({
  employees = [],
  bankAccounts = [],
  advances = [],
  defaultOutletId,
}: {
  employees: Employee[]
  bankAccounts: BankAccount[]
  advances: AdvanceRow[]
  defaultOutletId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    employeeId: employees[0]?.id || '',
    amount: '',
    method: 'BANK_TRANSFER' as any,
    bankAccountId: bankAccounts[0]?.id || '',
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employeeId) {
      toast.error('Please select an employee')
      return
    }
    const val = parseFloat(form.amount)
    if (isNaN(val) || val <= 0) {
      toast.error('Please enter a valid advance amount')
      return
    }

    const selectedEmp = employees.find(e => e.id === form.employeeId)
    const outletId = selectedEmp?.outletId || defaultOutletId

    try {
      setLoading(true)
      const res = await giveEmployeeAdvance({
        employeeId: form.employeeId,
        outletId,
        amount: val,
        method: form.method,
        bankAccountId: form.method !== 'CASH' ? form.bankAccountId : undefined,
        notes: form.notes,
      })

      if (res.success) {
        toast.success(`Advance of ৳${val.toLocaleString()} issued successfully!`)
        setOpen(false)
        setForm({
          employeeId: employees[0]?.id || '',
          amount: '',
          method: 'BANK_TRANSFER',
          bankAccountId: bankAccounts[0]?.id || '',
          notes: '',
        })
        router.refresh()
      } else {
        toast.error(res.error || 'Failed to issue advance')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error processing advance')
    } finally {
      setLoading(false)
    }
  }

  const totalDisbursed = advances.reduce((s, a) => s + a.amount, 0)
  const totalRecovered = advances.reduce((s, a) => s + a.recoveredAmount, 0)
  const totalOutstanding = totalDisbursed - totalRecovered

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex justify-between items-center">
        <h2 className="text-base font-bold text-foreground">Employee Advance Ledgers</h2>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
              <Plus className="size-4 mr-1.5" />
              Disburse Salary Advance
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Coins className="size-5 text-primary" />
                Issue Employee Advance Payment
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Employee</Label>
                <Select
                  value={form.employeeId}
                  onValueChange={val => setForm({ ...form, employeeId: val })}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Select Employee" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-card-foreground">
                    {employees.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} ({e.employeeCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Advance Amount (৳)</Label>
                <Input
                  required
                  type="number"
                  placeholder="e.g. 20000"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="bg-background border-border text-foreground font-mono font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Disbursement Method</Label>
                <Select
                  value={form.method}
                  onValueChange={val => setForm({ ...form, method: val as any })}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-card-foreground">
                    <SelectItem value="BANK_TRANSFER">Bank Wire / Electronic Transfer</SelectItem>
                    <SelectItem value="BKASH">bKash</SelectItem>
                    <SelectItem value="NAGAD">Nagad</SelectItem>
                    <SelectItem value="CASH">Petty Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.method !== 'CASH' && bankAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Withdraw From Account</Label>
                  <Select
                    value={form.bankAccountId}
                    onValueChange={val => setForm({ ...form, bankAccountId: val })}
                  >
                    <SelectTrigger className="bg-background border-border text-foreground">
                      <SelectValue placeholder="Select Bank/MFS" />
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
                <Label className="text-xs text-muted-foreground font-medium">Reason / Recovery Agreement</Label>
                <Textarea
                  placeholder="e.g. Advance against next month salary, medical emergency..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
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
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
                >
                  {loading ? 'Disbursing...' : 'Disburse Advance'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Advances Issued</CardTitle>
            <Coins className="size-4 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">৳{totalDisbursed.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Across {advances.length} records</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Recovered via Payroll</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{totalRecovered.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Deducted from monthly pay slips</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Outstanding Balance</CardTitle>
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              ৳{totalOutstanding.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pending recovery from future payroll</p>
          </CardContent>
        </Card>
      </div>

      {/* Advances Table */}
      {advances.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Coins className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No salary advances issued</h3>
            <p className="text-sm text-muted-foreground">
              Disburse an advance using the button above. Recoveries are automatically tracked during monthly payroll.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Date Given</th>
                <th className="px-4 py-3 text-right">Original Amount</th>
                <th className="px-4 py-3 text-right">Recovered</th>
                <th className="px-4 py-3 text-right">Remaining Due</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {advances.map(adv => {
                const rem = adv.amount - adv.recoveredAmount
                return (
                  <tr key={adv.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-bold text-foreground block">{adv.employee.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{adv.employee.employeeCode}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {adv.employee.department?.name || 'General'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(adv.givenDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                      ৳{adv.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      ৳{adv.recoveredAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      ৳{rem.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        className={
                          adv.status === 'FULLY_RECOVERED'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                            : adv.status === 'PARTIALLY_RECOVERED'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                        }
                      >
                        {adv.status.replace('_', ' ')}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
