'use server'

import {
  requireRole,
  validateOutletAccess,
} from '@/lib/actions/auth-guard'
import { fail, ok } from '@/lib/actions/result'
import { logAuditDirect } from '@/lib/audit/logger'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import {
  AccountType,
  AdvanceStatus,
  AdvanceType,
  AdjustmentType,
  BankTransactionType,
  ExpenseStatus,
  PaymentMethod,
  PayrollEntryStatus,
  PayrollLineType,
  PayrollPeriodStatus,
  Prisma,
  UserRole,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { DRAWER_TX_TYPE, BANK_TX_REF_TYPE } from '@/lib/constants/transaction-types'
import { assertBalancedJournal } from '@/lib/accounting/journal'
import { ensureOpenDrawer } from '@/lib/finance/drawer-rollover'

// Prisma interactive transaction client type
type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Interactive transactions default to a 5000ms timeout, which payroll runs
// (many employees × recalc) can exceed. Raise it for the heavy writes.
const PAYROLL_TX_TIMEOUT = { timeout: 30_000, maxWait: 10_000 } as const

function safeRevalidate(path: string) {
  try {
    revalidatePath(path)
  } catch {
    // Ignore when running outside Next.js request context (e.g. CLI test runner)
  }
}

/**
 * Ensures required Chart of Account records exist for payroll double-entry:
 * - 5210: Salaries & Wages (Expense)
 * - 2210: Accrued Payroll (Liability)
 * - 1100: Cash on Hand (Asset)
 * - 1200 / 1110: Bank Accounts (Asset)
 */
async function getOrCreatePayrollAccounts(tx: PrismaTx) {
  const coaAccounts = await tx.chartOfAccount.findMany({
    where: {
      code: { in: ['5210', '5200', '5000', '2210', '2000', '1100', '1200', '1110'] },
    },
    select: { id: true, code: true },
  })
  const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
  const payrollExpenseAccId =
    coaMap.get('5210') || coaMap.get('5200') || coaMap.get('5000')

  let accruedPayrollAccId = coaMap.get('2210')
  if (!accruedPayrollAccId) {
    const parentId = coaMap.get('2000')
    const created = await tx.chartOfAccount.create({
      data: {
        code: '2210',
        name: 'Accrued Payroll',
        type: AccountType.LIABILITY,
        parentId: parentId || null,
        isActive: true,
      },
    })
    accruedPayrollAccId = created.id
  }

  return {
    payrollExpenseAccId,
    accruedPayrollAccId,
    cashAccId: coaMap.get('1100'),
    bankAccId: coaMap.get('1200') || coaMap.get('1110'),
  }
}

/**
 * Helper to reverse EmployeeAdvance recoveries when a PayrollEntry (or set of entries)
 * is deleted, regenerated, or replaced by a final settlement (Finding #12).
 */
export async function reverseAdvanceRecoveriesForEntries(
  tx: PrismaTx,
  entries: Array<{ id?: string; employeeId: string; advanceRecovered: number | Prisma.Decimal | string }>
) {
  // XC-009: Defense-in-depth authorization check for exported server action
  await requireRole(UserRole.HR, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)

  for (const entry of entries) {
    let toReverse = Number(entry.advanceRecovered || 0)
    if (toReverse <= 0.001) continue

    const advances = await tx.employeeAdvance.findMany({
      where: {
        employeeId: entry.employeeId,
        recoveredAmount: { gt: 0 },
      },
      orderBy: { givenDate: 'desc' },
    })

    for (const adv of advances) {
      if (toReverse <= 0.001) break
      const recovered = Number(adv.recoveredAmount)
      const reverseAmt = Math.min(recovered, toReverse)
      const newRecovered = Math.max(0, Math.round((recovered - reverseAmt + Number.EPSILON) * 100) / 100)
      const newStatus =
        newRecovered <= 0.001
          ? AdvanceStatus.OUTSTANDING
          : AdvanceStatus.PARTIALLY_CLEARED

      await tx.employeeAdvance.update({
        where: { id: adv.id },
        data: {
          recoveredAmount: newRecovered,
          status: newStatus,
        },
      })

      toReverse = Math.round((toReverse - reverseAmt + Number.EPSILON) * 100) / 100
    }
  }
}

// ─────────────────────────────────────────────
// PURE CALCULATION HELPERS
// ─────────────────────────────────────────────
import {
  calculateNetPayable,
  recalculatePayrollEntry,
} from '@/lib/payroll/calc'

// ─────────────────────────────────────────────
// ACCRUAL PAYROLL ENGINE CORE
// ─────────────────────────────────────────────

/**
 * Generate (accrue) monthly payroll for an outlet for a specified month & year.
 * Handles:
 * - Idempotency checks (rejects if already accrued/paid).
 * - Mid-month joiner salary proration.
 * - Mid-month salary structure revision proration across multiple rates.
 * - Attendance absence penalties.
 * - Advance recovery capping (never pushes net pay negative).
 * - Transactional recalculation.
 */
export async function generatePayrollForPeriod(
  month: number,
  year: number,
  outletId?: string
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  let targetOutletId = outletId?.trim() || user.outletId
  if (!targetOutletId) {
    const firstOutlet = await prisma.outlet.findFirst({ select: { id: true } })
    if (!firstOutlet) return fail('No outlet found in system. Please create an outlet first.')
    targetOutletId = firstOutlet.id
  }

  validateOutletAccess(user, targetOutletId)

  // 1. Idempotency Check: verify if period already accrued/paid/closed
  const existingPeriod = await prisma.payrollPeriod.findUnique({
    where: {
      month_year_outletId: { month, year, outletId: targetOutletId },
    },
  })

  if (
    existingPeriod &&
    existingPeriod.status !== PayrollPeriodStatus.DRAFT
  ) {
    return fail(
      `Payroll period for ${month}/${year} is already ${existingPeriod.status.toLowerCase()}`
    )
  }

  // 2. Fetch active employees for outlet
  const employees = await prisma.employee.findMany({
    where: { isActive: true, outletId: targetOutletId },
    include: {
      salaryStructures: {
        orderBy: { effectiveFrom: 'asc' },
      },
      attendances: {
        where: {
          date: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
      },
      advances: {
        where: {
          status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] },
        },
        orderBy: { givenDate: 'asc' },
      },
    },
  })

  if (employees.length === 0) {
    return fail('No active employees found for this outlet')
  }

  const daysInMonth = new Date(year, month, 0).getDate()

  // 3. Execute inside transactional boundary
  try {
    const result = await prisma.$transaction(
      async tx => {
    // Create or reuse DRAFT period
    let period = existingPeriod
    if (!period) {
      try {
        period = await tx.payrollPeriod.create({
          data: {
            month,
            year,
            outletId: targetOutletId,
            status: PayrollPeriodStatus.DRAFT,
            totalGross: 0,
            totalNet: 0,
          },
        })
      } catch (err: any) {
        // Finding #41: Gracefully handle concurrent period creation race (P2002)
        if (err?.code === 'P2002') {
          const racePeriod = await tx.payrollPeriod.findUnique({
            where: {
              month_year_outletId: { month, year, outletId: targetOutletId },
            },
          })
          if (racePeriod) {
            period = racePeriod
          } else {
            throw err
          }
        } else {
          throw err
        }
      }
    } else {
      // Finding #40: Guard draft payroll-period regeneration against deleting entries with recorded payments or adjustments
      const existingEntries = await tx.payrollEntry.findMany({
        where: { payrollPeriodId: period.id },
        select: {
          id: true,
          employeeId: true,
          advanceRecovered: true,
          status: true,
          _count: { select: { payments: true, adjustments: true } },
        },
      })

      const paidOrPaymented = existingEntries.find(
        e => e.status === PayrollEntryStatus.PAID || e._count.payments > 0 || e._count.adjustments > 0
      )
      if (paidOrPaymented) {
        throw new Error(
          'Cannot regenerate this period: it contains recorded payments or adjustments. Void each payment first, then regenerate.'
        )
      }

      // Finding #12: Reverse advance recoveries before deleting existing entries
      await reverseAdvanceRecoveriesForEntries(tx, existingEntries)

      // Clear old entries if re-generating draft
      await tx.payrollEntry.deleteMany({
        where: { payrollPeriodId: period.id },
      })
    }

    let totalPeriodGross = 0
    let totalPeriodNet = 0

    for (const emp of employees) {
      const basicSalary = Number(emp.basicSalary)
      const joinDate = new Date(emp.joinDate)

      // Edge Case 3: Mid-month Salary Structure Revision Proration
      const midMonthRevision = emp.salaryStructures.find(s => {
        const effDate = new Date(s.effectiveFrom)
        return (
          effDate.getFullYear() === year &&
          effDate.getMonth() + 1 === month &&
          effDate.getDate() > 1 &&
          effDate.getDate() <= daysInMonth
        )
      })

      const baseSalaryLines: { label: string; amount: number }[] = []
      let proratedBaseSalary = 0

      if (midMonthRevision) {
        const effDay = new Date(midMonthRevision.effectiveFrom).getDate()
        const daysRate1 = effDay - 1
        const daysRate2 = daysInMonth - daysRate1

        const oldRate = basicSalary
        const newRate = Number(midMonthRevision.baseSalary)

        const amt1 = Math.round(((oldRate / daysInMonth) * daysRate1) * 100) / 100
        const amt2 = Math.round(((newRate / daysInMonth) * daysRate2) * 100) / 100
        proratedBaseSalary = amt1 + amt2

        baseSalaryLines.push({
          label: `Basic Salary (Pre-revision: ${daysRate1}/${daysInMonth} days @ ৳${oldRate.toLocaleString()})`,
          amount: amt1,
        })
        baseSalaryLines.push({
          label: `Basic Salary (Post-revision: ${daysRate2}/${daysInMonth} days @ ৳${newRate.toLocaleString()})`,
          amount: amt2,
        })
      } else {
        let daysWorked = daysInMonth
        if (
          joinDate.getFullYear() === year &&
          joinDate.getMonth() + 1 === month
        ) {
          daysWorked = daysInMonth - joinDate.getDate() + 1
        }
        daysWorked = Math.max(1, Math.min(daysInMonth, daysWorked))

        proratedBaseSalary =
          daysWorked === daysInMonth
            ? basicSalary
            : Math.round(((basicSalary / daysInMonth) * daysWorked) * 100) / 100

        baseSalaryLines.push({
          label:
            daysWorked === daysInMonth
              ? 'Basic Salary'
              : `Prorated Basic Salary (${daysWorked}/${daysInMonth} days)`,
          amount: proratedBaseSalary,
        })
      }

      // Edge Case 2: Attendance Summary & Absence Penalties
      let presentDays = 0
      let absentDays = 0
      let leaveDays = 0

      emp.attendances.forEach(att => {
        if (att.status === 'PRESENT' || att.status === 'LATE') presentDays++
        else if (att.status === 'ABSENT') absentDays++
        else if (att.status === 'ON_LEAVE') leaveDays++
      })

      const absenceDeduction =
        absentDays > 0
          ? Math.round(((basicSalary / daysInMonth) * absentDays) * 100) / 100
          : 0

      // Edge Case 3: Advance Recovery Overflow Capping
      // Fetch advances inside transaction so any recoveries reversed on draft regeneration are reflected
      const empAdvances = await tx.employeeAdvance.findMany({
        where: {
          employeeId: emp.id,
          status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] },
        },
        orderBy: { givenDate: 'asc' },
      })

      const totalOutstandingAdvance = empAdvances.reduce(
        (sum, adv) => sum + (Number(adv.amount) - Number(adv.recoveredAmount)),
        0
      )

      const netBeforeAdvance = Math.max(0, proratedBaseSalary - absenceDeduction)
      const advanceToRecover = Math.min(
        totalOutstandingAdvance,
        netBeforeAdvance
      )

      // Apply recovery to individual advance records in order
      let remainingToDeduct = advanceToRecover
      for (const adv of empAdvances) {
        if (remainingToDeduct <= 0) break
        const unrecovered = Number(adv.amount) - Number(adv.recoveredAmount)
        const recoverHere = Math.min(unrecovered, remainingToDeduct)

        const newRecovered = Number(adv.recoveredAmount) + recoverHere
        const newStatus =
          newRecovered >= Number(adv.amount)
            ? AdvanceStatus.CLEARED
            : AdvanceStatus.PARTIALLY_CLEARED

        await tx.employeeAdvance.update({
          where: { id: adv.id },
          data: {
            recoveredAmount: newRecovered,
            status: newStatus,
          },
        })

        remainingToDeduct -= recoverHere
      }

      // Create PayrollEntry
      const entry = await tx.payrollEntry.create({
        data: {
          payrollPeriodId: period.id,
          employeeId: emp.id,
          baseSalary: proratedBaseSalary,
          incentive: 0,
          deduction: 0,
          advanceRecovered: advanceToRecover,
          netPayable: netBeforeAdvance - advanceToRecover,
          presentDays,
          absentDays,
          leaveDays,
          status: PayrollEntryStatus.UNPAID,
        },
      })

      // Create initial PayrollEntryLine items
      for (const bLine of baseSalaryLines) {
        await tx.payrollEntryLine.create({
          data: {
            payrollEntryId: entry.id,
            type: PayrollLineType.INCENTIVE,
            category: 'BASE_SALARY',
            label: bLine.label,
            amount: bLine.amount,
          },
        })
      }

      if (absenceDeduction > 0) {
        await tx.payrollEntryLine.create({
          data: {
            payrollEntryId: entry.id,
            type: PayrollLineType.DEDUCTION,
            category: 'ABSENCE_PENALTY',
            label: `Absence Penalty (${absentDays} day${absentDays > 1 ? 's' : ''})`,
            amount: absenceDeduction,
          },
        })
      }

      // Perform single-source-of-truth recalculation
      const updatedEntry = await recalculatePayrollEntry(entry.id, tx)

      totalPeriodGross += Number(updatedEntry.baseSalary)
      totalPeriodNet += Number(updatedEntry.netPayable)
    }

    // Transition Period Status to ACCRUED
    const finalPeriod = await tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        status: PayrollPeriodStatus.ACCRUED,
        accruedAt: new Date(),
        accruedById: user.id,
        totalGross: totalPeriodGross,
        totalNet: totalPeriodNet,
      },
      include: {
        entries: {
          include: {
            employee: { select: { name: true, employeeCode: true } },
            lines: true,
          },
        },
      },
    })

    // Double-Entry Accrual Posting:
    // Debit 5210 Salaries & Wages (Expense)
    // Credit 2210 Accrued Payroll (Liability)
    const { payrollExpenseAccId, accruedPayrollAccId } =
      await getOrCreatePayrollAccounts(tx)

    if (payrollExpenseAccId && accruedPayrollAccId) {
      const accrualEntries: {
        accountId: string
        type: 'DEBIT' | 'CREDIT'
        amount: number
        description: string
        referenceId: string
        referenceType: string
      }[] = []

      for (const entry of finalPeriod.entries) {
        const net = Number(entry.netPayable)
        if (net > 0) {
          const desc = `Payroll Accrual: ${entry.employee.name} (${month}/${year})`
          accrualEntries.push(
            {
              accountId: payrollExpenseAccId,
              type: 'DEBIT',
              amount: net,
              description: desc,
              referenceId: entry.id,
              referenceType: 'PAYROLL_ACCRUAL',
            },
            {
              accountId: accruedPayrollAccId,
              type: 'CREDIT',
              amount: net,
              description: desc,
              referenceId: entry.id,
              referenceType: 'PAYROLL_ACCRUAL',
            }
          )
        }
      }

      if (accrualEntries.length > 0) {
        assertBalancedJournal(accrualEntries)
        await tx.accountLedgerEntry.createMany({ data: accrualEntries })
      }
    }

    return finalPeriod
    },
    PAYROLL_TX_TIMEOUT
  )

  await logAuditDirect(
    user.id,
    'PAYROLL_PERIOD_ACCRUED',
    'PayrollPeriod',
    result.id,
    {
      month,
      year,
      outletId: targetOutletId,
      totalGross: result.totalGross,
      totalNet: result.totalNet,
      employeeCount: result.entries.length,
    }
  )

  safeRevalidate('/hr/payroll')
  safeRevalidate('/reports/profit-loss')
  return ok(result)
  } catch (err: any) {
    return fail(err.message || 'Failed to generate payroll period')
  }
}

