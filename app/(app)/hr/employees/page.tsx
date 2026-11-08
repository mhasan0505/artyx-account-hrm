import { EmployeesManagement } from "@/components/hr/employees-management";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getEmployees, getHrLookups } from "@/lib/actions/hr";
import Link from "next/link";

export default async function HrEmployeesPage() {
  const [employees, lookups] = await Promise.all([
    getEmployees(),
    getHrLookups(),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="HR Employees"
        description="Manage organization staff profiles, designations, and payroll links."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/users">Users & Roles</Link>
            </Button>
            <Button asChild>
              <Link href="/hr/payroll">Open Payroll</Link>
            </Button>
          </div>
        }
      />

      <EmployeesManagement initialEmployees={employees} lookups={lookups} />
    </div>
  );
}
