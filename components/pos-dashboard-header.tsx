'use client'

import {
  Briefcase,
  ChevronDown,
  Coins,
  FileText,
  KeyRound,
  LogOut,
  MessageSquare,
  Plus,
  Receipt,
  SearchIcon,
  Settings,
  TrendingUp,
  User,
  UserCircle,
} from 'lucide-react'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import { CommandPalette } from '@/components/command-palette'
import { ThemeToggle } from '@/components/theme-toggle'
import { HeaderNotifications } from '@/components/header/header-notifications'
import { navData } from '@/components/nav-data'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { canAccessRoute } from '@/lib/auth/route-access'
import { performLogoutCleanup } from '@/lib/auth/logout-cleanup'
import { cn } from '@/lib/utils'

type PosDashboardHeaderProps = {
  userName: string
  outletName?: string
  outletId?: string | null
  userRole: string
  userImage?: string | null
  className?: string
}

export function PosDashboardHeader({
  userName,
  userRole,
  userImage,
  className,
}: PosDashboardHeaderProps) {
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const pathname = usePathname()

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Derive breadcrumbs from navData using longest prefix match
  const breadcrumbs = React.useMemo(() => {
    if (!pathname || pathname === '/') {
      return [{ label: 'Agency Overview', href: '/' }, { label: 'Dashboard', href: '/' }]
    }

    if (pathname.startsWith('/master-setup')) {
      const parts = [{ label: 'Master Setup', href: '/master-setup' }]
      const sub = pathname.replace('/master-setup', '').replace(/^\//, '')
      if (sub) {
        const title = sub
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
        parts.push({ label: title, href: pathname })
      }
      return parts
    }

    let foundSection = ''
    let foundItem: { title: string; url: string } | null = null
    let bestLength = -1

    for (const section of navData) {
      for (const item of section.items) {
        if (
          item.url !== '#' &&
          (pathname === item.url ||
            (item.url !== '/' && pathname.startsWith(`${item.url}/`)))
        ) {
          if (item.url.length > bestLength) {
            bestLength = item.url.length
            foundSection = section.title
            foundItem = item
          }
        }
      }
    }

    if (foundSection && foundItem) {
      return [
        { label: foundSection, href: '#' },
        { label: foundItem.title, href: foundItem.url },
      ]
    }

    // Fallback based on pathname segments
    const segments = pathname.split('/').filter(Boolean)
    return segments.map((seg, idx) => ({
      label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '),
      href: '/' + segments.slice(0, idx + 1).join('/'),
    }))
  }, [pathname])

  const canManagePin =
    userRole === 'SUPER_ADMIN' ||
    userRole === 'ADMIN' ||
    userRole === 'MANAGER'
  const canAccessSettings = canAccessRoute(userRole, '/settings')

  return (
    <>
      <CommandPalette open={cmdOpen} onOpenChangeAction={setCmdOpen} />
      <header
        className={cn(
          'sticky top-0 z-20 flex h-16 w-full max-w-full shrink-0 items-center justify-between gap-2.5 sm:gap-3 border-b border-border/80 bg-card/95 backdrop-blur-md px-3 sm:px-5 shadow-xs transition-colors print:hidden overflow-hidden',
          className
        )}
      >
        {/* Left: Sidebar Trigger & Breadcrumbs */}
        <div className="flex items-center gap-2.5 shrink-0 min-w-0">
          <SidebarTrigger className="-ml-1 size-9 rounded-xl border border-border bg-card hover:bg-muted/60 text-foreground active:scale-95 shadow-2xs flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shrink-0" />
          <Separator
            orientation="vertical"
            className="hidden sm:block bg-border data-vertical:h-5 data-vertical:self-auto shrink-0"
          />

          {/* Breadcrumbs */}
          <div className="hidden sm:flex items-center pl-1 shrink-0 max-w-xs md:max-w-sm lg:max-w-md overflow-hidden">
            <Breadcrumb>
              <BreadcrumbList className="flex flex-nowrap whitespace-nowrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1
                  return (
                    <React.Fragment key={crumb.label + idx}>
                      {idx > 0 && (
                        <BreadcrumbSeparator className="text-muted-foreground/60 [&>svg]:size-3 shrink-0" />
                      )}
                      <BreadcrumbItem className="shrink-0 whitespace-nowrap">
                        {isLast ? (
                          <BreadcrumbPage className="font-bold text-foreground text-xs whitespace-nowrap truncate max-w-40 inline-block">
                            {crumb.label}
                          </BreadcrumbPage>
                        ) : crumb.href !== '#' ? (
                          <BreadcrumbLink
                            href={crumb.href}
                            className="text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap truncate max-w-36 inline-block"
                          >
                            {crumb.label}
                          </BreadcrumbLink>
                        ) : (
                          <span className="text-muted-foreground/70 whitespace-nowrap truncate max-w-36 inline-block">{crumb.label}</span>
                        )}
                      </BreadcrumbItem>
                    </React.Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>

        {/* Center: Search trigger with ⌘ K shortcut hint */}
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          className="hidden min-w-32 max-w-sm flex-1 cursor-pointer items-center gap-2.5 rounded-xl border border-input bg-muted/30 hover:bg-muted/60 hover:border-primary/40 active:scale-[0.99] px-3.5 h-9 text-xs text-muted-foreground shadow-2xs transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary lg:flex"
        >
          <SearchIcon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 text-left text-muted-foreground text-xs truncate">
            Search clients, invoices, projects...
          </span>
          <kbd className="pointer-events-none rounded-lg border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-2xs font-mono shrink-0">
            ⌘ K
          </kbd>
        </button>

        {/* Right: Agency Financial Context, Actions, Notifications, Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Currency Pill: BDT (৳) */}
          <div
            className="hidden xl:inline-flex items-center gap-1.5 px-2.5 h-8.5 rounded-xl border border-border/80 bg-muted/40 text-xs font-semibold text-foreground shadow-2xs select-none"
            title="Accounting Currency: Bangladeshi Taka (BDT ৳)"
          >
            <span className="text-primary font-black text-sm">৳</span>
            <span className="tracking-tight text-xs font-mono font-bold">BDT</span>
          </div>

          {/* Agency P&L Quick Status Link */}
          <Link
            href="/finances/profit-loss"
            className="hidden 2xl:inline-flex items-center gap-1.5 px-3 h-8.5 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted text-xs font-semibold text-foreground transition-all cursor-pointer shadow-2xs"
            title="Real-Time Agency P&L Intelligence"
          >
            <TrendingUp className="size-3.5 text-primary" />
            <span className="text-[11px] font-mono tracking-tight text-foreground font-bold">P&L Intelligence</span>
          </Link>

          {/* Agency Quick Create Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-border hover:border-primary/40 bg-card hover:bg-muted/60 active:scale-95 px-3 h-8.5 text-xs font-semibold text-foreground shadow-2xs transition-all cursor-pointer"
              >
                <Plus className="size-3.5 stroke-[2.5] text-primary" />
                <span>Quick Create</span>
                <ChevronDown className="size-3 text-muted-foreground ml-0.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl border-border/80 rounded-xl">
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2">
                <Link href="/invoices/new" className="flex items-center gap-2.5 font-medium">
                  <FileText className="size-4 text-primary" />
                  <span>New Service Invoice</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2">
                <Link href="/clients" className="flex items-center gap-2.5 font-medium">
                  <Briefcase className="size-4 text-primary" />
                  <span>Add New Client</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2">
                <Link href="/clients/credentials" className="flex items-center gap-2.5 font-medium">
                  <KeyRound className="size-4 text-primary" />
                  <span>Store Client Credential</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2">
                <Link href="/expenses" className="flex items-center gap-2.5 font-medium">
                  <Receipt className="size-4 text-primary" />
                  <span>Record Agency Expense</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2">
                <Link href="/equity/distributions" className="flex items-center gap-2.5 font-medium">
                  <Coins className="size-4 text-primary" />
                  <span>Partner Profit Distribution</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Primary Quick Invoice Action Button */}
          <Link
            href="/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground active:scale-95 px-3.5 h-8.5 text-xs font-bold shadow-2xs transition-all cursor-pointer shrink-0"
          >
            <Plus className="size-3.5 stroke-[3]" />
            <span>Invoice</span>
          </Link>

          {/* Mobile Search Button (< lg) */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCmdOpen(true)}
            className="size-8.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 shadow-2xs transition-all cursor-pointer lg:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label="Search"
            title="Search"
          >
            <SearchIcon className="size-3.5" />
          </Button>

          {/* Real-time Team Chat Trigger */}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('artyx-open-chat'))
              }
            }}
            className="size-8.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 flex items-center justify-center shadow-2xs transition-all shrink-0 cursor-pointer"
            title="Real-time Team Chat (Socket.io)"
            aria-label="Real-time Team Chat"
          >
            <MessageSquare className="size-3.5" />
          </button>

          {/* Agency Notifications Feed */}
          <HeaderNotifications triggerClassName="size-8.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 shadow-2xs data-[state=open]:bg-muted data-[state=open]:text-foreground transition-all" />

          {/* Settings Shortcut */}
          {canAccessSettings && (
            <Link
              href="/settings"
              className="size-8.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 flex items-center justify-center shadow-2xs transition-all shrink-0"
              title="Agency Settings"
            >
              <Settings className="size-3.5" />
            </Link>
          )}

          {/* Theme Toggle (Dark / Light) */}
          <ThemeToggle />

          <Separator
            orientation="vertical"
            className="hidden sm:block mx-0.5 bg-border data-vertical:h-5 data-vertical:self-auto shrink-0"
          />

          {/* User Profile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8.5 items-center gap-2 rounded-xl border border-border bg-card px-2 text-foreground hover:bg-muted/60 hover:text-foreground active:scale-95 shadow-2xs outline-none focus-visible:ring-1 focus-visible:ring-primary data-[state=open]:bg-muted cursor-pointer transition-all shrink-0"
                aria-label="User profile menu"
              >
                <span className="relative flex size-6 items-center justify-center rounded-full bg-muted border border-border overflow-hidden shadow-2xs shrink-0">
                  {userImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userImage}
                      alt={userName || 'User'}
                      className="size-full object-cover"
                    />
                  ) : (
                    <User className="size-3 text-muted-foreground" />
                  )}
                  <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-emerald-500 ring-1 ring-card" />
                </span>
                <span className="hidden text-xs font-semibold text-foreground md:inline max-w-28 truncate">
                  {userName || 'Admin'}
                </span>
                <ChevronDown className="size-3 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 p-1.5 shadow-xl border-border rounded-xl"
              sideOffset={8}
            >
              <DropdownMenuLabel className="font-normal p-2.5 bg-muted/40 rounded-lg mb-1 border border-border/50">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card border border-border overflow-hidden shadow-2xs">
                    {userImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userImage}
                        alt={userName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <User className="size-4.5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="flex flex-col space-y-0.5 overflow-hidden">
                    <p className="text-sm font-semibold truncate text-foreground leading-tight">
                      {userName || '—'}
                    </p>
                    <p className="text-xs font-semibold text-primary truncate leading-tight">
                      {userRole.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Artyx Digital ERP
                    </p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild className="gap-2 cursor-pointer py-2 rounded-lg">
                  <Link href="/profile">
                    <UserCircle className="size-4 text-muted-foreground" />
                    <span>My Profile</span>
                  </Link>
                </DropdownMenuItem>

                {canManagePin && (
                  <DropdownMenuItem
                    asChild
                    className="gap-2 cursor-pointer py-2 rounded-lg"
                  >
                    <Link href="/profile#manager-pin">
                      <KeyRound className="size-4 text-amber-500" />
                      <span>Security & PIN</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                {canAccessSettings && (
                  <DropdownMenuItem
                    asChild
                    className="gap-2 cursor-pointer py-2 rounded-lg"
                  >
                    <Link href="/settings">
                      <Settings className="size-4 text-muted-foreground" />
                      <span>Agency Settings</span>
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 cursor-pointer py-2 rounded-lg text-rose-600 focus:text-rose-600 focus:bg-rose-500/10"
                onClick={async () => {
                  await performLogoutCleanup()
                  signOut({ callbackUrl: '/login' })
                }}
              >
                <LogOut className="size-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}
