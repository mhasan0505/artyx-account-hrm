"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBankAccount } from "@/lib/actions/bank";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function CreateBankDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [branch, setBranch] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");

  const [isMfs, setIsMfs] = useState(false);
  const [chargePct, setChargePct] = useState("0");
  const [chargeType, setChargeType] = useState("MERCHANT_BEARS");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    startTransition(async () => {
      const res = await createBankAccount({
        accountName,
        accountNumber,
        bankName,
        branch,
        openingBalance: Number(openingBalance),
        isMfs,
        transactionChargePct: isMfs ? 0 : Number(chargePct),
        cashoutChargePct: isMfs ? Number(chargePct) : 0,
        chargeType,
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success("Account created successfully");
      setOpen(false);

      // Reset form
      setAccountName("");
      setAccountNumber("");
      setBankName("");
      setBranch("");
      setOpeningBalance("0");
      setIsMfs(false);
      setChargePct("0");
      setChargeType("MERCHANT_BEARS");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-106.25">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add Bank / MFS Account</DialogTitle>
            <DialogDescription>
              Create a new financial account for the POS ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center space-x-2">
              <Switch id="is-mfs" checked={isMfs} onCheckedChange={setIsMfs} />
              <Label htmlFor="is-mfs">Is this an MFS Account (e.g. bKash, Nagad)?</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{isMfs ? "MFS Provider" : "Bank Name"}</Label>
                <Input
                  required
                  placeholder={isMfs ? "e.g. bKash" : "e.g. Dutch Bangla Bank"}
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Account Name</Label>
                <Input
                  required
                  placeholder="e.g. Sales Account"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input
                  required
                  placeholder="01xxxxxxxxx"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>
              {!isMfs && (
                <div className="space-y-1">
                  <Label>Branch (Optional)</Label>
                  <Input
                    placeholder="Gulshan Branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{isMfs ? "Cash-Out Charge (%)" : "Transaction Fee Amount (৳)"}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={chargePct}
                  onChange={(e) => setChargePct(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Fee Behavior</Label>
                <Select value={chargeType} onValueChange={setChargeType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MERCHANT_BEARS">Merchant Bears Fee</SelectItem>
                    <SelectItem value="CUSTOMER_PAYS">Customer Pays Fee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Opening Balance</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
