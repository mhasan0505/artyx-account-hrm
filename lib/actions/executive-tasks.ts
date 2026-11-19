'use server'

import { ExecutiveTaskPriority, ExecutiveTaskStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { fail, ok, type ActionResult } from '@/lib/actions/result'
import {
  getCurrentExecutiveUser,
  getExecutiveMembers,
} from '@/lib/auth/executive-server'
import type {
  ExecTaskAttachment,
  ExecTaskChecklistItem,
  ExecTaskInput,
  ExecTaskPriority,
  ExecTaskRecord,
  ExecTaskStatus,
} from '@/lib/executive-tasks/types'

function parseJsonArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

async function buildBadgeLookup(): Promise<Map<string, string>> {
  const members = await getExecutiveMembers()
  return new Map(members.map((m) => [m.id, m.badge]))
}

function serializeTask(
  task: any,
  badgeMap: Map<string, string>
): ExecTaskRecord {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    status: task.status as ExecTaskStatus,
    priority: task.priority as ExecTaskPriority,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    tags: Array.isArray(task.tags) ? task.tags : [],
    attachments: parseJsonArray<ExecTaskAttachment>(task.attachments),
    checklist: parseJsonArray<ExecTaskChecklistItem>(task.checklist),
    createdBy: {
      id: task.createdBy.id,
      name: task.createdBy.name,
      image: task.createdBy.image ?? null,
      badge: badgeMap.get(task.createdBy.id) || task.createdBy.role,
    },
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name,
          image: task.assignee.image ?? null,
          badge: badgeMap.get(task.assignee.id) || task.assignee.role,
        }
      : null,
    updatedBy: task.updatedBy
      ? {
          id: task.updatedBy.id,
          name: task.updatedBy.name,
          badge: badgeMap.get(task.updatedBy.id) || task.updatedBy.role,
        }
      : null,
    comments: (task.comments || []).map((c: any) => ({
      id: c.id,
      content: c.content,
      attachments: parseJsonArray<ExecTaskAttachment>(c.attachments),
      createdAt: c.createdAt.toISOString(),
      user: {
        id: c.user.id,
        name: c.user.name,
        image: c.user.image ?? null,
        badge: badgeMap.get(c.user.id) || c.user.role,
      },
    })),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

const taskInclude = {
  createdBy: { select: { id: true, name: true, image: true, role: true } },
  assignee: { select: { id: true, name: true, image: true, role: true } },
  updatedBy: { select: { id: true, name: true, role: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      user: { select: { id: true, name: true, image: true, role: true } },
    },
  },
}

/**
 * Fetches all executive tasks (Super Admin, CEO, COO, CMO only).
 */
export async function getExecutiveTasks(): Promise<ActionResult<ExecTaskRecord[]>> {
  const exec = await getCurrentExecutiveUser()
  if (!exec) return fail('Unauthorized: Executive access required.')

  const [tasks, badgeMap] = await Promise.all([
    prisma.executiveTask.findMany({
      include: taskInclude,
      orderBy: [{ updatedAt: 'desc' }],
    }),
    buildBadgeLookup(),
  ])

  return ok(tasks.map((t) => serializeTask(t, badgeMap)))
}

/**
 * Creates a new executive task with optional file/image attachments and checklist.
 */
export async function createExecutiveTask(
  input: ExecTaskInput
): Promise<ActionResult<ExecTaskRecord>> {
  const exec = await getCurrentExecutiveUser()
  if (!exec) return fail('Unauthorized: Executive access required.')

  const title = input.title?.trim()
  if (!title) return fail('Task title is required.')

  const created = await prisma.executiveTask.create({
    data: {
      title,
      description: input.description?.trim() || null,
      status: (input.status as ExecutiveTaskStatus) || 'TODO',
      priority: (input.priority as ExecutiveTaskPriority) || 'MEDIUM',
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      tags: (input.tags || []).map((t) => t.trim()).filter(Boolean),
      assigneeId: input.assigneeId || null,
      attachments: (input.attachments || []) as any,
      checklist: (input.checklist || []) as any,
      createdById: exec.id,
      updatedById: exec.id,
    },
    include: taskInclude,
  })

  const badgeMap = await buildBadgeLookup()
  revalidatePath('/executive-tasks')
  return ok(serializeTask(created, badgeMap))
}

/**
 * Updates any field of an executive task (Super Admin, CEO, COO, CMO all have full edit access).
 */
export async function updateExecutiveTask(
  id: string,
  input: Partial<ExecTaskInput>
): Promise<ActionResult<ExecTaskRecord>> {
  const exec = await getCurrentExecutiveUser()
  if (!exec) return fail('Unauthorized: Executive access required.')

  const existing = await prisma.executiveTask.findUnique({ where: { id } })
  if (!existing) return fail('Task not found.')

  const data: Record<string, unknown> = {
    updatedById: exec.id,
  }

  if (input.title !== undefined) {
    const trimmed = input.title.trim()
    if (!trimmed) return fail('Task title cannot be empty.')
    data.title = trimmed
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null
  }
  if (input.status !== undefined) {
    data.status = input.status as ExecutiveTaskStatus
  }
  if (input.priority !== undefined) {
    data.priority = input.priority as ExecutiveTaskPriority
  }
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? new Date(input.dueDate) : null
  }
  if (input.tags !== undefined) {
    data.tags = input.tags.map((t) => t.trim()).filter(Boolean)
  }
  if (input.assigneeId !== undefined) {
    data.assigneeId = input.assigneeId || null
  }
  if (input.attachments !== undefined) {
    data.attachments = input.attachments as any
  }
  if (input.checklist !== undefined) {
    data.checklist = input.checklist as any
  }

  const updated = await prisma.executiveTask.update({
    where: { id },
    data,
    include: taskInclude,
  })

  const badgeMap = await buildBadgeLookup()
  revalidatePath('/executive-tasks')
  return ok(serializeTask(updated, badgeMap))
}

/**
 * Quick status change helper (board column move or list dropdown).
 */
export async function updateExecutiveTaskStatus(
  id: string,
  status: ExecTaskStatus
): Promise<ActionResult<ExecTaskRecord>> {
  return updateExecutiveTask(id, { status })
}

/**
 * Deletes an executive task.
 */
export async function deleteExecutiveTask(
  id: string
): Promise<ActionResult<{ deletedId: string }>> {
  const exec = await getCurrentExecutiveUser()
  if (!exec) return fail('Unauthorized: Executive access required.')

  const existing = await prisma.executiveTask.findUnique({ where: { id } })
  if (!existing) return fail('Task not found.')

  await prisma.executiveTask.delete({ where: { id } })
  revalidatePath('/executive-tasks')
  return ok({ deletedId: id })
}

/**
 * Adds a comment (with optional file/image attachments) to an executive task.
 */
export async function addExecutiveTaskComment(
  taskId: string,
  content: string,
  attachments: ExecTaskAttachment[] = []
): Promise<ActionResult<ExecTaskRecord>> {
  const exec = await getCurrentExecutiveUser()
  if (!exec) return fail('Unauthorized: Executive access required.')

  const text = content.trim()
  if (!text && attachments.length === 0) {
    return fail('Write a note or attach a file.')
  }

  await prisma.executiveTaskComment.create({
    data: {
      taskId,
      userId: exec.id,
      content: text,
      attachments: attachments as any,
    },
  })

  const updated = await prisma.executiveTask.update({
    where: { id: taskId },
    data: { updatedById: exec.id },
    include: taskInclude,
  })

  const badgeMap = await buildBadgeLookup()
  revalidatePath('/executive-tasks')
  return ok(serializeTask(updated, badgeMap))
}
