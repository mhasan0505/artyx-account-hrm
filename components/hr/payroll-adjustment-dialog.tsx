"use client";

import { useState, useTransition } from "react";
import { correctPayrollEntry } from "@/lib/actions/payroll";
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
import { SlidersHorizontal } from "lucide-react";
import { AdjustmentType } from "@prisma/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payrollEntryId: string;
  employeeName: string;
  currentNetPayable: number;
  onSuccess?: () => void;
};

export function PayrollAdjustmentDialog({
  open,
  onOpenChange,
  payrollEntryId,
  employeeName,
  currentNetPayable,
  onSuccess,
}: Props) {
  const [type, setType] = useState<AdjustmentType>(AdjustmentType.DEDUCTION_ADDON);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleApplyAdjustment = () => {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Please enter a valid adjustment amount greater than 0");
      return;
    }

    if (!label.trim()) {
      toast.error("Adjustment label is required (e.g. Late Penalty, Special Bonus)");
      return;
    }

    startTransition(async () => {
      const res = await correctPayrollEntry({
        payrollEntryId,
        type,
        amount: numAmount,
        category: type === AdjustmentType.DEDUCTION_ADDON ? "DEDUCTION" : "BONUS",
        label: label.trim(),
        reason: reason.trim() || label.trim(),
      });

      if (!res.success) {
        toast.error(res.error || "Failed to apply adjustment");
        return;
      }

      toast.success(
        `Adjustment applied for ${employeeName}. New Net Payable: ৳${res.data.updatedEntry.netPayable.toLocaleString()}`
      );
      setAmount("");
      setLabel("");
      setReason("");
      onOpenChange(false);
      if (onSuccess) onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <SlidersHorizontal className="w-5 h-5 text-indigo-600" /> Salary Deduction / Adjustment
          </DialogTitle>
          <DialogDescription>
            Apply a non-destructive deduction or bonus adjustment for <strong className="text-slate-900">{employeeName}</strong>.
            Current Net Payable: <strong className="text-slate-900">৳{currentNetPayable.toLocaleString()}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Adjustment Type <span className="text-rose-500">*</span>
            </label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
              value={type}
              onChange={(e) => setType(e.target.value as AdjustmentType)}
            >
              <option value={AdjustmentType.DEDUCTION_ADDON}>Deduction (Reduces Net Salary)</option>
              <option value={AdjustmentType.BONUS_ADDON}>Incentive / Bonus (Increases Net Salary)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Adjustment Amount (৳) <span className="text-rose-500">*</span>
            </label>
            <Input
              type="number"
              placeholder="e.g. 1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono text-base"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Label / Category Name <span className="text-rose-500">*</span>
            </label>
            <Input
              placeholder="e.g. Late Penalty, Tax Withholding, Festival Bonus"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Audit Note / Reason
            </label>
            <Input
              placeholder="e.g. Approved by HR Manager for 3 unexcused late arrivals"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleApplyAdjustment} disabled={isPending}>
            {isPending ? "Applying..." : "Apply Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
