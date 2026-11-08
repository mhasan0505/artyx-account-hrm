"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createTaxRate,
  deleteTaxRate,
  getTaxRates,
  updateTaxRate,
} from "@/lib/actions/settings";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type TaxRow = {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
  isActive: boolean;
};

export default function TaxSettingsPage() {
  const [rows, setRows] = useState<TaxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("15");
  const [newDefault, setNewDefault] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<TaxRow | null>(null);

  async function load() {
    setLoading(true);
    const taxRates = await getTaxRates();
    setRows(
      taxRates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        rate: Number(rate.rate),
        isDefault: rate.isDefault,
        isActive: rate.isActive,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    const numericRate = Number(newRate);
    if (Number.isNaN(numericRate) || numericRate < 0 || numericRate > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }

    setCreating(true);
    const result = await createTaxRate({
      name: newName.trim(),
      rate: numericRate,
      isDefault: newDefault,
      isActive: true,
    });
    setCreating(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("Tax rate created");
    setNewName("");
    setNewRate("15");
    setNewDefault(false);
    load();
  }

  async function handleSaveRow(row: TaxRow) {
    const result = await updateTaxRate(row.id, {
      name: row.name,
      rate: row.rate,
      isDefault: row.isDefault,
      isActive: row.isActive,
    });

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("Tax rate updated");
    load();
  }

  async function confirmDeleteRow() {
    if (!rowToDelete) return;
    const result = await deleteTaxRate(rowToDelete.id);
    if (!result.success) {
      toast.error(result.error);
      setRowToDelete(null);
      return;
    }

    toast.success(`Tax rate "${rowToDelete.name}" deleted`);
    setRowToDelete(null);
    load();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader title="Tax Rate Settings" />

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">Create Tax Rate</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            placeholder="Name (e.g. VAT 10%)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            placeholder="Rate"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={newDefault}
              onChange={(e) => setNewDefault(e.target.checked)}
            />
            Set as default
          </label>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-right">Rate %</th>
              <th className="p-3 text-center">Default</th>
              <th className="p-3 text-center">Active</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  Loading tax rates...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  No tax rates found.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, index) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Input
                      value={row.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, name: value } : r,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      className="text-right"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={String(row.rate)}
                      onChange={(e) => {
                        const value = Number(e.target.value || 0);
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, rate: value } : r,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={row.isDefault}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRows((prev) =>
                          prev.map((r, i) => ({
                            ...r,
                            isDefault:
                              i === index
                                ? checked
                                : checked
                                  ? false
                                  : r.isDefault,
                          })),
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
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveRow(row)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={row.isDefault}
                        onClick={() => setRowToDelete(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <AlertDialog open={!!rowToDelete} onOpenChange={open => !open && setRowToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tax Rate</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the tax rate &quot;{rowToDelete?.name}&quot;?
              Any products or calculations configured with this tax rate will need to be updated. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteRow}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
