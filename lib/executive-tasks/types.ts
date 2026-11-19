export type ExecTaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
export type ExecTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface ExecTaskAttachment {
  id: string
  url: string
  name: string
  type: string
  size: number
  uploadedByName?: string
  uploadedAt: string
}

export interface ExecTaskChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface ExecTaskMember {
  id: string
  name: string
  email: string
  image: string | null
  badge: 'CEO' | 'COO' | 'CMO' | 'SUPER ADMIN'
}

export interface ExecTaskCommentItem {
  id: string
  content: string
  attachments: ExecTaskAttachment[]
  createdAt: string
  user: {
    id: string
    name: string
    image: string | null
    badge: string
  }
}

export interface ExecTaskRecord {
  id: string
  title: string
  description: string | null
  status: ExecTaskStatus
  priority: ExecTaskPriority
  dueDate: string | null
  tags: string[]
  attachments: ExecTaskAttachment[]
  checklist: ExecTaskChecklistItem[]
  createdBy: {
    id: string
    name: string
    image: string | null
    badge: string
  }
  assignee: {
    id: string
    name: string
    image: string | null
    badge: string
  } | null
  updatedBy: {
    id: string
    name: string
    badge: string
  } | null
  comments: ExecTaskCommentItem[]
  createdAt: string
  updatedAt: string
}

export interface ExecTaskInput {
  title: string
  description?: string
  status?: ExecTaskStatus
  priority?: ExecTaskPriority
  dueDate?: string | null
  tags?: string[]
  assigneeId?: string | null
  attachments?: ExecTaskAttachment[]
  checklist?: ExecTaskChecklistItem[]
}

export const STATUS_COLUMNS: Array<{
  value: ExecTaskStatus
  label: string
  dotClass: string
}> = [
  { value: 'TODO', label: 'To Do', dotClass: 'bg-slate-400' },
  { value: 'IN_PROGRESS', label: 'In Progress', dotClass: 'bg-sky-500' },
  { value: 'IN_REVIEW', label: 'In Review', dotClass: 'bg-amber-500' },
  { value: 'DONE', label: 'Done', dotClass: 'bg-emerald-500' },
]

export const PRIORITY_META: Record<
  ExecTaskPriority,
  { label: string; badgeClass: string; dotClass: string }
> = {
  LOW: {
    label: 'Low',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-slate-400',
  },
  MEDIUM: {
    label: 'Medium',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    dotClass: 'bg-sky-500',
  },
  HIGH: {
    label: 'High',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dotClass: 'bg-amber-500',
  },
  URGENT: {
    label: 'Urgent',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dotClass: 'bg-rose-500',
  },
}

export function isImageAttachment(type?: string, name?: string): boolean {
  if (type && type.startsWith('image/')) return true
  if (name && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return true
  return false
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
}
