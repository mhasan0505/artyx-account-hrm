"use client";

import { useState, useTransition, useEffect } from "react";
import { giveEmployeeAdvance } from "@/lib/actions/payroll";
import { getBankAccounts } from "@/lib/actions/bank";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { PaymentMethod } from "@prisma/client";

type EmployeeOption = {
  id: string;
  name: string;
  employeeCode?: string;
};

type BankAccountOption = {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  currentBalance: any;
  isMfs?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeOption[];
  initialEmployeeId?: string;
  outletId: string;
  onSuccess?: () => void;
};

const PAYMENT_METHOD_OPTIONS = [
  { label: "Cash Register", value: PaymentMethod.CASH },
  { label: "Bank Transfer", value: PaymentMethod.BANK_TRANSFER },
  { label: "bKash", value: PaymentMethod.BKASH },
  { label: "Nagad", value: PaymentMethod.NAGAD },
  { label: "Rocket", value: PaymentMethod.ROCKET },
  { label: "Card", value: PaymentMethod.CARD },
  { label: "Cheque", value: PaymentMethod.CHEQUE },
];

export function EmployeeAdvanceDialog({
  open,
  onOpenChange,
  employees,
  initialEmployeeId,
  outletId,
  onSuccess,
}: Props) {
  const [selectedEmpId, setSelectedEmpId] = useState(
    initialEmployeeId || (employees.length > 0 ? employees[0].id : "")
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [reference, setReference] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [notes, setNotes] = useState("");
  const [givenDate, setGivenDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialEmployeeId) {
      setSelectedEmpId(initialEmployeeId);
    } else if (employees.length > 0 && !selectedEmpId) {
      setSelectedEmpId(employees[0].id);
    }
  }, [initialEmployeeId, employees, selectedEmpId]);

  useEffect(() => {
    if (open) {
      getBankAccounts()
        .then((accounts) => {
          setBankAccounts(accounts || []);
          if (accounts && accounts.length > 0 && !bankAccountId) {
            setBankAccountId(accounts[0].id);
          }
        })
        .catch(() => setBankAccounts([]));
    }
  }, [open, bankAccountId]);

  const selectedEmp = employees.find((e) => e.id === selectedEmpId) || employees[0];

  const handleGiveAdvance = () => {
    if (!selectedEmpId) {
      toast.error("Please select an employee");
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Please enter a valid advance amount greater than 0");
      return;
    }

    if (method !== PaymentMethod.CASH && !bankAccountId) {
      toast.error("Please select a bank/MFS account");
      return;
    }

    startTransition(async () => {
      const res = await giveEmployeeAdvance({
        employeeId: selectedEmpId,
        outletId,
        amount: numAmount,
        method,
        bankAccountId: method !== PaymentMethod.CASH ? bankAccountId : undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        givenDate: givenDate ? new Date(givenDate).toISOString() : undefined,
        chequeDate: method === PaymentMethod.CHEQUE && chequeDate ? chequeDate : undefined,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to issue advance");
        return;
      }

      toast.success(
        `Advance of ৳${numAmount.toLocaleString()} given to ${selectedEmp?.name || "Employee"}`
      );
      setAmount("");
      setReference("");
      setChequeDate("");
      setNotes("");
      onOpenChange(false);
      if (onSuccess) onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <HandCoins className="w-5 h-5 text-emerald-600" /> Give Salary Advance
          </DialogTitle>
          <DialogDescription>
            Issue a salary advance to an employee. Advances are automatically recovered against future monthly payroll runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Employee Selection Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Select Employee <span className="text-rose-500">*</span>
            </label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.employeeCode ? `(${emp.employeeCode})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Advance Amount (৳) <span className="text-rose-500">*</span>
              </label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono text-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Payment Method <span className="text-rose-500">*</span>
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {method !== PaymentMethod.CASH && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Select Bank / MFS Account <span className="text-rose-500">*</span>
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                {bankAccounts.length === 0 ? (
                  <option value="">No bank accounts available</option>
                ) : (
                  bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} - {acc.accountName} ({acc.accountNumber}) [Bal: ৳{Number(acc.currentBalance).toLocaleString()}]
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {method === PaymentMethod.CHEQUE && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Cheque Maturity Date
              </label>
              <Input
                type="date"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Disbursement Date
              </label>
              <Input
                type="date"
                value={givenDate}
                onChange={(e) => setGivenDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Reference / TrxID
              </label>
              <Input
                placeholder="e.g. Trx# 9X102"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Notes / Reason
            </label>
            <Input
              placeholder="e.g. Emergency medical advance"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleGiveAdvance} disabled={isPending}>
            {isPending ? "Processing..." : "Issue Advance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
