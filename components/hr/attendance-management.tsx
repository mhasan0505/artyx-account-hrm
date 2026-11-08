'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { markAttendance } from '@/lib/actions/hr'
import { toast } from 'sonner'
import { Clock, Plus, CheckCircle2, UserCheck, Calendar, AlertCircle } from 'lucide-react'
import { AttendanceStatus } from '@prisma/client'

type Employee = {
  id: string
  name: string
  employeeCode: string
  department?: { name: string } | null
  designation?: { name: string } | null
}

type AttendanceRecord = {
  id: string
  employeeId: string
  employee: Employee
  date: Date | string
  status: string
  checkIn?: Date | string | null
  checkOut?: Date | string | null
  notes?: string | null
}

export function AttendanceManagement({
  employees = [],
  records = [],
  selectedDate,
}: {
  employees: Employee[]
  records: AttendanceRecord[]
  selectedDate: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [dateFilter, setDateFilter] = useState(selectedDate)
  const [form, setForm] = useState({
    employeeId: employees[0]?.id || '',
    date: selectedDate,
    status: AttendanceStatus.PRESENT as AttendanceStatus,
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employeeId) {
      toast.error('Please select an employee')
      return
    }

    try {
      setLoading(true)
      const res = await markAttendance({
        employeeId: form.employeeId,
        date: new Date(form.date),
        status: form.status,
        notes: form.notes || undefined,
      })

      if (res.success) {
        toast.success('Attendance recorded successfully!')
        setOpen(false)
        setForm({
          employeeId: employees[0]?.id || '',
          date: selectedDate,
          status: AttendanceStatus.PRESENT,
          notes: '',
        })
        router.refresh()
      } else {
        toast.error(res.error || 'Failed to record attendance')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error recording attendance')
    } finally {
      setLoading(false)
    }
  }

  function handleDateChange(newDate: string) {
    setDateFilter(newDate)
    router.push(`/hr/attendance?date=${newDate}`)
  }

  const presentCount = records.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length
  const absentCount = records.filter(r => r.status === 'ABSENT').length
  const leaveCount = records.filter(r => r.status === 'ON_LEAVE' || r.status === 'HALF_DAY').length

  return (
    <div className="space-y-6">
      {/* Top Filter & Action Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground font-medium whitespace-nowrap">Filter Date:</Label>
          <Input
            type="date"
            value={dateFilter}
            onChange={e => handleDateChange(e.target.value)}
            className="w-44 bg-card border-border text-foreground text-xs"
          />
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs">
              <Plus className="size-4 mr-1.5" />
              Log Attendance / Remote
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Clock className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
                Log Staff Attendance / Remote Work
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
                        {e.name} ({e.employeeCode}) — {e.designation?.name || 'Staff'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(val: AttendanceStatus) => setForm({ ...form, status: val })}
                  >
                    <SelectTrigger className="bg-background border-border text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-card-foreground">
                      <SelectItem value={AttendanceStatus.PRESENT}>Present (In Office / Remote)</SelectItem>
                      <SelectItem value={AttendanceStatus.LATE}>Late Check-in</SelectItem>
                      <SelectItem value={AttendanceStatus.HALF_DAY}>Half Day</SelectItem>
                      <SelectItem value={AttendanceStatus.ON_LEAVE}>On Leave</SelectItem>
                      <SelectItem value={AttendanceStatus.HOLIDAY}>Holiday / Weekend</SelectItem>
                      <SelectItem value={AttendanceStatus.ABSENT}>Absent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Notes / Remote Log</Label>
                <Input
                  placeholder="e.g. Remote work, sprint deliverables, client visit..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="bg-background border-border text-foreground text-xs"
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
                  className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
                >
                  {loading ? 'Recording...' : 'Save Log'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Total Team Size</CardTitle>
            <UserCheck className="size-4 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{employees.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Active staff members</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Present / Remote</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {presentCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">On duty on {selectedDate}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">On Leave</CardTitle>
            <Calendar className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {leaveCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Approved leaves / half day</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Absent</CardTitle>
            <AlertCircle className="size-4 text-rose-600 dark:text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
              {absentCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Unexcused absences</p>
          </CardContent>
        </Card>
      </div>

      {/* Records Table */}
      {records.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Clock className="size-12 text-muted-foreground mx-auto opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No attendance records for {selectedDate}</h3>
            <p className="text-sm text-muted-foreground">
              Click &quot;Log Attendance / Remote&quot; above to record presence for your agency members.
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
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Notes / Work Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-bold text-foreground block">{r.employee.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{r.employee.employeeCode}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.employee.department?.name || 'General'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.employee.designation?.name || 'Staff'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={
                        r.status === 'PRESENT'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : r.status === 'LATE'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                            : r.status === 'ON_LEAVE' || r.status === 'HALF_DAY'
                              ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
                              : r.status === 'HOLIDAY'
                                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                      }
                    >
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {r.notes || '—'}
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
