'use client'

import React, { useState, useMemo } from 'react'
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Paperclip,
  MessageSquare,
  CheckSquare,
  Calendar,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PRIORITY_META,
  STATUS_COLUMNS,
  getInitials,
  isImageAttachment,
  type ExecTaskInput,
  type ExecTaskMember,
  type ExecTaskRecord,
  type ExecTaskStatus,
} from '@/lib/executive-tasks/types'
import {
  createExecutiveTask,
  deleteExecutiveTask,
  updateExecutiveTask,
  updateExecutiveTaskStatus,
} from '@/lib/actions/executive-tasks'
import { ExecutiveTaskModal } from './ExecutiveTaskModal'
import { toast } from 'sonner'

interface ExecutiveTasksClientProps {
  initialTasks: ExecTaskRecord[]
  members: ExecTaskMember[]
  currentUserBadge: string
}

export function ExecutiveTasksClient({
  initialTasks,
  members,
  currentUserBadge,
}: ExecutiveTasksClientProps) {
  const [tasks, setTasks] = useState<ExecTaskRecord[]>(initialTasks)
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<ExecTaskRecord | null>(null)
  const [defaultStatus, setDefaultStatus] = useState<ExecTaskStatus>('TODO')

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (assigneeFilter === 'UNASSIGNED' && t.assignee !== null) return false
      if (
        assigneeFilter !== 'ALL' &&
        assigneeFilter !== 'UNASSIGNED' &&
        t.assignee?.id !== assigneeFilter
      ) {
        return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const match =
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.assignee?.name.toLowerCase().includes(q) ||
          t.attachments.some((a) => a.name.toLowerCase().includes(q))
        if (!match) return false
      }
      return true
    })
  }, [tasks, search, assigneeFilter])

  const openCreateModal = (status: ExecTaskStatus = 'TODO') => {
    setSelectedTask(null)
    setDefaultStatus(status)
    setModalOpen(true)
  }

  const openEditModal = (task: ExecTaskRecord) => {
    setSelectedTask(task)
    setModalOpen(true)
  }

  const handleSaveTask = async (
    input: ExecTaskInput,
    existingId?: string
  ): Promise<boolean> => {
    if (existingId) {
      const res = await updateExecutiveTask(existingId, input)
      if (!res.success) {
        toast.error(res.error)
        return false
      }
      setTasks((prev) => prev.map((t) => (t.id === existingId ? res.data : t)))
      toast.success('Task updated.')
      return true
    }

    const res = await createExecutiveTask(input)
    if (!res.success) {
      toast.error(res.error)
      return false
    }
    setTasks((prev) => [res.data, ...prev])
    toast.success('Task created.')
    return true
  }

  const handleQuickStatusChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
    taskId: string
  ) => {
    e.stopPropagation()
    const nextStatus = e.target.value as ExecTaskStatus
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t))
    )
    const res = await updateExecutiveTaskStatus(taskId, nextStatus)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? res.data : t)))
  }

  const handleDeleteTask = async (id: string) => {
    const res = await deleteExecutiveTask(id)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    setTasks((prev) => prev.filter((t) => t.id !== id))
    toast.success('Task deleted.')
  }

  const formatDueDate = (iso: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    const isOverdue = d.getTime() < Date.now() - 86400000
    return {
      text: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      isOverdue,
    }
  }

  return (
    <div className="space-y-5">
      {/* Minimal Single-Row Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks or files..."
              className="w-full h-9 bg-card border border-border rounded-lg pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-9 bg-card border border-border rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All Leadership</option>
            <option value="UNASSIGNED">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.badge})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 justify-between sm:justify-end">
          <span className="hidden md:inline-flex text-[11px] font-medium px-2.5 py-1 rounded-md bg-muted/60 text-muted-foreground border border-border/70">
            Access: {currentUserBadge}
          </span>

          {/* Board / List Switcher */}
          <div className="flex items-center p-0.5 rounded-lg bg-muted/50 border border-border">
            <button
              onClick={() => setViewMode('board')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Board View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="List View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => openCreateModal('TODO')}
            className="h-9 text-xs font-semibold gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Task
          </Button>
        </div>
      </div>

      {/* BOARD VIEW */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {STATUS_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.value)
            return (
              <div
                key={col.value}
                className="rounded-xl bg-muted/25 border border-border/70 p-3 space-y-3 min-h-[260px]"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
                    <h3 className="text-xs font-semibold text-foreground">{col.label}</h3>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {colTasks.length}
                    </span>
                  </div>
                  <button
                    onClick={() => openCreateModal(col.value)}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title={`Add to ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Cards */}
                <div className="space-y-2.5">
                  {colTasks.length === 0 ? (
                    <div className="py-8 text-center text-[11px] text-muted-foreground/70">
                      No tasks
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const coverImg = task.attachments.find((a) =>
                        isImageAttachment(a.type, a.name)
                      )
                      const prio = PRIORITY_META[task.priority]
                      const due = formatDueDate(task.dueDate)
                      const doneChecks = task.checklist.filter((c) => c.done).length

                      return (
                        <div
                          key={task.id}
                          onClick={() => openEditModal(task)}
                          className="rounded-xl bg-card border border-border hover:border-primary/40 transition-all p-3 space-y-2.5 cursor-pointer shadow-2xs group"
                        >
                          {/* Optional Clean Image Preview */}
                          {coverImg && (
                            <div className="rounded-lg overflow-hidden border border-border/60 aspect-[16/9] bg-muted/30">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={coverImg.url}
                                alt={coverImg.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          {/* Priority & Quick Move */}
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${prio.badgeClass}`}
                            >
                              {prio.label}
                            </span>

                            <select
                              value={task.status}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleQuickStatusChange(e, task.id)}
                              className="text-[10px] bg-transparent text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer"
                              title="Change status"
                            >
                              {STATUS_COLUMNS.map((s) => (
                                <option key={s.value} value={s.value} className="bg-popover text-popover-foreground">
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Title & Excerpt */}
                          <div>
                            <h4 className="text-xs font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
                              {task.title}
                            </h4>
                            {task.description && (
                              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                                {task.description}
                              </p>
                            )}
                          </div>

                          {/* Clean Meta Footer */}
                          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-2.5">
                              {task.attachments.length > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Paperclip className="w-3 h-3" />
                                  {task.attachments.length}
                                </span>
                              )}
                              {task.checklist.length > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <CheckSquare className="w-3 h-3" />
                                  {doneChecks}/{task.checklist.length}
                                </span>
                              )}
                              {task.comments.length > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  {task.comments.length}
                                </span>
                              )}
                              {due && (
                                <span
                                  className={`inline-flex items-center gap-1 ${
                                    due.isOverdue && task.status !== 'DONE'
                                      ? 'text-rose-500 font-medium'
                                      : ''
                                  }`}
                                >
                                  <Calendar className="w-3 h-3" />
                                  {due.text}
                                </span>
                              )}
                            </div>

                            {task.assignee && (
                              <span
                                title={`${task.assignee.name} (${task.assignee.badge})`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px] font-semibold"
                              >
                                {task.assignee.badge}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {filteredTasks.length === 0 ? (
            <div className="py-14 text-center text-xs text-muted-foreground">
              No tasks yet. Click &ldquo;New Task&rdquo; to create one.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filteredTasks.map((task) => {
                const prio = PRIORITY_META[task.priority]
                const due = formatDueDate(task.dueDate)
                const doneChecks = task.checklist.filter((c) => c.done).length
                const statusMeta = STATUS_COLUMNS.find((s) => s.value === task.status)

                return (
                  <div
                    key={task.id}
                    onClick={() => openEditModal(task)}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-muted/35 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta?.dotClass}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-[11px] text-muted-foreground pl-5 sm:pl-0">
                      {task.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="w-3 h-3" />
                          {task.attachments.length}
                        </span>
                      )}
                      {task.checklist.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <CheckSquare className="w-3 h-3" />
                          {doneChecks}/{task.checklist.length}
                        </span>
                      )}
                      {due && (
                        <span className={due.isOverdue && task.status !== 'DONE' ? 'text-rose-500 font-medium' : ''}>
                          {due.text}
                        </span>
                      )}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${prio.badgeClass}`}>
                        {prio.label}
                      </span>
                      {task.assignee && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px] font-semibold">
                          {getInitials(task.assignee.name)} · {task.assignee.badge}
                        </span>
                      )}
                      <select
                        value={task.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleQuickStatusChange(e, task.id)}
                        className="h-7 bg-background border border-input rounded-md px-2 text-[11px] text-foreground cursor-pointer"
                      >
                        {STATUS_COLUMNS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit / View Modal */}
      <ExecutiveTaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        task={selectedTask}
        defaultStatus={defaultStatus}
        members={members}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onTaskUpdated={(updated) => {
          setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
          setSelectedTask(updated)
        }}
      />
    </div>
  )
}
