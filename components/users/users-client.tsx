"use client";

import { buildColumns, type UserRow } from "@/app/(app)/users/columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createRole,
  deleteRole,
} from "@/lib/actions/roles";
import {
  AVAILABLE_PERMISSIONS,
  type RoleDefinition,
} from "@/types/roles";
import { createUser, updateUser } from "@/lib/actions/users";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserRole } from "@prisma/client";
import {
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  TECHNICIAN: "Technician",
  ACCOUNTANT: "Accountant",
  HR: "HR",
};

const COLOR_CLASSES: Record<
  string,
  { badge: string; border: string; bg: string; dot: string }
> = {
  purple: {
    badge:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    border: "border-purple-200 dark:border-purple-900/40",
    bg: "bg-purple-500/10",
    dot: "bg-purple-500",
  },
  blue: {
    badge:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    border: "border-blue-200 dark:border-blue-900/40",
    bg: "bg-blue-500/10",
    dot: "bg-blue-500",
  },
  indigo: {
    badge:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
    border: "border-indigo-200 dark:border-indigo-900/40",
    bg: "bg-indigo-500/10",
    dot: "bg-indigo-500",
  },
  emerald: {
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    border: "border-emerald-200 dark:border-emerald-900/40",
    bg: "bg-emerald-500/10",
    dot: "bg-emerald-500",
  },
  green: {
    badge:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
    border: "border-green-200 dark:border-green-900/40",
    bg: "bg-green-500/10",
    dot: "bg-green-500",
  },
  amber: {
    badge:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    border: "border-amber-200 dark:border-amber-900/40",
    bg: "bg-amber-500/10",
    dot: "bg-amber-500",
  },
  orange: {
    badge:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    border: "border-orange-200 dark:border-orange-900/40",
    bg: "bg-orange-500/10",
    dot: "bg-orange-500",
  },
  pink: {
    badge:
      "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300 border-pink-200 dark:border-pink-800",
    border: "border-pink-200 dark:border-pink-900/40",
    bg: "bg-pink-500/10",
    dot: "bg-pink-500",
  },
  rose: {
    badge:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-800",
    border: "border-rose-200 dark:border-rose-900/40",
    bg: "bg-rose-500/10",
    dot: "bg-rose-500",
  },
  cyan: {
    badge:
      "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
    border: "border-cyan-200 dark:border-cyan-900/40",
    bg: "bg-cyan-500/10",
    dot: "bg-cyan-500",
  },
  slate: {
    badge:
      "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 border-slate-200 dark:border-slate-700",
    border: "border-slate-200 dark:border-slate-800",
    bg: "bg-slate-500/10",
    dot: "bg-slate-500",
  },
};

const COLOR_OPTIONS = [
  { id: "purple", label: "Purple" },
  { id: "blue", label: "Blue" },
  { id: "indigo", label: "Indigo" },
  { id: "emerald", label: "Emerald" },
  { id: "amber", label: "Amber" },
  { id: "pink", label: "Pink" },
  { id: "rose", label: "Rose" },
  { id: "cyan", label: "Cyan" },
  { id: "slate", label: "Slate" },
];

const createSchema = z.object({
  name: z.string().min(2, "At least 2 characters"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "At least 6 characters"),
  roleKey: z.string().min(1, "Select a role"),
  outletId: z.string().min(1, "Select an outlet"),
});

