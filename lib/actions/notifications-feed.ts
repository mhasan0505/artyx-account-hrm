'use server'

import { requireAuth } from '@/lib/actions/auth-guard'
import { prisma } from '@/lib/db'
import { UserRole } from '@prisma/client'

export interface HeaderNotificationItem {
  id: string
  title: string
  description: string
  type: 'INVOICE' | 'EXPENSE' | 'CLIENT' | 'SYSTEM'
  timestamp: string
  timeAgo: string
  url: string
  isRead?: boolean
}

export interface HeaderMessageItem {
  id: string
  recipient: string
  phone?: string
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL'
  snippet: string
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'UNCONFIGURED'
  timestamp: string
  timeAgo: string
  url: string
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

/**
 * Fetches relevant agency accounting notifications for Artyx Digital ERP.
 */
export async function getHeaderNotificationsFeed(): Promise<{
  unreadCount: number
  notifications: HeaderNotificationItem[]
}> {
  try {
    await requireAuth()

    const notifications: HeaderNotificationItem[] = []

    // 1. Fetch recent or overdue agency invoices
    const overdueInvoices = await prisma.agencyInvoice.findMany({
      where: {
        status: { in: ['OVERDUE', 'SENT', 'PARTIALLY_PAID'] },
        dueDate: { lt: new Date() },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
      include: {
        client: { select: { companyName: true, clientCode: true } },
      },
    })

    overdueInvoices.forEach(inv => {
      const amount = Number(inv.totalAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      notifications.push({
        id: `invoice-overdue-${inv.id}`,
        title: `Overdue Invoice: ${inv.invoiceNumber}`,
        description: `৳ ${amount} due from ${inv.client.companyName}`,
        type: 'INVOICE',
        timestamp: inv.dueDate.toISOString(),
        timeAgo: formatRelativeTime(inv.dueDate),
        url: `/invoices/${inv.id}`,
      })
    })

    // 2. Fetch recent paid/sent invoices (last 5)
    const recentInvoices = await prisma.agencyInvoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        client: { select: { companyName: true } },
      },
    })

    recentInvoices.forEach(inv => {
      if (overdueInvoices.some(o => o.id === inv.id)) return // skip duplicates
      const amount = Number(inv.totalAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      notifications.push({
        id: `invoice-${inv.id}`,
        title: `Invoice #${inv.invoiceNumber} (${inv.status})`,
        description: `৳ ${amount} • ${inv.client.companyName}`,
        type: 'INVOICE',
        timestamp: inv.createdAt.toISOString(),
        timeAgo: formatRelativeTime(inv.createdAt),
        url: `/invoices/${inv.id}`,
      })
    })

    // 3. Fetch pending expenses
    const pendingExpenses = await prisma.expense.findMany({
      where: { status: 'PENDING' },
      orderBy: { expenseDate: 'desc' },
      take: 5,
    })

    pendingExpenses.forEach(exp => {
      const amount = Number(exp.amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      notifications.push({
        id: `expense-${exp.id}`,
        title: `Pending Expense Approval`,
        description: `৳ ${amount} • ${exp.description.slice(0, 45)}`,
        type: 'EXPENSE',
        timestamp: exp.createdAt.toISOString(),
        timeAgo: formatRelativeTime(exp.createdAt),
        url: '/expenses',
      })
    })

    // 4. Fetch recent clients
    const recentClients = await prisma.agencyClient.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, companyName: true, clientCode: true, createdAt: true },
    })

    recentClients.forEach(c => {
      notifications.push({
        id: `client-${c.id}`,
        title: `New Client: ${c.companyName}`,
        description: `Client Code: ${c.clientCode}`,
        type: 'CLIENT',
        timestamp: c.createdAt.toISOString(),
        timeAgo: formatRelativeTime(c.createdAt),
        url: `/clients/${c.id}`,
      })
    })

    // Sort by timestamp descending
    notifications.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    return {
      unreadCount: Math.min(notifications.length, 99),
      notifications: notifications.slice(0, 15),
    }
  } catch (err) {
    console.error('[HeaderFeed] Error fetching notifications feed:', err)
    return { unreadCount: 0, notifications: [] }
  }
}

/**
 * Message dispatch helper (kept for compatibility)
 */
export async function getHeaderMessagesFeed(): Promise<{
  isConfigured: boolean
  unreadCount: number
  messages: HeaderMessageItem[]
}> {
  return { isConfigured: false, unreadCount: 0, messages: [] }
}
