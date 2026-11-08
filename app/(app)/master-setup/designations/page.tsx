import {
  createDesignationAction,
  getDepartmentsList,
  getDesignationsList,
  updateDesignation,
} from '@/lib/actions/master-setup'
import { MasterEntityTable } from '@/components/master-setup/master-entity-table'

export default async function DesignationsMasterPage() {
  const [designations, departments] = await Promise.all([
    getDesignationsList(),
    getDepartmentsList(),
  ])

  const initialData = designations.map(d => ({
    id: d.id,
    name: d.name,
    usageCount: d._count.employees,
    subtitle: d.department.name,
    departmentId: d.department.id,
  }))

  const departmentsList = departments.map(d => ({
    id: d.id,
    name: d.name,
  }))

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <MasterEntityTable
        title="Designations"
        description="Manage job titles and roles assigned to staff members within each department."
        entityName="Designation"
        usageLabel="employees"
        initialData={initialData}
        departmentsList={departmentsList}
        onAdd={async ({ name, departmentId }) => {
          'use server'
          if (!departmentId) {
            return { success: false, error: 'Department is required' }
          }
          return createDesignationAction(name, departmentId)
        }}
        onRename={async (id, name, departmentId) => {
          'use server'
          return updateDesignation(id, name, departmentId)
        }}
      />
    </div>
  )
}
