import { prisma } from '@/lib/db'
import { InvoiceForm } from '@/components/agency/invoice-form'

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; projectId?: string; milestoneId?: string }>
}) {
  const resolvedParams = await searchParams

  let preselectedClientId = resolvedParams.clientId
  let preselectedProjectId = resolvedParams.projectId
  let initialLineItem: { description: string; serviceCategory: string; quantity: number; unitPrice: number } | undefined

  if (resolvedParams.milestoneId) {
    const milestone = await prisma.projectMilestone.findUnique({
      where: { id: resolvedParams.milestoneId },
      include: {
        project: {
          select: { id: true, clientId: true, name: true },
        },
      },
    })
    if (milestone) {
      preselectedClientId = milestone.project.clientId
      preselectedProjectId = milestone.project.id
      initialLineItem = {
        description: `${milestone.title} Milestone Deliverable (${milestone.project.name})`,
        serviceCategory: 'Software Development',
        quantity: 1,
        unitPrice: Number(milestone.billableAmount) || 0,
      }
    }
  } else if (!preselectedClientId && preselectedProjectId) {
    const proj = await prisma.agencyProject.findUnique({
      where: { id: preselectedProjectId },
      select: { clientId: true },
    })
    preselectedClientId = proj?.clientId
  }

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
        preselectedClientId={preselectedClientId}
        preselectedProjectId={preselectedProjectId}
        initialLineItem={initialLineItem}
      />
    </div>
  )
}
