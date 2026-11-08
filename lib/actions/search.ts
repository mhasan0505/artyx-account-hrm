'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'

export type SearchResultItem = {
  id: string
  label: string
  sublabel: string
  href: string
  type:
    | 'product'
    | 'sale'
    | 'customer'
    | 'purchase'
    | 'supplier'
    | 'b2b'
    | 'serial'
    | 'quotation'
    | 'service'
    | 'invoice'
    | 'employee'
    | 'client'
    | 'project'
    | 'partner'
}

/** Safely run a single search query — returns [] on error so one failing
 *  entity type never blocks the others. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeSearch(label: string, query: Promise<any[]>): Promise<any[]> {
  try {
    return await query
  } catch (err) {
    console.error(`[globalSearch] ${label} query failed:`, err)
    return []
  }
}

export async function globalSearch(query: string): Promise<SearchResultItem[]> {
  if (!query || query.trim().length < 2) return []

  const user = await requireAuth()
  const q = query.trim()

  const [
    agencyClients,
    agencyInvoices,
    agencyProjects,
    agencyOwners,
    employees,
    users,
  ] = await Promise.all([
    safeSearch(
      'agencyClients',
      prisma.agencyClient.findMany({
        where: {
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { clientCode: { contains: q, mode: 'insensitive' } },
            { contactPerson: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 6,
        select: {
          id: true,
          companyName: true,
          clientCode: true,
          contactPerson: true,
          clientType: true,
          outstandingBalance: true,
        },
      })
    ),
    safeSearch(
      'agencyInvoices',
      prisma.agencyInvoice.findMany({
        where: {
          OR: [
            { invoiceNumber: { contains: q, mode: 'insensitive' } },
            { client: { companyName: { contains: q, mode: 'insensitive' } } },
            { client: { contactPerson: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 6,
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          dueAmount: true,
          status: true,
          client: { select: { companyName: true } },
        },
        orderBy: { issueDate: 'desc' },
      })
    ),
    safeSearch(
      'agencyProjects',
      prisma.agencyProject.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { projectCode: { contains: q, mode: 'insensitive' } },
            { serviceCategory: { contains: q, mode: 'insensitive' } },
            { client: { companyName: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 6,
        select: {
          id: true,
          name: true,
          projectCode: true,
          serviceCategory: true,
          contractValue: true,
          client: { select: { id: true, companyName: true } },
        },
      })
    ),
    safeSearch(
      'agencyOwners',
      prisma.agencyOwner.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: {
          id: true,
          name: true,
          title: true,
          equityPercentage: true,
          currentCapitalBalance: true,
        },
      })
    ),
    safeSearch(
      'employees',
      prisma.employee.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { employeeCode: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          employeeCode: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
        },
      })
    ),
    (['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user.role)
      ? safeSearch(
          'users',
          prisma.user.findMany({
            where: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
            take: 4,
            select: { id: true, name: true, email: true, role: true },
            orderBy: { name: 'asc' },
          })
        )
      : Promise.resolve([])),
  ])

  const results: SearchResultItem[] = []

  for (const c of agencyClients) {
    results.push({
      id: `client-${c.id}`,
      label: c.companyName,
      sublabel: `${c.clientCode} · ${c.contactPerson} · Due: ৳${Number(c.outstandingBalance).toLocaleString()}`,
      href: `/clients/${c.id}`,
      type: 'client',
    })
  }

  for (const inv of agencyInvoices) {
    results.push({
      id: `invoice-${inv.id}`,
      label: inv.invoiceNumber,
      sublabel: `${inv.client.companyName} · ৳${Number(inv.totalAmount).toLocaleString()} · ${inv.status}`,
      href: `/invoices/${inv.id}`,
      type: 'invoice',
    })
  }

  for (const p of agencyProjects) {
    results.push({
      id: `project-${p.id}`,
      label: p.name,
      sublabel: `${p.projectCode} · ${p.client.companyName} · ৳${Number(p.contractValue).toLocaleString()}`,
      href: `/clients/${p.client.id}`,
      type: 'project',
    })
  }

  for (const o of agencyOwners) {
    results.push({
      id: `owner-${o.id}`,
      label: o.name,
      sublabel: `Partner (${Number(o.equityPercentage)}% Equity) · Capital: ৳${Number(o.currentCapitalBalance).toLocaleString()}`,
      href: `/equity/${o.id}`,
      type: 'partner',
    })
  }

  for (const emp of employees) {
    results.push({
      id: `employee-${emp.id}`,
      label: emp.name,
      sublabel: `${emp.employeeCode} · ${emp.designation?.name || 'Team Member'} · ${emp.department?.name || 'Artyx'}`,
      href: `/hr/employees`,
      type: 'employee',
    })
  }

  for (const u of users) {
    results.push({
      id: `user-${u.id}`,
      label: u.name,
      sublabel: `${u.email} · Role: ${u.role}`,
      href: `/users`,
      type: 'employee',
    })
  }

  return results
}
