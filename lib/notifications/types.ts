export type NotificationCategoryType =
  | 'EXECUTIVE_TASK'
  | 'CHAT'
  | 'INVOICE'
  | 'PAYMENT'
  | 'CLIENT'
  | 'PROJECT'
  | 'EXPENSE'
  | 'EQUITY'
  | 'FINANCE'
  | 'HR'
  | 'PAYROLL'
  | 'SECURITY'
  | 'SYSTEM'

export type NotificationPriorityType = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface ExecutiveNotificationDTO {
  id: string
  recipientId: string
  actorId?: string | null
  actorName?: string | null
  actorBadge?: string | null
  actorImage?: string | null
  category: NotificationCategoryType
  priority: NotificationPriorityType
  eventKey: string
  title: string
  body: string
  url: string
  metadata?: Record<string, unknown> | null
  isRead: boolean
  readAt?: string | null
  createdAt: string
  tag?: string
  requireInteraction?: boolean
  /** True for synthesized legacy alerts (e.g. overdue invoices) not stored in UserNotification */
  isSynthetic?: boolean
}

export interface NotificationPreferenceDTO {
  desktopPushEnabled: boolean
  inAppPopupEnabled: boolean
  soundEnabled: boolean
  notifyWhenActive: boolean
  mutedCategories: NotificationCategoryType[]
  dndEnabled: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceDTO = {
  desktopPushEnabled: true,
  inAppPopupEnabled: true,
  soundEnabled: true,
  notifyWhenActive: true,
  mutedCategories: [],
  dndEnabled: false,
}

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategoryType,
  { label: string; shortLabel: string }
> = {
  EXECUTIVE_TASK: { label: 'Executive Tasks', shortLabel: 'Exec Tasks' },
  CHAT: { label: 'Team Chat & Mentions', shortLabel: 'Chat' },
  INVOICE: { label: 'Client Invoices', shortLabel: 'Invoices' },
  PAYMENT: { label: 'Payments Received', shortLabel: 'Payments' },
  CLIENT: { label: 'Clients & Retainers', shortLabel: 'Clients' },
  PROJECT: { label: 'Projects & Tasks', shortLabel: 'Projects' },
  EXPENSE: { label: 'Expenses & Approvals', shortLabel: 'Expenses' },
  EQUITY: { label: 'Partner Equity & Profit', shortLabel: 'Equity' },
  FINANCE: { label: 'Transfers & Capital', shortLabel: 'Finance' },
  HR: { label: 'HR & Leave Requests', shortLabel: 'HR' },
  PAYROLL: { label: 'Payroll & Advances', shortLabel: 'Payroll' },
  SECURITY: { label: 'Security & CEO Vault', shortLabel: 'Security' },
  SYSTEM: { label: 'System Alerts', shortLabel: 'System' },
}
