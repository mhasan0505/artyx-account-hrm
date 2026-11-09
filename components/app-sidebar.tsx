'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, ChevronsLeft } from 'lucide-react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getNavDataForRole, type NavItem } from './nav-data'

const STORAGE_KEY = 'artyx_sidebar_sections_v1'

function getSavedSectionStates(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function persistSectionStates(states: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(states))
  } catch {}
}

function CollapsedRouteTooltip({
  item,
  isActive,
  isCollapsed,
  children,
}: {
  item: NavItem
  isActive: boolean
  isCollapsed: boolean
  children: React.ReactNode
}) {
  if (!isCollapsed) return <>{children}</>

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <div className="w-full flex justify-center">{children}</div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={12}
        className={cn(
          'z-50 inline-flex items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 text-xs font-medium text-popover-foreground shadow-2xl backdrop-blur-md',
          'animate-in fade-in-0 zoom-in-95 data-[side=right]:slide-in-from-left-2 duration-200'
        )}
      >
        {isActive ? (
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        )}
        <span className="tracking-tight font-medium text-foreground">{item.title}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function NavItemLink({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem
  isActive: boolean
  onNavigate?: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <Link
      href={item.url}
      onClick={onNavigate}
      aria-label={item.title}
      aria-current={isActive ? 'page' : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group/link relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200 ease-out isolation-auto active:scale-[0.98]',
        'group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:mx-auto',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
        isActive
          ? 'text-primary font-bold'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {/* Active Indicator with left accent pill */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute inset-0 bg-primary/10 border border-primary/25 dark:border-lime/30 rounded-xl -z-10 shadow-2xs"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary shadow-[0_0_8px_rgba(127,255,0,0.5)]" />
        </motion.div>
      )}

      {/* Hover Glow Field */}
      {isHovered && !isActive && (
        <motion.div
          layoutId="sidebar-hover-indicator"
          className="absolute inset-0 bg-muted/60 border border-border/40 rounded-xl -z-10"
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        />
      )}

      <span
        className={cn(
          'size-4 shrink-0 flex items-center justify-center [&_svg]:size-4 transition-transform duration-200 group-hover/link:scale-110',
          isActive
            ? 'text-primary'
            : 'text-muted-foreground group-hover/link:text-foreground'
        )}
      >
        {item.icon}
      </span>

      <span className="flex-1 truncate tracking-tight transition-opacity duration-200 group-data-[collapsible=icon]:hidden">
        {item.title}
      </span>

      {item.isPrimary && (
        <span className="rounded-md bg-primary/10 text-primary dark:bg-lime/15 dark:text-lime border border-primary/25 dark:border-lime/30 px-1.5 py-0.5 text-[9px] font-bold tracking-wider group-data-[collapsible=icon]:hidden">
          NEW
        </span>
      )}
    </Link>
  )
}

function NavDropdownItem({
  item,
  pathname,
  isCollapsed,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  isCollapsed: boolean
  onNavigate?: () => void
}) {
  const hasActiveChild = useMemo(() => {
    if (!item.subItems?.length || !pathname) return false
    return item.subItems.some(sub => {
      if (!sub.url || sub.url === '#') return false
      const cleanSubUrl = sub.url.split('?')[0].split('#')[0]
      return (
        pathname === cleanSubUrl ||
        (cleanSubUrl !== '/' && pathname.startsWith(`${cleanSubUrl}/`))
      )
    })
  }, [item.subItems, pathname])

  const [isOpen, setIsOpen] = useState(hasActiveChild)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    if (hasActiveChild) setIsOpen(true)
  }, [hasActiveChild])

  if (isCollapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'relative flex size-10 items-center justify-center rounded-xl p-0 transition-all duration-200 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 mx-auto',
              hasActiveChild
                ? 'bg-primary/10 border border-primary/30 text-primary font-semibold shadow-xs'
                : 'bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
            title={item.title}
            aria-label={item.title}
          >
            <span
              className={cn(
                'size-4 shrink-0 flex items-center justify-center [&_svg]:size-4',
                hasActiveChild ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {item.icon}
            </span>
            {hasActiveChild && (
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          sideOffset={12}
          className="w-56 p-1.5 shadow-2xl border border-border bg-popover text-popover-foreground rounded-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 data-[side=right]:slide-in-from-left-2 duration-200"
        >
          <DropdownMenuLabel className="px-2.5 py-2 text-xs font-medium flex items-center gap-2">
            <span className="size-4 text-primary shrink-0 [&_svg]:size-4">
              {item.icon}
            </span>
            <span className="truncate text-foreground font-semibold">{item.title}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1 border-border" />
          <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5">
            {item.subItems?.map(sub => {
              const cleanSubUrl = sub.url.split('?')[0].split('#')[0]
              const isSubActive =
                pathname === cleanSubUrl ||
                (cleanSubUrl !== '/' && pathname.startsWith(`${cleanSubUrl}/`))
              return (
                <DropdownMenuItem
                  key={sub.url}
                  asChild
                  className="cursor-pointer focus:bg-muted focus:text-foreground rounded-lg"
                >
                  <Link
                    href={sub.url}
                    onClick={onNavigate}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors duration-150',
                      isSubActive
                        ? 'bg-primary/10 text-primary font-bold border border-primary/25 shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span className="truncate">{sub.title}</span>
                    {isSubActive && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div
      className="flex flex-col w-full relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'group/btn relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200 ease-out cursor-pointer active:scale-[0.98]',
          hasActiveChild
            ? 'text-primary font-bold'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
        )}
      >
        {isHovered && !isOpen && (
          <motion.div
            layoutId="sidebar-hover-indicator"
            className="absolute inset-0 bg-muted/60 border border-border/40 rounded-xl -z-10"
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          />
        )}
        <span
          className={cn(
            'size-4 shrink-0 flex items-center justify-center [&_svg]:size-4 transition-transform duration-200 group-hover/btn:scale-110',
            hasActiveChild ? 'text-primary' : 'text-muted-foreground group-hover/btn:text-foreground'
          )}
        >
          {item.icon}
        </span>
        <span className="flex-1 text-left truncate tracking-tight">{item.title}</span>
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shrink-0 ml-1',
            isOpen && 'rotate-90 text-primary'
          )}
        />
      </button>

      {/* Nested Sub-Menu with smooth CSS grid slide accordion animation */}
      {item.subItems && item.subItems.length > 0 && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]',
            isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          )}
        >
          <div className="overflow-hidden">
            <div className="border-l border-border ml-5 pl-3 space-y-0.5 my-1">
              {item.subItems.map(sub => {
                const cleanSubUrl = sub.url.split('?')[0].split('#')[0]
                const isSubActive =
                  pathname === cleanSubUrl ||
                  (cleanSubUrl !== '/' && pathname.startsWith(`${cleanSubUrl}/`))

                return (
                  <Link
                    key={sub.url}
                    href={sub.url}
                    onClick={onNavigate}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 active:scale-[0.98]',
                      isSubActive
                        ? 'text-primary font-bold bg-primary/10 border border-primary/20 shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full shrink-0 transition-all duration-150',
                        isSubActive ? 'bg-primary ring-2 ring-primary/30' : 'bg-muted-foreground/40'
                      )}
                    />
                    <span className="truncate">{sub.title}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function AppSidebar({
  className,
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { state, isMobile, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed' && !isMobile

  const role = session?.user?.role ?? 'CASHIER'
  const roleNavData = useMemo(() => getNavDataForRole(role), [role])

  // Flatten accessible items with section titles
  const flatItems = useMemo(() => {
    const list: {
      item: { title: string; url: string }
      sectionTitle: string
    }[] = []
    roleNavData.forEach(section => {
      section.items.forEach(item => {
        list.push({
          item: { title: item.title, url: item.url },
          sectionTitle: section.title,
        })
        if (item.subItems?.length) {
          item.subItems.forEach(sub => {
            list.push({
              item: { title: sub.title, url: sub.url },
              sectionTitle: section.title,
            })
          })
        }
      })
    })
    return list
  }, [roleNavData])

  // Longest-prefix matching for active item
  const activeMatch = useMemo(() => {
    if (!pathname) return null
    const matches = flatItems.filter(({ item }) => {
      if (!item.url || item.url === '#') return false
      const cleanItemUrl = item.url.split('?')[0].split('#')[0]
      if (!cleanItemUrl) return false
      if (pathname === cleanItemUrl) return true
      if (cleanItemUrl !== '/' && pathname.startsWith(`${cleanItemUrl}/`)) return true
      return false
    })

    if (matches.length === 0) return null
    matches.sort((a, b) => b.item.url.length - a.item.url.length)
    return matches[0]
  }, [pathname, flatItems])

  const activeUrl = activeMatch?.item.url
  const activeSectionTitle = activeMatch?.sectionTitle

  // Section dropdown collapse state (defaults all to open: true)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const saved = getSavedSectionStates()
    setOpenSections(saved)
  }, [])

  // Auto-expand section containing active item
  useEffect(() => {
    if (activeSectionTitle) {
      setOpenSections(prev => {
        if (prev[activeSectionTitle] === false) {
          const next = { ...prev, [activeSectionTitle]: true }
          persistSectionStates(next)
          return next
        }
        return prev
      })
    }
  }, [activeSectionTitle])

  const toggleSection = useCallback((title: string) => {
    setOpenSections(prev => {
      const current = prev[title] ?? true
      const next = { ...prev, [title]: !current }
      persistSectionStates(next)
      return next
    })
  }, [])

  const handleNavigate = useCallback(() => {
    if (isMobile) {
      toggleSidebar()
    }
  }, [isMobile, toggleSidebar])

  return (
    <TooltipProvider delayDuration={0}>
      <Sidebar
        collapsible="icon"
        {...props}
        className={cn(
          'bg-sidebar border-r border-sidebar-border text-sidebar-foreground shadow-xs print:hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          className
        )}
      >
        {/* Header: Artyx Digital Logo & Collapse Button */}
        <SidebarHeader className="min-h-16 h-16 justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2 bg-sidebar shrink-0 transition-colors">
          <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1.5">
            <Link
              href="/"
              onClick={handleNavigate}
              className="flex items-center gap-2.5 rounded-xl py-1 hover:opacity-90 transition-opacity focus-visible:outline-none min-w-0"
            >
              <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center p-1.5 shrink-0 overflow-hidden shadow-2xs">
                <Image
                  src="/artyx-icon.svg"
                  alt="Artyx Digital Logo"
                  width={28}
                  height={28}
                  unoptimized
                  className="size-full object-contain"
                />
              </div>
              <div
                className={cn(
                  'flex flex-col min-w-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
                  'group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:hidden'
                )}
              >
                <h1 className="text-[15px] font-extrabold tracking-tight text-foreground font-sans truncate leading-none">
                  Artyx Digital
                </h1>
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-primary font-mono leading-tight mt-1">
                  Agency · ERP
                </p>
              </div>
            </Link>

            {/* Circular collapse toggle button */}
            <button
              type="button"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                toggleSidebar()
              }}
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              className="size-6.5 rounded-full bg-primary/10 hover:bg-primary active:scale-90 text-primary hover:text-primary-foreground border border-primary/25 flex items-center justify-center shadow-2xs transition-all duration-200 ease-out cursor-pointer shrink-0"
            >
              <ChevronsLeft
                className={cn(
                  'size-3.5 stroke-[2.5] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  isCollapsed ? 'rotate-180' : 'rotate-0'
                )}
              />
            </button>
          </div>
        </SidebarHeader>

        {/* Content: Sections and Items with Smooth Accordion Transitions */}
        <SidebarContent className="px-2 py-2 group-data-[collapsible=icon]:px-1 bg-sidebar">
          {roleNavData.map(section => {
            const isSectionOpen = openSections[section.title] ?? true

            return (
              <SidebarGroup
                key={section.title}
                className="p-0 group-data-[collapsible=icon]:p-0 my-1 first:mt-0 bg-sidebar"
              >
                {/* Clickable Section Dropdown Header */}
                <div className="group-data-[collapsible=icon]:hidden px-2 pt-2.5 pb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.title)}
                    className="group/sec flex w-full items-center justify-between text-left rounded-lg py-1 px-1.5 transition-colors duration-200 hover:bg-muted/60 active:scale-[0.99] cursor-pointer select-none"
                    aria-expanded={isSectionOpen}
                  >
                    <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground group-hover/sec:text-foreground truncate transition-colors">
                      {section.title}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground group-hover/sec:text-foreground transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shrink-0 ml-1',
                        isSectionOpen ? 'rotate-0' : '-rotate-90'
                      )}
                    />
                  </button>
                </div>

                {/* Section Items with smooth CSS grid slide accordion animation */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    isCollapsed || isSectionOpen
                      ? 'grid-rows-[1fr] opacity-100'
                      : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  )}
                >
                  <div className="overflow-hidden">
                    <SidebarGroupContent className="bg-sidebar">
                      <ul className="flex flex-col gap-0.5 group-data-[collapsible=icon]:items-center">
                        {section.items.map(item => {
                          if (item.subItems?.length) {
                            return (
                              <li key={item.title} className="w-full">
                                <NavDropdownItem
                                  item={item}
                                  pathname={pathname}
                                  isCollapsed={isCollapsed}
                                  onNavigate={handleNavigate}
                                />
                              </li>
                            )
                          }

                          const isActive = activeUrl === item.url

                          return (
                            <li key={item.title} className="w-full">
                              <CollapsedRouteTooltip
                                item={item}
                                isActive={isActive}
                                isCollapsed={isCollapsed}
                              >
                                <NavItemLink
                                  item={item}
                                  isActive={isActive}
                                  onNavigate={handleNavigate}
                                />
                              </CollapsedRouteTooltip>
                            </li>
                          )
                        })}
                      </ul>
                    </SidebarGroupContent>
                  </div>
                </div>
              </SidebarGroup>
            )
          })}
        </SidebarContent>

        {/* Footer: Artyx Digital Agency Suite */}
        <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2 bg-sidebar shrink-0 transition-colors">
          <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] leading-tight text-muted-foreground group-data-[collapsible=icon]:hidden flex items-center justify-between transition-opacity duration-200">
            <span className="font-medium text-muted-foreground">Artyx Office</span>
            <span className="font-bold text-primary">
              <a
                href="https://www.artyx.digital"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                artyx.digital
              </a>
            </span>
          </div>

          {/* Collapsed Mode Icon */}
          <div className="hidden items-center justify-center group-data-[collapsible=icon]:flex">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <span className="flex size-8 items-center justify-center rounded-lg border border-lime/30 bg-[#121810] cursor-help">
                  <span className="size-1.5 rounded-full bg-lime" />
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={14}
                className="z-50 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-xl"
              >
                Artyx Digital · Agency ERP
              </TooltipContent>
            </Tooltip>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>
    </TooltipProvider>
  )
}
