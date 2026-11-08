'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Bell,
  AlertTriangle,
  Receipt,
  FileText,
  Briefcase,
  Coins,
  ShieldCheck,
  CheckCircle2,
  Settings2,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  getHeaderNotificationsFeed,
  type HeaderNotificationItem,
} from '@/lib/actions/notifications-feed'

export function HeaderNotifications({ triggerClassName }: { triggerClassName?: string } = {}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [feed, setFeed] = React.useState<{
    unreadCount: number
    notifications: HeaderNotificationItem[]
  }>({
    unreadCount: 0,
    notifications: [],
  })
  const [filter, setFilter] = React.useState<'ALL' | 'INVOICE' | 'EXPENSE' | 'CLIENT'>('ALL')
  const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(new Set())

  const fetchFeed = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await getHeaderNotificationsFeed()
      setFeed(data)
    } catch (err) {
      console.error('Failed to load notifications feed:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchFeed()
    // Poll every 30 seconds for live updates
    const interval = setInterval(fetchFeed, 30000)
    return () => clearInterval(interval)
  }, [fetchFeed])

  const visibleNotifications = feed.notifications
    .filter(n => !dismissedIds.has(n.id))
    .filter(n => (filter === 'ALL' ? true : n.type === filter))

  const activeUnreadCount = Math.max(0, feed.unreadCount - dismissedIds.size)

  const handleMarkAllRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    const allIds = new Set(feed.notifications.map(n => n.id))
    setDismissedIds(allIds)
  }

  const getIcon = (type: HeaderNotificationItem['type']) => {
    switch (type) {
      case 'INVOICE':
        return <FileText className="size-4 text-emerald-500" />
      case 'EXPENSE':
        return <Receipt className="size-4 text-amber-500" />
      case 'CLIENT':
        return <Briefcase className="size-4 text-blue-500" />
      case 'SYSTEM':
      default:
        return <Bell className="size-4 text-primary" />
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative size-9 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 shadow-2xs transition-all', triggerClassName)}
          aria-label={`Notifications (${activeUnreadCount} unread)`}
          title="Notifications"
        >
          <Bell className="size-3.5" />
          {activeUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-[#f33c3c] text-[9px] font-bold text-white shadow-2xs pointer-events-none">
              {activeUnreadCount > 9 ? '9+' : activeUnreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] p-0 shadow-2xl border-border/80 overflow-hidden"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">Notifications</h4>
            {activeUnreadCount > 0 && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                {activeUnreadCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {activeUnreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleMarkAllRead}
              >
                Mark all read
              </Button>
            )}
            <Link href="/profile" onClick={() => setIsOpen(false)}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title="Push Notification Settings"
              >
                <Settings2 className="size-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b bg-background/50 overflow-x-auto">
          {(['ALL', 'INVOICE', 'EXPENSE', 'CLIENT'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab === 'ALL'
                ? 'All'
                : tab === 'INVOICE'
                ? 'Invoices'
                : tab === 'EXPENSE'
                ? 'Expenses'
                : 'Clients'}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="max-h-[340px] overflow-y-auto divide-y divide-border/40">
          {isLoading && visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mb-2" />
              <p className="text-xs">Loading alerts…</p>
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <CheckCircle2 className="size-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium text-foreground">All caught up!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No active notifications in this category.
              </p>
            </div>
          ) : (
            visibleNotifications.map(notification => (
              <Link
                key={notification.id}
                href={notification.url}
                onClick={() => setIsOpen(false)}
                className="flex items-start gap-3 p-3 transition-colors hover:bg-muted/50 block group"
              >
                <div className="mt-0.5 rounded-lg border border-border/60 bg-muted/60 p-1.5 shrink-0 group-hover:border-primary/40">
                  {getIcon(notification.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {notification.title}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                      {notification.timeAgo}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                    {notification.description}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-2 border-t bg-muted/20 text-xs">
          <Link
            href="/sales"
            onClick={() => setIsOpen(false)}
            className="text-muted-foreground hover:text-primary flex items-center gap-1 font-medium transition-colors"
          >
            Sales Orders <ExternalLink className="size-3" />
          </Link>
          <Link
            href="/profile"
            onClick={() => setIsOpen(false)}
            className="text-primary hover:underline font-medium"
          >
            Push Settings
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
