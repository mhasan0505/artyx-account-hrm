import { PageHeader } from '@/components/page-header'
import { requireAuth } from '@/lib/actions/auth-guard'
import { getBankAccounts } from '@/lib/actions/bank'
import { getContraTransfers } from '@/lib/actions/transfers'
import { prisma, withDatabaseReadFallback } from '@/lib/db'
import { TransfersTable } from './transfers-table'

export default async function TransfersPage() {
  const user = await requireAuth()
  const transfers = await withDatabaseReadFallback(
    () => getContraTransfers(),
    [],
    'TransfersPage:getContraTransfers'
  )
  const bankAccountsRes = await withDatabaseReadFallback(
    () => getBankAccounts(),
    [],
    'TransfersPage:getBankAccounts'
  )

  // Also need to get active cash drawer for CASH_TO_BANK and BANK_TO_CASH transfers
  const activeDrawer = await withDatabaseReadFallback(
    () =>
      prisma.cashDrawer.findFirst({
        where: { outletId: user.outletId, status: 'OPEN' },
      }),
    null,
    'TransfersPage:activeDrawer'
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Bank & Cash Transfers" />
      </div>

      <TransfersTable
        transfers={transfers}
        bankAccounts={bankAccountsRes}
        activeDrawerId={activeDrawer?.id}
        userRole={user.role}
      />
    </div>
  )
}