// ─────────────────────────────────────────────
// PAYMENT RECORDING & CASH FLOW
// ─────────────────────────────────────────────

/**
 * Record a full or partial salary payment against a PayrollEntry.
 * Edge Cases:
 * - Pessimistic Row Lock (`FOR UPDATE`) to eliminate race conditions on concurrent clicks.
 * - Overpayment protection (`amount <= netPayable - paidAmount`).
 * - Updates Bank Account balance if bank payment used.
 * - Auto-transitions PayrollEntry & PayrollPeriod statuses.
 */
export async function recordPayrollPayment(data: {
  payrollEntryId: string
  amount: number
  method: PaymentMethod
  bankAccountId?: string
  reference?: string
  notes?: string
  chequeDate?: string
}) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  if (data.amount <= 0) {
    return fail('Payment amount must be greater than 0')
  }

  let finalNotes = data.notes
  if (data.method === PaymentMethod.CHEQUE && data.chequeDate) {
    if (!finalNotes || !finalNotes.includes('[Cheque Matures:')) {
      finalNotes = finalNotes ? `${finalNotes} | [Cheque Matures: ${data.chequeDate}]` : `[Cheque Matures: ${data.chequeDate}]`
    }
  }

  const result = await prisma.$transaction(async tx => {
    // 0. Pessimistic Row Lock (FOR UPDATE) to eliminate concurrent click race conditions
    await tx.$executeRaw`SELECT id FROM "PayrollEntry" WHERE id = ${data.payrollEntryId} FOR UPDATE`

    const entry = await tx.payrollEntry.findUnique({
      where: { id: data.payrollEntryId },
      include: {
        employee: { select: { name: true } },
        payrollPeriod: true,
      },
    })

    if (!entry) throw new Error('Payroll entry not found')
    validateOutletAccess(user, entry.payrollPeriod.outletId)

    const remainingPayable =
      Number(entry.netPayable) - Number(entry.paidAmount)

    if (entry.status === PayrollEntryStatus.PAID || remainingPayable <= 0.01) {
      throw new Error('This payroll entry has already been fully paid.')
    }

    // Overpayment Protection
    if (data.amount > remainingPayable + 0.01) {
      throw new Error(
        `Payment amount (৳${data.amount.toLocaleString()}) exceeds remaining net payable (৳${remainingPayable.toLocaleString()})`
      )
    }

    // 1. Create Payment Record
    const payment = await tx.payrollPayment.create({
      data: {
        payrollEntryId: entry.id,
        employeeId: entry.employeeId,
        amount: data.amount,
        method: data.method,
        bankAccountId: data.bankAccountId || undefined,
        reference: data.reference || undefined,
        notes: finalNotes || undefined,
        createdById: user.id,
      },
    })

    // 2. Update Entry Paid Amount & Status
    const newPaidAmount = Number(entry.paidAmount) + data.amount
    const newEntryStatus =
      newPaidAmount >= Number(entry.netPayable) - 0.01
        ? PayrollEntryStatus.PAID
        : PayrollEntryStatus.PARTIALLY_PAID

    const updatedEntry = await tx.payrollEntry.update({
      where: { id: entry.id },
      data: {
        paidAmount: newPaidAmount,
        status: newEntryStatus,
      },
    })

    // 3. Process Cash or Bank Deduction
    if (data.method === PaymentMethod.CASH) {
      // Find open cash drawer for the outlet
      const drawer = await ensureOpenDrawer(tx, entry.payrollPeriod.outletId)

      if (!drawer) {
        throw new Error('No open cash drawer found for this outlet. Please open the register first.')
      }

      // Lock CashDrawer row
      await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${drawer.id} FOR UPDATE`

      // Check balance
      const stats = await tx.drawerTransaction.aggregate({
        _sum: { amount: true },
        where: { drawerId: drawer.id },
      })
      const cashBalance = Number(stats._sum.amount || 0)

      if (cashBalance < data.amount) {
        throw new Error(
          `Insufficient cash in drawer for salary payment. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${data.amount.toLocaleString()}`
        )
      }

      // Deduct from drawer
      await tx.drawerTransaction.create({
        data: {
          drawerId: drawer.id,
          amount: -data.amount,
          type: DRAWER_TX_TYPE.PAYROLL,
          description: `Salary Payment to ${entry.employee.name} (${entry.payrollPeriod.month}/${entry.payrollPeriod.year})`,
          referenceId: payment.id,
          referenceType: BANK_TX_REF_TYPE.PAYROLL_PAYMENT,
        },
      })
    } else if (data.bankAccountId) {
      await tx.$executeRaw`SELECT 1 FROM "BankAccount" WHERE id = ${data.bankAccountId} FOR UPDATE`

      const bankAcc = await tx.bankAccount.findUnique({
        where: { id: data.bankAccountId },
      })
      if (!bankAcc) throw new Error('Selected bank account not found')

      if (Number(bankAcc.currentBalance) < data.amount) {
        throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
      }

      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: { decrement: data.amount },
        },
      })

      await tx.bankTransaction.create({
        data: {
          bankAccountId: data.bankAccountId,
          type: BankTransactionType.WITHDRAWAL,
          amount: data.amount,
          description: `Salary Payment to ${entry.employee.name} (${entry.payrollPeriod.month}/${entry.payrollPeriod.year})`,
          referenceId: payment.id,
          referenceType: BANK_TX_REF_TYPE.PAYROLL_PAYMENT,
        },
      })
    }

    // 4. Double-Entry Ledger Posting:
    // Debit 2210 Accrued Payroll (Liability clearing)
    // Credit 1100 Cash / 1200 Bank (Asset reduction)
    const { accruedPayrollAccId, cashAccId, bankAccId } =
      await getOrCreatePayrollAccounts(tx)
    const creditAcc = data.method === PaymentMethod.CASH ? cashAccId : bankAccId

    if (accruedPayrollAccId && creditAcc) {
      const gl = [
        {
          accountId: accruedPayrollAccId,
          type: 'DEBIT' as const,
          amount: data.amount,
          description: `Salary Payment to ${entry.employee.name} (${entry.payrollPeriod.month}/${entry.payrollPeriod.year})`,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT',
        },
        {
          accountId: creditAcc,
          type: 'CREDIT' as const,
          amount: data.amount,
          description: `Salary Payment to ${entry.employee.name} (${entry.payrollPeriod.month}/${entry.payrollPeriod.year})`,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT',
        },
      ]
      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({
        data: gl,
      })
    }

    // 5. Check if all entries in period are paid
    const allEntriesInPeriod = await tx.payrollEntry.findMany({
      where: { payrollPeriodId: entry.payrollPeriodId },
      select: { status: true },
    })

    const allPaid = allEntriesInPeriod.every(
      e => e.status === PayrollEntryStatus.PAID
    )

    if (allPaid) {
      await tx.payrollPeriod.update({
        where: { id: entry.payrollPeriodId },
        data: { status: PayrollPeriodStatus.PAID },
      })
    }

    // 6. Synchronize into Expense Master as APPROVED salary expense
    const empCode = (entry.employee as any).employeeCode || `EMP-${entry.employeeId.slice(-4)}`
    const periodTag = `[Emp: ${entry.employee.name} (${empCode}) | Month: ${entry.payrollPeriod.year}-${String(entry.payrollPeriod.month).padStart(2, '0')}]`
    const desc = `${periodTag} ${data.notes?.trim() || 'Staff Salary'}`

    const salaryCoa = await tx.chartOfAccount.findFirst({
      where: {
        OR: [{ code: '5210' }, { name: { contains: 'salary', mode: 'insensitive' } }],
        isActive: true,
      },
      select: { id: true },
    })

    if (salaryCoa) {
      await tx.expense.create({
        data: {
          accountId: salaryCoa.id,
          description: desc,
          amount: data.amount,
          expenseDate: new Date(),
          outletId: entry.payrollPeriod.outletId,
          receiptUrl: `payroll-payment:${payment.id}`,
          createdById: user.id,
          approvedById: user.id,
          status: ExpenseStatus.APPROVED,
          method: data.method,
          bankAccountId: data.bankAccountId || null,
        },
      })
    }

    return { payment, updatedEntry }
  })

  await logAuditDirect(
    user.id,
    'PAYROLL_PAYMENT_RECORDED',
    'PayrollPayment',
    result.payment.id,
    {
      payrollEntryId: data.payrollEntryId,
      amount: data.amount,
      method: data.method,
    }
  )

  safeRevalidate('/hr/payroll')
  safeRevalidate('/finances')
  safeRevalidate('/expenses')
  return ok(result)
}

// ─────────────────────────────────────────────
// PERIOD DELETION & PAID PAYMENT REVERSAL
// ─────────────────────────────────────────────

/**
 * Delete a payroll period that has NOT been paid.
 * Only DRAFT and ACCRUED periods are eligible. Any period containing a recorded
 * payment is blocked — those must be voided first via voidPayrollPayment.
 * Cascades to PayrollEntry, PayrollEntryLine, PayrollEntryAdjustment, and (with the
 * schema onDelete: Cascade) PayrollPayment rows.
 */
export async function deletePayrollPeriod(periodId: string) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  const result = await prisma.$transaction(async tx => {
    const period = await tx.payrollPeriod.findUnique({
      where: { id: periodId },
      include: {
        entries: {
          select: {
            id: true,
            employeeId: true,
            advanceRecovered: true,
            status: true,
            _count: { select: { payments: true } },
          },
        },
      },
    })

    if (!period) throw new Error('Payroll period not found')
    validateOutletAccess(user, period.outletId)

    if (
      period.status !== PayrollPeriodStatus.DRAFT &&
      period.status !== PayrollPeriodStatus.ACCRUED
    ) {
      return {
        error: `Payroll period is ${period.status}. Only DRAFT or ACCRUED periods can be deleted. Paid periods must be reversed via payment voiding.`,
      }
    }

    const paidOrPaymentedEntry = period.entries.find(
      e =>
        e.status === PayrollEntryStatus.PAID || e._count.payments > 0
    )
    if (paidOrPaymentedEntry) {
      return {
        error:
          'Cannot delete this period: it contains recorded payments. Void each payment first, then delete.',
      }
    }

    // Finding #12: Reverse advance recoveries before deleting period
    await reverseAdvanceRecoveriesForEntries(tx, period.entries)

    const entryIds = period.entries.map(e => e.id)
    if (entryIds.length > 0) {
      await tx.accountLedgerEntry.deleteMany({
        where: {
          referenceId: { in: entryIds },
          referenceType: 'PAYROLL_ACCRUAL',
        },
      })
    }

    await tx.payrollPeriod.delete({ where: { id: period.id } })
    return period
  })

  if ('error' in result) {
    return fail(result.error as string)
  }

  await logAuditDirect(
    user.id,
    'PAYROLL_PERIOD_DELETED',
    'PayrollPeriod',
    periodId,
    { status: result.status, month: result.month, year: result.year }
  )

  safeRevalidate('/hr/payroll')
  safeRevalidate('/reports/payroll')
  return ok(null)
}

/**
 * Atomically void a recorded payroll payment and reverse every money leg:
 * - Drawer: re-credits the cash drawer (PAYIN).
 * - Bank: restores currentBalance and posts a reversing DEPOSIT BankTransaction.
 * - GL: posts reversing CREDIT/DEBIT AccountLedgerEntry pairs.
 * - Entry: decrements paidAmount, downgrades status UNPAID/PARTIALLY_PAID.
 * - Period: downgrades from PAID back to ACCRUED if any entry becomes unpaid.
 * - Payment: stamped voidedAt/voidedById/voidReason for full auditability.
 */
export async function voidPayrollPayment(data: {
  paymentId: string
  reason: string
}) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)

  if (!data.reason?.trim()) {
    return fail('A voiding reason is required for audit purposes')
  }

  const result = await prisma.$transaction(async tx => {
    const payment = await tx.payrollPayment.findUnique({
      where: { id: data.paymentId },
      include: {
        payrollEntry: {
          include: {
            employee: { select: { name: true } },
            payrollPeriod: { select: { outletId: true, month: true, year: true } },
          },
        },
      },
    })

    if (!payment) throw new Error('Payment record not found')
    if (payment.voidedAt) {
      return { error: 'This payment has already been voided' }
    }
    validateOutletAccess(user, payment.payrollEntry.payrollPeriod.outletId)

    // Lock the entry row to serialize against concurrent payments/reversals.
    await tx.$executeRaw`SELECT id FROM "PayrollEntry" WHERE id = ${payment.payrollEntryId} FOR UPDATE`

    const amount = Number(payment.amount)
    const entry = payment.payrollEntry
    const employeeName = entry.employee.name
    const periodLabel = `${entry.payrollPeriod.month}/${entry.payrollPeriod.year}`
    const desc = `VOID: Salary payment to ${employeeName} (${periodLabel}) — ${data.reason}`

    // 1. Reverse cash/drawer leg
    if (payment.method === PaymentMethod.CASH) {
      const drawer = await ensureOpenDrawer(tx, entry.payrollPeriod.outletId)
      if (!drawer) {
        throw new Error(
          'Cannot void CASH payment: no open cash drawer exists to return the funds to. Open the register first.'
        )
      }
      await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${drawer.id} FOR UPDATE`
      await tx.drawerTransaction.create({
        data: {
          drawerId: drawer.id,
          type: DRAWER_TX_TYPE.CASH_IN,
          amount,
          description: desc,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT_VOID',
        },
      })
    }

    // 2. Reverse bank leg
    if (payment.bankAccountId) {
      await tx.$executeRaw`SELECT 1 FROM "BankAccount" WHERE id = ${payment.bankAccountId} FOR UPDATE`
      const bankAcc = await tx.bankAccount.findUnique({
        where: { id: payment.bankAccountId },
      })
      if (!bankAcc) throw new Error('Bank account for this payment not found')
      await tx.bankAccount.update({
        where: { id: bankAcc.id },
        data: { currentBalance: { increment: amount } },
      })
      await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAcc.id,
          type: BankTransactionType.DEPOSIT,
          amount,
          description: desc,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT_VOID',
        },
      })
    }

    // 3. Reverse GL legs (Debit Cash/Bank, Credit Accrued Payroll Liability)
    const { accruedPayrollAccId, cashAccId, bankAccId } =
      await getOrCreatePayrollAccounts(tx)
    const creditAcc = payment.method === PaymentMethod.CASH ? cashAccId : bankAccId

    if (accruedPayrollAccId && creditAcc) {
      const gl = [
        {
          accountId: accruedPayrollAccId,
          type: 'CREDIT' as const,
          amount,
          description: desc,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT_VOID',
        },
        {
          accountId: creditAcc,
          type: 'DEBIT' as const,
          amount,
          description: desc,
          referenceId: payment.id,
          referenceType: 'PAYROLL_PAYMENT_VOID',
        },
      ]
      assertBalancedJournal(gl)
      await tx.accountLedgerEntry.createMany({
        data: gl,
      })
    }

    // 4. Restore entry state
    const newPaidAmount = Math.max(0, Number(entry.paidAmount) - amount)
    const newStatus =
      newPaidAmount <= 0.01
        ? PayrollEntryStatus.UNPAID
        : PayrollEntryStatus.PARTIALLY_PAID

    await tx.payrollEntry.update({
      where: { id: entry.id },
      data: { paidAmount: newPaidAmount, status: newStatus },
    })

    // 5. Downgrade period if it was PAID
    const siblings = await tx.payrollEntry.findMany({
      where: { payrollPeriodId: entry.payrollPeriodId },
      select: { status: true },
    })
    if (!siblings.every(e => e.status === PayrollEntryStatus.PAID)) {
      await tx.payrollPeriod.update({
        where: { id: entry.payrollPeriodId },
        data: { status: PayrollPeriodStatus.ACCRUED },
      })
    }

    // 6. Stamp the payment as voided
    const voidedPayment = await tx.payrollPayment.update({
      where: { id: payment.id },
      data: {
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: data.reason,
      },
    })

    // 6.1 Reverse linked Expense in Expense Master
    const linkedExpenses = await tx.expense.findMany({
      where: {
        receiptUrl: `payroll-payment:${payment.id}`,
      },
    })
    for (const exp of linkedExpenses) {
      await tx.expense.update({
        where: { id: exp.id },
        data: { status: ExpenseStatus.REJECTED },
      })
    }

    return voidedPayment
  })

  if ('error' in result) {
    return fail(result.error as string)
  }

  await logAuditDirect(
    user.id,
    'PAYROLL_PAYMENT_VOIDED',
    'PayrollPayment',
    result.id,
    { amount: result.amount, reason: data.reason }
  )

  safeRevalidate('/hr/payroll')
  safeRevalidate('/finances')
  safeRevalidate('/expenses')
  return ok(result)
}

