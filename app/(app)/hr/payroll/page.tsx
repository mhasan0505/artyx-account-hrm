"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  getPayrolls,
  getPayslips,
  processMonthlyPayroll,
} from "@/lib/actions/payroll";
import { getBankAccounts } from "@/lib/actions/bank";
import { PayrollPaymentDialog } from "@/components/hr/payroll-payment-dialog";
import { EmployeeAdvanceDialog } from "@/components/hr/employee-advance-dialog";
import { PayrollAdjustmentDialog } from "@/components/hr/payroll-adjustment-dialog";
import { PayrollVoidDialog } from "@/components/hr/payroll-void-dialog";
import { DeletePayrollPeriodDialog } from "@/components/hr/delete-payroll-period-dialog";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { HandCoins, SlidersHorizontal, RotateCcw, Trash2 } from "lucide-react";

type PayrollRow = Awaited<ReturnType<typeof getPayrolls>>[number];
type PayslipRow = Awaited<ReturnType<typeof getPayslips>>[number];

function monthName(month: number) {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", {
    month: "long",
  });
}

export default function HrPayrollPage() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [outletId, setOutletId] = useState("");
  const [userRole, setUserRole] = useState<string>("");

  const [payrolls, setPayrolls] = useState<PayrollRow[]>([]);
  const [selectedPayrollId, setSelectedPayrollId] = useState<string | null>(
    null,
  );
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [paymentTarget, setPaymentTarget] = useState<PayslipRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<{
    entry: PayslipRow;
    payment: NonNullable<PayslipRow["payments"]>[number];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollRow | null>(null);

  const [isAdvanceOpen, setIsAdvanceOpen] = useState(false);
  const [adjustmentTarget, setAdjustmentTarget] = useState<PayslipRow | null>(null);

  const [isPending, startTransition] = useTransition();
  const [isPayslipPending, startPayslipTransition] = useTransition();

  // Only ADMIN / SUPER_ADMIN may run payroll, delete periods, or void payments.
  // HR / ACCOUNTANT / MANAGER get read-only payslip access.
  const isPayrollAdmin =
    userRole === "ADMIN" || userRole === "SUPER_ADMIN";

  const selectedPayroll = useMemo(
    () => payrolls.find((p) => p.id === selectedPayrollId) ?? null,
    [payrolls, selectedPayrollId],
  );

  function loadPayrolls(targetOutletId?: string) {
    const activeOid = targetOutletId || outletId;
    startTransition(async () => {
      try {
        const data = await getPayrolls(activeOid || undefined);
        setPayrolls(data);
      } catch (err: any) {
        toast.error(err?.message || "Failed to load payroll records");
      }
    });
  }

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        const userOid = s?.user?.outletId ?? "";
        const role = s?.user?.role ?? "";
        setOutletId(userOid);
        setUserRole(role);
        loadPayrolls(userOid);
      })
      .catch(() => {
        loadPayrolls();
      });

    getBankAccounts().then(setBankAccounts).catch(() => {});
  }, []);

  function handleProcessPayroll() {
    if (!outletId) {
      toast.error("No outlet assigned to your account");
      return;
    }

    startTransition(async () => {
      const res = await processMonthlyPayroll(month, year, outletId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success(`Payroll generated for ${monthName(month)} ${year}`);
      loadPayrolls();
    });
  }

  function handleViewPayslips(payrollId: string) {
    setSelectedPayrollId(payrollId);
    startPayslipTransition(async () => {
      try {
        const data = await getPayslips(payrollId);
        setPayslips(data);
      } catch (err: any) {
        toast.error(err?.message || "Failed to load payslips");
      }
    });
  }

  function handleMarkPaid(slip: PayslipRow) {
    setPaymentTarget(slip);
  }

  const totalNetSalary = payslips.reduce((s, p) => s + p.netSalary, 0);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Payroll" />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/hr/employees">Employees</Link>
          </Button>
          <Button onClick={() => loadPayrolls()} disabled={isPending} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-sm font-medium">Process Monthly Payroll</p>
        {!isPayrollAdmin && (
          <p className="mb-3 text-xs text-muted-foreground">
            Read-only view — only ADMIN or SUPER_ADMIN can run payroll, issue advances, adjust,
            void payments, or delete periods.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="month" className="text-xs text-muted-foreground">
              Month
            </label>
            <select
              id="month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={!isPayrollAdmin}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="year" className="text-xs text-muted-foreground">
              Year
            </label>
            <input
              id="year"
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 w-28 rounded-md border bg-background px-3 text-sm"
              disabled={!isPayrollAdmin}
            />
          </div>

          <Button onClick={handleProcessPayroll} disabled={isPending || !isPayrollAdmin}>
            {isPending ? "Processing..." : "Process Payroll"}
          </Button>

          {payslips.length > 0 && isPayrollAdmin && (
            <Button
              variant="outline"
              onClick={() => setIsAdvanceOpen(true)}
              className="gap-1.5"
            >
              <HandCoins className="w-4 h-4 text-emerald-600" /> Issue Salary Advance
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Period</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Payslips</th>
              <th className="px-4 py-2 text-right font-medium">Total Amount</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {payrolls.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No payroll records yet
                </td>
              </tr>
            )}

            {payrolls.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">
                  {monthName(p.month)} {p.year}
                </td>
                <td className="px-4 py-2">{p.status}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {p.payslipCount}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {p.totalAmount.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant={selectedPayrollId === p.id ? "default" : "outline"}
                      onClick={() => handleViewPayslips(p.id)}
                      disabled={isPayslipPending}
                    >
                      Payslips
                    </Button>
                    {isPayrollAdmin && p.canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(p)}
                        title="Delete this DRAFT/ACCRUED payroll period"
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPayroll && (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Payslips - {monthName(selectedPayroll.month)}{" "}
              {selectedPayroll.year}
            </p>
            <p className="text-sm text-muted-foreground">
              Total Net Salary:{" "}
              <span className="font-mono">
                {totalNetSalary.toLocaleString()}
              </span>
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Employee</th>
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-4 py-2 text-right font-medium">Gross</th>
                  <th className="px-4 py-2 text-right font-medium">Earnings</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Deductions
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Advance</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      {isPayslipPending
                        ? "Loading payslips..."
                        : "No payslips for this payroll"}
                    </td>
                  </tr>
                )}

                {payslips.map((slip) => (
                  <tr key={slip.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {slip.employee.name}
                    </td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">
                      {slip.employee.employeeCode}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {slip.grossSalary.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-green-600">
                      {slip.totalEarnings.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-600">
                      {slip.totalDeductions.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-rose-600">
                      {slip.advanceRecovered.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      {slip.netSalary.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {isPayrollAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-indigo-600 hover:text-indigo-800"
                            onClick={() => setAdjustmentTarget(slip)}
                            disabled={slip.isPaid}
                            title={
                              slip.isPaid
                                ? "Paid payslips are final — void the payment first"
                                : "Add post-accrual deduction or incentive adjustment"
                            }
                          >
                            <SlidersHorizontal className="w-3 h-3 mr-1" /> Adjust
                          </Button>
                        )}
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                          <Link href={`/hr/payroll/payslip/${slip.id}`} target="_blank">
                            Print
                          </Link>
                        </Button>
                        {isPayrollAdmin && !slip.isPaid ? (
                          <Button 
                            size="sm" 
                            className="h-7 px-2 text-xs"
                            onClick={() => handleMarkPaid(slip)}
                            disabled={isPending}
                          >
                            Pay
                          </Button>
                        ) : (
                          <span className="text-[10px] font-bold text-green-600 uppercase bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                            Paid
                          </span>
                        )}
                        {isPayrollAdmin &&
                          slip.payments.length > 0 &&
                          slip.payments.some((p) => !p.voidedAt) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() =>
                                setVoidTarget({
                                  entry: slip,
                                  payment: slip.payments.find((p) => !p.voidedAt)!,
                                })
                              }
                              title="Void the most recent non-voided payment and reverse ledger/bank/drawer"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" /> Void
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PayrollPaymentDialog
        isOpen={!!paymentTarget}
        onClose={() => setPaymentTarget(null)}
        payslip={paymentTarget}
        bankAccounts={bankAccounts}
        onSuccess={() => handleViewPayslips(selectedPayrollId!)}
      />

      {adjustmentTarget && (
        <PayrollAdjustmentDialog
          open={!!adjustmentTarget}
          onOpenChange={(open) => !open && setAdjustmentTarget(null)}
          payrollEntryId={adjustmentTarget.id}
          employeeName={adjustmentTarget.employee.name}
          currentNetPayable={adjustmentTarget.netSalary}
          onSuccess={() => handleViewPayslips(selectedPayrollId!)}
        />
      )}

      <PayrollVoidDialog
        open={!!voidTarget}
        onOpenChange={(open) => !open && setVoidTarget(null)}
        payment={voidTarget ? { ...voidTarget.payment } : null}
        employeeName={voidTarget ? voidTarget.entry.employee.name : ""}
        onSuccess={() => {
          if (selectedPayrollId) handleViewPayslips(selectedPayrollId);
        }}
      />

      <DeletePayrollPeriodDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        period={
          deleteTarget
            ? { id: deleteTarget.id, month: deleteTarget.month, year: deleteTarget.year, status: deleteTarget.status }
            : null
        }
        onSuccess={() => {
          loadPayrolls();
          setSelectedPayrollId(null);
        }}
      />

      {isAdvanceOpen && (
        <EmployeeAdvanceDialog
          open={isAdvanceOpen}
          onOpenChange={setIsAdvanceOpen}
          employees={payslips.map((s) => ({
            id: s.employeeId,
            name: s.employee.name,
            employeeCode: s.employee.employeeCode,
          }))}
          outletId={outletId}
          onSuccess={() => {
            if (selectedPayrollId) handleViewPayslips(selectedPayrollId);
          }}
        />
      )}
    </div>
  );
}
