import { PageHeader } from '@/components/page-header'
import { requireAuth } from '@/lib/actions/auth-guard'
import { getBankAccounts } from '@/lib/actions/bank'
import { getCapitalInjections } from '@/lib/actions/capital'
import { withDatabaseReadFallback } from '@/lib/db'
import { CapitalInjectionTable } from './capital-injection-table'

export default async function CapitalInjectionPage() {
  const user = await requireAuth()
  const injections = await withDatabaseReadFallback(
    () => getCapitalInjections(),
    [],
    'CapitalInjectionPage:getCapitalInjections'
  )
  const bankAccountsRes = await withDatabaseReadFallback(
    () => getBankAccounts(),
    [],
    'CapitalInjectionPage:getBankAccounts'
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Capital Injection" />
      </div>

      <CapitalInjectionTable
        injections={injections}
        bankAccounts={bankAccountsRes}
        userRole={user.role}
      />
    </div>
  )
}
