import { getAllClientCredentials } from '@/lib/actions/agency-clients'
import { prisma } from '@/lib/db'
import { CredentialsVaultClient } from '@/components/agency/credentials-vault-client'

export const dynamic = 'force-dynamic'

export default async function CredentialsVaultPage() {
  const credentials = await getAllClientCredentials()

  const clients = await prisma.agencyClient.findMany({
    select: {
      id: true,
      companyName: true,
      clientCode: true,
    },
    orderBy: { companyName: 'asc' },
  })

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden p-3 sm:p-5 md:p-6">
      <CredentialsVaultClient
        initialCredentials={credentials}
        clients={clients}
      />
    </div>
  )
}
