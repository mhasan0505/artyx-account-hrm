'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { ClientStatus, ClientType, CredentialCategory, Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'

export type ClientFilterParams = {
  search?: string
  status?: ClientStatus
  clientType?: ClientType
  page?: number
  pageSize?: number
}

// ─────────────────────────────────────────────
// 1. CLIENT DIRECTORY & METRICS
// ─────────────────────────────────────────────

export async function getAgencyClients(params: ClientFilterParams = {}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const { search, status, clientType, page = 1, pageSize = 20 } = params
  const skip = (page - 1) * pageSize

  const where: Prisma.AgencyClientWhereInput = {
    ...(status ? { status } : {}),
    ...(clientType ? { clientType } : {}),
    ...(search
      ? {
          OR: [
            { companyName: { contains: search, mode: 'insensitive' } },
            { contactPerson: { contains: search, mode: 'insensitive' } },
            { clientCode: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [clients, totalCount, stats] = await Promise.all([
    prisma.agencyClient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: {
            projects: true,
            retainers: true,
            invoices: true,
            credentials: true,
          },
        },
      },
    }),
    prisma.agencyClient.count({ where }),
    prisma.agencyClient.aggregate({
      _sum: {
        outstandingBalance: true,
      },
      _count: {
        id: true,
      },
    }),
  ])

  // Get active retainers total monthly revenue
  const retainersSum = await prisma.clientRetainer.aggregate({
    where: { isActive: true },
    _sum: { monthlyFee: true },
    _count: { id: true },
  })

  return {
    clients,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    currentPage: page,
    summary: {
      totalClients: stats._count.id,
      totalOutstanding: Number(stats._sum.outstandingBalance || 0),
      activeRetainersMonthlyValue: Number(retainersSum._sum.monthlyFee || 0),
      activeRetainersCount: retainersSum._count.id,
    },
  }
}

// ─────────────────────────────────────────────
// 2. CLIENT 360° PROFILE
// ─────────────────────────────────────────────

export async function getAgencyClientById(id: string) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const client = await prisma.agencyClient.findUnique({
    where: { id },
    include: {
      credentials: {
        orderBy: { createdAt: 'desc' },
      },
      projects: {
        orderBy: { createdAt: 'desc' },
        include: {
          invoices: {
            select: {
              id: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
          },
          expenses: {
            select: {
              id: true,
              amount: true,
              description: true,
            },
          },
        },
      },
      retainers: {
        orderBy: { createdAt: 'desc' },
      },
      invoices: {
        orderBy: { issueDate: 'desc' },
        include: {
          payments: {
            select: {
              id: true,
              amount: true,
              paymentDate: true,
              paymentMethod: true,
              reference: true,
            },
          },
        },
      },
      ledger: {
        orderBy: { date: 'desc' },
        take: 50,
      },
    },
  })

  if (!client) {
    return null
  }

  // Calculate Client Lifetime Value (LTV) and Financial Stats
  const totalInvoiced = client.invoices.reduce(
    (sum, inv) => sum + Number(inv.totalAmount),
    0
  )
  const totalPaid = client.invoices.reduce(
    (sum, inv) => sum + Number(inv.paidAmount),
    0
  )
  const totalDue = Number(client.outstandingBalance)

  return {
    ...client,
    stats: {
      totalInvoiced,
      totalPaid,
      totalDue,
      activeProjectsCount: client.projects.filter(p => p.status === 'IN_PROGRESS').length,
      activeRetainersCount: client.retainers.filter(r => r.isActive).length,
    },
  }
}

// ─────────────────────────────────────────────
// 3. CREATE & UPDATE CLIENT
// ─────────────────────────────────────────────

export async function createAgencyClient(data: {
  companyName: string
  contactPerson: string
  email?: string
  phone?: string
  whatsapp?: string
  website?: string
  address?: string
  city?: string
  country?: string
  taxId?: string
  clientType?: ClientType
  billingCurrency?: string
  notes?: string
  openingBalance?: number
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  // Generate unique client code (e.g. CLI-1001)
  const count = await prisma.agencyClient.count()
  const clientCode = `CLI-${(1001 + count).toString().padStart(4, '0')}`

  const openingBal = data.openingBalance ? new Prisma.Decimal(data.openingBalance) : new Prisma.Decimal(0)

  const newClient = await prisma.$transaction(async tx => {
    const client = await tx.agencyClient.create({
      data: {
        clientCode,
        companyName: data.companyName.trim(),
        contactPerson: data.contactPerson.trim(),
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        whatsapp: data.whatsapp?.trim() || null,
        website: data.website?.trim() || null,
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        country: data.country || 'Bangladesh',
        taxId: data.taxId?.trim() || null,
        clientType: data.clientType || 'PROJECT_BASED',
        billingCurrency: data.billingCurrency || 'BDT',
        notes: data.notes?.trim() || null,
        outstandingBalance: openingBal,
      },
    })

    if (openingBal.gt(0)) {
      await tx.clientLedger.create({
        data: {
          clientId: client.id,
          type: 'DEBIT',
          amount: openingBal,
          balance: openingBal,
          description: 'Opening Balance',
          reference: 'OPENING_BAL',
        },
      })
    }

    return client
  })

  revalidatePath('/clients')
  return { success: true, client: newClient }
}

export async function updateAgencyClient(
  id: string,
  data: Partial<{
    companyName: string
    contactPerson: string
    email: string
    phone: string
    whatsapp: string
    website: string
    address: string
    city: string
    country: string
    taxId: string
    clientType: ClientType
    status: ClientStatus
    notes: string
  }>
) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const updated = await prisma.agencyClient.update({
    where: { id },
    data: {
      ...(data.companyName ? { companyName: data.companyName.trim() } : {}),
      ...(data.contactPerson ? { contactPerson: data.contactPerson.trim() } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.whatsapp !== undefined ? { whatsapp: data.whatsapp?.trim() || null } : {}),
      ...(data.website !== undefined ? { website: data.website?.trim() || null } : {}),
      ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
      ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
      ...(data.country !== undefined ? { country: data.country } : {}),
      ...(data.taxId !== undefined ? { taxId: data.taxId?.trim() || null } : {}),
      ...(data.clientType ? { clientType: data.clientType } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
  })

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  return { success: true, client: updated }
}

// ─────────────────────────────────────────────
// 4. CLIENT CREDENTIALS VAULT
// ─────────────────────────────────────────────

export async function addClientCredential(
  clientId: string,
  data: {
    title: string
    category: CredentialCategory
    loginUrl?: string
    username?: string
    password?: string
    apiKey?: string
    notes?: string
  }
) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const credential = await prisma.clientCredential.create({
    data: {
      clientId,
      title: data.title.trim(),
      category: data.category,
      loginUrl: data.loginUrl?.trim() || null,
      username: data.username?.trim() || null,
      password: data.password?.trim() || null,
      apiKey: data.apiKey?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  })

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients/credentials')
  return { success: true, credential }
}

export async function deleteClientCredential(id: string, clientId: string) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  await prisma.clientCredential.delete({
    where: { id },
  })

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients/credentials')
  return { success: true }
}

export async function getAllClientCredentials(category?: CredentialCategory) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  return prisma.clientCredential.findMany({
    where: category ? { category } : {},
    include: {
      client: {
        select: {
          id: true,
          companyName: true,
          clientCode: true,
          contactPerson: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

// ─────────────────────────────────────────────
// 5. MONTHLY RETAINERS
// ─────────────────────────────────────────────

export async function addClientRetainer(
  clientId: string,
  data: {
    serviceName: string
    monthlyFee: number
    billingDay?: number
    startDate?: Date
    currency?: string
    notes?: string
  }
) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const retainer = await prisma.clientRetainer.create({
    data: {
      clientId,
      serviceName: data.serviceName.trim(),
      monthlyFee: new Prisma.Decimal(data.monthlyFee),
      billingDay: data.billingDay || 1,
      startDate: data.startDate || new Date(),
      currency: data.currency || 'BDT',
      notes: data.notes?.trim() || null,
      isActive: true,
    },
  })

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients/retainers')
  return { success: true, retainer }
}

export async function toggleRetainerStatus(id: string, clientId: string, isActive: boolean) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  await prisma.clientRetainer.update({
    where: { id },
    data: { isActive },
  })

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients/retainers')
  return { success: true }
}

export async function getAllRetainers() {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const retainers = await prisma.clientRetainer.findMany({
    include: {
      client: {
        select: {
          id: true,
          companyName: true,
          clientCode: true,
          contactPerson: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const totalMonthlyMRR = retainers
    .filter(r => r.isActive)
    .reduce((sum, r) => sum + Number(r.monthlyFee), 0)

  return {
    retainers,
    stats: {
      totalRetainers: retainers.length,
      activeCount: retainers.filter(r => r.isActive).length,
      totalMonthlyMRR,
    },
  }
}

// ─────────────────────────────────────────────
// 6. PROJECTS & CONTRACTS
// ─────────────────────────────────────────────

export async function createAgencyProject(data: {
  clientId: string
  name: string
  serviceCategory: string
  billingType?: string
  contractValue: number
  startDate?: Date
  targetEndDate?: Date
  description?: string
}) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const count = await prisma.agencyProject.count()
  const projectCode = `PRJ-${(1001 + count).toString().padStart(4, '0')}`

  const project = await prisma.agencyProject.create({
    data: {
      projectCode,
      clientId: data.clientId,
      name: data.name.trim(),
      serviceCategory: data.serviceCategory,
      billingType: data.billingType || 'FIXED_PRICE',
      contractValue: new Prisma.Decimal(data.contractValue),
      startDate: data.startDate || new Date(),
      targetEndDate: data.targetEndDate || null,
      description: data.description?.trim() || null,
      status: 'IN_PROGRESS',
    },
  })

  revalidatePath(`/clients/${data.clientId}`)
  revalidatePath('/projects')
  return { success: true, project }
}

export async function getAllAgencyProjects(status?: string, category?: string) {
  const where: any = {}
  if (status && status !== 'ALL') where.status = status
  if (category && category !== 'ALL') where.serviceCategory = category

  const projects = await prisma.agencyProject.findMany({
    where,
    include: {
      client: {
        select: {
          id: true,
          companyName: true,
          clientCode: true,
          contactPerson: true,
        },
      },
      invoices: {
        select: {
          totalAmount: true,
          paidAmount: true,
          dueAmount: true,
        },
      },
      expenses: {
        select: {
          amount: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const stats = {
    totalProjects: projects.length,
    activeCount: projects.filter(p => p.status === 'IN_PROGRESS').length,
    totalContractValue: projects.reduce((s, p) => s + Number(p.contractValue), 0),
    totalInvoiced: projects.reduce(
      (s, p) => s + p.invoices.reduce((is, i) => is + Number(i.totalAmount), 0),
      0
    ),
    totalCollected: projects.reduce(
      (s, p) => s + p.invoices.reduce((is, i) => is + Number(i.paidAmount), 0),
      0
    ),
  }

  return { projects, stats }
}

