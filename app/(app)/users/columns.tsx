"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteUser, toggleUserActive } from "@/lib/actions/users";
import { UserRole } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
  outlet: { id: string; name: string };
};

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  TECHNICIAN: "Technician",
  ACCOUNTANT: "Accountant",
  HR: "HR",
};

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  ADMIN: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  MANAGER:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  CASHIER: "bg-success/15 text-success",
  TECHNICIAN:
    "bg-warning/15 text-warning",
  ACCOUNTANT:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  HR: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

function ActionsCell({
  user,
  onEdit,
}: {
  user: UserRow;
  onEdit: (user: UserRow) => void;
}) {
  async function handleToggle() {
    const result = await toggleUserActive(user.id);
    if (result.success) {
      toast.success(
        result.data.isActive ? "User activated" : "User deactivated",
      );
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${user.name}? This action cannot be undone.`)) return;
    const result = await deleteUser(user.id);
    if (result.success) {
      toast.success("User deleted");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for ${user.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => onEdit(user)}
        >
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={handleToggle}
        >
          <Power className="size-4" />
          {user.isActive ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
          onClick={handleDelete}
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildColumns(
  onEdit: (user: UserRow) => void,
): ColumnDef<UserRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.original.role;
        return (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}
          >
            {ROLE_LABELS[role]}
          </span>
        );
      },
    },
    {
      accessorKey: "outlet",
      header: "Outlet",
      cell: ({ row }) => row.original.outlet.name,
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Inactive
          </span>
        ),
    },
    {
      accessorKey: "lastLogin",
      header: "Last Login",
      cell: ({ row }) =>
        row.original.lastLogin
          ? new Date(row.original.lastLogin).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "Never",
    },
    {
      id: "actions",
      cell: ({ row }) => <ActionsCell user={row.original} onEdit={onEdit} />,
    },
  ];
}
