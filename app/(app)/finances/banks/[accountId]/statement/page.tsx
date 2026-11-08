import { getBankAccountStatement } from '@/lib/actions/bank'
import { BankStatementView } from '@/components/finances/bank-statement-view'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ accountId: string }>
}

export default async function BankAccountStatementPage({ params }: Props) {
  const { accountId } = await params

  const res = await getBankAccountStatement(accountId, {
    page: 1,
    pageSize: 25,
  })

  if (!res.success || !res.data) {
    notFound()
  }

  const statementData = res.data

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title={`${statementData.account.accountName} Statement`}
          description={`Comprehensive ledger and cash flow statement for ${statementData.account.bankName} (${statementData.account.accountNumber})`}
          customBreadcrumbLabel="Statement"
          action={
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/finances/banks">
                <ChevronLeft className="size-4" />
                Back to Accounts
              </Link>
            </Button>
          }
        />
      </div>

      <BankStatementView initialData={statementData} />
    </div>
  )
}
