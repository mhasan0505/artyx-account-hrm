import { prisma } from '@/lib/db'
import {
  AdvanceStatus,
  AdvanceType,
  PayrollEntryStatus,
  PayrollLineType,
  Prisma,
} from '@prisma/client'

export type PrismaTx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * Net Payable = Base Salary + Incentives - Deductions - Advance Recovered
 */
export async function calculateNetPayable(params: {
  baseSalary: number
  incentive: number
  deduction: number
  advanceRecovered: number
}): Promise<number> {
  const base = params.baseSalary || 0
  const inc = params.incentive || 0
  const ded = params.deduction || 0
  const adv = params.advanceRecovered || 0
  return Math.max(0, base + inc - ded - adv)
}

/**
 * Single source of truth for recalculating a PayrollEntry inside a transaction:
 * 1. Sums all PayrollEntryLine rows for INCENTIVE and DEDUCTION.
 * 2. Updates entry incentive & deduction fields from that sum.
 * 3. Computes netPayable using calculateNetPayable and updates entry in DB.
 */
export async function recalculatePayrollEntry(
  entryId: string,
  tx?: PrismaTx | Prisma.TransactionClient
) {
  const db = tx || prisma

  // Pessimistic Row Lock (FOR UPDATE) to eliminate race conditions with concurrent payments/corrections
  await db.$executeRaw`SELECT id FROM "PayrollEntry" WHERE id = ${entryId} FOR UPDATE`

  const entry = await db.payrollEntry.findUnique({
    where: { id: entryId },
    select: {
      baseSalary: true,
      advanceRecovered: true,
      paidAmount: true,
      status: true,
      employeeId: true,
      payrollPeriod: { select: { month: true, year: true, outletId: true } },
    },
  })

  if (!entry) throw new Error(`Payroll entry ${entryId} not found`)

  // FINALITY GUARD: paid entries are immutable.
  // A paid payslip must only be touched through an explicit reversal (voidPayrollPayment),
  // never by recalculating gross/deductions/net.
  if (entry.status === PayrollEntryStatus.PAID) {
    throw new Error(
      `Payroll entry ${entryId} is PAID and cannot be recalculated. Void the payment first, then adjust.`
    )
  }

  const lines = await db.payrollEntryLine.findMany({
    where: { payrollEntryId: entryId },
  })

  let incentiveSum = 0
  let deductionSum = 0

  for (const line of lines) {
    const amt = Number(line.amount)
    if (line.type === PayrollLineType.INCENTIVE) {
      incentiveSum += amt
    } else if (line.type === PayrollLineType.DEDUCTION) {
      deductionSum += amt
    }
  }

  const netPayable = await calculateNetPayable({
    baseSalary: Number(entry.baseSalary),
    incentive: incentiveSum,
    deduction: deductionSum,
    advanceRecovered: Number(entry.advanceRecovered),
  })

  const paidAmount = Number(entry.paidAmount) || 0

  // Post-payment deduction overpayment detection:
  // If post-payment correction lowers netPayable below paidAmount,
  // create an EmployeeAdvance (asset receivable) to recover the overpayment from the next period.
  if (paidAmount > netPayable) {
    const overpaidAmount = Math.round((paidAmount - netPayable) * 100) / 100

    await db.employeeAdvance.create({
      data: {
        employeeId: entry.employeeId,
        outletId: entry.payrollPeriod.outletId,
        amount: overpaidAmount,
        recoveredAmount: 0,
        givenDate: new Date(),
        status: AdvanceStatus.OUTSTANDING,
        type: AdvanceType.OVERPAYMENT_RECOVERY,
        notes: `Auto Overpayment Recovery: Post-payment correction in period ${entry.payrollPeriod.month}/${entry.payrollPeriod.year} reduced net payable to ৳${netPayable} (Paid: ৳${paidAmount}).`,
      },
    })
  }

  const updated = await db.payrollEntry.update({
    where: { id: entryId },
    data: {
      incentive: incentiveSum,
      deduction: deductionSum,
      netPayable,
    },
  })

  // Synchronize GL accrual entries if already posted
  await db.accountLedgerEntry.updateMany({
    where: {
      referenceId: entryId,
      referenceType: 'PAYROLL_ACCRUAL',
    },
    data: {
      amount: netPayable,
    },
  })

  return updated
}
