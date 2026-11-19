import { Metadata } from 'next'
import {
  getExecutiveMembers,
  requireExecutivePageAccess,
} from '@/lib/auth/executive-server'
import { getExecutiveTasks } from '@/lib/actions/executive-tasks'
import { PageHeader } from '@/components/page-header'
import { ExecutiveTasksClient } from '@/components/executive-tasks/ExecutiveTasksClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Executive Tasks | Artyx Digital Office',
  description:
    'Private leadership task workspace exclusively for Super Admin, CEO, COO, and CMO.',
}

export default async function ExecutiveTasksPage() {
  // Strictly enforce ONLY Super Admin, CEO, COO, and CMO
  const execUser = await requireExecutivePageAccess()

  const [tasksRes, members] = await Promise.all([
    getExecutiveTasks(),
    getExecutiveMembers(),
  ])

  const initialTasks = tasksRes.success ? tasksRes.data : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Tasks"
        description="Shared leadership workspace for Super Admin, CEO, COO, and CMO."
        customBreadcrumbLabel="Executive Tasks"
      />
      <ExecutiveTasksClient
        initialTasks={initialTasks}
        members={members}
        currentUserBadge={execUser.badge}
      />
    </div>
  )
}
