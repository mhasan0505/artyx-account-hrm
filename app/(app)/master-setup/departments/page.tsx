import {
  createDepartmentAction,
  getDepartmentsList,
  updateDepartment,
} from '@/lib/actions/master-setup'
import { MasterEntityTable } from '@/components/master-setup/master-entity-table'

export default async function DepartmentsMasterPage() {
  const departments = await getDepartmentsList()

  const initialData = departments.map(d => ({
    id: d.id,
    name: d.name,
    usageCount: d._count.employees,
  }))

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <MasterEntityTable
        title="Departments"
        description="Organize company divisions, teams, and administrative branches."
        entityName="Department"
        usageLabel="employees"
        initialData={initialData}
        onAdd={async ({ name }) => {
          'use server'
          return createDepartmentAction(name)
        }}
        onRename={async (id, name) => {
          'use server'
          return updateDepartment(id, name)
        }}
      />
    </div>
  )
}
