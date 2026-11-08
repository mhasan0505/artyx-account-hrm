import { prisma } from '@/lib/db'
import { InvoiceForm } from '@/components/agency/invoice-form'

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const resolvedParams = await searchParams

  const clients = await prisma.agencyClient.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      companyName: true,
      clientCode: true,
      contactPerson: true,
      projects: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { companyName: 'asc' },
  })

  return (
    <div className="w-full p-4 md:p-6">
      <InvoiceForm
        clients={clients}
        preselectedClientId={resolvedParams.clientId}
      />
    </div>
  )
}
