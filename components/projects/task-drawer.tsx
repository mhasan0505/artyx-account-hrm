'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  addChecklistItem,
  addTaskComment,
  deleteChecklistItem,
  deleteTask,
  getTaskDetail,
  logTaskTime,
  toggleChecklistItem,
  updateTask,
  type UpdateTaskInput,
} from '@/lib/actions/agency-tasks'
import { Clock, Plus, Send, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'
import {
  PRIORITIES,
  STATUS_COLUMNS,
  type MemberOption,
  type MilestoneOption,
} from './task-meta'

type Detail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>

const selectCls =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'

const toDateInput = (d: Date | string | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

export function TaskDrawer({
  taskId,
  members,
  milestones,
  onClose,
}: {
  taskId: string | null
  members: MemberOption[]
  milestones: MilestoneOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [task, setTask] = React.useState<Detail | null>(null)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [newItem, setNewItem] = React.useState('')
  const [hours, setHours] = React.useState('')
  const [timeNote, setTimeNote] = React.useState('')
  const [comment, setComment] = React.useState('')

  const load = React.useCallback(async (id: string) => {
    const d = await getTaskDetail(id)
    setTask(d)
    setTitle(d?.title ?? '')
    setDescription(d?.description ?? '')
  }, [])

  React.useEffect(() => {
    if (taskId) {
      setTask(null)
      load(taskId).catch(() => toast.error('Failed to load task'))
    }
  }, [taskId, load])

  async function run<T>(fn: () => Promise<T>, after?: () => void) {
    try {
      await fn()
      if (taskId) await load(taskId)
      router.refresh()
      after?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  const patch = (input: UpdateTaskInput) =>
    run(() => updateTask(task!.id, input))

  const done = task?.checklists.filter(c => c.isCompleted).length ?? 0
  const total = task?.checklists.length ?? 0
  const logged = task?.timeLogs.reduce((s, l) => s + l.hours, 0) ?? 0

  return (
    <Sheet open={!!taskId} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        <SheetHeader className="border-b border-border p-5">
          <SheetDescription className="font-mono text-[11px] text-muted-foreground">
            {task?.taskCode ?? 'Loading…'}
          </SheetDescription>
          <SheetTitle className="sr-only">Task details</SheetTitle>
          {task && (
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() =>
                title.trim() && title !== task.title && patch({ title })
              }
              className="h-auto border-0 bg-transparent px-0 text-lg font-bold shadow-none focus-visible:ring-0"
            />
          )}
        </SheetHeader>

        {!task ? (
          <div className="p-5 text-sm text-muted-foreground">Loading task…</div>
        ) : (
          <div className="space-y-6 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <select
                  className={selectCls}
                  value={task.status}
                  onChange={e =>
                    patch({ status: e.target.value as Detail['status'] })
                  }
                >
                  {STATUS_COLUMNS.map(s => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  className={selectCls}
                  value={task.priority}
                  onChange={e =>
                    patch({ priority: e.target.value as Detail['priority'] })
                  }
                >
                  {PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Assignee">
                <select
                  className={selectCls}
                  value={task.assigneeId ?? ''}
                  onChange={e => patch({ assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Milestone">
                <select
                  className={selectCls}
                  value={task.milestoneId ?? ''}
                  onChange={e => patch({ milestoneId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {milestones.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due date">
                <Input
                  type="date"
                  className="h-9 text-xs"
                  defaultValue={toDateInput(task.dueDate)}
                  onChange={e => patch({ dueDate: e.target.value || null })}
                />
              </Field>
              <Field label="Estimate (hours)">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  className="h-9 text-xs"
                  defaultValue={task.estimatedHours ?? ''}
                  onBlur={e =>
                    patch({
                      estimatedHours: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() =>
                  description !== (task.description ?? '') &&
                  patch({ description })
                }
                placeholder="Requirements, acceptance criteria, links…"
                className="min-h-24 text-sm"
              />
            </Field>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Checklist {total > 0 && `· ${done}/${total}`}
              </h3>
              {task.checklists.map(c => (
                <div key={c.id} className="group flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.isCompleted}
                    onChange={e =>
                      run(() => toggleChecklistItem(c.id, e.target.checked))
                    }
                    className="size-4 accent-primary"
                  />
                  <span
                    className={
                      c.isCompleted
                        ? 'flex-1 text-sm text-muted-foreground line-through'
                        : 'flex-1 text-sm'
                    }
                  >
                    {c.title}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete checklist item"
                    onClick={() => run(() => deleteChecklistItem(c.id))}
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  if (newItem.trim())
                    run(
                      () => addChecklistItem(task.id, newItem),
                      () => setNewItem('')
                    )
                }}
              >
                <Input
                  value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  placeholder="Add item…"
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-8"
                >
                  <Plus className="size-3.5" />
                </Button>
              </form>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Time tracked · {logged.toFixed(1)}h
                {task.estimatedHours ? ` / ${task.estimatedHours}h` : ''}
              </h3>
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  const h = Number(hours)
                  if (!h) return toast.error('Enter hours')
                  run(
                    () => logTaskTime(task.id, h, timeNote),
                    () => {
                      setHours('')
                      setTimeNote('')
                    }
                  )
                }}
              >
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={hours}
                  onChange={e => setHours(e.target.value)}
                  placeholder="Hrs"
                  className="h-8 w-20 text-xs"
                />
                <Input
                  value={timeNote}
                  onChange={e => setTimeNote(e.target.value)}
                  placeholder="What did you do?"
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-8"
                >
                  <Clock className="size-3.5" />
                </Button>
              </form>
              {task.timeLogs.map(l => (
                <p key={l.id} className="text-xs text-muted-foreground">
                  <span className="font-mono font-semibold text-foreground">
                    {l.hours}h
                  </span>{' '}
                  · {l.userName}
                  {l.notes ? ` — ${l.notes}` : ''} ·{' '}
                  {new Date(l.logDate).toLocaleDateString()}
                </p>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Comments
              </h3>
              {task.comments.map(c => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border bg-muted/40 p-2.5"
                >
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {c.userName}
                    </span>{' '}
                    · {new Date(c.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {c.content}
                  </p>
                </div>
              ))}
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  if (comment.trim())
                    run(
                      () => addTaskComment(task.id, comment),
                      () => setComment('')
                    )
                }}
              >
                <Input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Write a comment…"
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-8"
                >
                  <Send className="size-3.5" />
                </Button>
              </form>
            </section>

            <div className="border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                onClick={() => {
                  if (!confirm('Delete this task permanently?')) return
                  run(() => deleteTask(task.id), onClose)
                }}
              >
                <Trash2 className="mr-1.5 size-3.5" /> Delete task
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
