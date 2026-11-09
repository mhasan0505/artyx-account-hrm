import type { TaskPriority, TaskStatus } from '@prisma/client'

export const STATUS_COLUMNS: Array<{
  value: TaskStatus
  label: string
  dot: string
}> = [
  { value: 'BACKLOG', label: 'Backlog', dot: 'bg-slate-400' },
  { value: 'TODO', label: 'To Do', dot: 'bg-sky-500' },
  { value: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-amber-500' },
  { value: 'IN_REVIEW', label: 'In Review / QA', dot: 'bg-violet-500' },
  { value: 'BLOCKED', label: 'Blocked', dot: 'bg-rose-500' },
  { value: 'DONE', label: 'Done', dot: 'bg-emerald-500' },
]

export const PRIORITIES: Array<{
  value: TaskPriority
  label: string
  cls: string
}> = [
  {
    value: 'URGENT',
    label: 'Urgent',
    cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  {
    value: 'HIGH',
    label: 'High',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  {
    value: 'NORMAL',
    label: 'Normal',
    cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  {
    value: 'LOW',
    label: 'Low',
    cls: 'bg-muted text-muted-foreground border-border',
  },
]

export type TaskCardData = {
  id: string
  taskCode: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  milestoneId: string | null
  dueDate: Date | string | null
  estimatedHours: number | null
  assignee: { id: string; name: string; image: string | null } | null
  checklistTotal: number
  checklistDone: number
  loggedHours: number
  commentCount: number
}

export type MemberOption = { id: string; name: string }
export type MilestoneOption = { id: string; title: string }

export function priorityMeta(p: TaskPriority) {
  return PRIORITIES.find(x => x.value === p) ?? PRIORITIES[2]
}

export function dueState(due: Date | string | null, status: TaskStatus) {
  if (!due || status === 'DONE') return null
  const d = new Date(due)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000)
  if (diff < 0) return 'overdue' as const
  if (diff === 0) return 'today' as const
  return 'upcoming' as const
}

export function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
