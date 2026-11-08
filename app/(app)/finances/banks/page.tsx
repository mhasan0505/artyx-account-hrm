import { PageHeader } from "@/components/page-header"
import { getBankAccounts } from "@/lib/actions/bank"
import { BankAccountsTable } from "./bank-accounts-table"

export default async function BankAccountsPage() {
  const accounts = await getBankAccounts()

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Bank & MFS Accounts" />
      </div>

      <BankAccountsTable accounts={accounts} />
    </div>
  )
}
