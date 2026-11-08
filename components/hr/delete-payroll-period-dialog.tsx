"use client";

import { useState, useTransition } from "react";
import { deletePayrollPeriod } from "@/lib/actions/payroll";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: { id: string; month: number; year: number; status: string } | null;
  onSuccess?: () => void;
};

function monthName(month: number) {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", {
    month: "long",
  });
}

export function DeletePayrollPeriodDialog({
  open,
  onOpenChange,
  period,
  onSuccess,
}: Props) {
  const [confirm, setConfirm] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!period) return;
    if (confirm.trim().toUpperCase() !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }

    startTransition(async () => {
      const res = await deletePayrollPeriod(period.id);
      if (!res.success) {
        toast.error(res.error || "Failed to delete payroll period");
        return;
      }
      toast.success(
        `Payroll period ${monthName(period.month)} ${period.year} deleted.`
      );
      setConfirm("");
      onOpenChange(false);
      if (onSuccess) onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Trash2 className="w-5 h-5 text-destructive" /> Delete Payroll Period
          </DialogTitle>
          <DialogDescription>
            You are about to permanently delete the{" "}
            <strong className="text-slate-900">
              {period ? `${monthName(period.month)} ${period.year}` : ""}
            </strong>{" "}
            payroll period (status: <strong className="text-slate-900">{period?.status}</strong>).
            All associated payslips, lines, and adjustments will be removed. Only periods with no
            recorded payments can be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2 text-sm">
          <label className="text-xs font-semibold text-slate-700">
            Type <span className="font-mono">DELETE</span> to confirm
          </label>
          <input
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending || confirm.trim().toUpperCase() !== "DELETE"}
          >
            {isPending ? "Deleting..." : "Delete Period"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
