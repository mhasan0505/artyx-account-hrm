"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { PaymentMethod } from "@prisma/client";
import { recordPayrollPayment } from "@/lib/actions/payroll";
import { toast } from "sonner";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  payslip: any;
  bankAccounts: any[];
  onSuccess: () => void;
};

export function PayrollPaymentDialog({
  isOpen,
  onClose,
  payslip,
  bankAccounts,
  onSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [notes, setNotes] = useState("");

  const remainingPayable = Math.max(
    0,
    Number(payslip?.netSalary || 0) - Number(payslip?.paidAmount || 0)
  );

  function handleSubmit() {
    startTransition(async () => {
      const res = await recordPayrollPayment({
        payrollEntryId: payslip.id,
        amount: remainingPayable,
        method,
        bankAccountId: method !== "CASH" ? bankAccountId : undefined,
        reference,
        notes,
        chequeDate: method === "CHEQUE" && chequeDate ? chequeDate : undefined,
      });

      if (res.success) {
        toast.success("Payment recorded successfully");
        setChequeDate("");
        onSuccess();
        onClose();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle>Mark Salary as Paid</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Employee</p>
            <p className="text-sm text-muted-foreground">{payslip?.employee.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Net Salary</p>
            <p className="text-lg font-bold">{Number(payslip?.netSalary).toLocaleString()}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Method</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="BKASH">bKash</option>
              <option value="NAGAD">Nagad</option>
              <option value="ROCKET">Rocket</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
            </select>
          </div>

          {method === "CHEQUE" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Cheque Maturity Date</label>
              <input
                type="date"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
            </div>
          )}

          {method !== "CASH" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Source Account</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Select Account</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} - {acc.accountNumber} (Bal: ৳{Number(acc.currentBalance).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Reference</label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="TrxID, Cheque No, etc."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || (method !== "CASH" && !bankAccountId)}>
            {isPending ? "Recording..." : "Confirm Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
