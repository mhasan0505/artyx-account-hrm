"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDepartment,
  createDesignation,
  createEmployee,
  getEmployees,
  getHrLookups,
  updateEmployee,
} from "@/lib/actions/hr";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { BookOpen, Pencil } from "lucide-react";

type EmployeeRow = Awaited<ReturnType<typeof getEmployees>>[number];
type HrLookups = Awaited<ReturnType<typeof getHrLookups>>;

type FormState = {
  id?: string;
  employeeCode: string;
  name: string;
  phone: string;
  email: string;
  departmentId: string;
  designationId: string;
  outletId: string;
  joinDate: string;
  basicSalary: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  employeeCode: "",
  name: "",
  phone: "",
  email: "",
  departmentId: "",
  designationId: "",
  outletId: "",
  joinDate: new Date().toISOString().slice(0, 10),
  basicSalary: "",
  isActive: true,
};

function toForm(employee: EmployeeRow): FormState {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    departmentId: employee.departmentId,
    designationId: employee.designationId,
    outletId: employee.outletId,
    joinDate: new Date(employee.joinDate).toISOString().slice(0, 10),
    basicSalary: String(Number(employee.basicSalary)),
    isActive: employee.isActive,
  };
}

export function EmployeesManagement({
  initialEmployees,
  lookups,
}: {
  initialEmployees: EmployeeRow[];
  lookups: HrLookups;
}) {
  const [employees, setEmployees] = useState<EmployeeRow[]>(initialEmployees);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    ...emptyForm,
    outletId: lookups.outlets[0]?.id ?? "",
    departmentId: lookups.departments[0]?.id ?? "",
    designationId:
      lookups.designations.find(
        (d) => d.departmentId === (lookups.departments[0]?.id ?? ""),
      )?.id ??
      lookups.designations[0]?.id ??
      "",
  });
  const [isPending, startTransition] = useTransition();
  const [addDeptOpen, setAddDeptOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [addDesigOpen, setAddDesigOpen] = useState(false);
  const [newDesigName, setNewDesigName] = useState("");

  const filteredDesignations = useMemo(
    () =>
      lookups.designations.filter((d) => d.departmentId === form.departmentId),
    [lookups.designations, form.departmentId],
  );

  function resetForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      outletId: lookups.outlets[0]?.id ?? "",
      departmentId: lookups.departments[0]?.id ?? "",
      designationId:
        lookups.designations.find(
          (d) => d.departmentId === (lookups.departments[0]?.id ?? ""),
        )?.id ??
        lookups.designations[0]?.id ??
        "",
    });
  }

  function beginEdit(emp: EmployeeRow) {
    setEditingId(emp.id);
    setForm(toForm(emp));
  }

  function onDepartmentChange(nextDepartmentId: string) {
    const nextDesignation =
      lookups.designations.find((d) => d.departmentId === nextDepartmentId)
        ?.id ?? "";

    setForm((prev) => ({
      ...prev,
      departmentId: nextDepartmentId,
      designationId: nextDesignation,
    }));
  }

  function reloadEmployees() {
    startTransition(async () => {
      try {
        const next = await getEmployees();
        setEmployees(next);
      } catch {
        toast.error("Failed to refresh employee list");
      }
    });
  }

  function submitAddDepartment(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeptName.trim()) return;

    startTransition(async () => {
      const res = await createDepartment({ name: newDeptName.trim() });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Department added");
      setForm((prev) => ({ ...prev, departmentId: res.data.id }));
      setAddDeptOpen(false);
      setNewDeptName("");
    });
  }

  function submitAddDesignation(e: React.FormEvent) {
    e.preventDefault();
    if (!form.departmentId) {
      toast.error("Please select a department first");
      return;
    }
    if (!newDesigName.trim()) return;

    startTransition(async () => {
      const res = await createDesignation({
        name: newDesigName.trim(),
        departmentId: form.departmentId,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Designation added");
      setForm((prev) => ({ ...prev, designationId: res.data.id }));
      setAddDesigOpen(false);
      setNewDesigName("");
    });
  }

  function submitForm() {
    if (!form.name.trim() || !form.employeeCode.trim()) {
      toast.error("Employee code and name are required");
      return;
    }
    if (!form.departmentId || !form.designationId) {
      toast.error("Department and designation are required");
      return;
    }
    if (!form.basicSalary || Number(form.basicSalary) <= 0) {
      toast.error("Basic salary must be greater than zero");
      return;
    }

    startTransition(async () => {
      if (editingId) {
        const res = await updateEmployee({
          id: editingId,
          name: form.name,
          phone: form.phone || undefined,
          email: form.email || undefined,
          departmentId: form.departmentId,
          designationId: form.designationId,
          basicSalary: Number(form.basicSalary),
          isActive: form.isActive,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }

        toast.success("Employee updated");
      } else {
        const res = await createEmployee({
          employeeCode: form.employeeCode,
          name: form.name,
          phone: form.phone || undefined,
          email: form.email || undefined,
          departmentId: form.departmentId,
          designationId: form.designationId,
          outletId: form.outletId,
          joinDate: new Date(form.joinDate),
          basicSalary: Number(form.basicSalary),
          userId: undefined,
        });

        if (!res.success) {
          toast.error(res.error);
          return;
        }

        toast.success("Employee created");
      }

      resetForm();
      reloadEmployees();
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-sm font-medium">
          {editingId ? "Edit Employee" : "Create Employee"}
        </p>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              Employee Code
            </label>
            <input
              value={form.employeeCode}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, employeeCode: e.target.value }))
              }
              disabled={!!editingId}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-70"
              placeholder="EMP-001"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              placeholder="Employee name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Phone</label>
            <input
              value={form.phone}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, phone: e.target.value }))
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              placeholder="01XXXXXXXXX"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, email: e.target.value }))
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              placeholder="name@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Department</label>
            <div className="flex items-center gap-2">
              <select
                value={form.departmentId}
                onChange={(e) => onDepartmentChange(e.target.value)}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
              >
                {lookups.departments.length === 0 && (
                  <option value="" disabled>
                    No departments available
                  </option>
                )}
                {lookups.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setAddDeptOpen(true)}
                disabled={isPending}
                title="Add Department"
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Designation</label>
            <div className="flex items-center gap-2">
              <select
                value={form.designationId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, designationId: e.target.value }))
                }
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
              >
                {filteredDesignations.length === 0 && (
                  <option value="" disabled>
                    No designations
                  </option>
                )}
                {filteredDesignations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setAddDesigOpen(true)}
                disabled={isPending || !form.departmentId}
                title="Add Designation"
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Outlet</label>
            <select
              value={form.outletId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, outletId: e.target.value }))
              }
              disabled={!!editingId}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-70"
            >
              {lookups.outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Join Date</label>
            <input
              type="date"
              value={form.joinDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, joinDate: e.target.value }))
              }
              disabled={!!editingId}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-70"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              Basic Salary
            </label>
            <input
              type="number"
              min={0}
              value={form.basicSalary}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, basicSalary: e.target.value }))
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </div>

          {editingId && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Status</label>
              <select
                value={form.isActive ? "active" : "inactive"}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    isActive: e.target.value === "active",
                  }))
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={submitForm} disabled={isPending}>
            {isPending
              ? editingId
                ? "Updating..."
                : "Creating..."
              : editingId
                ? "Update Employee"
                : "Create Employee"}
          </Button>

          {editingId && (
            <Button variant="outline" onClick={resetForm} disabled={isPending}>
              Cancel Edit
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Code</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Department</th>
              <th className="px-4 py-2 text-left font-medium">Designation</th>
              <th className="px-4 py-2 text-right font-medium">Basic Salary</th>
              <th className="px-4 py-2 text-center font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No employees found
                </td>
              </tr>
            )}

            {employees.map((emp) => (
              <tr key={emp.id} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono">{emp.employeeCode}</td>
                <td className="px-4 py-2 font-medium">{emp.name}</td>
                <td className="px-4 py-2">{emp.department?.name ?? "-"}</td>
                <td className="px-4 py-2">{emp.designation?.name ?? "-"}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {Number(emp.basicSalary).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-center">
                  {emp.isActive ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground pressable-subtle">
                      <Link href={`/hr/employees/${emp.id}/ledger`} title="View Employee Ledger" aria-label="View Employee Ledger">
                        <BookOpen className="size-4" />
                      </Link>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground pressable-subtle"
                      onClick={() => beginEdit(emp)}
                      disabled={isPending}
                      title="Edit Employee"
                      aria-label="Edit Employee"
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={addDeptOpen} onOpenChange={setAddDeptOpen}>
        <DialogContent className="sm:max-w-50">
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAddDepartment} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Department Name</Label>
              <Input
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="e.g. Engineering"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddDeptOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addDesigOpen} onOpenChange={setAddDesigOpen}>
        <DialogContent className="sm:max-w-50">
          <DialogHeader>
            <DialogTitle>Add Designation</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAddDesignation} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Designation Name</Label>
              <Input
                value={newDesigName}
                onChange={(e) => setNewDesigName(e.target.value)}
                placeholder="e.g. Software Engineer"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddDesigOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
