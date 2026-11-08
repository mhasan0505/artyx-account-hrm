import { fail, ok, type ActionResult } from '@/lib/actions/result'
import { prisma } from '@/lib/db'
import { checkAndNotifyBalanceSheetDiscrepancy } from '@/lib/notifications/triggers/balance-sheet'
import { getLocalDateRangeBoundaries } from '@/lib/date-utils'
import { getFixedAssets } from '@/lib/actions/fixed-assets'

export type BalanceSheetData = {
  assets: {
    cashOnHand: number
    bankBalances: number
    accountsReceivable: number
    inventoryValue: number
    fixedAssetsGross: number
    fixedAssetsAccumulatedDepreciation: number
    fixedAssetsNet: number
    totalAssets: number
  }
  liabilities: {
    accountsPayable: number
    accruedPayroll: number
    totalLiabilities: number
  }
  equity: {
    ownersCapital: number
    openingBalanceEquity: number
    retainedEarnings: number
    totalEquity: number
  }
  isBalanced: boolean
  discrepancy: number
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

/**
 * Pure internal function to compute the double-entry Balance Sheet.
 * Can be called safely from server actions, background workers, or cron endpoints.
 */
export async function computeBalanceSheet(
  asOfDateStr?: string
): Promise<ActionResult<BalanceSheetData>> {
  try {
    const { end: asOfDate } = getLocalDateRangeBoundaries(asOfDateStr, asOfDateStr, 6)

    // ==========================================
    // 1. ASSETS (Calculated via Immutable Double-Entry Ledger History)
    // ==========================================

    // 1.1 Cash on Hand (Code 1100: Assets = DEBIT - CREDIT)
    const [cashSum] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "total"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '1100'
        AND ale."createdAt" <= ${asOfDate}
    `
    const cashOnHand = round2(Number(cashSum?.total || 0))

    // 1.2 Bank Balances (Code 1110 / 1200: Assets = DEBIT - CREDIT)
    const [bankSum] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "total"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE (coa.code = '1110' OR coa.code = '1200')
        AND ale."createdAt" <= ${asOfDate}
    `
    const bankBalances = round2(Number(bankSum?.total || 0))

    // 1.3 Accounts Receivable (Code 1300: Assets = DEBIT - CREDIT)
    const [arSum] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "total"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '1300'
        AND ale."createdAt" <= ${asOfDate}
    `
    const accountsReceivable = round2(Number(arSum?.total || 0))

    // 1.4 Inventory Value (Code 1400: Assets = DEBIT - CREDIT)
    const [invSum] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "total"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '1400'
        AND ale."createdAt" <= ${asOfDate}
    `
    const inventoryValue = round2(Number(invSum?.total || 0))

    // 1.5 Fixed Assets
    const fixedAssetsList = await getFixedAssets(asOfDate)
    const fixedAssetsGross = round2(fixedAssetsList.reduce((sum, a) => sum + a.acquisitionCost, 0))
    const fixedAssetsAccumulatedDepreciation = round2(fixedAssetsList.reduce((sum, a) => sum + a.accumulatedDepreciation, 0))
    const fixedAssetsNet = round2(fixedAssetsList.reduce((sum, a) => sum + a.bookValue, 0))

    const totalAssets = round2(cashOnHand + bankBalances + accountsReceivable + inventoryValue + fixedAssetsNet)

    // ==========================================
    // 2. LIABILITIES
    // ==========================================

    // 2.1 Accounts Payable (Code 2100: Liabilities = CREDIT - DEBIT)
    const [apSum] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "total"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '2100'
        AND ale."createdAt" <= ${asOfDate}
    `
    const accountsPayable = round2(Number(apSum?.total || 0))

    // 2.2 Accrued Payroll (Code 2210: Liabilities = CREDIT - DEBIT)
    const [payrollGlSum] = await prisma.$queryRaw<{ totalAccrued: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "totalAccrued"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE (coa.code = '2210' OR (coa.code = '2200' AND coa.name ILIKE '%Payroll%'))
        AND ale."createdAt" <= ${asOfDate}
    `
    let accruedPayroll = round2(Number(payrollGlSum?.totalAccrued || 0))

    // Fallback: If no GL accrual entries exist yet (before remediation script runs),
    // derive from PayrollEntry table
    if (accruedPayroll === 0) {
      const [hasAny2210] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count FROM "AccountLedgerEntry" ale
        JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
        WHERE coa.code = '2210'
      `
      if ((hasAny2210?.count || 0) === 0) {
        const [payrollTableSum] = await prisma.$queryRaw<{ totalAccrued: number }[]>`
          SELECT COALESCE(SUM("netPayable" - "paidAmount"), 0) as "totalAccrued"
          FROM "PayrollEntry" pe
          JOIN "PayrollPeriod" pp ON pe."payrollPeriodId" = pp.id
          WHERE pe.status::text IN ('UNPAID', 'PARTIALLY_PAID')
            AND pe."createdAt" <= ${asOfDate}
        `
        accruedPayroll = round2(Number(payrollTableSum?.totalAccrued || 0))
      }
    }

    const totalLiabilities = round2(accountsPayable + accruedPayroll)

    // ==========================================
    // 3. EQUITY
    // ==========================================

    // 3.1 Owner's Capital (Code 3000)
    const [capitalSum] = await prisma.$queryRaw<{ totalCapital: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "totalCapital"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '3000'
        AND ale."createdAt" <= ${asOfDate}
    `
    const ownersCapital = round2(Number(capitalSum?.totalCapital || 0))

    // 3.1b Opening Balance Equity (Code 3200)
    const [obeSum] = await prisma.$queryRaw<{ totalObe: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "totalObe"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.code = '3200'
        AND ale."createdAt" <= ${asOfDate}
    `
    const openingBalanceEquity = round2(Number(obeSum?.totalObe || 0))

    // 3.2 Retained Earnings (Accumulated Net Income: Total Revenue - Total Expenses/COGS)
    const [glIncomeSum] = await prisma.$queryRaw<{ totalInc: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'CREDIT' THEN amount ELSE -amount END
      ), 0) as "totalInc"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.type::text = 'INCOME'
        AND ale."createdAt" <= ${asOfDate}
    `
    const totalRevenue = round2(Number(glIncomeSum?.totalInc || 0))

    const [glExpenseSum] = await prisma.$queryRaw<{ totalExp: number }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ale.type::text = 'DEBIT' THEN amount ELSE -amount END
      ), 0) as "totalExp"
      FROM "AccountLedgerEntry" ale
      JOIN "ChartOfAccount" coa ON ale."accountId" = coa.id
      WHERE coa.type::text = 'EXPENSE'
        AND ale."createdAt" <= ${asOfDate}
    `
    const totalExpenses = round2(Number(glExpenseSum?.totalExp || 0))

    const retainedEarnings = round2(totalRevenue - totalExpenses)
    const totalEquity = round2(ownersCapital + openingBalanceEquity + retainedEarnings)

    // ==========================================
    // 4. BALANCING
    // ==========================================

    const discrepancy = round2(totalAssets - (totalLiabilities + totalEquity))
    const isBalanced = Math.abs(discrepancy) < 0.01

    if (!isBalanced) {
      checkAndNotifyBalanceSheetDiscrepancy({
        discrepancy,
        totalAssets,
        totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
        asOfDate,
      }).catch(err => {
        console.error('[Reports] Failed to send balance sheet discrepancy alert:', err)
      })
    }

    return ok({
      assets: {
        cashOnHand,
        bankBalances,
        accountsReceivable,
        inventoryValue,
        fixedAssetsGross,
        fixedAssetsAccumulatedDepreciation,
        fixedAssetsNet,
        totalAssets,
      },
      liabilities: {
        accountsPayable,
        accruedPayroll,
        totalLiabilities,
      },
      equity: {
        ownersCapital,
        openingBalanceEquity,
        retainedEarnings,
        totalEquity,
      },
      isBalanced,
      discrepancy,
    })
  } catch (error: any) {
    return fail(error.message || 'Failed to generate Balance Sheet')
  }
}
