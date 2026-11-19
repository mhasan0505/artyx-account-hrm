'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { io, type Socket } from 'socket.io-client'
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellRing,
  Briefcase,
  Check,
  CheckSquare,
  Coins,
  FileText,
  FolderKanban,
  Landmark,
  MessageSquare,
  Receipt,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/lib/stores/notifications'
import type {
  ExecutiveNotificationDTO,
  NotificationCategoryType,
  NotificationPriorityType,
} from '@/lib/notifications/types'
import {
  enableBrowserNotifications,
  getNotificationPermission,
  isBrowserNotificationSupported,
  showNativeBrowserNotification,
  updateAppBadgeCount,
} from '@/lib/notifications/push-client'
import {
  getVapidPublicKey,
  getUserNotificationPreferences,
  savePushSubscription,
  updateUserNotificationPreferences,
} from '@/lib/actions/push-notifications'
import {
  getUserNotificationsInbox,
  markNotificationAsRead,
  pollNewNotifications,
} from '@/lib/actions/notifications-feed'
import {
  playNotificationChime,
  primeNotificationAudio,
} from '@/lib/notifications/sound'
import { toast } from 'sonner'

const IDLE_THRESHOLD_MS = 60_000
const PUSH_PROMPT_DISMISS_KEY = 'artyx_push_prompt_dismissed_v1'

function getSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:3001`
  }
  return 'http://localhost:3001'
}

export function getCategoryVisuals(
  category: NotificationCategoryType,
  priority: NotificationPriorityType
) {
  if (priority === 'URGENT') {
    return {
      icon: AlertTriangle,
      accentBar: 'bg-rose-500',
      iconBg: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
      pill: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
      label: 'URGENT',
    }
  }

  switch (category) {
    case 'EXECUTIVE_TASK':
      return {
        icon: CheckSquare,
        accentBar: 'bg-[#3E7000] dark:bg-[#7FFF00]',
        iconBg:
          'bg-[#3E7000]/15 text-[#3E7000] dark:bg-[#7FFF00]/15 dark:text-[#7FFF00] border-[#3E7000]/25 dark:border-[#7FFF00]/25',
        pill: 'bg-[#3E7000]/12 text-[#3E7000] dark:bg-[#7FFF00]/15 dark:text-[#7FFF00]',
        label: 'Executive Task',
      }
    case 'CHAT':
      return {
        icon: MessageSquare,
        accentBar: 'bg-sky-500',
        iconBg: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
        pill: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
        label: 'Team Chat',
      }
    case 'INVOICE':
      return {
        icon: FileText,
        accentBar: 'bg-emerald-500',
        iconBg: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
        pill: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
        label: 'Invoice',
      }
    case 'PAYMENT':
      return {
        icon: Wallet,
        accentBar: 'bg-emerald-500',
        iconBg: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
        pill: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
        label: 'Payment',
      }
    case 'CLIENT':
      return {
        icon: Briefcase,
        accentBar: 'bg-blue-500',
        iconBg: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
        pill: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
        label: 'Client',
      }
    case 'PROJECT':
      return {
        icon: FolderKanban,
        accentBar: 'bg-indigo-500',
        iconBg: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30',
        pill: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
        label: 'Project',
      }
    case 'EXPENSE':
      return {
        icon: Receipt,
        accentBar: 'bg-amber-500',
        iconBg: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
        pill: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
        label: 'Expense',
      }
    case 'EQUITY':
      return {
        icon: Coins,
        accentBar: 'bg-amber-500',
        iconBg: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
        pill: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
        label: 'Equity',
      }
    case 'FINANCE':
      return {
        icon: Landmark,
        accentBar: 'bg-teal-500',
        iconBg: 'bg-teal-500/15 text-teal-500 border-teal-500/30',
        pill: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
        label: 'Finance',
      }
    case 'HR':
    case 'PAYROLL':
      return {
        icon: Users,
        accentBar: 'bg-violet-500',
        iconBg: 'bg-violet-500/15 text-violet-500 border-violet-500/30',
        pill: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
        label: category === 'PAYROLL' ? 'Payroll' : 'HR',
      }
    case 'SECURITY':
      return {
        icon: ShieldAlert,
        accentBar: 'bg-rose-500',
        iconBg: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
        pill: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
        label: 'Security',
      }
    default:
      return {
        icon: Bell,
        accentBar: 'bg-primary',
        iconBg: 'bg-primary/15 text-primary border-primary/30',
        pill: 'bg-primary/12 text-primary',
        label: 'Alert',
      }
  }
}

interface PopupCardProps {
  notification: ExecutiveNotificationDTO
  onOpen: (n: ExecutiveNotificationDTO) => void
  onDismiss: (id: string) => void
  onMarkRead: (id: string) => void
}

function NotificationPopupCard({
  notification,
  onOpen,
  onDismiss,
  onMarkRead,
}: PopupCardProps) {
  const prefersReducedMotion = useReducedMotion()
  const [isHovered, setIsHovered] = useState(false)
  const visuals = getCategoryVisuals(notification.category, notification.priority)
  const Icon = visuals.icon

  const isUrgent = notification.priority === 'URGENT'
  const autoDismissMs = isUrgent
    ? 0
    : notification.priority === 'HIGH'
      ? 14000
      : 8500

  useEffect(() => {
    if (autoDismissMs <= 0 || isHovered) return
    const timer = setTimeout(() => {
      onDismiss(notification.id)
    }, autoDismissMs)
    return () => clearTimeout(timer)
  }, [autoDismissMs, isHovered, notification.id, onDismiss])

  return (
    <motion.div
      layout
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.94 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'pointer-events-auto relative w-[340px] sm:w-[376px] overflow-hidden rounded-2xl border bg-card/95 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.28)] text-card-foreground transition-colors',
        isUrgent
          ? 'border-rose-500/50 ring-1 ring-rose-500/25'
          : 'border-border/85 hover:border-primary/40'
      )}
    >
      {/* Left semantic accent bar */}
      <div className={cn('absolute inset-y-0 left-0 w-1', visuals.accentBar)} />

      <div className="p-3.5 pl-4">
        {/* Top Row: Actor / Category / Close */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Actor avatar or category icon */}
            <div className="relative shrink-0">
              {notification.actorImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={notification.actorImage}
                  alt={notification.actorName || 'Executive'}
                  className="size-8 rounded-full object-cover border border-border shadow-2xs"
                />
              ) : (
                <div
                  className={cn(
                    'size-8 rounded-xl border flex items-center justify-center shrink-0',
                    visuals.iconBg
                  )}
                >
                  <Icon className="size-4" />
                </div>
              )}
              {notification.actorImage && (
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

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                    visuals.pill
                  )}
                >
                  {visuals.label}
                </span>
                {notification.actorBadge && (
                  <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono font-bold text-foreground">
                    {notification.actorBadge}
                  </span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground">
                  Just now
                </span>
              </div>
              {notification.actorName && (
                <p className="text-[11px] font-medium text-muted-foreground truncate mt-0.5">
                  From <span className="text-foreground font-semibold">{notification.actorName}</span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(notification.id)
            }}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer shrink-0"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Body Content (Clickable) */}
        <button
          type="button"
          onClick={() => onOpen(notification)}
          className="mt-2 w-full text-left group cursor-pointer"
        >
          <p className="text-xs font-bold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {notification.title}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
            {notification.body}
          </p>
        </button>

        {/* Quick Actions Footer */}
        <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpen(notification)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#3E7000] dark:text-[#7FFF00] hover:underline cursor-pointer"
          >
            <span>
              {notification.category === 'CHAT' ? 'Open Chat' : 'View Details'}
            </span>
            <ArrowUpRight className="size-3" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMarkRead(notification.id)
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Check className="size-3" />
            <span>Mark read</span>
          </button>
        </div>
      </div>

      {/* Auto-dismiss subtle progress bar */}
      {autoDismissMs > 0 && !isHovered && !prefersReducedMotion && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: autoDismissMs / 1000, ease: 'linear' }}
          style={{ transformOrigin: 'left' }}
          className={cn('h-0.5 w-full opacity-75', visuals.accentBar)}
        />
      )}
    </motion.div>
  )
}

export function NotificationCenterProvider() {
  const { data: session } = useSession()
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()

  const userId = session?.user?.id
  const userName = session?.user?.name || 'Executive'

  const popups = useNotificationStore((s) => s.popups)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const preferences = useNotificationStore((s) => s.preferences)
  const isChatboxOpen = useNotificationStore((s) => s.isChatboxOpen)
  const pushPermission = useNotificationStore((s) => s.pushPermission)
  const isPushSubscribed = useNotificationStore((s) => s.isPushSubscribed)
  const pushMode = useNotificationStore((s) => s.pushMode)

  const setInbox = useNotificationStore((s) => s.setInbox)
  const addIncoming = useNotificationStore((s) => s.addIncoming)
  const dismissPopup = useNotificationStore((s) => s.dismissPopup)
  const markReadLocal = useNotificationStore((s) => s.markReadLocal)
  const markAllReadLocal = useNotificationStore((s) => s.markAllReadLocal)
  const setPreferences = useNotificationStore((s) => s.setPreferences)
  const setSocketConnected = useNotificationStore((s) => s.setSocketConnected)
  const setPushState = useNotificationStore((s) => s.setPushState)

  const [showEnableBanner, setShowEnableBanner] = useState(false)
  const [enablingPush, setEnablingPush] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const swDisplayedRef = useRef<Set<string>>(new Set())
  const lastActivityRef = useRef<number>(Date.now())
  const lastServerTimeRef = useRef<string>(new Date().toISOString())
  const baseTitleRef = useRef<string>('')
  const bcRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  )
  const prefsRef = useRef(preferences)
  prefsRef.current = preferences

  // 1. Prime Web Audio & track user idle state
  useEffect(() => {
    if (typeof window === 'undefined') return
    primeNotificationAudio()
    baseTitleRef.current = document.title.replace(/^\(\d+\+?\)\s*/, '')

    const markActive = () => {
      lastActivityRef.current = Date.now()
    }
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'pointerdown',
      'focus',
    ]
    for (const ev of events) {
      window.addEventListener(ev, markActive, { passive: true })
    }
    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, markActive)
      }
    }
  }, [])

  // 2. Sync browser tab title & OS App Badge with unreadCount
  useEffect(() => {
    if (typeof window === 'undefined') return
    updateAppBadgeCount(unreadCount)
    const base =
      baseTitleRef.current ||
      document.title.replace(/^\(\d+\+?\)\s*/, '') ||
      'Artyx Digital'

    if (unreadCount > 0) {
      const prefix = unreadCount > 99 ? '(99+)' : `(${unreadCount})`
      document.title = `${prefix} ${base}`
    } else {
      document.title = base
    }
  }, [unreadCount])

  // 3. Cross-tab BroadcastChannel sync
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return
    const bc = new BroadcastChannel('artyx-notifications-sync')
    bcRef.current = bc

    bc.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || msg.sender === tabIdRef.current) return
      if (msg.type === 'MARK_READ' && msg.id) {
        markReadLocal(msg.id)
      } else if (msg.type === 'MARK_ALL_READ') {
        markAllReadLocal()
      } else if (msg.type === 'DISMISS_POPUP' && msg.id) {
        dismissPopup(msg.id)
      } else if (msg.type === 'PREFS_UPDATED' && msg.preferences) {
        setPreferences(msg.preferences)
      }
    }

    return () => {
      bc.close()
      bcRef.current = null
    }
  }, [markReadLocal, markAllReadLocal, dismissPopup, setPreferences])

  // Navigate or open chat helper
  const handleOpenNotification = useCallback(
    (notification: ExecutiveNotificationDTO) => {
      markReadLocal(notification.id)
      void markNotificationAsRead(notification.id)
      bcRef.current?.postMessage({
        type: 'MARK_READ',
        id: notification.id,
        sender: tabIdRef.current,
      })

      const meta = notification.metadata as
        | { openChat?: boolean; channelId?: string }
        | null
        | undefined

      if (meta?.openChat || notification.category === 'CHAT') {
        window.dispatchEvent(
          new CustomEvent('artyx-open-chat', {
            detail: { channelId: meta?.channelId || null },
          })
        )
        return
      }

      if (notification.url) {
        router.push(notification.url)
      }
    },
    [markReadLocal, router]
  )

  const handleMarkRead = useCallback(
    (id: string) => {
      markReadLocal(id)
      void markNotificationAsRead(id)
      bcRef.current?.postMessage({
        type: 'MARK_READ',
        id,
        sender: tabIdRef.current,
      })
    },
    [markReadLocal]
  )

  const handleDismissPopup = useCallback(
    (id: string) => {
      dismissPopup(id)
      bcRef.current?.postMessage({
        type: 'DISMISS_POPUP',
        id,
        sender: tabIdRef.current,
      })
    },
    [dismissPopup]
  )

  // Core handler for any freshly arriving live notification
  const processIncomingNotification = useCallback(
    (notification: ExecutiveNotificationDTO) => {
      if (!notification?.id) return
      if (seenIdsRef.current.has(notification.id)) return
      seenIdsRef.current.add(notification.id)

      const prefs = prefsRef.current
      const isUrgent = notification.priority === 'URGENT'
      const isDnd = prefs.dndEnabled && !isUrgent

      // Update inbox + floating pop-up stack
      addIncoming(notification, {
        showPopup: prefs.inAppPopupEnabled && !isDnd,
      })

      // Play distinct sound chime (only in visible tab or if user is idle/away and this tab is active)
      if (prefs.soundEnabled && !isDnd) {
        playNotificationChime(notification.category, notification.priority)
      }

      // Trigger native OS Browser Desktop Pop-up if:
      // - User is in another tab (`document.hidden`)
      // - Window is unfocused (`!document.hasFocus()`)
      // - User is idle (no interaction for 60s+)
      // - OR user enabled `notifyWhenActive` (pop up in browser even when active)
      const isTabHidden =
        typeof document !== 'undefined' &&
        (document.hidden || document.visibilityState !== 'visible')
      const isWindowUnfocused =
        typeof document !== 'undefined' && !document.hasFocus()
      const isIdle = Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS

      const shouldShowDesktopPopup =
        prefs.desktopPushEnabled &&
        !isDnd &&
        Notification.permission === 'granted' &&
        (isTabHidden ||
          isWindowUnfocused ||
          isIdle ||
          prefs.notifyWhenActive ||
          isUrgent)

      if (shouldShowDesktopPopup) {
        // Wait 250ms to let the Service Worker Web Push message arrive first if already delivered via VAPID
        setTimeout(() => {
          if (swDisplayedRef.current.has(notification.id)) return
          const meta = notification.metadata as
            | { openChat?: boolean; channelId?: string }
            | null
            | undefined
          const titlePrefix = notification.actorBadge
            ? `[${notification.actorBadge}] `
            : ''
          void showNativeBrowserNotification({
            title: `${titlePrefix}${notification.title}`,
            body: notification.body,
            url: notification.url,
            tag: notification.tag || `artyx-notif-${notification.id}`,
            notificationId: notification.id,
            category: notification.category,
            priority: notification.priority,
            requireInteraction:
              notification.requireInteraction ??
              (notification.priority === 'URGENT' ||
                notification.priority === 'HIGH'),
            openChat: Boolean(meta?.openChat || notification.category === 'CHAT'),
            channelId: meta?.channelId || null,
            onClick: () => handleOpenNotification(notification),
          })
        }, 280)
      }
    },
    [addIncoming, handleOpenNotification]
  )

  // 4. Listen for Service Worker postMessages (push dedup & click navigation)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    const onSwMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data?.type) return

      if (data.type === 'ARTYX_PUSH_RECEIVED' && data.notificationId) {
        swDisplayedRef.current.add(data.notificationId)
        // Refresh inbox if Socket.io missed it while tab was suspended
        void pollNewNotifications(lastServerTimeRef.current).then((res) => {
          lastServerTimeRef.current = res.serverTime
          for (const item of res.notifications) {
            processIncomingNotification(item)
          }
        })
      } else if (data.type === 'ARTYX_OPEN_CHAT') {
        if (data.notificationId) {
          handleMarkRead(data.notificationId)
        }
        window.dispatchEvent(
          new CustomEvent('artyx-open-chat', {
            detail: { channelId: data.channelId || null },
          })
        )
      } else if (data.type === 'ARTYX_NOTIFICATION_CLICK') {
        if (data.notificationId) {
          handleMarkRead(data.notificationId)
        }
        if (data.url) {
          router.push(data.url)
        }
      }
    }

    navigator.serviceWorker.addEventListener('message', onSwMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onSwMessage)
    }
  }, [handleMarkRead, processIncomingNotification, router])

  // 5. Initial hydration: inbox + preferences + auto-sync push subscription
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function hydrate() {
      const [inboxRes, prefsRes] = await Promise.all([
        getUserNotificationsInbox(40),
        getUserNotificationPreferences(),
      ])

      if (cancelled) return

      for (const n of inboxRes.notifications) {
        seenIdsRef.current.add(n.id)
      }
      lastServerTimeRef.current = inboxRes.serverTime
      setInbox(inboxRes.notifications, inboxRes.unreadCount)
      setPreferences(prefsRes.preferences)

      // Check browser push permission & auto-sync SW/Push subscription if already granted
      const perm = getNotificationPermission()
      if (perm === 'granted' && isBrowserNotificationSupported()) {
        try {
          const res = await enableBrowserNotifications(async () => {
            const vapid = await getVapidPublicKey()
            return vapid.success ? vapid.publicKey : null
          })
          if (res.mode === 'web_push' && res.subscription) {
            await savePushSubscription(res.subscription)
            if (!cancelled) setPushState('granted', true, 'web_push')
          } else {
            if (!cancelled) setPushState('granted', false, 'browser_realtime')
          }
        } catch {
          if (!cancelled) setPushState('granted', false, 'browser_realtime')
        }
      } else {
        setPushState(perm, false, 'off')
        // Show one-click opt-in banner if permission is default and not dismissed
        if (
          perm === 'default' &&
          isBrowserNotificationSupported() &&
          typeof window !== 'undefined' &&
          !sessionStorage.getItem(PUSH_PROMPT_DISMISS_KEY)
        ) {
          setTimeout(() => {
            if (!cancelled) setShowEnableBanner(true)
          }, 3500)
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [userId, setInbox, setPreferences, setPushState])

  // 6. Real-Time Socket.io connection for instant executive notifications
  useEffect(() => {
    if (!userId) return

    const socket = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10000,
      timeout: 10000,
      autoConnect: true,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setSocketConnected(true)
      socket.emit('user_connected', {
        id: userId,
        name: userName,
      })
    })

    socket.on('disconnect', () => {
      setSocketConnected(false)
    })

    socket.on('connect_error', () => {
      setSocketConnected(false)
    })

    socket.on('executive_notification', (payload: ExecutiveNotificationDTO) => {
      if (payload?.createdAt) {
        lastServerTimeRef.current = payload.createdAt
      }
      processIncomingNotification(payload)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      setSocketConnected(false)
    }
  }, [userId, userName, processIncomingNotification, setSocketConnected])

  // 7. Resilient fallback polling (catches missed events during sleep / socket disconnect)
  useEffect(() => {
    if (!userId) return

    const poll = async () => {
      const res = await pollNewNotifications(lastServerTimeRef.current)
      lastServerTimeRef.current = res.serverTime
      for (const item of res.notifications) {
        processIncomingNotification(item)
      }
    }

    const interval = setInterval(() => {
      // Poll every 18s if socket disconnected, or every 45s as a light heartbeat if connected
      if (!socketRef.current?.connected) {
        void poll()
      }
    }, 18000)

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityOrFocus)
    window.addEventListener('focus', onVisibilityOrFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityOrFocus)
      window.removeEventListener('focus', onVisibilityOrFocus)
    }
  }, [userId, processIncomingNotification])

  // One-click Browser Push Activation handler
  const handleEnableBrowserPush = async () => {
    setEnablingPush(true)
    try {
      const result = await enableBrowserNotifications(async () => {
        const vapidRes = await getVapidPublicKey()
        return vapidRes.success ? vapidRes.publicKey : null
      })

      if (result.mode === 'web_push' && result.subscription) {
        const saveRes = await savePushSubscription(result.subscription)
        if (!saveRes.success) {
          throw new Error(saveRes.error || 'Failed to save push subscription')
        }
        setPushState('granted', true, 'web_push')
        setShowEnableBanner(false)
        toast.success(
          'Browser push pop-ups enabled! You will now receive alerts even in other tabs, while idle, or offline.'
        )
      } else {
        // Permission granted — live OS desktop pop-ups active via Service Worker + Socket.io
        await updateUserNotificationPreferences({ desktopPushEnabled: true })
        setPushState('granted', false, 'browser_realtime')
        setShowEnableBanner(false)
        toast.success(
          result.isBrave
            ? 'Desktop pop-up alerts enabled! Alerts will pop up across tabs & while idle. (Tip: Enable "Use Google services for push messaging" in brave://settings/privacy for closed-browser push.)'
            : 'Desktop pop-up alerts enabled! You will receive OS pop-ups across tabs & while idle.'
        )
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Could not enable push alerts'
      toast.error(msg)
      setPushState(getNotificationPermission(), false, 'off')
      if (getNotificationPermission() === 'denied') {
        setShowEnableBanner(false)
      }
    } finally {
      setEnablingPush(false)
    }
  }

  const handleDismissEnableBanner = () => {
    setShowEnableBanner(false)
    try {
      sessionStorage.setItem(PUSH_PROMPT_DISMISS_KEY, '1')
    } catch {}
  }

  if (!userId) return null

  const visiblePopups = popups.slice(0, 3)
  const overflowCount = Math.max(0, popups.length - visiblePopups.length)

  return (
    <div
      aria-live="polite"
      aria-label="Live executive notifications"
      className={cn(
        'pointer-events-none fixed z-50 flex flex-col items-end gap-2.5 print:hidden transition-all duration-300',
        isChatboxOpen
          ? 'bottom-5 right-5 md:right-[438px]'
          : 'bottom-20 right-5'
      )}
    >
      {/* Active Floating Pop-up Notification Stack */}
      <AnimatePresence mode="popLayout">
        {visiblePopups.map((n) => (
          <NotificationPopupCard
            key={n.id}
            notification={n}
            onOpen={handleOpenNotification}
            onDismiss={handleDismissPopup}
            onMarkRead={handleMarkRead}
          />
        ))}
      </AnimatePresence>

      {/* Overflow pill if > 3 popups queued */}
      {overflowCount > 0 && (
        <div className="pointer-events-auto rounded-full border border-border/80 bg-card/95 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-lg">
          +{overflowCount} more alert{overflowCount > 1 ? 's' : ''} in inbox
        </div>
      )}

      {/* Sleek One-Click Browser Push Opt-in Card (only if permission === default) */}
      <AnimatePresence>
        {showEnableBanner &&
          pushPermission === 'default' &&
          pushMode === 'off' &&
          !isPushSubscribed && (
            <motion.div
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 16, scale: 0.96 }
              }
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 12, scale: 0.96 }
              }
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto w-[330px] sm:w-[360px] rounded-2xl border border-[#3E7000]/30 dark:border-[#7FFF00]/30 bg-card/95 backdrop-blur-xl p-3.5 shadow-2xl"
            >
              <div className="flex items-start gap-2.5">
                <div className="size-8 rounded-xl bg-[#3E7000]/15 dark:bg-[#7FFF00]/15 text-[#3E7000] dark:text-[#7FFF00] flex items-center justify-center shrink-0 mt-0.5">
                  <BellRing className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-foreground">
                      Enable Desktop Push Alerts
                    </p>
                    <button
                      type="button"
                      onClick={handleDismissEnableBanner}
                      className="p-0.5 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label="Dismiss prompt"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Get instant executive pop-up notifications even when you are
                    in another tab, another app, or idle.
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <button
                      type="button"
                      disabled={enablingPush}
                      onClick={handleEnableBrowserPush}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black px-3 py-1.5 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <Bell className="size-3" />
                      <span>
                        {enablingPush ? 'Activating…' : 'Enable Push Alerts'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDismissEnableBanner}
                      className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Later
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  )
}
