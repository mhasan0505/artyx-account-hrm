import { EmployeeLedgerView } from "@/components/hr/employee-ledger-view";
import { getEmployeeLedger } from "@/lib/actions/employee-ledger";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

export default async function EmployeeLedgerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
  });

  if (!employee) notFound();

  const ledger = await getEmployeeLedger(params.id);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <EmployeeLedgerView employee={employee} ledger={ledger} />
    </div>
  );
}
