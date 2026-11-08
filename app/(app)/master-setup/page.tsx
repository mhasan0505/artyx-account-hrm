import { auth } from '@/auth'
import {
  getMasterSetupCounts,
  type MasterSetupCounts,
} from '@/lib/actions/master-setup'
import { canAccessRoute } from '@/lib/auth/route-access'
import {
  Banknote,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  ChevronRight,
  Cpu,
  CreditCard,
  FileText,
  Folder,
  FolderTree,
  HardDrive,
  Layers,
  MemoryStick,
  Monitor,
  Percent,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  UserCog,
  UsersRound,
} from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type MasterCardItem = {
  title: string
  href: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  countKey: keyof MasterSetupCounts
  countUnit?: string
  accentColor: string
}

type MasterGroup = {
  id: string
  title: string
  description: string
  cards: MasterCardItem[]
}

const MASTER_GROUPS: MasterGroup[] = [
  {
    id: 'finance-masters',
    title: 'Finance & Banking',
    description: 'Bank institutions, mobile accounts, and ledger account structures.',
    cards: [
      {
        title: 'Bank & MFS Accounts',
        href: '/finances/banks',
        description: 'Store checking accounts, bKash merchant, and Nagad gateways.',
        icon: Banknote,
        countKey: 'bankAccounts',
        countUnit: 'accounts',
        accentColor: 'text-emerald-600 bg-emerald-600/10 border-emerald-600/20',
      },
      {
        title: 'Chart of Accounts',
        href: '/master-setup/chart-of-accounts',
        description: 'Standard double-entry accounting ledger accounts.',
        icon: BookOpen,
        countKey: 'chartOfAccounts',
        countUnit: 'ledger accounts',
        accentColor: 'text-indigo-600 bg-indigo-600/10 border-indigo-600/20',
      },
    ],
  },
  {
    id: 'people-masters',
    title: 'People & HR',
    description: 'Organizational hierarchy, staff designations, and departments.',
    cards: [
      {
        title: 'Departments',
        href: '/master-setup/departments',
        description: 'Company divisions, project teams, and departments.',
        icon: Building2,
        countKey: 'departments',
        countUnit: 'departments',
        accentColor: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
      },
      {
        title: 'Designations',
        href: '/master-setup/designations',
        description: 'Job positions, developer ranks, and agency titles.',
        icon: Briefcase,
        countKey: 'designations',
        countUnit: 'designations',
        accentColor: 'text-amber-600 bg-amber-600/10 border-amber-600/20',
      },
    ],
  },
  {
    id: 'sales-billing',
    title: 'Billing & Payments',
    description: 'Payment methods, gateway channels, and tax rates.',
    cards: [
      {
        title: 'Payment Methods',
        href: '/settings/payment-methods',
        description: 'Enable or disable Cash, Card, Bank, and MFS options.',
        icon: CreditCard,
        countKey: 'paymentMethods',
        countUnit: 'methods',
        accentColor: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
      },
      {
        title: 'Tax Rates',
        href: '/settings/tax',
        description: 'Standard VAT percentages and default service tax rates.',
        icon: Calculator,
        countKey: 'taxRates',
        countUnit: 'tax rates',
        accentColor: 'text-green-500 bg-green-500/10 border-green-500/20',
      },
    ],
  },
  {
    id: 'agency-system',
    title: 'Agency & System',
    description: 'System configuration, letterhead invoice formatting, and audit records.',
    cards: [
      {
        title: 'Agency Settings',
        href: '/settings',
        description: 'Agency name, default currency, and operational policies.',
        icon: Settings,
        countKey: 'storeSettings',
        countUnit: 'settings',
        accentColor: 'text-blue-600 bg-blue-600/10 border-blue-600/20',
      },
      {
        title: 'Letterhead & Invoice Terms',
        href: '/settings/letterhead',
        description: 'Invoice headers, agency footer terms, and print formats.',
        icon: FileText,
        countKey: 'letterhead',
        countUnit: 'template',
        accentColor: 'text-cyan-600 bg-cyan-600/10 border-cyan-600/20',
      },
      {
        title: 'Users & Roles',
        href: '/users',
        description: 'Staff authentication, role permissions, and access keys.',
        icon: UserCog,
        countKey: 'users',
        countUnit: 'users',
        accentColor: 'text-purple-600 bg-purple-600/10 border-purple-600/20',
      },
      {
        title: 'Audit Logs',
        href: '/reports/audit',
        description: 'Complete immutable log of critical modifications and overrides.',
        icon: ShieldAlert,
        countKey: 'auditLogs',
        countUnit: 'audit records',
        accentColor: 'text-rose-600 bg-rose-600/10 border-rose-600/20',
      },
    ],
  },
]

export default async function MasterSetupHubPage() {
  const session = await auth()
  const role = session?.user?.role

  if (!canAccessRoute(role, '/master-setup')) {
    redirect('/')
  }

  // Fetch record counts via role-checked server action
  const counts = await getMasterSetupCounts().catch(() => ({
    categories: 0,
    subcategories: 0,
    brands: 0,
    parents: 0,
    processors: 0,
    processorGens: 0,
    ram: 0,
    storage: 0,
    customerGroups: 0,
    discountLimits: null,
    paymentMethods: 0,
    taxRates: 0,
    bankAccounts: 0,
    chartOfAccounts: 0,
    departments: 0,
    designations: 0,
    storeSettings: 0,
    letterhead: null,
    users: 0,
    hardware: null,
    auditLogs: 0,
  }))

  // Filter cards by route access for the current user role
  const visibleGroups = MASTER_GROUPS.map(group => {
    const visibleCards = group.cards.filter(card =>
      canAccessRoute(role, card.href)
    )
    return {
      ...group,
      cards: visibleCards,
    }
  }).filter(group => group.cards.length > 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 w-full">
      {/* Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs tracking-wider uppercase">
            <SlidersHorizontal className="size-4" />
            <span>Core Administration</span>
          </div>
          <h1 className="page-title text-3xl font-bold tracking-tight text-foreground">
            Master Setup
          </h1>
          <p className="page-subtitle text-sm text-muted-foreground max-w-3xl">
            Centralized hub for system master data, hardware parameters, sales policies, and organization structures.
          </p>
        </div>
      </div>

      {/* Grouped Sections */}
      <div className="space-y-10">
        {visibleGroups.map(group => (
          <section key={group.id} className="space-y-3.5">
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                {group.title}
              </h2>
              <p className="text-xs text-muted-foreground">
                {group.description}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {group.cards.map(card => {
                const countVal = counts[card.countKey]
                const IconComponent = card.icon

                return (
                  <Link
                    key={card.title}
                    href={card.href}
                    className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-md hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  >
                    <div>
                      {/* Top icon and optional count chip */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span
                          className={`flex size-9 items-center justify-center rounded-lg border ${card.accentColor}`}
                        >
                          <IconComponent className="size-4.5" />
                        </span>
                        {countVal !== null && countVal !== undefined && (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                            {countVal}{' '}
                            <span className="font-normal text-[11px]">
                              {countVal === 1
                                ? card.countUnit?.replace(/s$/, '') || 'item'
                                : card.countUnit || 'items'}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Title & description */}
                      <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {card.title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {card.description}
                      </p>
                    </div>

                    {/* Bottom Action Hint */}
                    <div className="mt-4 flex items-center justify-between text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors border-t border-border/40 pt-2.5">
                      <span>Manage records</span>
                      <ChevronRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
