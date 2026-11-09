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
import { createLeaveRequest, approveLeaveRequest } from '@/lib/actions/hr'
import { toast } from 'sonner'
import { CheckSquare, Plus, CheckCircle2, XCircle, Clock, Calendar } from 'lucide-react'

type Employee = {
  id: string
  name: string
  employeeCode: string
  department?: { name: string } | null
  designation?: { name: string } | null
}

type LeaveType = {
  id: string
  name: string
  annualAllowance: number
}

type LeaveRequest = {
  id: string
  employee: Employee
  leaveType: LeaveType
  startDate: Date | string
  endDate: Date | string
  days: number
  reason?: string | null
  status: string
  createdAt: Date | string
}

export function LeaveManagement({
  employees = [],
  leaveTypes = [],
  requests = [],
}: {
  employees: Employee[]
  leaveTypes: LeaveType[]
  requests: LeaveRequest[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    employeeId: employees[0]?.id || '',
    leaveTypeId: leaveTypes[0]?.id || '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    reason: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employeeId || !form.leaveTypeId) {
      toast.error('Employee and leave type are required')
      return
    }

    try {
      setLoading(true)
      const res = await createLeaveRequest({
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        startDate: new Date(form.startDate),
        endDate: new Date(form.endDate),
        reason: form.reason,
      })

      if (res.success) {
        toast.success('Leave request submitted successfully!')
        setOpen(false)
        setForm({
          employeeId: employees[0]?.id || '',
          leaveTypeId: leaveTypes[0]?.id || '',
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0],
          reason: '',
        })
        router.refresh()
      } else {
        toast.error(res.error || 'Failed to submit leave request')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error submitting request')
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(requestId: string) {
    try {
      setApprovingId(requestId)
      const res = await approveLeaveRequest(requestId)
      if (res.success) {
        toast.success('Leave request approved!')
        router.refresh()
      } else {
        toast.error(res.error || 'Failed to approve request')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error approving request')
    } finally {
      setApprovingId(null)
    }
  }

  const pendingCount = requests.filter(r => r.status === 'PENDING').length
  const approvedCount = requests.filter(r => r.status === 'APPROVED').length

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex justify-between items-center">
        <h2 className="text-base font-bold text-foreground">Leave Requests & Allowances</h2>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
              <Plus className="size-4 mr-1.5" />
              Request Leave
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Calendar className="size-5 text-primary" />
                Submit Leave Application
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
                <Label className="text-xs text-muted-foreground font-medium">Leave Category</Label>
                <Select
                  value={form.leaveTypeId}
                  onValueChange={val => setForm({ ...form, leaveTypeId: val })}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Select Leave Type" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-card-foreground">
                    {leaveTypes.map(lt => (
                      <SelectItem key={lt.id} value={lt.id}>
                        {lt.name} ({lt.annualAllowance} days/yr)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Start Date</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm({ ...form, startDate: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">End Date</Label>
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm({ ...form, endDate: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Reason / Handover Notes</Label>
                <Textarea
                  placeholder="Reason for leave and emergency contact or sprint handover..."
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  className="bg-background border-border text-foreground min-h-[70px]"
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
                  {loading ? 'Submitting...' : 'Submit Application'}
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
            <CardTitle className="text-xs font-semibold text-muted-foreground">Pending Approvals</CardTitle>
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {pendingCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Requires HR / Management approval</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Approved Leaves</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {approvedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Approved for current cycle</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Available Leave Types</CardTitle>
            <CheckSquare className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{leaveTypes.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Annual, Sick, & Casual allowances</p>
          </CardContent>
        </Card>
      </div>

      {/* Requests Table */}
      {requests.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <CheckSquare className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No leave requests recorded</h3>
            <p className="text-sm text-muted-foreground">
              Submit a leave application using the button above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3 text-center">Days</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {requests.map(req => (
                <tr key={req.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-bold text-foreground block">{req.employee.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{req.employee.employeeCode}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground font-medium">
                    {req.leaveType?.name || 'General Leave'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(req.startDate).toLocaleDateString()} to {new Date(req.endDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-bold text-foreground">
                    {req.days} {req.days === 1 ? 'day' : 'days'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                    {req.reason || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={
                        req.status === 'APPROVED'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : req.status === 'PENDING'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                      }
                    >
                      {req.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {req.status === 'PENDING' && (
                      <Button
                        size="sm"
                        onClick={() => handleApprove(req.id)}
                        disabled={approvingId === req.id}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-7 px-2.5"
                      >
                        {approvingId === req.id ? 'Approving...' : 'Approve'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