const editSchema = z.object({
  name: z.string().min(2, "At least 2 characters"),
  roleKey: z.string().min(1, "Select a role"),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

type Outlet = { id: string; name: string };

export function UsersClient({
  users,
  outlets,
  roles,
  isSuperAdmin,
  currentUserRole,
}: {
  users: UserRow[];
  outlets: Outlet[];
  roles: RoleDefinition[];
  isSuperAdmin: boolean;
  currentUserRole: string;
}) {
  const [activeTab, setActiveTab] = React.useState<"users" | "roles">("users");
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createRoleOpen, setCreateRoleOpen] = React.useState(false);
  const [roleSearch, setRoleSearch] = React.useState("");

  const columns = React.useMemo(() => buildColumns(setEditing), []);

  const customRoles = React.useMemo(
    () => roles.filter((r) => !r.isSystem),
    [roles]
  );
  const systemRoles = React.useMemo(
    () => roles.filter((r) => r.isSystem),
    [roles]
  );

  const filteredRoles = React.useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
    );
  }, [roles, roleSearch]);

  return (
    <div className="mt-4 space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "users" | "roles")}
        className="w-full"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
          <TabsList className="grid grid-cols-2 w-full sm:w-auto">
            <TabsTrigger value="users" className="gap-2">
              <Users className="size-4" />
              <span>Users</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {users.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2">
              <ShieldCheck className="size-4" />
              <span>Roles & Access</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {roles.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 justify-end">
            {/* Create Role Button: ONLY accessible and visible to Super Admin */}
            {isSuperAdmin ? (
              <Button
                variant={activeTab === "roles" ? "default" : "outline"}
                onClick={() => setCreateRoleOpen(true)}
                className="gap-2 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 font-medium"
              >
                <ShieldPlus className="size-4 text-purple-600 dark:text-purple-400" />
                Create Role
              </Button>
            ) : (
              <div
                title="Only Super Admin has access to create roles"
                className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-md border"
              >
                <Lock className="size-3.5 text-amber-500" />
                <span>Role Creation Restricted</span>
              </div>
            )}

            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <UserPlus className="size-4" />
              Add User
            </Button>
          </div>
        </div>

        {/* ─── TAB 1: USERS ───────────────────────────────── */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <DataTable columns={columns} data={users} />
        </TabsContent>

        {/* ─── TAB 2: ROLES & PERMISSIONS ─────────────────── */}
        <TabsContent value="roles" className="mt-4 space-y-6">
          {/* Status Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border bg-card/60 backdrop-blur-sm">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Shield className="size-5 text-purple-600 dark:text-purple-400" />
                <h3 className="font-semibold text-sm sm:text-base">
                  Workspace Roles & Access Levels
                </h3>
                {isSuperAdmin ? (
                  <Badge className="bg-purple-600 hover:bg-purple-600 text-white text-[10px]">
                    Super Admin Access
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Lock className="size-2.5 text-amber-500" />
                    Super Admin Required to Create
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Manage role templates, module permissions, and custom access
                tiers for staff members.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search roles..."
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  className="pl-8 text-xs h-9"
                />
              </div>
              {isSuperAdmin && (
                <Button
                  onClick={() => setCreateRoleOpen(true)}
                  size="sm"
                  className="gap-1.5 whitespace-nowrap bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <ShieldPlus className="size-3.5" />
                  New Role
                </Button>
              )}
            </div>
          </div>

          {/* Role Summary Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Total Roles</p>
              <p className="text-xl font-bold mt-1">{roles.length}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">System Defaults</p>
              <p className="text-xl font-bold mt-1 text-slate-700 dark:text-slate-300">
                {systemRoles.length}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Custom Roles</p>
              <p className="text-xl font-bold mt-1 text-purple-600 dark:text-purple-400">
                {customRoles.length}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Active Staff</p>
              <p className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                {users.filter((u) => u.isActive).length}
              </p>
            </Card>
          </div>

          {/* Roles Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRoles.map((role) => {
              const colorInfo =
                COLOR_CLASSES[role.color] || COLOR_CLASSES.indigo;
              return (
                <Card
                  key={role.id}
                  className={`flex flex-col justify-between transition-all hover:shadow-md border ${
                    !role.isSystem
                      ? "ring-1 ring-purple-500/20"
                      : "border-border/80"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-2.5 rounded-full ${colorInfo.dot}`}
                          />
                          <CardTitle className="text-base font-semibold">
                            {role.label}
                          </CardTitle>
                        </div>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {role.name}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {role.isSystem ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            System Default
                          </Badge>
                        ) : (
                          <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 text-[10px]">
                            Custom Role
                          </Badge>
                        )}
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${colorInfo.badge}`}
                        >
                          {role.label}
                        </span>
                      </div>
                    </div>

                    <CardDescription className="text-xs mt-2 line-clamp-2">
                      {role.description || "No description provided."}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3 text-xs">
                    {!role.isSystem && (
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t">
                        <span className="text-muted-foreground">
                          Base System Permission:
                        </span>
                        <span className="font-medium text-foreground">
                          {ROLE_LABELS[role.baseRole] || role.baseRole}
                        </span>
                      </div>
                    )}

                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                        Accessible Modules:
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                        {role.permissions.includes("all") ? (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-100 dark:bg-purple-950/60 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">
                            <CheckCircle2 className="size-3" /> All Modules
                            (Full Control)
                          </span>
                        ) : role.permissions.length > 0 ? (
                          role.permissions.map((p) => {
                            const opt = AVAILABLE_PERMISSIONS.find(
                              (item) => item.id === p
                            );
                            return (
                              <span
                                key={p}
                                className="inline-flex items-center rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              >
                                {opt?.label.split("&")[0].trim() || p}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">
                            Inherits from {ROLE_LABELS[role.baseRole]}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      <span>{role.userCount || 0} staff assigned</span>
                    </div>

                    {!role.isSystem ? (
                      isSuperAdmin ? (
                        <DeleteRoleButton
                          roleId={role.id}
                          roleName={role.label}
                          userCount={role.userCount || 0}
                        />
                      ) : null
                    ) : (
                      <span className="text-[10px] flex items-center gap-1 opacity-70">
                        <Lock className="size-3" /> Core Role
                      </span>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {filteredRoles.length === 0 && (
            <div className="text-center py-12 border rounded-xl bg-card/40">
              <ShieldAlert className="size-8 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No roles match your search</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try searching with a different term or create a new role.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <CreateUserDialog
        open={createOpen}
        outlets={outlets}
        roles={roles}
        isSuperAdmin={isSuperAdmin}
        onOpenChange={setCreateOpen}
        onOpenCreateRole={() => setCreateRoleOpen(true)}
      />

      {/* Edit User Dialog */}
      {editing && (
        <EditUserDialog
          user={editing}
          roles={roles}
          isSuperAdmin={isSuperAdmin}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onOpenCreateRole={() => setCreateRoleOpen(true)}
        />
      )}

      {/* Create Role Dialog (Restricted to Super Admin) */}
      {isSuperAdmin && (
        <CreateRoleDialog
          open={createRoleOpen}
          onOpenChange={setCreateRoleOpen}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Create Role Dialog (Only Super Admin)
 * ───────────────────────────────────────────────────────────── */
function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [baseRole, setBaseRole] = React.useState<UserRole>(UserRole.MANAGER);
  const [selectedPermissions, setSelectedPermissions] = React.useState<
    string[]
  >([
    "dashboard",
    "clients",
    "projects",
    "invoices",
  ]);
  const [color, setColor] = React.useState("indigo");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Auto-generate uppercase code when name changes (if user hasn't typed a custom code)
  const handleNameChange = (val: string) => {
    setName(val);
    const suggestedCode = val
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    setCode(suggestedCode);
  };

  const togglePermission = (id: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedPermissions.length === AVAILABLE_PERMISSIONS.length) {
      setSelectedPermissions([]);
    } else {
      setSelectedPermissions(AVAILABLE_PERMISSIONS.map((p) => p.id));
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a role title");
      return;
    }
    if (!code.trim()) {
      toast.error("Please enter a role code");
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("code", code.trim());
      fd.append("description", description.trim());
      fd.append("baseRole", baseRole);
      fd.append("color", color);
      selectedPermissions.forEach((p) => fd.append("permissions", p));

      const res = await createRole(fd);
      if (res.success) {
        toast.success(`Role "${res.data.label}" created successfully!`);
        setName("");
        setCode("");
        setDescription("");
        setBaseRole(UserRole.MANAGER);
        setSelectedPermissions(["dashboard", "clients", "projects", "invoices"]);
        setColor("indigo");
        onOpenChange(false);
      } else {
        toast.error(res.error);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to create role");
    } finally {
      setIsSubmitting(false);
    }
  }

  const previewColor = COLOR_CLASSES[color] || COLOR_CLASSES.indigo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <ShieldPlus className="size-5" />
            </div>
            <div>
              <DialogTitle>Create New Role</DialogTitle>
              <DialogDescription>
                Define a custom role title, underlying permissions, and visual
                badge for your team.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          {/* Role Title and Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Role Title <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. Operations Lead, Lead Designer"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                The public name displayed across profiles and tables.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Role Identifier Code <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. OPERATIONS_LEAD"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"))
                }
                className="font-mono text-xs uppercase"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Unique uppercase key used for internal authorization.
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Description
            </label>
            <Textarea
              placeholder="Describe the duties, responsibilities, and operational scope of this role..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-xs resize-none"
            />
          </div>

          {/* Base System Role Template */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Base Permission Template <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-muted-foreground">
                Underlying system capability
              </span>
            </div>
            <Select
              value={baseRole}
              onValueChange={(val) => setBaseRole(val as UserRole)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select base template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UserRole.MANAGER}>
                  Manager (Branch operations, team management, approvals)
                </SelectItem>
                <SelectItem value={UserRole.ACCOUNTANT}>
                  Accountant (Financial ledgers, invoices, AR/AP, bank)
                </SelectItem>
                <SelectItem value={UserRole.HR}>
                  HR (Employee directory, attendance, payroll, advances)
                </SelectItem>
                <SelectItem value={UserRole.TECHNICIAN}>
                  Technician (Project tasks, service logs, repairs)
                </SelectItem>
                <SelectItem value={UserRole.CASHIER}>
                  Cashier (Point of sale, receipts, client invoices)
                </SelectItem>
                <SelectItem value={UserRole.ADMIN}>
                  Admin (High-level administration and configuration)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Guarantees full compatibility with existing backend endpoints and
              workflows.
            </p>
          </div>

          {/* Color Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Badge Visual Theme
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => {
                const isSelected = color === c.id;
                const cClasses = COLOR_CLASSES[c.id] || COLOR_CLASSES.indigo;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                      isSelected
                        ? "ring-2 ring-primary ring-offset-1 font-semibold"
                        : "opacity-80 hover:opacity-100"
                    } ${cClasses.badge}`}
                  >
                    <span className={`size-2 rounded-full ${cClasses.dot}`} />
                    <span>{c.label}</span>
                    {isSelected && <Check className="size-3 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground font-medium">
                Badge Preview
              </p>
              <p className="text-xs font-medium mt-0.5">
                {name.trim() || "Role Title"}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border ${previewColor.badge}`}
            >
              <span className={`size-2 rounded-full ${previewColor.dot}`} />
              {name.trim() || "Role Preview"}
            </span>
          </div>

          {/* Module Permissions Checkboxes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Accessible Modules & Permissions
              </label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium"
              >
                {selectedPermissions.length === AVAILABLE_PERMISSIONS.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border rounded-lg p-3 bg-muted/20 max-h-56 overflow-y-auto">
              {AVAILABLE_PERMISSIONS.map((perm) => {
                const isChecked = selectedPermissions.includes(perm.id);
                return (
                  <label
                    key={perm.id}
                    className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition-colors text-xs ${
                      isChecked
                        ? "bg-purple-500/10 border-purple-500/30 text-foreground"
                        : "bg-card border-border/60 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => togglePermission(perm.id)}
                      className="mt-0.5 accent-purple-600 rounded"
                    />
                    <div className="space-y-0.5 select-none">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-xs text-foreground">
                          {perm.label}
                        </span>
                        <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-muted text-muted-foreground">
                          {perm.category}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        {perm.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Create Role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Delete Role Button
 * ───────────────────────────────────────────────────────────── */
function DeleteRoleButton({
  roleId,
  roleName,
  userCount,
}: {
  roleId: string;
  roleName: string;
  userCount: number;
}) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  async function handleDelete() {
    if (userCount > 0) {
      toast.error(
        `Cannot delete "${roleName}" because ${userCount} user(s) are assigned to it.`
      );
      return;
    }

    if (
      !confirm(
        `Are you sure you want to delete role "${roleName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await deleteRole(roleId);
      if (res.success) {
        toast.success(`Role "${roleName}" deleted`);
      } else {
        toast.error(res.error);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete role");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-destructive hover:bg-destructive/10 h-7 px-2 text-xs gap-1"
      title="Delete Custom Role"
    >
      {isDeleting ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Trash2 className="size-3 text-destructive" />
      )}
      Delete
    </Button>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Create User Dialog
 * ───────────────────────────────────────────────────────────── */
function CreateUserDialog({
  open,
  outlets,
  roles,
  isSuperAdmin,
  onOpenChange,
  onOpenCreateRole,
}: {
  open: boolean;
  outlets: Outlet[];
  roles: RoleDefinition[];
  isSuperAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreateRole: () => void;
}) {
  const form = useForm<CreateValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: (zodResolver as any)(createSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      roleKey: UserRole.CASHIER,
      outletId: "",
    },
  });

  const customRoles = roles.filter((r) => !r.isSystem);
  const systemRoles = roles.filter((r) => r.isSystem);

  async function onSubmit(values: CreateValues) {
    const fd = new FormData();
    fd.append("name", values.name);
    fd.append("email", values.email);
    fd.append("password", values.password);
    fd.append("outletId", values.outletId);

    // Resolve if roleKey is a custom role or system role
    const matchedCustom = customRoles.find(
      (r) => r.id === values.roleKey || r.name === values.roleKey
    );

    if (matchedCustom) {
      fd.append("role", matchedCustom.baseRole);
      fd.append("customRoleId", matchedCustom.id);
    } else {
      fd.append("role", values.roleKey);
    }

    const result = await createUser(fd);
    if (result.success) {
      toast.success(`User "${result.data.name}" created`);
      form.reset();
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>
            Create login credentials and assign workspace permissions.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="john@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="roleKey"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Role</FormLabel>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenChange(false);
                            onOpenCreateRole();
                          }}
                          className="text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium flex items-center gap-0.5"
                        >
                          <Plus className="size-3" /> New
                        </button>
                      )}
                    </div>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase text-muted-foreground">
                            System Roles
                          </SelectLabel>
                          {systemRoles.map((r) => {
                            // Non-superadmins cannot assign SUPER_ADMIN
                            if (!isSuperAdmin && r.name === "SUPER_ADMIN")
                              return null;
                            return (
                              <SelectItem key={r.name} value={r.name}>
                                {r.label}
                              </SelectItem>
                            );
                          })}
                        </SelectGroup>

                        {customRoles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-[10px] uppercase text-purple-600 dark:text-purple-400 font-semibold">
                              Custom Roles
                            </SelectLabel>
                            {customRoles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.label} (Custom)
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="outletId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outlet</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select outlet" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {outlets.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Edit User Dialog
 * ───────────────────────────────────────────────────────────── */
function EditUserDialog({
  user,
  roles,
  isSuperAdmin,
  onOpenChange,
  onOpenCreateRole,
}: {
  user: UserRow;
  roles: RoleDefinition[];
  isSuperAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreateRole: () => void;
}) {
  const initialRoleKey = user.customRole ? user.customRole.id : user.role;

  const form = useForm<EditValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: (zodResolver as any)(editSchema),
    defaultValues: { name: user.name, roleKey: initialRoleKey },
  });

  const customRoles = roles.filter((r) => !r.isSystem);
  const systemRoles = roles.filter((r) => r.isSystem);

  async function onSubmit(values: EditValues) {
    const fd = new FormData();
    fd.append("id", user.id);
    fd.append("name", values.name);

    // Resolve roleKey
    const matchedCustom = customRoles.find(
      (r) => r.id === values.roleKey || r.name === values.roleKey
    );

    if (matchedCustom) {
      fd.append("role", matchedCustom.baseRole);
      fd.append("customRoleId", matchedCustom.id);
    } else {
      fd.append("role", values.roleKey);
      fd.append("customRoleId", ""); // Clear custom role
    }

    const result = await updateUser(fd);
    if (result.success) {
      toast.success("User updated");
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update user name and assigned role permissions.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roleKey"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Role</FormLabel>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenCreateRole();
                        }}
                        className="text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium flex items-center gap-0.5"
                      >
                        <Plus className="size-3" /> New
                      </button>
                    )}
                  </div>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase text-muted-foreground">
                          System Roles
                        </SelectLabel>
                        {systemRoles.map((r) => {
                          if (!isSuperAdmin && r.name === "SUPER_ADMIN")
                            return null;
                          return (
                            <SelectItem key={r.name} value={r.name}>
                              {r.label}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>

                      {customRoles.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase text-purple-600 dark:text-purple-400 font-semibold">
                            Custom Roles
                          </SelectLabel>
                          {customRoles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.label} (Custom)
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground">
              Email: <span className="font-medium">{user.email}</span>
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
