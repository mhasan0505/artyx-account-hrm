'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  CheckCircle2,
  Loader2,
  Moon,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/lib/stores/notifications'
import { getCategoryVisuals } from '@/components/notifications/notification-center-provider'
import {
  deleteUserNotification,
  getUserNotificationsInbox,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/lib/actions/notifications-feed'
import {
  getVapidPublicKey,
  savePushSubscription,
  sendTestPushToCurrentUser,
  updateUserNotificationPreferences,
} from '@/lib/actions/push-notifications'
import {
  enableBrowserNotifications,
  getNotificationPermission,
  isBrowserNotificationSupported,
} from '@/lib/notifications/push-client'
import type { ExecutiveNotificationDTO } from '@/lib/notifications/types'
import { toast } from 'sonner'

type FilterTab =
  | 'ALL'
  | 'UNREAD'
  | 'EXECUTIVE_TASK'
  | 'CHAT'
  | 'FINANCE'
  | 'CLIENTS'
  | 'TEAM'

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function matchesTab(n: ExecutiveNotificationDTO, tab: FilterTab): boolean {
  switch (tab) {
    case 'ALL':
      return true
    case 'UNREAD':
      return !n.isRead
    case 'EXECUTIVE_TASK':
      return n.category === 'EXECUTIVE_TASK'
    case 'CHAT':
      return n.category === 'CHAT'
    case 'FINANCE':
      return (
        n.category === 'INVOICE' ||
        n.category === 'PAYMENT' ||
        n.category === 'EXPENSE' ||
        n.category === 'EQUITY' ||
        n.category === 'FINANCE'
      )
    case 'CLIENTS':
      return n.category === 'CLIENT' || n.category === 'PROJECT'
    case 'TEAM':
      return (
        n.category === 'HR' ||
        n.category === 'PAYROLL' ||
        n.category === 'SECURITY' ||
        n.category === 'SYSTEM'
      )
  }
}

export function HeaderNotifications({
  triggerClassName,
}: { triggerClassName?: string } = {}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [enablingPush, setEnablingPush] = React.useState(false)
  const [sendingTest, setSendingTest] = React.useState(false)
  const [filter, setFilter] = React.useState<FilterTab>('ALL')

  const notifications = useNotificationStore((s) => s.notifications)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const preferences = useNotificationStore((s) => s.preferences)
  const isLoaded = useNotificationStore((s) => s.isLoaded)
  const isSocketConnected = useNotificationStore((s) => s.isSocketConnected)
  const pushPermission = useNotificationStore((s) => s.pushPermission)
  const isPushSubscribed = useNotificationStore((s) => s.isPushSubscribed)
  const pushMode = useNotificationStore((s) => s.pushMode)

  const setInbox = useNotificationStore((s) => s.setInbox)
  const markReadLocal = useNotificationStore((s) => s.markReadLocal)
  const markAllReadLocal = useNotificationStore((s) => s.markAllReadLocal)
  const removeLocal = useNotificationStore((s) => s.removeLocal)
  const setPreferences = useNotificationStore((s) => s.setPreferences)
  const setPushState = useNotificationStore((s) => s.setPushState)

  const refreshInbox = React.useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await getUserNotificationsInbox(40)
      setInbox(res.notifications, res.unreadCount)
    } finally {
      setIsRefreshing(false)
    }
  }, [setInbox])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      void refreshInbox()
    }
  }

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation()
    markAllReadLocal()
    await markAllNotificationsAsRead()
    try {
      const bc = new BroadcastChannel('artyx-notifications-sync')
      bc.postMessage({ type: 'MARK_ALL_READ' })
      bc.close()
    } catch {}
  }

  const handleItemClick = (n: ExecutiveNotificationDTO) => {
    setIsOpen(false)
    if (!n.isRead && !n.isSynthetic) {
      markReadLocal(n.id)
      void markNotificationAsRead(n.id)
    }

    const meta = n.metadata as
      | { openChat?: boolean; channelId?: string }
      | null
      | undefined
    if (meta?.openChat || n.category === 'CHAT') {
      window.dispatchEvent(
        new CustomEvent('artyx-open-chat', {
          detail: { channelId: meta?.channelId || null },
        })
      )
      return
    }
    if (n.url) {
      router.push(n.url)
    }
  }

  const handleMarkSingleRead = (
    e: React.MouseEvent,
    n: ExecutiveNotificationDTO
  ) => {
    e.stopPropagation()
    if (!n.isRead && !n.isSynthetic) {
      markReadLocal(n.id)
      void markNotificationAsRead(n.id)
    }
  }

  const handleDeleteSingle = (
    e: React.MouseEvent,
    n: ExecutiveNotificationDTO
  ) => {
    e.stopPropagation()
    if (n.isSynthetic) return
    removeLocal(n.id)
    void deleteUserNotification(n.id)
  }

  const handleToggleSound = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = { ...preferences, soundEnabled: !preferences.soundEnabled }
    setPreferences(next)
    await updateUserNotificationPreferences({ soundEnabled: next.soundEnabled })
  }

  const handleToggleDnd = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = { ...preferences, dndEnabled: !preferences.dndEnabled }
    setPreferences(next)
    await updateUserNotificationPreferences({ dndEnabled: next.dndEnabled })
    toast.success(
      next.dndEnabled
        ? 'Do Not Disturb enabled (Urgent alerts still arrive)'
        : 'Do Not Disturb disabled'
    )
  }

  const handleQuickEnablePush = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isBrowserNotificationSupported()) {
      toast.error('Browser notifications are not supported on this device.')
      return
    }
    setEnablingPush(true)
    try {
      const result = await enableBrowserNotifications(async () => {
        const vapid = await getVapidPublicKey()
        return vapid.success ? vapid.publicKey : null
      })

      if (result.mode === 'web_push' && result.subscription) {
        const saved = await savePushSubscription(result.subscription)
        if (!saved.success) {
          throw new Error(saved.error || 'Failed to save push subscription')
        }
        setPushState('granted', true, 'web_push')
        toast.success('Full browser push pop-ups enabled on this device!')
      } else {
        await updateUserNotificationPreferences({ desktopPushEnabled: true })
        setPushState('granted', false, 'browser_realtime')
        toast.success(
          result.isBrave
            ? 'Desktop pop-up alerts enabled! Works across tabs & while idle. (For closed-browser push in Brave, enable "Use Google services for push messaging" in brave://settings/privacy.)'
            : 'Desktop pop-up alerts enabled! Works across tabs & while idle.'
        )
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to enable push alerts'
      )
      setPushState(getNotificationPermission(), false, 'off')
    } finally {
      setEnablingPush(false)
    }
  }

  const handleTestPopup = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSendingTest(true)
    try {
      const res = await sendTestPushToCurrentUser()
      if (res.success) {
        toast.success(res.message || 'Test alert sent!')
      } else {
        toast.error(res.error || 'Failed to send test alert')
      }
    } finally {
      setSendingTest(false)
    }
  }

  const visibleNotifications = React.useMemo(
    () => notifications.filter((n) => matchesTab(n, filter)),
    [notifications, filter]
  )

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-9 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 shadow-2xs transition-all cursor-pointer',
            triggerClassName
          )}
          aria-label={`Notifications (${unreadCount} unread)`}
          title={
            preferences.dndEnabled
              ? 'Notifications (Do Not Disturb)'
              : `Notifications (${unreadCount} unread)`
          }
        >
          {preferences.dndEnabled ? (
            <BellOff className="size-3.5 text-amber-500" />
          ) : (
            <Bell className="size-3.5" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-[#f33c3c] text-[9px] font-bold text-white shadow-2xs pointer-events-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[340px] sm:w-[420px] max-w-[calc(100vw-1.5rem)] p-0 shadow-2xl border-border/80 overflow-hidden rounded-2xl"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-foreground">
              Executive Alerts
            </h4>
            {unreadCount > 0 && (
              <span className="rounded-full bg-[#3E7000]/15 dark:bg-[#7FFF00]/15 px-2 py-0.5 text-[11px] font-bold text-[#3E7000] dark:text-[#7FFF00]">
                {unreadCount} new
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-mono font-bold',
                isSocketConnected
                  ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
              )}
              title={
                isSocketConnected
                  ? 'Real-time Socket.io live stream connected'
                  : 'Polling sync active'
              }
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isSocketConnected
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-amber-500'
                )}
              />
              {isSocketConnected ? 'LIVE' : 'SYNC'}
            </span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={handleToggleSound}
              title={
                preferences.soundEnabled
                  ? 'Mute notification chimes'
                  : 'Unmute notification chimes'
              }
            >
              {preferences.soundEnabled ? (
                <Volume2 className="size-3.5" />
              ) : (
                <VolumeX className="size-3.5 opacity-50" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 cursor-pointer',
                preferences.dndEnabled
                  ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={handleToggleDnd}
              title={
                preferences.dndEnabled
                  ? 'Disable Do Not Disturb'
                  : 'Enable Do Not Disturb'
              }
            >
              <Moon className="size-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                void refreshInbox()
              }}
              title="Refresh notifications"
            >
              <RefreshCw
                className={cn('size-3.5', isRefreshing && 'animate-spin')}
              />
            </Button>

            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleMarkAllRead}
                title="Mark all as read"
              >
                <CheckCheck className="size-3.5" />
              </Button>
            )}

            <Link href="/profile#notifications" onClick={() => setIsOpen(false)}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground cursor-pointer"
                title="Notification & Push Settings"
              >
                <Settings2 className="size-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* One-Click Browser Push Status Banner (only if not yet active) */}
        {pushMode === 'off' &&
          !isPushSubscribed &&
          pushPermission !== 'unsupported' && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b bg-[#3E7000]/8 dark:bg-[#7FFF00]/8">
            <div className="flex items-center gap-2 min-w-0">
              <BellRing className="size-3.5 text-[#3E7000] dark:text-[#7FFF00] shrink-0" />
              <p className="text-[11px] text-foreground truncate">
                {pushPermission === 'denied'
                  ? 'Browser push blocked in site settings'
                  : 'Get OS pop-ups in other tabs & while idle'}
              </p>
            </div>
            {pushPermission !== 'denied' && (
              <button
                type="button"
                disabled={enablingPush}
                onClick={handleQuickEnablePush}
                className="shrink-0 rounded-lg bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-60"
              >
                {enablingPush ? 'Enabling…' : 'Enable Push'}
              </button>
            )}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b bg-background/60 overflow-x-auto no-scrollbar">
          {(
            [
              { key: 'ALL', label: 'All' },
              { key: 'UNREAD', label: `Unread${unreadCount ? ` (${unreadCount})` : ''}` },
              { key: 'EXECUTIVE_TASK', label: 'Exec Tasks' },
              { key: 'CHAT', label: 'Chat' },
              { key: 'FINANCE', label: 'Finance' },
              { key: 'CLIENTS', label: 'Clients' },
              { key: 'TEAM', label: 'Team' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer',
                filter === tab.key
                  ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="max-h-[370px] overflow-y-auto divide-y divide-border/40">
          {!isLoaded && visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mb-2" />
              <p className="text-xs">Loading executive alerts…</p>
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <CheckCircle2 className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-semibold text-foreground">
                All caught up!
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[240px]">
                No notifications in this category. Executive actions and team
                mentions appear here in real time.
              </p>
            </div>
          ) : (
            visibleNotifications.map((n) => {
              const visuals = getCategoryVisuals(n.category, n.priority)
              const Icon = visuals.icon
              return (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleItemClick(n)
                    }
                  }}
                  className={cn(
                    'flex items-start gap-3 p-3 transition-colors hover:bg-muted/60 cursor-pointer group relative',
                    !n.isRead && 'bg-[#3E7000]/[0.04] dark:bg-[#7FFF00]/[0.04]'
                  )}
                >
                  {/* Unread indicator bar */}
                  {!n.isRead && (
                    <span
                      className={cn(
                        'absolute inset-y-2 left-0.5 w-1 rounded-full',
                        visuals.accentBar
                      )}
                    />
                  )}

                  {/* Actor Avatar / Category Icon */}
                  <div className="relative mt-0.5 shrink-0">
                    {n.actorImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={n.actorImage}
                        alt={n.actorName || 'Executive'}
                        className="size-8 rounded-full object-cover border border-border"
                      />
                    ) : (
                      <div
                        className={cn(
                          'size-8 rounded-xl border flex items-center justify-center',
                          visuals.iconBg
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                    )}
                    {n.actorImage && (
                      <span
                        className={cn(
                          'absolute -bottom-1 -right-1 size-4 rounded-full border border-card flex items-center justify-center',
                          visuals.iconBg
                        )}
                      >
                        <Icon className="size-2.5" />
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {n.actorBadge && (
                          <span className="shrink-0 rounded bg-muted px-1 py-0.2 text-[9px] font-mono font-bold text-foreground uppercase">
                            {n.actorBadge}
                          </span>
                        )}
                        <p
                          className={cn(
                            'text-xs truncate',
                            !n.isRead
                              ? 'font-bold text-foreground'
                              : 'font-medium text-foreground/85'
                          )}
                        >
                          {n.title}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                      {n.body}
                    </p>

                    <div className="flex items-center justify-between mt-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wide',
                          visuals.pill
                        )}
                      >
                        {visuals.label}
                      </span>

                      {!n.isSynthetic && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!n.isRead && (
                            <button
                              type="button"
                              onClick={(e) => handleMarkSingleRead(e, n)}
                              title="Mark as read"
                              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <Check className="size-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSingle(e, n)}
                            title="Delete alert"
                            className="p-1 rounded-md hover:bg-rose-500/15 text-muted-foreground hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t bg-muted/25 text-xs">
          <button
            type="button"
            disabled={sendingTest}
            onClick={handleTestPopup}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
          >
            {sendingTest ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            <span>Test Pop-up</span>
          </button>

          <Link
            href="/profile#notifications"
            onClick={() => setIsOpen(false)}
            className="text-[11px] text-[#3E7000] dark:text-[#7FFF00] hover:underline font-bold"
          >
            Push & Alert Settings
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
