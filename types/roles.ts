import { UserRole } from "@prisma/client";

export type RoleDefinition = {
  id: string;
  name: string; // Uppercase unique code e.g. "OPERATIONS_LEAD"
  label: string; // Human readable name e.g. "Operations Lead"
  description: string;
  baseRole: UserRole;
  permissions: string[];
  color: string;
  isSystem: boolean;
  createdBy?: string | null;
  createdAt?: string;
  userCount?: number;
};

export type PermissionOption = {
  id: string;
  label: string;
  category: "Overview" | "CRM" | "Operations" | "Finance" | "HR" | "System";
  description: string;
};

export const AVAILABLE_PERMISSIONS: PermissionOption[] = [
  {
    id: "dashboard",
    label: "Dashboard & Overview",
    category: "Overview",
    description: "Access to agency operational analytics and overview metrics",
  },
  {
    id: "clients",
    label: "Clients & CRM",
    category: "CRM",
    description: "View and manage clients, contracts, and credentials vault",
  },
  {
    id: "projects",
    label: "Projects & Tasks",
    category: "Operations",
    description: "Manage projects, task assignments, and time logs",
  },
  {
    id: "invoices",
    label: "Invoices & Revenue",
    category: "Finance",
    description: "Create and manage service invoices and payment receipts",
  },
  {
    id: "receivables",
    label: "Accounts Receivable",
    category: "Finance",
    description: "Track customer balances, aged dues, and collections",
  },
  {
    id: "expenses",
    label: "Agency Expenses",
    category: "Finance",
    description: "Submit, view, and process agency expenditures",
  },
  {
    id: "payables",
    label: "Accounts Payable",
    category: "Finance",
    description: "Manage vendor invoices and operational payables",
  },
  {
    id: "finances",
    label: "Financials & Banking",
    category: "Finance",
    description: "Access bank accounts, cash drawers, and transfers",
  },
  {
    id: "ledger",
    label: "General Ledger",
    category: "Finance",
    description: "Double-entry journal, chart of accounts, and financial audits",
  },
  {
    id: "equity",
    label: "Owner Equity & Profit",
    category: "Finance",
    description: "Partner equity records, drawings, and profit distributions",
  },
  {
    id: "hr",
    label: "Team Directory & Attendance",
    category: "HR",
    description: "View staff list, work shifts, and remote attendance",
  },
  {
    id: "payroll",
    label: "Payroll & Advances",
    category: "HR",
    description: "Process monthly salaries, allowances, and staff advances",
  },
  {
    id: "master_setup",
    label: "Master Setup Hub",
    category: "System",
    description: "Manage departments, designations, and system parameters",
  },
  {
    id: "settings",
    label: "Agency Settings",
    category: "System",
    description: "Modify agency branding, taxes, and operational rules",
  },
  {
    id: "users",
    label: "User Access & Roles",
    category: "System",
    description: "Manage staff logins, role assignments, and security",
  },
  {
    id: "audit_logs",
    label: "Security Audit Logs",
    category: "System",
    description: "Inspect immutable audit trails of sensitive modifications",
  },
];

export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    id: "role_super_admin",
    name: "SUPER_ADMIN",
    label: "Super Admin",
    description:
      "Highest authority in the system. Has unrestricted access across all outlets, role creation, system settings, financials, and audit logs.",
    baseRole: UserRole.SUPER_ADMIN,
    permissions: AVAILABLE_PERMISSIONS.map((p) => p.id),
    color: "purple",
    isSystem: true,
  },
  {
    id: "role_admin",
    name: "ADMIN",
    label: "Admin",
    description:
      "Agency-wide administrative access for managing users, projects, operations, finances, settings, and team performance.",
    baseRole: UserRole.ADMIN,
    permissions: [
      "dashboard",
      "clients",
      "projects",
      "invoices",
      "receivables",
      "expenses",
      "payables",
      "finances",
      "hr",
      "payroll",
      "master_setup",
      "settings",
      "users",
      "audit_logs",
    ],
    color: "blue",
    isSystem: true,
  },
  {
    id: "role_manager",
    name: "MANAGER",
    label: "Manager",
    description:
      "Operational leadership overseeing client deliveries, staff task allocations, expenditure approvals, and daily progress.",
    baseRole: UserRole.MANAGER,
    permissions: [
      "dashboard",
      "clients",
      "projects",
      "invoices",
      "receivables",
      "expenses",
      "payables",
      "finances",
      "hr",
    ],
    color: "indigo",
    isSystem: true,
  },
  {
    id: "role_accountant",
    name: "ACCOUNTANT",
    label: "Accountant",
    description:
      "Financial control role managing general ledgers, accounts payable/receivable, bank reconciliation, and P&L statements.",
    baseRole: UserRole.ACCOUNTANT,
    permissions: [
      "dashboard",
      "clients",
      "invoices",
      "receivables",
      "expenses",
      "payables",
      "finances",
      "ledger",
      "equity",
    ],
    color: "amber",
    isSystem: true,
  },
  {
    id: "role_hr",
    name: "HR",
    label: "HR",
    description:
      "People operations role handling employee profiles, attendance logs, leave approvals, salary advances, and monthly payroll.",
    baseRole: UserRole.HR,
    permissions: [
      "dashboard",
      "hr",
      "payroll",
      "master_setup",
    ],
    color: "pink",
    isSystem: true,
  },
  {
    id: "role_technician",
    name: "TECHNICIAN",
    label: "Technician",
    description:
      "Execution and specialist role dedicated to completing project tasks, service orders, time logs, and technical deliverables.",
    baseRole: UserRole.TECHNICIAN,
    permissions: ["dashboard", "projects"],
    color: "orange",
    isSystem: true,
  },
  {
    id: "role_cashier",
    name: "CASHIER",
    label: "Cashier",
    description:
      "Front-desk financial role managing customer invoice settlement, point-of-sale receipts, and daily cash drawer reconciliation.",
    baseRole: UserRole.CASHIER,
    permissions: ["dashboard", "clients", "invoices"],
    color: "green",
    isSystem: true,
  },
];
