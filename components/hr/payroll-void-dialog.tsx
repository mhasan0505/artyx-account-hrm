"use client";

import { useState, useTransition } from "react";
import { voidPayrollPayment } from "@/lib/actions/payroll";
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
import { RotateCcw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: {
    id: string;
    amount: number;
    method: string;
    reference?: string | null;
    paidAt: string;
  } | null;
  employeeName: string;
  onSuccess?: () => void;
};

export function PayrollVoidDialog({
  open,
  onOpenChange,
  payment,
  employeeName,
  onSuccess,
}: Props) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleVoid = () => {
    if (!payment) return;
    if (!reason.trim()) {
      toast.error("A voiding reason is required for the audit trail");
      return;
    }

    startTransition(async () => {
      const res = await voidPayrollPayment({
        paymentId: payment.id,
        reason: reason.trim(),
      });

      if (!res.success) {
        toast.error(res.error || "Failed to void payment");
        return;
      }

      toast.success(
        `Payment of ৳${payment.amount.toLocaleString()} voided. Ledger, bank, and drawer entries reversed.`
      );
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
            <RotateCcw className="w-5 h-5 text-rose-600" /> Void Salary Payment
          </DialogTitle>
          <DialogDescription>
            This <strong className="text-slate-900">irreversibly reverses</strong> the payment for{" "}
            <strong className="text-slate-900">{employeeName}</strong> — the cash drawer / bank account
            is re-credited and the general ledger is reversed with full audit traceability.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-md border bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment Amount</span>
              <span className="font-mono font-semibold">
                ৳{(payment?.amount || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Method</span>
              <span className="font-medium">{payment?.method}</span>
            </div>
            {payment?.reference && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-medium">{payment.reference}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid At</span>
              <span className="font-medium">
                {payment
                  ? new Date(payment.paidAt).toLocaleString()
                  : "—"}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Voiding Reason <span className="text-rose-500">*</span>
            </label>
            <Input
              placeholder="e.g. Wrong employee selected, duplicate payment, amount error"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? "Voiding..." : "Void Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
