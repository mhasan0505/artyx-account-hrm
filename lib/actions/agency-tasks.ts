'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'

const WORK_HOURS_PER_MONTH = 176

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session.user
}

function refresh(projectId?: string) {
  revalidatePath('/projects')
  revalidatePath('/projects/my-tasks')
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

async function nextTaskCode(projectId: string) {
  const project = await prisma.agencyProject.findUniqueOrThrow({
    where: { id: projectId },
    select: { projectCode: true },
  })
  const count = await prisma.projectTask.count({ where: { projectId } })
  let n = count + 1
  // Guard against gaps after deletions
  for (;;) {
    const code = `${project.projectCode}-T${String(n).padStart(2, '0')}`
    const exists = await prisma.projectTask.findUnique({ where: { taskCode: code } })
    if (!exists) return code
    n++
  }
}

// ─────────────── Queries ───────────────

export async function getProjectWorkspace(projectId: string) {
  await requireUser()
  const project = await prisma.agencyProject.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true, companyName: true, clientCode: true } },
      milestones: { orderBy: { targetDate: 'asc' } },
      tasks: {
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        include: {
          assignee: { select: { id: true, name: true, image: true } },
          checklists: { select: { id: true, isCompleted: true } },
          timeLogs: { select: { hours: true, hourlyRate: true } },
          _count: { select: { comments: true } },
        },
      },
      invoices: { select: { totalAmount: true, paidAmount: true } },
    },
  })
  if (!project) return null

  const toNum = (v: Prisma.Decimal | null | undefined) => (v ? Number(v) : 0)

  const tasks = project.tasks.map(t => ({
    id: t.id,
    taskCode: t.taskCode,
    title: t.title,
    status: t.status,
    priority: t.priority,
    milestoneId: t.milestoneId,
    dueDate: t.dueDate,
    estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
    assignee: t.assignee,
    checklistTotal: t.checklists.length,
    checklistDone: t.checklists.filter(c => c.isCompleted).length,
    loggedHours: t.timeLogs.reduce((s, l) => s + toNum(l.hours), 0),
    commentCount: t._count.comments,
  }))

  const laborCost = project.tasks.reduce(
    (s, t) => s + t.timeLogs.reduce((x, l) => x + toNum(l.hours) * toNum(l.hourlyRate), 0),
    0
  )
  const contractValue = Number(project.contractValue)
  const invoiced = project.invoices.reduce((s, i) => s + Number(i.totalAmount), 0)

  return {
    project: {
      id: project.id,
      projectCode: project.projectCode,
      name: project.name,
      status: project.status,
      serviceCategory: project.serviceCategory,
      contractValue,
      targetEndDate: project.targetEndDate,
      client: project.client,
    },
    milestones: project.milestones.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetDate: m.targetDate,
      status: m.status,
      isBilled: m.isBilled,
      billableAmount: m.billableAmount ? Number(m.billableAmount) : null,
      taskCount: tasks.filter(t => t.milestoneId === m.id).length,
      doneCount: tasks.filter(t => t.milestoneId === m.id && t.status === 'DONE').length,
    })),
    tasks,
    stats: {
      laborCost,
      loggedHours: tasks.reduce((s, t) => s + t.loggedHours, 0),
      invoiced,
      margin: contractValue > 0 ? ((contractValue - laborCost) / contractValue) * 100 : 0,
    },
  }
}

export async function getTaskDetail(taskId: string) {
  await requireUser()
  const t = await prisma.projectTask.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: { id: true, name: true } },
      checklists: { orderBy: { orderIndex: 'asc' } },
      timeLogs: {
        orderBy: { logDate: 'desc' },
        include: { user: { select: { name: true } } },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { name: true } } },
      },
    },
  })
  if (!t) return null
  return {
    id: t.id,
    taskCode: t.taskCode,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    milestoneId: t.milestoneId,
    assigneeId: t.assigneeId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
    checklists: t.checklists.map(c => ({ id: c.id, title: c.title, isCompleted: c.isCompleted })),
    timeLogs: t.timeLogs.map(l => ({
      id: l.id,
      hours: Number(l.hours),
      notes: l.notes,
      logDate: l.logDate,
      userName: l.user.name,
    })),
    comments: t.comments.map(c => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      userName: c.user.name,
    })),
  }
}

export async function getTeamMembers() {
  await requireUser()
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export async function getMyTasks() {
  const user = await requireUser()
  return prisma.projectTask.findMany({
    where: { assigneeId: user.id, status: { not: 'DONE' } },
    orderBy: [{ dueDate: 'asc' }, { priority: 'asc' }],
    select: {
      id: true,
      taskCode: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { id: true, name: true, client: { select: { companyName: true } } } },
    },
  })
}

// ─────────────── Task mutations ───────────────

export type CreateTaskInput = {
  projectId: string
  title: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: string | null
  milestoneId?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
}

