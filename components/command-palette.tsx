'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { globalSearch, type SearchResultItem } from '@/lib/actions/search'
import { canAccessRoute } from '@/lib/auth/route-access'
import { navData } from '@/components/nav-data'
import {
  Barcode,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  ClipboardList,
  Coins,
  Cpu,
  CreditCard,
  FileQuestion,
  FileText,
  Folder,
  FolderTree,
  HardDrive,
  Layers,
  Loader2,
  MemoryStick,
  Package,
  Percent,
  Receipt,
  ReceiptText,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Tags,
  User,
  Users,
  UsersRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import * as React from 'react'

type CommandItem = {
  id: string
  label: string
  section: string
  href: string
  icon: React.ReactNode
  keywords: string[]
}

const masterSetupPages: CommandItem[] = [
  {
    id: 'master-setup-hub',
    label: 'Master Setup Hub',
    section: 'Master Setup',
    href: '/master-setup',
    icon: <SlidersHorizontal className="size-4" />,
    keywords: ['master', 'setup', 'config', 'admin', 'hub'],
  },
  {
    id: 'master-chart-of-accounts',
    label: 'Chart of Accounts',
    section: 'Master Setup',
    href: '/master-setup/chart-of-accounts',
    icon: <BookOpen className="size-4" />,
    keywords: ['chart of accounts', 'coa', 'ledger', 'accounting', 'assets', 'liabilities'],
  },
  {
    id: 'master-departments',
    label: 'Departments',
    section: 'Master Setup',
    href: '/master-setup/departments',
    icon: <Building2 className="size-4" />,
    keywords: ['department', 'departments', 'division', 'team'],
  },
  {
    id: 'master-designations',
    label: 'Designations',
    section: 'Master Setup',
    href: '/master-setup/designations',
    icon: <Briefcase className="size-4" />,
    keywords: ['designation', 'designations', 'title', 'role', 'position'],
  },
  {
    id: 'agency-settings',
    label: 'Agency Settings',
    section: 'Master Setup',
    href: '/settings',
    icon: <SlidersHorizontal className="size-4" />,
    keywords: ['settings', 'config', 'currency', 'company', 'agency'],
  },
  {
    id: 'master-payment-methods',
    label: 'Payment Methods',
    section: 'Master Setup',
    href: '/settings/payment-methods',
    icon: <CreditCard className="size-4" />,
    keywords: ['payment', 'method', 'cash', 'card', 'bkash', 'nagad'],
  },
  {
    id: 'master-tax',
    label: 'Tax Rates',
    section: 'Master Setup',
    href: '/settings/tax',
    icon: <Calculator className="size-4" />,
    keywords: ['tax', 'vat', 'tax rate', 'gst'],
  },
  {
    id: 'master-letterhead',
    label: 'Letterhead & Invoice Terms',
    section: 'Master Setup',
    href: '/settings/letterhead',
    icon: <FileText className="size-4" />,
    keywords: ['letterhead', 'invoice terms', 'print footer', 'receipt header'],
  },
  {
    id: 'user-profile',
    label: 'My Profile',
    section: 'System',
    href: '/profile',
    icon: <User className="size-4" />,
    keywords: ['profile', 'account', 'me', 'password', 'pin'],
  },
]

const typeIcon: Record<SearchResultItem['type'], React.ReactNode> = {
  client: <Building2 className="size-4 text-sky-500" />,
  project: <Briefcase className="size-4 text-purple-500" />,
  partner: <Coins className="size-4 text-amber-500" />,
  invoice: <Receipt className="size-4 text-emerald-500" />,
  employee: <Users className="size-4 text-indigo-500" />,
  product: <Package className="size-4 text-blue-500" />,
  sale: <Receipt className="size-4 text-emerald-500" />,
  customer: <User className="size-4 text-violet-500" />,
  purchase: <ShoppingCart className="size-4 text-amber-500" />,
  supplier: <Store className="size-4 text-orange-500" />,
  b2b: <Building2 className="size-4 text-sky-500" />,
  serial: <Barcode className="size-4 text-cyan-500" />,
  quotation: <FileQuestion className="size-4 text-pink-500" />,
  service: <ClipboardList className="size-4 text-red-400" />,
}

const typeLabel: Record<SearchResultItem['type'], string> = {
  client: 'Agency Clients',
  project: 'Projects',
  partner: 'Owners & Partners',
  invoice: 'Service Invoices',
  employee: 'Team & HR',
  product: 'Products',
  sale: 'Sales & Invoices',
  customer: 'Customers',
  purchase: 'Purchase Orders',
  supplier: 'Suppliers',
  b2b: 'B2B Clients',
  serial: 'Serial Numbers',
  quotation: 'Quotations',
  service: 'Service Jobs',
}

export function CommandPalette({
  open,
  onOpenChangeAction,
}: {
  open: boolean
  onOpenChangeAction: (open: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [dataResults, setDataResults] = React.useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const { data: session } = useSession()
  const userRole = session?.user?.role

  // Build command palette dynamically from navData + masterSetupPages
  const allCommandItems = React.useMemo(() => {
    const seenHrefs = new Set<string>()
    const items: CommandItem[] = []

    // 1. Pages from navData
    navData.forEach(section => {
      section.items.forEach(item => {
        if (item.url && item.url !== '#' && !seenHrefs.has(item.url)) {
          seenHrefs.add(item.url)
          items.push({
            id: item.url,
            label: item.title,
            section: section.title,
            href: item.url,
            icon: item.icon,
            keywords: [item.title.toLowerCase(), section.title.toLowerCase()],
          })
        }
      })
    })

    // 2. Master Setup & system utility pages
    masterSetupPages.forEach(item => {
      if (!seenHrefs.has(item.href)) {
        seenHrefs.add(item.href)
        items.push(item)
      }
    })

    return items
  }, [])

  // Filter page routes by query and canAccessRoute
  const filteredPages = React.useMemo(() => {
    if (!query.trim()) return []
    const lower = query.toLowerCase()
    return allCommandItems.filter(
      item =>
        canAccessRoute(userRole, item.href) &&
        (item.label.toLowerCase().includes(lower) ||
          item.section.toLowerCase().includes(lower) ||
          item.href.toLowerCase().includes(lower) ||
          item.keywords.some(k => k.includes(lower)))
    )
  }, [query, userRole, allCommandItems])

  // Debounced data search
  React.useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setDataResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await globalSearch(query)
        setDataResults(results)
      } catch {
        setDataResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [query])

  // Total selectable items count
  const totalItems = filteredPages.length + dataResults.length

  // Reset active index when results change
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query, filteredPages.length, dataResults.length])

  // Focus input when dialog opens
  React.useEffect(() => {
    if (open) {
      setQuery('')
      setDataResults([])
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const navigateTo = React.useCallback(
    (href: string) => {
      onOpenChangeAction(false)
      router.push(href)
    },
    [onOpenChangeAction, router]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev + 1) % Math.max(totalItems, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev - 1 + totalItems) % Math.max(totalItems, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex < filteredPages.length) {
        const page = filteredPages[activeIndex]
        if (page) navigateTo(page.href)
      } else {
        const result = dataResults[activeIndex - filteredPages.length]
        if (result) navigateTo(result.href)
      }
    } else if (e.key === 'Escape') {
      onOpenChangeAction(false)
    }
  }

  // Scroll active item into view
  React.useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`
    )
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // Group data results by type
  const groupedDataResults = React.useMemo(() => {
    const map = new Map<SearchResultItem['type'], SearchResultItem[]>()
    dataResults.forEach(item => {
      const existing = map.get(item.type) ?? []
      map.set(item.type, [...existing, item])
    })
    return map
  }, [dataResults])

  // Quick navigation recommendations when query is empty
  const defaultQuickLinks = React.useMemo(() => {
    const recommendedHrefs = [
      '/sales',
      '/products',
      '/create-products',
      '/finances/drawer',
      '/master-setup',
      '/reports',
    ]
    return allCommandItems.filter(
      item =>
        recommendedHrefs.includes(item.href) &&
        canAccessRoute(userRole, item.href)
    )
  }, [allCommandItems, userRole])

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden shadow-2xl border-white/20 dark:border-white/10 [&>button]:hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Quick Navigation & Search</DialogTitle>
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/80 bg-muted/30">
          <Search className="size-4.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a page, product, invoice, customer, or serial..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none"
          />
          {isSearching && (
            <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
          )}
          <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2 space-y-4"
        >
          {/* Empty Query: Quick Navigation Links */}
          {!query.trim() && (
            <div className="space-y-1">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Quick Navigation
              </p>
              <div className="grid grid-cols-2 gap-1">
                {defaultQuickLinks.map(page => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => navigateTo(page.href)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent/80 hover:text-accent-foreground transition-colors cursor-pointer"
                  >
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                      {page.icon}
                    </span>
                    <div className="truncate">
                      <p className="font-medium text-foreground text-xs leading-tight">
                        {page.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {page.section}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Page Results */}
          {filteredPages.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pages & Actions
              </p>
              {filteredPages.map((page, idx) => {
                const isSelected = activeIndex === idx
                return (
                  <button
                    key={page.id}
                    data-index={idx}
                    type="button"
                    onClick={() => navigateTo(page.href)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-foreground/90 hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0 [&_svg]:size-3.5">
                        {page.icon}
                      </span>
                      <span className="truncate">{page.label}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {page.section}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Database Search Results grouped by Type */}
          {Array.from(groupedDataResults.entries()).map(([type, items]) => {
            const startIndex = filteredPages.length
            return (
              <div key={type} className="space-y-1">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {typeLabel[type] ?? type}
                </p>
                {items.map(item => {
                  const globalIdx =
                    startIndex + dataResults.indexOf(item)
                  const isSelected = activeIndex === globalIdx
                  return (
                    <button
                      key={item.id}
                      data-index={globalIdx}
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground/90 hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                          {typeIcon[item.type]}
                        </span>
                        <div className="truncate">
                          <p className="font-medium text-xs text-foreground truncate">
                            {item.label}
                          </p>
                          {item.sublabel && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.sublabel}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] rounded bg-muted/80 px-1.5 py-0.5 text-muted-foreground shrink-0">
                        {typeLabel[item.type] ?? item.type}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* No results state */}
          {query.trim() &&
            filteredPages.length === 0 &&
            dataResults.length === 0 &&
            !isSearching && (
              <div className="p-8 text-center text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">No matches found</p>
                <p className="text-xs">
                  We could not find any pages, products, or records matching &ldquo;{query}&rdquo;.
                </p>
              </div>
            )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between border-t border-border/80 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Navigate:</span>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
              ↑
            </kbd>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
              ↓
            </kbd>
          </div>
          <div className="flex items-center gap-2">
            <span>Open:</span>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
              ↵
            </kbd>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
