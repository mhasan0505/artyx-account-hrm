'use server'

import { requireSensitiveRole } from '@/lib/actions/auth-guard'
import { UserRole } from '@prisma/client'
import {
  computeBalanceSheet,
  type BalanceSheetData,
} from '@/lib/reports/balance-sheet'


/**
 * Server action to get Balance Sheet with strict role authorization.
 */
export async function getBalanceSheet(asOfDateStr?: string) {
  await requireSensitiveRole(
    'viewBalanceSheet',
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  return computeBalanceSheet(asOfDateStr)
}