export async function createTask(input: CreateTaskInput) {
  const user = await requireUser()
  const title = input.title.trim()
  if (!title) throw new Error('Task title is required')

  const status = input.status ?? 'TODO'
  const last = await prisma.projectTask.findFirst({
    where: { projectId: input.projectId, status },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  })

  const task = await prisma.projectTask.create({
    data: {
      taskCode: await nextTaskCode(input.projectId),
      projectId: input.projectId,
      title,
      status,
      priority: input.priority ?? 'NORMAL',
      assigneeId: input.assigneeId || null,
      milestoneId: input.milestoneId || null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      estimatedHours: input.estimatedHours ?? null,
      creatorId: user.id,
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  })
  refresh(input.projectId)
  return { success: true as const, id: task.id }
}

export type UpdateTaskInput = {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: string | null
  milestoneId?: string | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  await requireUser()
  const data: Prisma.ProjectTaskUncheckedUpdateInput = {}
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error('Task title is required')
    data.title = input.title.trim()
  }
  if (input.description !== undefined) data.description = input.description
  if (input.status !== undefined) data.status = input.status
  if (input.priority !== undefined) data.priority = input.priority
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId || null
  if (input.milestoneId !== undefined) data.milestoneId = input.milestoneId || null
  if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null
  if (input.estimatedHours !== undefined) data.estimatedHours = input.estimatedHours

  const task = await prisma.projectTask.update({ where: { id: taskId }, data })
  refresh(task.projectId)
  return { success: true as const }
}

/** Drag-and-drop: move a task to a column at a given position and re-index that column. */
export async function moveTask(taskId: string, status: TaskStatus, position: number) {
  await requireUser()
  const task = await prisma.projectTask.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true },
  })

  const column = await prisma.projectTask.findMany({
    where: { projectId: task.projectId, status, id: { not: taskId } },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  const ids = column.map(c => c.id)
  ids.splice(Math.max(0, Math.min(position, ids.length)), 0, taskId)

  await prisma.$transaction([
    prisma.projectTask.update({ where: { id: taskId }, data: { status } }),
    ...ids.map((id, index) =>
      prisma.projectTask.update({ where: { id }, data: { orderIndex: index } })
    ),
  ])
  refresh(task.projectId)
  return { success: true as const }
}

export async function deleteTask(taskId: string) {
  await requireUser()
  const task = await prisma.projectTask.delete({ where: { id: taskId } })
  refresh(task.projectId)
  return { success: true as const }
}

// ─────────────── Checklist ───────────────

export async function addChecklistItem(taskId: string, title: string) {
  await requireUser()
  if (!title.trim()) throw new Error('Checklist item is required')
  const count = await prisma.taskChecklistItem.count({ where: { taskId } })
  await prisma.taskChecklistItem.create({
    data: { taskId, title: title.trim(), orderIndex: count },
  })
  return { success: true as const }
}

export async function toggleChecklistItem(itemId: string, isCompleted: boolean) {
  await requireUser()
  const item = await prisma.taskChecklistItem.update({
    where: { id: itemId },
    data: { isCompleted },
    include: { task: { select: { projectId: true } } },
  })
  refresh(item.task.projectId)
  return { success: true as const }
}

export async function deleteChecklistItem(itemId: string) {
  await requireUser()
  await prisma.taskChecklistItem.delete({ where: { id: itemId } })
  return { success: true as const }
}

// ─────────────── Time tracking ───────────────

export async function logTaskTime(taskId: string, hours: number, notes?: string) {
  const user = await requireUser()
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error('Hours must be between 0 and 24')
  }

  // Cost rate is derived from the linked employee's monthly basic salary.
  const employee = await prisma.employee.findUnique({
    where: { userId: user.id },
    select: { basicSalary: true },
  })
  const hourlyRate = employee
    ? Math.round((Number(employee.basicSalary) / WORK_HOURS_PER_MONTH) * 100) / 100
    : null

  const task = await prisma.projectTask.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true },
  })
  await prisma.taskTimeLog.create({
    data: { taskId, userId: user.id, hours, hourlyRate, notes: notes?.trim() || null },
  })
  refresh(task.projectId)
  return { success: true as const, hourlyRate }
}

export async function addTaskComment(taskId: string, content: string) {
  const user = await requireUser()
  if (!content.trim()) throw new Error('Comment cannot be empty')
  const task = await prisma.projectTask.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true },
  })
  await prisma.taskComment.create({ data: { taskId, userId: user.id, content: content.trim() } })
  refresh(task.projectId)
  return { success: true as const }
}

// ─────────────── Milestones ───────────────

export async function createMilestone(input: {
  projectId: string
  title: string
  targetDate?: string | null
  billableAmount?: number | null
  description?: string | null
}) {
  await requireUser()
  if (!input.title.trim()) throw new Error('Milestone title is required')
  await prisma.projectMilestone.create({
    data: {
      projectId: input.projectId,
      title: input.title.trim(),
      description: input.description || null,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      billableAmount: input.billableAmount ?? null,
    },
  })
  refresh(input.projectId)
  return { success: true as const }
}

export async function setMilestoneStatus(
  milestoneId: string,
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'
) {
  await requireUser()
  const m = await prisma.projectMilestone.update({
    where: { id: milestoneId },
    data: { status, completedDate: status === 'COMPLETED' ? new Date() : null },
  })
  refresh(m.projectId)
  return { success: true as const }
}

export async function deleteMilestone(milestoneId: string) {
  await requireUser()
  const m = await prisma.projectMilestone.delete({ where: { id: milestoneId } })
  refresh(m.projectId)
  return { success: true as const }
}
