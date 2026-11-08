import { canAccessRoute } from '@/lib/auth/route-access'
import {
  ArrowRightLeft,
  Banknote,
  BarChart2,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckSquare,
  Clock,
  Coins,
  CreditCard,
  FileText,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  PieChart,
  Receipt,
  Scale,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react'
import * as React from 'react'

export type NavSubItem = {
  title: string
  icon?: React.ReactNode
  url: string
}

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
  isActive?: boolean
  isPrimary?: boolean
  subItems?: NavSubItem[]
}

export type NavSection = {
  title: string
  url?: string
  items: NavItem[]
}

export const navData: NavSection[] = [
  {
    title: 'Agency Overview',
    url: '#',
    items: [
      {
        title: 'Dashboard',
        icon: <LayoutDashboard className="size-4 shrink-0 text-lime-400" />,
        url: '/',
      },
    ],
  },
  {
    title: 'Clients & CRM',
    url: '#',
    items: [
      {
        title: 'All Clients',
        icon: <UsersRound className="size-4 shrink-0 text-sky-400" />,
        url: '/clients',
      },
      {
        title: 'Projects & Contracts',
        icon: <Briefcase className="size-4 shrink-0 text-cyan-400" />,
        url: '/projects',
      },
      {
        title: 'Monthly Retainers',
        icon: <CalendarCheck className="size-4 shrink-0 text-emerald-400" />,
        url: '/clients/retainers',
      },
      {
        title: 'Credentials Vault',
        icon: <KeyRound className="size-4 shrink-0 text-amber-400" />,
        url: '/clients/credentials',
      },
    ],
  },
  {
    title: 'Invoicing & Revenue',
    url: '#',
    items: [
      {
        title: 'Service Invoices',
        icon: <Receipt className="size-4 shrink-0 text-emerald-400" />,
        url: '/invoices',
      },
      {
        title: 'Accounts Receivable',
        icon: <TrendingUp className="size-4 shrink-0 text-teal-400" />,
        url: '/accounts-receivable',
      },
    ],
  },
  {
    title: 'Expenses & Payables',
    url: '#',
    items: [
      {
        title: 'Agency Expenses',
        icon: <PiggyBank className="size-4 shrink-0 text-rose-400" />,
        url: '/expenses',
      },
      {
        title: 'Accounts Payable',
        icon: <CreditCard className="size-4 shrink-0 text-orange-400" />,
        url: '/accounts-payable',
      },
    ],
  },
  {
    title: 'Profit & Financials',
    url: '#',
    items: [
      {
        title: 'Profit & Loss (P&L)',
        icon: <PieChart className="size-4 shrink-0 text-lime-400" />,
        url: '/finances/profit-loss',
      },
      {
        title: 'Project Margins',
        icon: <BarChart2 className="size-4 shrink-0 text-cyan-400" />,
        url: '/finances/project-profitability',
      },
      {
        title: 'Bank & MFS Accounts',
        icon: <Banknote className="size-4 shrink-0 text-indigo-400" />,
        url: '/finances/banks',
      },
      {
        title: 'Bank Transfers',
        icon: <ArrowRightLeft className="size-4 shrink-0 text-blue-400" />,
        url: '/finances/transfers',
      },
      {
        title: 'General Ledger',
        icon: <History className="size-4 shrink-0 text-slate-400" />,
        url: '/ledger/transactions',
      },
    ],
  },
  {
    title: 'Owner Equity & Dividends',
    url: '#',
    items: [
      {
        title: 'Partners & Equity',
        icon: <Scale className="size-4 shrink-0 text-yellow-400" />,
        url: '/equity',
      },
      {
        title: 'Profit Share Distributions',
        icon: <Coins className="size-4 shrink-0 text-amber-400" />,
        url: '/equity/distributions',
      },
      {
        title: 'Owner Drawings',
        icon: <CreditCard className="size-4 shrink-0 text-orange-400" />,
        url: '/equity/drawings',
      },
    ],
  },
  {
    title: 'People & HR',
    url: '#',
    items: [
      {
        title: 'Team Directory',
        icon: <Users className="size-4 shrink-0 text-violet-400" />,
        url: '/hr/employees',
      },
      {
        title: 'Attendance & Remote Log',
        icon: <Clock className="size-4 shrink-0 text-purple-400" />,
        url: '/hr/attendance',
      },
      {
        title: 'Leave Requests',
        icon: <CheckSquare className="size-4 shrink-0 text-emerald-400" />,
        url: '/hr/leaves',
      },
      {
        title: 'Monthly Payroll',
        icon: <Banknote className="size-4 shrink-0 text-teal-400" />,
        url: '/hr/payroll',
      },
      {
        title: 'Salary Advances',
        icon: <Coins className="size-4 shrink-0 text-amber-400" />,
        url: '/hr/advances',
      },
    ],
  },
  {
    title: 'System & Masters',
    url: '#',
    items: [
      {
        title: 'Agency Settings',
        icon: <Settings className="size-4 shrink-0 text-slate-400" />,
        url: '/settings',
      },
      {
        title: 'Departments & Roles',
        icon: <Briefcase className="size-4 shrink-0 text-sky-400" />,
        url: '/master-setup/departments',
      },
      {
        title: 'Chart of Accounts',
        icon: <Landmark className="size-4 shrink-0 text-indigo-400" />,
        url: '/master-setup/chart-of-accounts',
      },
      {
        title: 'User Access',
        icon: <UserCog className="size-4 shrink-0 text-blue-400" />,
        url: '/users',
      },
      {
        title: 'Audit Logs',
        icon: <ShieldAlert className="size-4 shrink-0 text-rose-400" />,
        url: '/reports/audit',
      },
    ],
  },
]

export function getNavDataForRole(role: string): NavSection[] {
  return navData
    .map(section => {
      const items = section.items
        .map(item => {
          const filteredSubItems = item.subItems?.filter(subItem =>
            canAccessRoute(role, subItem.url)
          )

          if (item.subItems?.length) {
            if (!filteredSubItems || filteredSubItems.length === 0) return null
            return {
              ...item,
              subItems: filteredSubItems,
            }
          }

          if (!canAccessRoute(role, item.url)) return null
          return item
        })
        .filter((item): item is NavItem => item !== null)

      if (items.length === 0) return null
      return {
        ...section,
        items,
      }
    })
    .filter((section): section is NavSection => section !== null)
}
