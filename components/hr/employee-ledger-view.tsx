"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import Link from "next/link";
import { Printer } from "lucide-react";

type Props = {
  employee: any;
  ledger: {
    entries: any[];
    payments: any[];
    advances: any[];
    adjustments: any[];
  };
};

export function EmployeeLedgerView({ employee, ledger }: Props) {
  const totalNetPayable = ledger.entries.reduce((sum, e) => sum + Number(e.netPayable), 0);
  const totalPaid = ledger.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const outstandingBalance = totalNetPayable - totalPaid;

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-primary/20 bg-primary/10 text-primary text-sm">
        <div>
          <p className="font-semibold">Accrual Employee Ledger (Read-Only View)</p>
          <p className="text-xs mt-0.5">
            This ledger displays historical records from the Accrual Payroll Engine. All new monthly payroll accruals, salary disbursements, and post-accrual corrections are managed via the{" "}
            <Link href="/hr/payroll" className="font-bold underline">
              Payroll Module
            </Link>.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={`Employee Ledger: ${employee.name}`} />
        <Button variant="outline" asChild size="sm">
          <Link href="/hr/payroll">Go to Payroll Processing</Link>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground uppercase">Total Net Salary Accrued</p>
          <p className="text-2xl font-bold font-mono tabular-nums">৳ {totalNetPayable.toLocaleString()}</p>
        </div>
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground uppercase">Total Disbursed</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-primary">৳ {totalPaid.toLocaleString()}</p>
        </div>
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground uppercase">Outstanding Balance</p>
          <p className={`text-2xl font-bold font-mono tabular-nums ${outstandingBalance > 0 ? "text-amber-600" : "text-primary"}`}>
            ৳ {outstandingBalance.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Tables Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Accrued Payroll History */}
        <div className="space-y-4">
          <p className="font-semibold">Payroll Entry History (Accrual Engine)</p>
          <div className="overflow-hidden rounded-xl shadow-sm border-transparent">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-right">Net Payable</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-right">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No payroll entry records found
                    </td>
                  </tr>
                )}
                {ledger.entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      {format(new Date(e.year, e.month - 1), "MMMM yyyy")}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      ৳ {e.netPayable.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 text-xs font-bold rounded border ${
                        e.status === "PAID"
                          ? "bg-primary/10 text-primary border-primary/20"
                          : e.status === "PARTIAL"
                          ? "bg-muted/60 text-foreground border-border"
                          : "bg-muted/40 text-muted-foreground border-border"
                      }`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                        <Link href={`/hr/payroll/payslip/${e.id}`} target="_blank">
                          <Printer className="w-3.5 h-3.5 mr-1" /> View
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Outflow Audit Log */}
        <div className="space-y-4">
          <p className="font-semibold">Disbursement & Payment History</p>
          <div className="overflow-hidden rounded-xl shadow-sm border-transparent">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-left">Method</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.payments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No payment records found
                    </td>
                  </tr>
                )}
                {ledger.payments.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 text-xs">
                      {format(new Date(p.paidAt), "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {format(new Date(p.year, p.month - 1), "MMM yyyy")}
                    </td>
                    <td className="px-4 py-2 text-xs font-mono">
                      {p.method}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-primary font-semibold">
                      ৳ {p.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Adjustments Audit Log */}
      {ledger.adjustments.length > 0 && (
        <div className="space-y-4">
          <p className="font-semibold">Post-Accrual Corrections & Adjustments</p>
          <div className="overflow-hidden rounded-xl shadow-sm border-transparent">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-left">Reason / Audit Note</th>
                  <th className="px-4 py-2 text-right">Adjustment Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.adjustments.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      {format(new Date(a.year, a.month - 1), "MMMM yyyy")}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.reason}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-bold text-foreground">
                      ৳ {a.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
