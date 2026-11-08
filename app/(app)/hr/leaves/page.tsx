import { prisma } from '@/lib/db'
import { LeaveManagement } from '@/components/hr/leave-management'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CheckSquare } from 'lucide-react'

export default async function HrLeavesPage() {
  // Ensure default agency leave types exist
  const existingTypesCount = await prisma.leaveType.count()
  if (existingTypesCount === 0) {
    await prisma.leaveType.createMany({
      data: [
        { name: 'Casual Leave', kind: 'CASUAL', annualAllowance: 10 },
        { name: 'Sick Leave', kind: 'SICK', annualAllowance: 14 },
        { name: 'Annual Paid Leave', kind: 'ANNUAL', annualAllowance: 15 },
      ],
      skipDuplicates: true,
    })
  }

  const [employees, leaveTypes, requests] = await Promise.all([
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
    prisma.leaveType.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        annualAllowance: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.leaveRequest.findMany({
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
        leaveType: {
          select: {
            id: true,
            name: true,
            annualAllowance: true,
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
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Leave & Absence Management
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Annual paid leave, sick leave, casual time-off requests, and approvals
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/hr/attendance">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Attendance Log
            </Button>
          </Link>
          <Link href="/hr/payroll">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Monthly Payroll
            </Button>
          </Link>
        </div>
      </div>

      <LeaveManagement
        employees={employees}
        leaveTypes={leaveTypes}
        requests={requests}
      />
    </div>
  )
}
