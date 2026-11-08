import { prisma } from '@/lib/db'
import { AttendanceManagement } from '@/components/hr/attendance-management'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Clock } from 'lucide-react'

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const resolvedParams = await searchParams
  const todayStr = new Date().toISOString().split('T')[0]
  const dateStr = resolvedParams.date || todayStr

  const queryDate = new Date(dateStr)

  const [employees, records] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.attendance.findMany({
      where: {
        date: queryDate,
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/hr/employees">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Attendance & Remote Work Log
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Track team attendance, remote work status, and check-in times
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/hr/employees">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Team Directory
            </Button>
          </Link>
          <Link href="/hr/leaves">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Leave Requests
            </Button>
          </Link>
        </div>
      </div>

      <AttendanceManagement
        employees={employees}
        records={records}
        selectedDate={dateStr}
      />
    </div>
  )
}
