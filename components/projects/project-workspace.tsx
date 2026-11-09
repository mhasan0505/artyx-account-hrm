'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  createMilestone,
  createTask,
  deleteMilestone,
  moveTask,
  setMilestoneStatus,
  updateTask,
} from '@/lib/actions/agency-tasks'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskStatus } from '@prisma/client'
import { CheckSquare, Clock, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { toast } from 'sonner'
import { TaskDrawer } from './task-drawer'
import {
  PRIORITIES,
  STATUS_COLUMNS,
  dueState,
  initials,
  priorityMeta,
  type MemberOption,
  type TaskCardData,
} from './task-meta'

type MilestoneData = {
  id: string
  title: string
  description: string | null
  targetDate: Date | string | null
  status: string
  isBilled: boolean
  billableAmount: number | null
  taskCount: number
  doneCount: number
}

type Props = {
  projectId: string
  tasks: TaskCardData[]
  milestones: MilestoneData[]
  members: MemberOption[]
  stats: {
    laborCost: number
    loggedHours: number
    invoiced: number
    margin: number
  }
  contractValue: number
}

const TABS = ['Board', 'List', 'Milestones', 'Time & Margin'] as const
type Tab = (typeof TABS)[number]
const money = (n: number) => `৳${Math.round(n).toLocaleString()}`

export function ProjectWorkspace({
  projectId,
  tasks: initialTasks,
  milestones,
  members,
  stats,
  contractValue,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = React.useState<Tab>('Board')
  const [tasks, setTasks] = React.useState(initialTasks)
  const [openId, setOpenId] = React.useState<string | null>(null)

  React.useEffect(() => setTasks(initialTasks), [initialTasks])

  const msOptions = milestones.map(m => ({ id: m.id, title: m.title }))

  async function quickCreate(title: string, status: TaskStatus) {
    try {
      await createTask({ projectId, title, status })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create task')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Board' && (
        <Board
          tasks={tasks}
          setTasks={setTasks}
          onOpen={setOpenId}
          onCreate={quickCreate}
        />
      )}
      {tab === 'List' && (
        <ListView
          tasks={tasks}
          members={members}
          onOpen={setOpenId}
          onCreate={quickCreate}
        />
      )}
      {tab === 'Milestones' && (
        <Milestones projectId={projectId} milestones={milestones} />
      )}
      {tab === 'Time & Margin' && (
        <TimeMargin stats={stats} contractValue={contractValue} tasks={tasks} />
      )}

      <TaskDrawer
        taskId={openId}
        members={members}
        milestones={msOptions}
        onClose={() => setOpenId(null)}
      />
    </div>
  )
}

// ───────────────────────── Board ─────────────────────────

function Board({
  tasks,
  setTasks,
  onOpen,
  onCreate,
}: {
  tasks: TaskCardData[]
  setTasks: React.Dispatch<React.SetStateAction<TaskCardData[]>>
  onOpen: (id: string) => void
  onCreate: (title: string, status: TaskStatus) => void
}) {
  const router = useRouter()
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const active = tasks.find(t => t.id === activeId) ?? null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const dragged = tasks.find(t => t.id === active.id)
    if (!dragged) return

    const overId = String(over.id)
    const overTask = tasks.find(t => t.id === overId)
    const targetStatus = (overTask ? overTask.status : overId) as TaskStatus
    if (!STATUS_COLUMNS.some(c => c.value === targetStatus)) return

    const column = tasks.filter(
      t => t.status === targetStatus && t.id !== dragged.id
    )
    const position = overTask
      ? Math.max(
          0,
          column.findIndex(t => t.id === overTask.id)
        )
      : column.length
    if (dragged.status === targetStatus && overTask?.id === dragged.id) return

    const snapshot = tasks
    const rest = tasks.filter(t => t.id !== dragged.id)
    const targetIds = rest.filter(t => t.status === targetStatus)
    const before = targetIds[position]
    const moved = { ...dragged, status: targetStatus }
    const next = before
      ? [
          ...rest.slice(0, rest.indexOf(before)),
          moved,
          ...rest.slice(rest.indexOf(before)),
        ]
      : [...rest, moved]
    setTasks(next)

    try {
      await moveTask(dragged.id, targetStatus, position)
      router.refresh()
    } catch (err) {
      setTasks(snapshot)
      toast.error(err instanceof Error ? err.message : 'Failed to move task')
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STATUS_COLUMNS.map(col => (
          <Column
            key={col.value}
            col={col}
            tasks={tasks.filter(t => t.status === col.value)}
            onOpen={onOpen}
            onCreate={onCreate}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? <TaskCard task={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  col,
  tasks,
  onOpen,
  onCreate,
}: {
  col: (typeof STATUS_COLUMNS)[number]
  tasks: TaskCardData[]
  onOpen: (id: string) => void
  onCreate: (title: string, status: TaskStatus) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.value })
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState('')

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 p-2.5 transition-colors ${
        isOver ? 'border-primary' : 'border-border'
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${col.dot}`} />
          <span className="text-xs font-bold uppercase tracking-wide text-foreground">
            {col.label}
          </span>
          <span className="rounded-md bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <button
          type="button"
          aria-label={`Add task to ${col.label}`}
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <SortableContext
        items={tasks.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-12 flex-col gap-2">
          {tasks.map(t => (
            <SortableCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>

      {adding && (
        <form
          className="mt-2"
          onSubmit={e => {
            e.preventDefault()
            if (title.trim()) onCreate(title, col.value)
            setTitle('')
            setAdding(false)
          }}
        >
          <Input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)}
            onKeyDown={e => e.key === 'Escape' && setAdding(false)}
            placeholder="Task title, then Enter"
            className="h-8 text-xs"
          />
        </form>
      )}
    </div>
  )
}

function SortableCard({
  task,
  onOpen,
}: {
  task: TaskCardData
  onOpen: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  )
}

function TaskCard({
  task,
  onOpen,
  overlay,
}: {
  task: TaskCardData
  onOpen?: (id: string) => void
  overlay?: boolean
}) {
  const p = priorityMeta(task.priority)
  const due = dueState(task.dueDate, task.status)
  return (
    <div
      onClick={() => onOpen?.(task.id)}
      className={`cursor-grab rounded-lg border border-border bg-card p-3 text-left shadow-2xs transition-shadow hover:shadow-md ${
        overlay ? 'rotate-2 shadow-xl' : ''
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {task.taskCode}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${p.cls}`}
        >
          {p.label}
        </span>
      </div>
      <p className="text-sm font-semibold leading-snug text-foreground">
        {task.title}
      </p>
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2.5">
          {task.checklistTotal > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="size-3" />
              {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.loggedHours > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {task.loggedHours.toFixed(1)}h
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {task.commentCount}
            </span>
          )}
          {task.dueDate && (
            <span
              className={
                due === 'overdue'
                  ? 'font-semibold text-rose-600 dark:text-rose-400'
                  : due === 'today'
                    ? 'font-semibold text-amber-600 dark:text-amber-400'
                    : ''
              }
            >
              {new Date(task.dueDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
        {task.assignee && (
          <span
            title={task.assignee.name}
            className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary"
          >
            {initials(task.assignee.name)}
          </span>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── List ─────────────────────────

function ListView({
  tasks,
  members,
  onOpen,
  onCreate,
}: {
  tasks: TaskCardData[]
  members: MemberOption[]
  onOpen: (id: string) => void
  onCreate: (title: string, status: TaskStatus) => void
}) {
  const router = useRouter()
  const [filterAssignee, setFilterAssignee] = React.useState('')
  const [title, setTitle] = React.useState('')

  const rows = tasks.filter(
    t => !filterAssignee || t.assignee?.id === filterAssignee
  )

  async function inline(id: string, input: Parameters<typeof updateTask>[1]) {
    try {
      await updateTask(id, input)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const sel = 'h-7 rounded-md border border-border bg-background px-1.5 text-xs'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (title.trim()) onCreate(title, 'TODO')
            setTitle('')
          }}
        >
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Add a task and press Enter…"
            className="h-9 max-w-md text-sm"
          />
        </form>
        <select
          className={sel}
          value={filterAssignee}
          onChange={e => setFilterAssignee(e.target.value)}
          aria-label="Filter by assignee"
        >
          <option value="">All assignees</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Assignee</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2 text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No tasks yet.
                </td>
              </tr>
            )}
            {rows.map(t => (
              <tr
                key={t.id}
                className="border-t border-border hover:bg-muted/30"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className="text-left font-semibold text-foreground hover:underline"
                  >
                    {t.title}
                  </button>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {t.taskCode}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={sel}
                    value={t.status}
                    onChange={e =>
                      inline(t.id, { status: e.target.value as TaskStatus })
                    }
                  >
                    {STATUS_COLUMNS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={sel}
                    value={t.priority}
                    onChange={e =>
                      inline(t.id, {
                        priority: e.target.value as TaskCardData['priority'],
                      })
                    }
                  >
                    {PRIORITIES.map(p => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={sel}
                    value={t.assignee?.id ?? ''}
                    onChange={e =>
                      inline(t.id, { assigneeId: e.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    className={sel}
                    defaultValue={
                      t.dueDate
                        ? new Date(t.dueDate).toISOString().slice(0, 10)
                        : ''
                    }
                    onChange={e =>
                      inline(t.id, { dueDate: e.target.value || null })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {t.loggedHours.toFixed(1)}
                  {t.estimatedHours ? ` / ${t.estimatedHours}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ───────────────────────── Milestones ─────────────────────────

function Milestones({
  projectId,
  milestones,
}: {
  projectId: string
  milestones: MilestoneData[]
}) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState('')
  const [amount, setAmount] = React.useState('')

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3"
        onSubmit={e => {
          e.preventDefault()
          run(async () => {
            await createMilestone({
              projectId,
              title,
              targetDate: date || null,
              billableAmount: amount ? Number(amount) : null,
            })
            setTitle('')
            setDate('')
            setAmount('')
          })
        }}
      >
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Milestone title"
          className="h-9 w-64 text-sm"
        />
        <Input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-9 w-40 text-sm"
          aria-label="Target date"
        />
        <Input
          type="number"
          min="0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="Billable ৳"
          className="h-9 w-36 text-sm"
        />
        <Button type="submit" size="sm" className="h-9">
          Add milestone
        </Button>
      </form>

      {milestones.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No milestones yet.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {milestones.map(m => {
          const pct = m.taskCount
            ? Math.round((m.doneCount / m.taskCount) * 100)
            : 0
          return (
            <Card key={m.id} className="rounded-xl border-border">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-foreground">{m.title}</h4>
                    <p className="text-xs text-muted-foreground">
                      {m.targetDate
                        ? `Target ${new Date(m.targetDate).toLocaleDateString()}`
                        : 'No target date'}
                      {m.billableAmount ? ` · ${money(m.billableAmount)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete milestone"
                    onClick={() => run(() => deleteMilestone(m.id))}
                    className="text-muted-foreground hover:text-rose-500"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>
                      {m.doneCount}/{m.taskCount} tasks
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <select
                    value={m.status}
                    onChange={e =>
                      run(() =>
                        setMilestoneStatus(
                          m.id,
                          e.target.value as
                            | 'PLANNED'
                            | 'IN_PROGRESS'
                            | 'COMPLETED'
                        )
                      )
                    }
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                  >
                    <option value="PLANNED">Planned</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                  {m.status === 'COMPLETED' && !m.isBilled && (
                    <a
                      href={`/invoices/new?projectId=${projectId}`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Create invoice →
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────── Time & Margin ─────────────────────────

function TimeMargin({
  stats,
  contractValue,
  tasks,
}: {
  stats: Props['stats']
  contractValue: number
  tasks: TaskCardData[]
}) {
  const tiles = [
    { label: 'Contract value', value: money(contractValue) },
    { label: 'Hours logged', value: `${stats.loggedHours.toFixed(1)}h` },
    { label: 'Labor cost', value: money(stats.laborCost) },
    { label: 'Gross margin', value: `${stats.margin.toFixed(1)}%` },
  ]
  const byPerson = new Map<string, number>()
  tasks.forEach(
    t =>
      t.assignee &&
      byPerson.set(
        t.assignee.name,
        (byPerson.get(t.assignee.name) ?? 0) + t.loggedHours
      )
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(t => (
          <Card key={t.label} className="rounded-xl border-border">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-muted-foreground">
                {t.label}
              </p>
              <p className="mt-1 font-mono text-xl font-bold text-foreground">
                {t.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Labor cost = logged hours × the logger&apos;s hourly cost (monthly basic
        salary ÷ 176h). Hours from users without a linked employee profile count
        as ৳0 cost.
      </p>
      {byPerson.size > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-2 text-sm font-bold">Hours by assignee</h4>
          {[...byPerson.entries()].map(([name, h]) => (
            <div
              key={name}
              className="flex justify-between border-t border-border py-1.5 text-sm first:border-0"
            >
              <span>{name}</span>
              <span className="font-mono">{h.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
