import { notifyUsers } from '@/lib/notifications/push-service'
import { UserRole } from '@prisma/client'

export interface CheckBalanceSheetParams {
  discrepancy: number
  totalAssets: number
  totalLiabilitiesAndEquity: number
  asOfDate?: Date
}

/**
 * Checks if the balance sheet is unbalanced and sends Web Push alerts to admins.
 * Rate-limited to once per hour company-wide to avoid duplicate alerts during investigations.
 */
export async function checkAndNotifyBalanceSheetDiscrepancy(
  params: CheckBalanceSheetParams
): Promise<{ triggered: boolean; discrepancy: number }> {
  const { discrepancy, totalAssets, totalLiabilitiesAndEquity } = params

  const absDiscrepancy = Math.abs(discrepancy)
  if (absDiscrepancy < 0.01) {
    return { triggered: false, discrepancy }
  }

  try {
    const formattedDiscrepancy = `BDT ${absDiscrepancy.toFixed(2)}`
    const direction =
      discrepancy > 0
        ? 'Assets exceed Liabilities & Equity'
        : 'Liabilities & Equity exceed Assets'

    const res = await notifyUsers({
      roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN],
      // Company-wide cooldown key (independent of outlet)
      cooldownKey: 'balance-sheet-discrepancy',
      cooldownMinutes: 60,
      title: 'Balance Sheet Discrepancy Alert',
      body: `Balance Sheet is unbalanced by ${formattedDiscrepancy} (${direction}). Assets: BDT ${totalAssets.toFixed(2)}, L+E: BDT ${totalLiabilitiesAndEquity.toFixed(2)}.`,
      url: '/reports/balance-sheet',
      data: {
        type: 'BALANCE_SHEET_DISCREPANCY',
        discrepancy,
        absDiscrepancy,
        totalAssets,
        totalLiabilitiesAndEquity,
        direction,
      },
    })

    return {
      triggered: res.sent > 0 || !res.suppressedByCooldown,
      discrepancy,
    }
  } catch (err) {
    console.error('[BalanceSheetTrigger] Error notifying balance sheet discrepancy:', err)
    return { triggered: false, discrepancy }
  }
}
