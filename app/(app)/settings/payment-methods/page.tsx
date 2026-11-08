"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPaymentMethods, updatePaymentMethod } from "@/lib/actions/settings";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type MethodRow = {
  id: string;
  method: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
};

export default function PaymentMethodsSettingsPage() {
  const [rows, setRows] = useState<MethodRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    const res = await getPaymentMethods();
    if (!res.success) {
      toast.error(res.error);
      setIsLoading(false);
      return;
    }

    setRows(
      res.data.map((m) => ({
        id: m.id,
        method: m.method,
        label: m.label,
        isActive: m.isActive,
        sortOrder: m.sortOrder,
      })),
    );
    setIsLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(row: MethodRow) {
    const res = await updatePaymentMethod(row.id, {
      label: row.label,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });

    if (!res.success) {
      toast.error(res.error);
      return;
    }

    toast.success(`${row.method} updated`);
    load();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader title="Payment Method Settings" />

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left">Method</th>
              <th className="p-3 text-left">Label</th>
              <th className="p-3 text-center">Active</th>
              <th className="p-3 text-center">Sort</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  Loading payment methods...
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  No payment methods configured.
                </td>
              </tr>
            )}

            {!isLoading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs">{row.method}</td>
                  <td className="p-3">
                    <Input
                      value={row.label}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, label: value } : r,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, isActive: checked } : r,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <Input
                      type="number"
                      min={0}
                      className="w-24 mx-auto"
                      value={String(row.sortOrder)}
                      onChange={(e) => {
                        const sortOrder = Number(e.target.value || 0);
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, sortOrder } : r,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSave(row)}
                    >
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
