import { ProjectWorkspace } from '@/components/projects/project-workspace'
import { Badge } from '@/components/ui/badge'
import { getProjectWorkspace, getTeamMembers } from '@/lib/actions/agency-tasks'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [ws, members] = await Promise.all([
    getProjectWorkspace(id),
    getTeamMembers(),
  ])
  if (!ws) notFound()

  const { project } = ws
  return (
    <div className="w-full min-w-0 space-y-5 p-3 sm:p-5 md:p-6">
      <div className="flex items-start gap-3 border-b border-border pb-4">
        <Link
          href="/projects"
          aria-label="Back to projects"
          className="mt-1 flex size-9 items-center justify-center rounded-md border border-border hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              {project.name}
            </h1>
            <Badge variant="outline" className="font-mono text-[10px]">
              {project.projectCode}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {project.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link
              href={`/clients/${project.client.id}`}
              className="font-medium hover:underline"
            >
              {project.client.companyName}
            </Link>
            {' · '}
            {project.serviceCategory}
            {project.targetEndDate &&
              ` · Due ${new Date(project.targetEndDate).toLocaleDateString()}`}
          </p>
        </div>
      </div>

      <ProjectWorkspace
        projectId={project.id}
        tasks={ws.tasks}
        milestones={ws.milestones}
        members={members}
        stats={ws.stats}
        contractValue={project.contractValue}
      />
    </div>
  )
}
