'use server'

import { requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import { UserRole } from '@prisma/client'

/**
 * Clean Read-Only Employee Ledger Action
 * Repointed to read exclusively from the new Accrual Payroll Engine:
 * PayrollEntry, PayrollPayment, PayrollEntryAdjustment, and EmployeeAdvance.
 */
export async function getEmployeeLedger(employeeId: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { outletId: true },
  })
  if (!emp) throw new Error('Employee not found')
  validateOutletAccess(user, emp.outletId)

  const [entries, payments, advances, adjustments] = await Promise.all([
    prisma.payrollEntry.findMany({
      where: { employeeId },
      include: {
        payrollPeriod: true,
        lines: true,
        adjustments: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payrollPayment.findMany({
      where: { employeeId },
      include: {
        payrollEntry: {
          select: {
            payrollPeriod: { select: { month: true, year: true } },
          },
        },
        bankAccount: { select: { bankName: true } },
      },
      orderBy: { paidAt: 'desc' },
    }),
    prisma.employeeAdvance.findMany({
      where: { employeeId },
      orderBy: { givenDate: 'desc' },
    }),
    prisma.payrollEntryAdjustment.findMany({
      where: { payrollEntry: { employeeId } },
      include: {
        payrollEntry: {
          select: {
            payrollPeriod: { select: { month: true, year: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    entries: entries.map((e) => ({
      id: e.id,
      month: e.payrollPeriod.month,
      year: e.payrollPeriod.year,
      status: e.status,
      baseSalary: Number(e.baseSalary),
      incentive: Number(e.incentive),
      deduction: Number(e.deduction),
      advanceRecovered: Number(e.advanceRecovered),
      netPayable: Number(e.netPayable),
      paidAmount: Number(e.paidAmount),
      createdAt: e.createdAt.toISOString(),
      lines: e.lines.map((l) => ({ ...l, amount: Number(l.amount) })),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      notes: p.notes,
      month: p.payrollEntry.payrollPeriod.month,
      year: p.payrollEntry.payrollPeriod.year,
      bankName: p.bankAccount?.bankName ?? null,
    })),
    advances: advances.map((a) => ({
      id: a.id,
      amount: Number(a.amount),
      recoveredAmount: Number(a.recoveredAmount),
      status: a.status,
      type: a.type,
      givenDate: a.givenDate.toISOString(),
      reason: a.notes ?? 'Employee Advance',
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      amount: Number(adj.amount),
      reason: adj.reason,
      type: adj.type,
      createdAt: adj.createdAt.toISOString(),
      month: adj.payrollEntry.payrollPeriod.month,
      year: adj.payrollEntry.payrollPeriod.year,
    })),
  }
}