// ─────────────────────────────────────────────
// EMPLOYEE ADVANCE LEDGER
// ─────────────────────────────────────────────

/**
 * Issue an advance salary payment to an employee.
 * Tracked as an Asset (Receivable), not an expense.
 */
export async function giveEmployeeAdvance(data: {
  employeeId: string
  outletId: string
  amount: number
  method: PaymentMethod
  bankAccountId?: string
  reference?: string
  givenDate?: string
  notes?: string
  chequeDate?: string
}) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  validateOutletAccess(user, data.outletId)

  if (data.amount <= 0) {
    return fail('Advance amount must be greater than 0')
  }

  let finalNotes = data.notes
  if (data.method === PaymentMethod.CHEQUE && data.chequeDate) {
    if (!finalNotes || !finalNotes.includes('[Cheque Matures:')) {
      finalNotes = finalNotes ? `${finalNotes} | [Cheque Matures: ${data.chequeDate}]` : `[Cheque Matures: ${data.chequeDate}]`
    }
  }

  if (data.method === PaymentMethod.CREDIT) {
    return fail('Credit is not a valid payment method for advance disbursement')
  }

  if (data.method !== PaymentMethod.CASH && !data.bankAccountId) {
    return fail('Bank account is required for non-cash advance disbursement')
  }

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      basicSalary: true,
      advances: {
        select: { amount: true, recoveredAmount: true },
      },
    },
  })
  if (!employee) return fail('Employee not found')

  // ADVANCE CAP: total outstanding advance may never exceed the employee's monthly salary.
  // This prevents an unrecoverable receivable (recovery is capped at monthly net in payroll runs).
  const totalOutstanding = employee.advances.reduce(
    (sum, adv) => sum + (Number(adv.amount) - Number(adv.recoveredAmount)),
    0
  )
  const monthlySalary = Number(employee.basicSalary || 0)

  if (
    monthlySalary > 0 &&
    totalOutstanding + data.amount > monthlySalary
  ) {
    return fail(
      `Advance blocked: total outstanding advance (৳${totalOutstanding.toLocaleString()}) + this advance (৳${data.amount.toLocaleString()}) exceeds the employee's monthly salary (৳${monthlySalary.toLocaleString()}).`
    )
  }

  try {
    const advance = await prisma.$transaction(async tx => {
      // Lock the employee row first so a concurrent payroll accrual or advance
      // cannot read a half-committed advance balance.
      await tx.$executeRaw`SELECT id FROM "Employee" WHERE id = ${data.employeeId} FOR UPDATE`

      if (data.method === PaymentMethod.CASH) {
        const openDrawer = await ensureOpenDrawer(tx, data.outletId)

        if (!openDrawer) {
          throw new Error(
            'No open cash drawer found for this outlet. Please open a cash drawer first.'
          )
        }

        await tx.$executeRaw`SELECT 1 FROM "CashDrawer" WHERE id = ${openDrawer.id} FOR UPDATE`

        const stats = await tx.drawerTransaction.aggregate({
          where: { drawerId: openDrawer.id },
          _sum: { amount: true },
        })

        const cashBalance = Number(stats._sum.amount || 0)
        if (cashBalance < data.amount) {
          throw new Error(
            `Insufficient cash in drawer. Available: ৳${cashBalance.toLocaleString()}, Required: ৳${data.amount.toLocaleString()}`
          )
        }

        const newAdvance = await tx.employeeAdvance.create({
          data: {
            employeeId: data.employeeId,
            outletId: data.outletId,
            amount: data.amount,
            recoveredAmount: 0,
            givenDate: data.givenDate ? new Date(data.givenDate) : new Date(),
            status: AdvanceStatus.OUTSTANDING,
            reference: data.reference || undefined,
            notes: finalNotes || undefined,
            createdById: user.id,
          },
          include: {
            employee: { select: { name: true, employeeCode: true } },
          },
        })

        await tx.drawerTransaction.create({
          data: {
            drawerId: openDrawer.id,
            type: DRAWER_TX_TYPE.ADVANCE,
            amount: -data.amount,
            description: `Employee Advance: ${employee.name}`,
            referenceId: newAdvance.id,
            referenceType: BANK_TX_REF_TYPE.EMPLOYEE_ADVANCE,
          },
        })

        // Double-Entry Posting for Cash Advance Asset
        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: ['1300', '1100'] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const advanceAssetAcc = coaMap.get('1300')
        const cashAcc = coaMap.get('1100')

        if (advanceAssetAcc && cashAcc) {
          const gl = [
            {
              accountId: advanceAssetAcc,
              type: 'DEBIT' as const,
              amount: data.amount,
              description: `Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            },
            {
              accountId: cashAcc,
              type: 'CREDIT' as const,
              amount: data.amount,
              description: `Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            },
          ]
          assertBalancedJournal(gl)
          await tx.accountLedgerEntry.createMany({
            data: gl,
          })
        }

        return newAdvance
      } else {
        const bankAccountId = data.bankAccountId!
        await tx.$executeRaw`SELECT 1 FROM "BankAccount" WHERE id = ${bankAccountId} FOR UPDATE`

        const bankAccount = await tx.bankAccount.findUnique({
          where: { id: bankAccountId },
        })

        if (!bankAccount) throw new Error('Bank account not found')

        if (Number(bankAccount.currentBalance) < data.amount) {
          throw new Error('Insufficient funds: Transaction amount exceeds the available bank balance.')
        }

        let feeAmount = 0
        if (bankAccount.isMfs && bankAccount.cashoutChargePct.toNumber() > 0) {
          feeAmount = Number(
            (
              (data.amount * bankAccount.cashoutChargePct.toNumber()) /
              100
            ).toFixed(2)
          )
        }

        const newAdvance = await tx.employeeAdvance.create({
          data: {
            employeeId: data.employeeId,
            outletId: data.outletId,
            amount: data.amount,
            recoveredAmount: 0,
            givenDate: data.givenDate ? new Date(data.givenDate) : new Date(),
            status: AdvanceStatus.OUTSTANDING,
            reference: data.reference || undefined,
            notes: finalNotes || undefined,
            createdById: user.id,
          },
          include: {
            employee: { select: { name: true, employeeCode: true } },
          },
        })

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: BankTransactionType.WITHDRAWAL,
            amount: data.amount + feeAmount,
            description: `Employee Advance: ${employee.name}${feeAmount > 0 ? ` (incl. MFS fee ৳${feeAmount})` : ''}`,
            referenceId: newAdvance.id,
            referenceType: BANK_TX_REF_TYPE.EMPLOYEE_ADVANCE,
          },
        })

        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { decrement: data.amount + feeAmount } },
        })

        // Double-Entry Posting for Advance Asset
        const coaAccounts = await tx.chartOfAccount.findMany({
          where: { code: { in: ['1300', '1100', '1200', '1110', '5290'] } },
          select: { id: true, code: true },
        })
        const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
        const advanceAssetAcc = coaMap.get('1300')
        const creditAcc = coaMap.get('1200') || coaMap.get('1110')
        const feeExpenseAcc = coaMap.get('5290')

        if (advanceAssetAcc && creditAcc) {
          const entries: any[] = [
            {
              accountId: advanceAssetAcc,
              type: 'DEBIT',
              amount: data.amount,
              description: `Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            },
            {
              accountId: creditAcc,
              type: 'CREDIT',
              amount: data.amount + (feeAmount > 0 && !feeExpenseAcc ? feeAmount : 0),
              description: `Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            },
          ]

          if (feeAmount > 0 && feeExpenseAcc) {
            entries.push({
              accountId: feeExpenseAcc,
              type: 'DEBIT',
              amount: feeAmount,
              description: `MFS Fee — Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            })
            entries.push({
              accountId: creditAcc,
              type: 'CREDIT',
              amount: feeAmount,
              description: `MFS Fee — Employee Advance: ${employee.name}`,
              referenceId: newAdvance.id,
              referenceType: 'EMPLOYEE_ADVANCE',
            })
          }

          assertBalancedJournal(entries)
          await tx.accountLedgerEntry.createMany({ data: entries })
        }

        return newAdvance
      }
    })

    // Post-posting recalculation: if the employee has an open (UNPAID/PARTIALLY_PAID)
    // payroll entry, immediately fold the new advance into its recovery so the payslip
    // stays in sync with the receivable ledger. Recalc runs under its own row lock.
    await prisma.$transaction(
      async tx => {
        const openEntry = await tx.payrollEntry.findFirst({
          where: {
            employeeId: data.employeeId,
            status: {
              in: [PayrollEntryStatus.UNPAID, PayrollEntryStatus.PARTIALLY_PAID],
            },
          },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        })
        if (openEntry) {
          await recalculatePayrollEntry(openEntry.id, tx)
        }
      },
      PAYROLL_TX_TIMEOUT
    )

    await logAuditDirect(
      user.id,
      'EMPLOYEE_ADVANCE_GIVEN',
      'EmployeeAdvance',
      advance.id,
      {
        employeeId: data.employeeId,
        amount: data.amount,
        method: data.method,
      }
    )

    safeRevalidate('/hr/payroll')
    safeRevalidate('/reports/payroll')
    return ok(advance)
  } catch (error: any) {
    return fail(error.message || 'Failed to disburse employee advance')
  }
}

// ─────────────────────────────────────────────
// POST-ACCRUAL CORRECTIONS / ADJUSTMENTS
// ─────────────────────────────────────────────

/**
 * Add a non-destructive post-accrual correction or adjustment to a PayrollEntry.
 * Adds a PayrollEntryAdjustment audit row + PayrollEntryLine, then triggers recalculatePayrollEntry.
 */
export async function correctPayrollEntry(data: {
  payrollEntryId: string
  type: AdjustmentType
  category: string
  label: string
  amount: number
  reason: string
}) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  const result = await prisma.$transaction(async tx => {
    // Pessimistic row lock before reading to serialize concurrent corrections/adjustments.
    await tx.$executeRaw`SELECT id FROM "PayrollEntry" WHERE id = ${data.payrollEntryId} FOR UPDATE`

    const entry = await tx.payrollEntry.findUnique({
      where: { id: data.payrollEntryId },
      include: { payrollPeriod: { select: { outletId: true } } },
    })

    if (!entry) throw new Error('Payroll entry not found')
    validateOutletAccess(user, entry.payrollPeriod.outletId)

    // FINALITY GUARD: paid payslips are immutable.
    // Corrections must be applied via an explicit void/reversal, never silently.
    if (entry.status === PayrollEntryStatus.PAID) {
      return { error: 'This payroll entry has been paid and is final. Void the payment first, then apply the adjustment.' }
    }

    // Create Audit Adjustment
    const adj = await tx.payrollEntryAdjustment.create({
      data: {
        payrollEntryId: entry.id,
        type: data.type,
        amount: data.amount,
        reason: data.reason,
        createdById: user.id,
      },
    })

    // Map AdjustmentType to LineType
    const lineType =
      data.type === AdjustmentType.DEDUCTION_ADDON
        ? PayrollLineType.DEDUCTION
        : PayrollLineType.INCENTIVE

    // Create Line Item
    await tx.payrollEntryLine.create({
      data: {
        payrollEntryId: entry.id,
        type: lineType,
        category: data.category,
        label: `${data.label} (${data.reason})`,
        amount: Math.abs(data.amount),
      },
    })

    // Single source of truth recalculation
    const updatedEntry = await recalculatePayrollEntry(entry.id, tx)

    return { adjustment: adj, updatedEntry }
  })

  if ('error' in result) {
    return fail(result.error as string)
  }

  await logAuditDirect(
    user.id,
    'PAYROLL_ENTRY_CORRECTED',
    'PayrollEntryAdjustment',
    result.adjustment.id,
    {
      payrollEntryId: data.payrollEntryId,
      type: data.type,
      amount: data.amount,
      reason: data.reason,
    }
  )

  safeRevalidate('/hr/payroll')
  return ok(result)
}

// ─────────────────────────────────────────────
// QUERY FUNCTIONS FOR UI & REPORTING
// ─────────────────────────────────────────────

export async function getPayrollPeriods(outletId: string) {
  return withDatabaseReadFallback(
    async () => {
      const user = await requireRole(
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.HR,
        UserRole.ACCOUNTANT,
        UserRole.MANAGER
      )

      validateOutletAccess(user, outletId)

      const periods = await prisma.payrollPeriod.findMany({
        where: { outletId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          accruedBy: { select: { name: true } },
          _count: { select: { entries: true } },
        },
      })

      return periods.map(p => ({
        id: p.id,
        month: p.month,
        year: p.year,
        status: p.status,
        totalGross: Number(p.totalGross),
        totalNet: Number(p.totalNet),
        accruedAt: p.accruedAt?.toISOString() ?? null,
        accruedByName: p.accruedBy?.name ?? null,
        entryCount: p._count.entries,
        createdAt: p.createdAt.toISOString(),
      }))
    },
    [],
    'getPayrollPeriods'
  )
}

export async function getPayrollPeriodById(periodId: string) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT,
    UserRole.MANAGER
  )

  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    include: {
      accruedBy: { select: { name: true } },
      entries: {
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              employeeCode: true,
              designation: { select: { name: true } },
            },
          },
          lines: true,
          payments: {
            include: { bankAccount: { select: { bankName: true } } },
            orderBy: { paidAt: 'desc' },
          },
          adjustments: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { employee: { name: 'asc' } },
      },
    },
  })

  if (!period) return null

  validateOutletAccess(user, period.outletId)

  return {
    ...period,
    totalGross: Number(period.totalGross),
    totalNet: Number(period.totalNet),
    entries: period.entries.map(e => ({
      ...e,
      baseSalary: Number(e.baseSalary),
      incentive: Number(e.incentive),
      deduction: Number(e.deduction),
      advanceRecovered: Number(e.advanceRecovered),
      netPayable: Number(e.netPayable),
      paidAmount: Number(e.paidAmount),
      lines: e.lines.map(l => ({ ...l, amount: Number(l.amount) })),
      payments: e.payments.map(p => ({
        ...p,
        amount: Number(p.amount),
        paidAt: p.paidAt.toISOString(),
      })),
      adjustments: e.adjustments.map(a => ({
        ...a,
        amount: Number(a.amount),
        createdAt: a.createdAt.toISOString(),
      })),
    })),
  }
}

export async function getEmployeeAdvances(employeeId: string) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { outletId: true },
  })
  if (!employee) {
    throw new Error('Employee not found')
  }
  if (employee.outletId) {
    validateOutletAccess(user, employee.outletId)
  }

  const advances = await prisma.employeeAdvance.findMany({
    where: { employeeId },
    orderBy: { givenDate: 'desc' },
  })

  return advances.map(a => ({
    id: a.id,
    amount: Number(a.amount),
    recoveredAmount: Number(a.recoveredAmount),
    remainingAmount: Number(a.amount) - Number(a.recoveredAmount),
    givenDate: a.givenDate.toISOString(),
    status: a.status,
    notes: a.notes,
  }))
}

// ─────────────────────────────────────────────
// FINAL SETTLEMENT (EXIT PAYROLL)
// ─────────────────────────────────────────────

/**
 * Generate Final Settlement for a departing employee:
 * - Prorates salary up to exit date.
 * - Computes unused leave encashment (if provided).
 * - Full clearance recovery of all outstanding advances against final net pay.
 * - Deactivates employee record upon settlement.
 */
export async function generateFinalSettlement(data: {
  employeeId: string
  exitDate: string
  unusedLeaveDays?: number
  leaveEncashmentDailyRate?: number
  notes?: string
}) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR
  )

  const exit = new Date(data.exitDate)
  const month = exit.getMonth() + 1
  const year = exit.getFullYear()
  const exitDay = exit.getDate()

  const empCheck = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    select: { isActive: true, outletId: true },
  })

  if (!empCheck) return fail('Employee not found')
  validateOutletAccess(user, empCheck.outletId)

  if (!empCheck.isActive) {
    return fail('Employee has already been settled and is inactive')
  }

  const result = await prisma.$transaction(
    async tx => {
    // 0. Row lock on Employee to prevent concurrent settlement requests
    await tx.$executeRaw`SELECT id FROM "Employee" WHERE id = ${data.employeeId} FOR UPDATE`

    const emp = await tx.employee.findUnique({
      where: { id: data.employeeId },
      include: {
        advances: {
          where: {
            status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] },
          },
        },
      },
    })

    if (!emp) throw new Error('Employee not found')
    if (!emp.isActive) {
      throw new Error('Employee has already been settled and is inactive')
    }

    const daysInMonth = new Date(year, month, 0).getDate()
    const basicSalary = Number(emp.basicSalary)

    // Prorated base salary up to exit date
    const proratedBaseSalary =
      Math.round(((basicSalary / daysInMonth) * exitDay) * 100) / 100

    // Leave encashment (if provided)
    const leaveEncashment =
      (data.unusedLeaveDays || 0) *
      (data.leaveEncashmentDailyRate || basicSalary / daysInMonth)
    const roundedLeaveEncashment = Math.round(leaveEncashment * 100) / 100

    const totalGrossBeforeAdvance = proratedBaseSalary + roundedLeaveEncashment

    // Total outstanding advances
    const totalOutstandingAdvance = emp.advances.reduce(
      (sum, adv) => sum + (Number(adv.amount) - Number(adv.recoveredAmount)),
      0
    )

    const advanceToRecover = Math.min(totalOutstandingAdvance, totalGrossBeforeAdvance)

    // Clear advances
    let remainingToDeduct = advanceToRecover
    for (const adv of emp.advances) {
      if (remainingToDeduct <= 0) break
      const unrecovered = Number(adv.amount) - Number(adv.recoveredAmount)
      const recoverHere = Math.min(unrecovered, remainingToDeduct)
      const newRecovered = Number(adv.recoveredAmount) + recoverHere
      const newStatus =
        newRecovered >= Number(adv.amount)
          ? AdvanceStatus.CLEARED
          : AdvanceStatus.PARTIALLY_CLEARED

      await tx.employeeAdvance.update({
        where: { id: adv.id },
        data: { recoveredAmount: newRecovered, status: newStatus },
      })
      remainingToDeduct -= recoverHere
    }

    // Lock and get or create period
    await tx.$executeRaw`SELECT id FROM "PayrollPeriod" WHERE month = ${month} AND year = ${year} AND "outletId" = ${emp.outletId} FOR UPDATE`

    let period = await tx.payrollPeriod.findUnique({
      where: { month_year_outletId: { month, year, outletId: emp.outletId } },
    })

    if (!period) {
      period = await tx.payrollPeriod.create({
        data: {
          month,
          year,
          outletId: emp.outletId,
          status: PayrollPeriodStatus.DRAFT,
        },
      })
    } else {
      // Check if employee already has an entry in this period (e.g. regular monthly run ran earlier)
      const existingEntry = await tx.payrollEntry.findUnique({
        where: {
          payrollPeriodId_employeeId: {
            payrollPeriodId: period.id,
            employeeId: emp.id,
          },
        },
      })

      if (existingEntry) {
        if (existingEntry.status === PayrollEntryStatus.PAID) {
          throw new Error(
            `Payroll for ${month}/${year} has already been paid to this employee. Submit an adjustment instead.`
          )
        }
        // Never delete an entry that already has recorded payments or adjustments —
        // that would orphan ledger/drawer/bank legs. Block the settlement instead.
        const childCounts = await tx.payrollEntry.findUnique({
          where: { id: existingEntry.id },
          select: {
            _count: { select: { payments: true, adjustments: true } },
          },
        })
        if (
          childCounts &&
          (childCounts._count.payments > 0 || childCounts._count.adjustments > 0)
        ) {
          throw new Error(
            'Cannot replace this employee\'s entry: it has recorded payments or adjustments. Void them first, or settle in a separate period.'
          )
        }
        // Finding #12: Reverse advances recovered by existingEntry before deleting it
        if (existingEntry.advanceRecovered && Number(existingEntry.advanceRecovered) > 0) {
          await reverseAdvanceRecoveriesForEntries(tx, [
            { employeeId: emp.id, advanceRecovered: existingEntry.advanceRecovered },
          ])
        }
        // Replace old un-paid monthly entry with final settlement entry
        await tx.payrollEntry.delete({
          where: { id: existingEntry.id },
        })
      }
    }

    // Create Final Settlement PayrollEntry
    const entry = await tx.payrollEntry.create({
      data: {
        payrollPeriodId: period.id,
        employeeId: emp.id,
        baseSalary: proratedBaseSalary,
        incentive: roundedLeaveEncashment,
        deduction: 0,
        advanceRecovered: advanceToRecover,
        netPayable: Math.max(0, totalGrossBeforeAdvance - advanceToRecover),
        status: PayrollEntryStatus.UNPAID,
      },
    })

    // Base salary line
    await tx.payrollEntryLine.create({
      data: {
        payrollEntryId: entry.id,
        type: PayrollLineType.INCENTIVE,
        category: 'BASE_SALARY',
        label: `Final Settlement Basic Salary (1 to ${exitDay} ${exit.toLocaleString('en-US', { month: 'short' })})`,
        amount: proratedBaseSalary,
      },
    })

    // Leave encashment line
    if (roundedLeaveEncashment > 0) {
      await tx.payrollEntryLine.create({
        data: {
          payrollEntryId: entry.id,
          type: PayrollLineType.INCENTIVE,
          category: 'LEAVE_ENCASHMENT',
          label: `Leave Encashment (${data.unusedLeaveDays} unused days)`,
          amount: roundedLeaveEncashment,
        },
      })
    }

    // Deactivate employee
    await tx.employee.update({
      where: { id: emp.id },
      data: { isActive: false },
    })

    if (emp.userId) {
      await tx.user.update({
        where: { id: emp.userId },
        data: { isActive: false },
      })
    }

    return { entry, period }
    },
    PAYROLL_TX_TIMEOUT
  )

  await logAuditDirect(
    user.id,
    'EMPLOYEE_FINAL_SETTLEMENT',
    'Employee',
    data.employeeId,
    { exitDate: data.exitDate, netPayable: result.entry.netPayable }
  )

  safeRevalidate('/hr/payroll')
  safeRevalidate('/hr/employees')
  return ok(result)
}

// ─────────────────────────────────────────────
// BACKWARD COMPATIBILITY EXPORTS FOR UI
// ─────────────────────────────────────────────

export async function processMonthlyPayroll(
  month: number,
  year: number,
  outletId: string
) {
  return generatePayrollForPeriod(month, year, outletId)
}

export async function getPayrolls(requestedOutletId?: string) {
  return withDatabaseReadFallback(
    async () => {
      const user = await requireRole(
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.HR,
        UserRole.ACCOUNTANT,
        UserRole.MANAGER
      )

      let whereClause: any = {}
      if (requestedOutletId) {
        validateOutletAccess(user, requestedOutletId)
        whereClause = { outletId: requestedOutletId }
      } else if (user.role !== UserRole.SUPER_ADMIN) {
        if (user.outletId) {
          validateOutletAccess(user, user.outletId)
          whereClause = { outletId: user.outletId }
        } else {
          return []
        }
      }

      const rows = await prisma.payrollPeriod.findMany({
        where: whereClause,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          _count: { select: { entries: true } },
          entries: {
            select: { status: true, _count: { select: { payments: true } } },
          },
        },
      })

      return rows.map(r => ({
        id: r.id,
        month: r.month,
        year: r.year,
        status: r.status,
        totalAmount: Number(r.totalNet),
        createdAt: r.createdAt.toISOString(),
        processedAt: r.accruedAt?.toISOString() ?? null,
        payslipCount: r._count.entries,
        // Whether the period is deletable (no payments recorded, non-paid status).
        canDelete:
          (r.status === PayrollPeriodStatus.DRAFT ||
            r.status === PayrollPeriodStatus.ACCRUED) &&
          r.entries.every(e => e.status !== PayrollEntryStatus.PAID && e._count.payments === 0),
      }))
    },
    [],
    'getPayrolls'
  )
}

export async function getPayslips(payrollId: string) {
  return withDatabaseReadFallback(
    async () => {
      const user = await requireRole(
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.HR,
        UserRole.ACCOUNTANT,
        UserRole.MANAGER
      )

      const period = await prisma.payrollPeriod.findUnique({
        where: { id: payrollId },
        select: { outletId: true },
      })
      if (!period) {
        throw new Error('Payroll period not found')
      }
      validateOutletAccess(user, period.outletId)

      const rows = await prisma.payrollEntry.findMany({
        where: { payrollPeriodId: payrollId },
        include: {
          employee: { select: { name: true, employeeCode: true } },
          lines: true,
          payments: {
            orderBy: { paidAt: 'desc' },
            select: {
              id: true,
              amount: true,
              method: true,
              reference: true,
              paidAt: true,
              voidedAt: true,
              voidedById: true,
              voidReason: true,
            },
          },
        },
        orderBy: { employee: { name: 'asc' } },
      })

      return rows.map(r => ({
        id: r.id,
        payrollId: r.payrollPeriodId,
        employeeId: r.employeeId,
        employee: r.employee,
        grossSalary: Number(r.baseSalary),
        totalEarnings: Number(r.baseSalary) + Number(r.incentive),
        advanceRecovered: Number(r.advanceRecovered),
        totalDeductions: Number(r.deduction),
        netSalary: Number(r.netPayable),
        paidAmount: Number(r.paidAmount),
        present: r.presentDays,
        absent: r.absentDays,
        leaves: r.leaveDays,
        isPaid: r.status === PayrollEntryStatus.PAID,
        payments: r.payments.map(p => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference,
          paidAt: p.paidAt.toISOString(),
          voidedAt: p.voidedAt?.toISOString() ?? null,
          voidedById: p.voidedById ?? null,
          voidReason: p.voidReason ?? null,
        })),
        lines: r.lines.map(line => ({
          id: line.id,
          label: line.label,
          amount: Number(line.amount),
          isDeduction: line.type === PayrollLineType.DEDUCTION,
        })),
      }))
    },
    [],
    'getPayslips'
  )
}

// ─────────────────────────────────────────────
// ACCRUAL EXPENSE VS CASH FLOW REPORTING
// ─────────────────────────────────────────────

/**
 * Accrual Expense Report (P&L View)
 * Groups by payrollPeriod.month and year (when cost was incurred).
 * Does NOT depend on payment date!
 */
export async function getPayrollAccrualExpenseReport(
  outletId: string,
  year: number
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )
  validateOutletAccess(user, outletId)

  const periods = await prisma.payrollPeriod.findMany({
    where: { outletId, year },
    orderBy: { month: 'asc' },
    include: {
      entries: {
        select: {
          baseSalary: true,
          incentive: true,
          deduction: true,
          advanceRecovered: true,
          netPayable: true,
        },
      },
    },
  })

  return periods.map(p => {
    const grossExpense = p.entries.reduce(
      (sum, e) => sum + Number(e.baseSalary) + Number(e.incentive),
      0
    )
    const netObligation = p.entries.reduce(
      (sum, e) => sum + Number(e.netPayable),
      0
    )

    return {
      periodId: p.id,
      month: p.month,
      year: p.year,
      status: p.status,
      grossExpense,
      netObligation,
      accruedAt: p.accruedAt?.toISOString() ?? null,
      employeeCount: p.entries.length,
    }
  })
}

/**
 * Cash Outflow Report (Cash Flow View)
 * Groups by the actual payment date (paidAt) from PayrollPayment rows.
 * Demonstrates July-payroll-paid-in-August scenario: paid in August -> shows in August!
 */
export async function getPayrollCashFlowReport(
  outletId: string,
  year: number
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT
  )
  validateOutletAccess(user, outletId)

  const monthlyAggs = await prisma.$queryRaw<{ month: number; total: number; count: bigint }[]>`
    SELECT EXTRACT(MONTH FROM pp."paidAt") as month, SUM(pp.amount) as total, COUNT(*) as count
    FROM "PayrollPayment" pp
    JOIN "PayrollEntry" pe ON pp."payrollEntryId" = pe.id
    JOIN "PayrollPeriod" pr ON pe."payrollPeriodId" = pr.id
    WHERE pr."outletId" = ${outletId}
      AND pp."paidAt" >= ${new Date(year, 0, 1)} AND pp."paidAt" < ${new Date(year + 1, 0, 1)}
    GROUP BY EXTRACT(MONTH FROM pp."paidAt")
  `

  // Group by paidAt calendar month
  const monthlyOutflows: Record<
    number,
    { totalCashOutflow: number; count: number; details: any[] }
  > = {}

  for (let m = 1; m <= 12; m++) {
    monthlyOutflows[m] = { totalCashOutflow: 0, count: 0, details: [] }
  }

  for (const row of monthlyAggs) {
    const m = Number(row.month)
    if (monthlyOutflows[m]) {
      monthlyOutflows[m].totalCashOutflow = Number(row.total || 0)
      monthlyOutflows[m].count = Number(row.count || 0)
    }
  }

  return Object.entries(monthlyOutflows).map(([monthStr, data]) => ({
    month: Number(monthStr),
    year,
    totalCashOutflow: data.totalCashOutflow,
    transactionCount: data.count,
    details: data.details,
  }))
}

export async function getPayslipById(entryId: string) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.ACCOUNTANT,
    UserRole.MANAGER
  )

  const entry = await prisma.payrollEntry.findUnique({
    where: { id: entryId },
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          employeeCode: true,
          outletId: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
          outlet: {
            select: {
              name: true,
              address: true,
              phone: true,
              logo: true,
            },
          },
        },
      },
      payrollPeriod: true,
      lines: true,
      payments: {
        include: { bankAccount: { select: { bankName: true } } },
        orderBy: { paidAt: 'desc' },
      },
    },
  })

  if (!entry) return null
  validateOutletAccess(user, entry.employee.outletId)

  return {
    ...entry,
    baseSalary: Number(entry.baseSalary),
    incentive: Number(entry.incentive),
    deduction: Number(entry.deduction),
    advanceRecovered: Number(entry.advanceRecovered),
    netPayable: Number(entry.netPayable),
    paidAmount: Number(entry.paidAmount),
    lines: entry.lines.map(l => ({ ...l, amount: Number(l.amount) })),
    payments: entry.payments.map(p => ({
      ...p,
      amount: Number(p.amount),
      paidAt: p.paidAt.toISOString(),
    })),
  }
}

/**
 * Get salary details, deductions, advance recovery, and remaining due for an employee.
 * Used by the Expense Master modal and Payroll payment dialogues.
 */
export async function getEmployeeSalaryDetails(data: {
  employeeId: string
  month: number
  year: number
}) {
  const user = await requireRole(
    UserRole.HR,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ACCOUNTANT
  )

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    include: {
      advances: {
        where: {
          status: { in: [AdvanceStatus.OUTSTANDING, AdvanceStatus.PARTIALLY_CLEARED] },
        },
      },
    },
  })

  if (!employee) return fail('Employee not found')
  validateOutletAccess(user, employee.outletId)

  // 1. Check existing PayrollPeriod and PayrollEntry
  const period = await prisma.payrollPeriod.findUnique({
    where: {
      month_year_outletId: {
        month: data.month,
        year: data.year,
        outletId: employee.outletId,
      },
    },
    include: {
      entries: {
        where: { employeeId: employee.id },
      },
    },
  })

  const existingEntry = period?.entries[0]

  if (existingEntry) {
    const netPayable = Number(existingEntry.netPayable)
    const paidAmount = Number(existingEntry.paidAmount)
    const remainingDue = Math.max(0, Math.round((netPayable - paidAmount + Number.EPSILON) * 100) / 100)

    return ok({
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.employeeCode || `EMP-${employee.id.slice(-4)}`,
      month: data.month,
      year: data.year,
      baseSalary: Number(existingEntry.baseSalary),
      incentives: Number(existingEntry.incentive),
      deductions: Number(existingEntry.deduction),
      advanceRecovered: Number(existingEntry.advanceRecovered),
      netPayable,
      paidAmount,
      remainingDue,
      status: existingEntry.status,
      payrollEntryId: existingEntry.id,
      periodStatus: period.status,
    })
  }

  // 2. If no entry exists yet, compute preview
  const daysInMonth = new Date(data.year, data.month, 0).getDate()
  const basicSalary = Number(employee.basicSalary)
  const joinDate = new Date(employee.joinDate)

  let daysWorked = daysInMonth
  if (
    joinDate.getFullYear() === data.year &&
    joinDate.getMonth() + 1 === data.month
  ) {
    daysWorked = daysInMonth - joinDate.getDate() + 1
  }
  daysWorked = Math.max(1, Math.min(daysInMonth, daysWorked))

  const proratedBase =
    daysWorked === daysInMonth
      ? basicSalary
      : Math.round(((basicSalary / daysInMonth) * daysWorked + Number.EPSILON) * 100) / 100

  // Check attendance for absence deductions
  const attendances = await prisma.attendance.findMany({
    where: {
      employeeId: employee.id,
      date: {
        gte: new Date(data.year, data.month - 1, 1),
        lt: new Date(data.year, data.month, 1),
      },
    },
  })

  let absentDays = 0
  attendances.forEach(att => {
    if (att.status === 'ABSENT') absentDays++
  })

  const absenceDeduction =
    absentDays > 0
      ? Math.round(((basicSalary / daysInMonth) * absentDays + Number.EPSILON) * 100) / 100
      : 0

  const totalOutstandingAdvance = employee.advances.reduce(
    (sum, adv) => sum + (Number(adv.amount) - Number(adv.recoveredAmount)),
    0
  )

  const netBeforeAdvance = Math.max(0, proratedBase - absenceDeduction)
  const advanceToRecover = Math.min(totalOutstandingAdvance, netBeforeAdvance)
  const netPayable = Math.max(
    0,
    Math.round((netBeforeAdvance - advanceToRecover + Number.EPSILON) * 100) / 100
  )

  return ok({
    employeeId: employee.id,
    employeeName: employee.name,
    employeeCode: employee.employeeCode || `EMP-${employee.id.slice(-4)}`,
    month: data.month,
    year: data.year,
    baseSalary: proratedBase,
    incentives: 0,
    deductions: absenceDeduction,
    advanceRecovered: advanceToRecover,
    netPayable,
    paidAmount: 0,
    remainingDue: netPayable,
    status: 'UNPAID',
    payrollEntryId: null,
    periodStatus: 'DRAFT',
  })
}

