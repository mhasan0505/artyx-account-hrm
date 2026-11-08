import { prisma } from '@/lib/db'
import { AdvancesManagement } from '@/components/hr/advances-management'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Coins } from 'lucide-react'

export default async function HrAdvancesPage() {
  const [employees, bankAccounts, rawAdvances, outlet] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        outletId: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
      },
      orderBy: { bankName: 'asc' },
    }),
    prisma.employeeAdvance.findMany({
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
      orderBy: { givenDate: 'desc' },
    }),
    prisma.outlet.findFirst({
      select: { id: true },
    }),
  ])

  const advances = rawAdvances.map(a => ({
    id: a.id,
    employee: a.employee,
    amount: Number(a.amount),
    recoveredAmount: Number(a.recoveredAmount),
    givenDate: a.givenDate,
    status: a.status,
  }))

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
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Salary Advances & Loans
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Disburse staff advances and track automatic payroll installment recoveries
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/hr/payroll">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Monthly Payroll
            </Button>
          </Link>
          <Link href="/hr/employees">
            <Button variant="outline" className="border-border text-foreground hover:bg-muted">
              Team Directory
            </Button>
          </Link>
        </div>
      </div>

      <AdvancesManagement
        employees={employees}
        bankAccounts={bankAccounts}
        advances={advances}
        defaultOutletId={outlet?.id || ''}
      />
    </div>
  )
}
