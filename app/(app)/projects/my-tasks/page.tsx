import {
  dueState,
  priorityMeta,
  STATUS_COLUMNS,
} from '@/components/projects/task-meta'
import { getMyTasks } from '@/lib/actions/agency-tasks'
import Link from 'next/link'

// Artyx Project Management — My Tasks
export const dynamic = 'force-dynamic'

export default async function MyTasksPage() {
  const tasks = await getMyTasks()

  return (
    <div className="w-full min-w-0 space-y-5 p-3 sm:p-5 md:p-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          My Tasks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open tasks assigned to you across all client projects.
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing assigned to you. 🎉
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {tasks.map(t => {
            const p = priorityMeta(t.priority)
            const due = dueState(t.dueDate, t.status)
            const status = STATUS_COLUMNS.find(s => s.value === t.status)
            return (
              <Link
                key={t.id}
                href={`/projects/${t.project.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${p.cls}`}
                >
                  {p.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {t.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.project.client.companyName} · {t.project.name} ·{' '}
                    {t.taskCode}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {status?.label}
                </span>
                {t.dueDate && (
                  <span
                    className={`text-xs ${
                      due === 'overdue'
                        ? 'font-semibold text-rose-600 dark:text-rose-400'
                        : due === 'today'
                          ? 'font-semibold text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {new Date(t.dueDate).toLocaleDateString()}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
