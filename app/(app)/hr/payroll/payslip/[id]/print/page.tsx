import { redirect } from "next/navigation";

export default async function PayslipPrintPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/hr/payroll/payslip/${params.id}`);
}
