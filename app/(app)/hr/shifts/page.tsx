import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function HrShiftsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Shifts & Timeclock" />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/hr/employees">Employees</Link>
          </Button>
          <Button asChild>
            <Link href="/hr/payroll">Payroll</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Shift scheduling and timeclock screens are ready for implementation.
          HR navigation now routes correctly to this page.
        </p>
      </div>
    </div>
  );
}
