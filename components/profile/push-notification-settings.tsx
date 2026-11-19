'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  BellRing,
  CheckCircle2,
  Info,
  Loader2,
  Monitor,
  Moon,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  detectBraveBrowser,
  enableBrowserNotifications,
  isBrowserNotificationSupported,
  getNotificationPermission,
  unsubscribeFromPush,
  getActivePushSubscriptionEndpoint,
  type PushActivationMode,
} from '@/lib/notifications/push-client'
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
  getPushSubscriptionStatus,
  sendTestPushToCurrentUser,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} from '@/lib/actions/push-notifications'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_META,
  type NotificationCategoryType,
  type NotificationPreferenceDTO,
} from '@/lib/notifications/types'
import { useNotificationStore } from '@/lib/stores/notifications'
import { playNotificationChime } from '@/lib/notifications/sound'

const TOGGLEABLE_CATEGORIES: NotificationCategoryType[] = [
  'EXECUTIVE_TASK',
  'CHAT',
  'INVOICE',
  'PAYMENT',
  'CLIENT',
  'PROJECT',
  'EXPENSE',
  'EQUITY',
  'FINANCE',
  'HR',
  'PAYROLL',
  'SECURITY',
]

export function PushNotificationSettings() {
  const [isSupported, setIsSupported] = React.useState(false)
  const [isBrave, setIsBrave] = React.useState(false)
  const [permission, setPermission] = React.useState<
    NotificationPermission | 'unsupported'
  >('default')
  const [isSubscribed, setIsSubscribed] = React.useState(false)
  const [pushMode, setPushMode] = React.useState<PushActivationMode>('off')
  const [subscriptionCount, setSubscriptionCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [toggling, setToggling] = React.useState(false)
  const [sendingTest, setSendingTest] = React.useState(false)
  const [savingPref, setSavingPref] = React.useState<string | null>(null)
  const [prefs, setPrefs] = React.useState<NotificationPreferenceDTO>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  })

  const setStorePreferences = useNotificationStore((s) => s.setPreferences)
  const setStorePushState = useNotificationStore((s) => s.setPushState)

  const checkStatus = React.useCallback(async () => {
    try {
      const [supported, brave] = await Promise.all([
        Promise.resolve(isBrowserNotificationSupported()),
        detectBraveBrowser(),
      ])
      setIsSupported(supported)
      setIsBrave(brave)

      const prefsRes = await getUserNotificationPreferences()
      const loadedPrefs = prefsRes.success
        ? prefsRes.preferences
        : DEFAULT_NOTIFICATION_PREFERENCES
      if (prefsRes.success) {
        setPrefs(loadedPrefs)
        setStorePreferences(loadedPrefs)
      }

      if (!supported) {
        setPermission('unsupported')
        setPushMode('off')
        setStorePushState('unsupported', false, 'off')
        setLoading(false)
        return
      }

      const currentPermission = getNotificationPermission()
      setPermission(currentPermission)

      const endpoint = await getActivePushSubscriptionEndpoint()
      const status = await getPushSubscriptionStatus(endpoint)

      if (status.success) {
        setIsSubscribed(status.isSubscribed)
        setSubscriptionCount(status.subscriptionCount)
        const activeMode: PushActivationMode = status.isSubscribed
          ? 'web_push'
          : currentPermission === 'granted' && loadedPrefs.desktopPushEnabled
            ? 'browser_realtime'
            : 'off'
        setPushMode(activeMode)
        setStorePushState(currentPermission, status.isSubscribed, activeMode)
      }
    } catch (err) {
      console.error('Failed to check push subscription status:', err)
    } finally {
      setLoading(false)
    }
  }, [setStorePreferences, setStorePushState])

  React.useEffect(() => {
    void checkStatus()
  }, [checkStatus])

  const handleTogglePush = async (checked: boolean) => {
    if (!isSupported) {
      toast.error('Desktop notifications are not supported on this browser.')
      return
    }

    setToggling(true)
    try {
      if (checked) {
        const result = await enableBrowserNotifications(async () => {
          const vapidRes = await getVapidPublicKey()
          return vapidRes.success ? vapidRes.publicKey : null
        })

        await updateUserNotificationPreferences({ desktopPushEnabled: true })
        setPrefs((p) => ({ ...p, desktopPushEnabled: true }))

        if (result.mode === 'web_push' && result.subscription) {
          const saveRes = await savePushSubscription(result.subscription)
          if (saveRes.success) {
            setIsSubscribed(true)
            setPermission('granted')
            setPushMode('web_push')
            setStorePushState('granted', true, 'web_push')
            toast.success(
              'Full Web Push enabled! Alerts will appear even in other tabs, while idle, or when closed.'
            )
            await checkStatus()
          } else {
            toast.error(saveRes.error || 'Failed to save subscription.')
          }
        } else {
          setIsSubscribed(false)
          setPermission('granted')
          setPushMode('browser_realtime')
          setStorePushState('granted', false, 'browser_realtime')
          toast.success(
            result.isBrave
              ? 'Live Desktop Pop-ups enabled! (For closed-browser push in Brave, enable "Use Google services for push messaging" in brave://settings/privacy.)'
              : 'Live Desktop Pop-ups enabled! Alerts will pop up across tabs & while idle.'
          )
        }
      } else {
        const endpoint = await unsubscribeFromPush()
        if (endpoint) {
          await deletePushSubscription(endpoint)
        }
        await updateUserNotificationPreferences({ desktopPushEnabled: false })
        setPrefs((p) => ({ ...p, desktopPushEnabled: false }))
        setIsSubscribed(false)
        setPushMode('off')
        setStorePushState(getNotificationPermission(), false, 'off')
        toast.success('Desktop push notifications disabled for this device.')
        await checkStatus()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Subscription error'
      toast.error(msg)
      await checkStatus()
    } finally {
      setToggling(false)
    }
  }

  const updatePref = async (
    key: keyof NotificationPreferenceDTO,
    value: boolean | NotificationCategoryType[]
  ) => {
    const nextPrefs: NotificationPreferenceDTO = {
      ...prefs,
      [key]: value,
    }
    setPrefs(nextPrefs)
    setStorePreferences(nextPrefs)
    setSavingPref(key)
    try {
      const res = await updateUserNotificationPreferences({ [key]: value })
      if (!res.success) {
        toast.error(res.error || 'Failed to save preference')
        setPrefs(prefs)
        setStorePreferences(prefs)
      } else {
        try {
          const bc = new BroadcastChannel('artyx-notifications-sync')
          bc.postMessage({ type: 'PREFS_UPDATED', preferences: nextPrefs })
          bc.close()
        } catch {}
      }
    } finally {
      setSavingPref(null)
    }
  }

  const toggleCategory = (cat: NotificationCategoryType, enabled: boolean) => {
    const current = new Set(prefs.mutedCategories)
    if (enabled) {
      current.delete(cat)
    } else {
      current.add(cat)
    }
    void updatePref('mutedCategories', Array.from(current))
  }

  const handleSendTestPush = async () => {
    setSendingTest(true)
    try {
      const res = await sendTestPushToCurrentUser()
      if (res.success) {
        toast.success(res.message || 'Test notification dispatched!')
      } else {
        toast.error(res.error || 'Failed to send test notification.')
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Error sending test notification'
      toast.error(msg)
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div
      id="notifications"
      className="rounded-xl border bg-card p-5 shadow-sm space-y-5 scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#3E7000]/12 dark:bg-[#7FFF00]/12 text-[#3E7000] dark:text-[#7FFF00]">
            <BellRing className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base">
              Advanced Executive Push & Pop-up Alerts
            </h3>
            <p className="text-sm text-muted-foreground">
              Instant floating pop-ups and OS browser push notifications when
              executives assign tasks, update statuses, send messages, or log
              financial actions — even in other tabs or while idle.
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {!isSupported ? (
            <Badge
              variant="outline"
              className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30"
            >
              Unsupported
            </Badge>
          ) : permission === 'denied' ? (
            <Badge variant="destructive">Blocked in Browser</Badge>
          ) : pushMode === 'web_push' ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
              Web Push Active
            </Badge>
          ) : pushMode === 'browser_realtime' ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
              Desktop Pop-ups Active
            </Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          )}
        </div>
      </div>

      {/* Browser Web Push Registration */}
      <div className="rounded-xl border bg-muted/40 p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="font-medium text-sm flex items-center gap-2">
              <Smartphone className="size-4 text-muted-foreground" />
              Browser Push Notifications on this device
            </div>
            <p className="text-xs text-muted-foreground">
              {pushMode === 'web_push'
                ? 'Registered via Service Worker Web Push — receives native OS pop-up notifications across tabs, while idle, or even when browser is closed.'
                : pushMode === 'browser_realtime'
                  ? 'Live Desktop OS Pop-ups active — receives native OS notifications across other tabs, other apps, and while idle.'
                  : 'Turn on to register this browser for instant background & desktop pop-up notifications.'}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {loading || toggling ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={pushMode !== 'off'}
                onCheckedChange={handleTogglePush}
                disabled={!isSupported || permission === 'denied' || toggling}
                aria-label="Toggle Web Push Notifications"
              />
            )}
          </div>
        </div>

        {pushMode === 'browser_realtime' && isBrave && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
            <Info className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                Brave Browser detected — Live OS Pop-ups are already working!
              </p>
              <p className="text-muted-foreground mt-0.5">
                You will get native desktop pop-ups even in other tabs or while
                idle. To also receive cloud push when Brave is completely
                closed, enable{' '}
                <code className="font-mono text-[11px]">
                  Use Google services for push messaging
                </code>{' '}
                in <code className="font-mono text-[11px]">brave://settings/privacy</code>{' '}
                and toggle this switch off & on.
              </p>
            </div>
          </div>
        )}

        {permission === 'denied' && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                Notifications are blocked in your browser.
              </p>
              <p className="text-muted-foreground mt-0.5">
                Click the lock/settings icon next to the browser address bar and
                set Notifications to Allow for this site, then refresh.
              </p>
            </div>
          </div>
        )}

        <div className="pt-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2
              className={
                isSubscribed
                  ? 'size-4 text-emerald-600 shrink-0'
                  : 'size-4 text-muted-foreground/60 shrink-0'
              }
            />
            <span>
              {subscriptionCount > 0
                ? `${subscriptionCount} active browser/device${subscriptionCount > 1 ? 's' : ''} subscribed on your account`
                : 'No devices registered for background push yet'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => playNotificationChime('EXECUTIVE_TASK', 'HIGH')}
              className="text-xs"
            >
              <Volume2 className="mr-1.5 size-3.5" />
              Test Chime
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSendTestPush}
              disabled={sendingTest}
              className="text-xs"
            >
              {sendingTest ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-3.5" />
              )}
              Send Test Pop-up & Push
            </Button>
          </div>
        </div>
      </div>

      {/* Delivery & Behavior Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">In-App Floating Pop-ups</p>
              <p className="text-[11px] text-muted-foreground">
                Show floating alert cards above Team Chat when an action occurs
              </p>
            </div>
          </div>
          <Switch
            checked={prefs.inAppPopupEnabled}
            disabled={savingPref === 'inAppPopupEnabled'}
            onCheckedChange={(v) => void updatePref('inAppPopupEnabled', v)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <Monitor className="size-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">
                OS Pop-up Even While Active
              </p>
              <p className="text-[11px] text-muted-foreground">
                Show native browser pop-ups even while viewing Artyx (always on
                when in other tabs or idle)
              </p>
            </div>
          </div>
          <Switch
            checked={prefs.notifyWhenActive}
            disabled={savingPref === 'notifyWhenActive'}
            onCheckedChange={(v) => void updatePref('notifyWhenActive', v)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <Volume2 className="size-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Notification Chimes</p>
              <p className="text-[11px] text-muted-foreground">
                Play distinct audio tones for urgent tasks, chat & financial
                alerts
              </p>
            </div>
          </div>
          <Switch
            checked={prefs.soundEnabled}
            disabled={savingPref === 'soundEnabled'}
            onCheckedChange={(v) => void updatePref('soundEnabled', v)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <Moon className="size-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Do Not Disturb</p>
              <p className="text-[11px] text-muted-foreground">
                Silence pop-ups & chimes (URGENT alerts still break through)
              </p>
            </div>
          </div>
          <Switch
            checked={prefs.dndEnabled}
            disabled={savingPref === 'dndEnabled'}
            onCheckedChange={(v) => void updatePref('dndEnabled', v)}
          />
        </div>
      </div>

      {/* Per-Category Alert Matrix */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Subscribed Executive Event Channels
          </h4>
          <span className="text-[11px] text-muted-foreground">
            {TOGGLEABLE_CATEGORIES.length - prefs.mutedCategories.length} of{' '}
            {TOGGLEABLE_CATEGORIES.length} active
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {TOGGLEABLE_CATEGORIES.map((cat) => {
            const enabled = !prefs.mutedCategories.includes(cat)
            return (
              <label
                key={cat}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <span className="font-medium truncate">
                  {NOTIFICATION_CATEGORY_META[cat].label}
                </span>
                <Switch
                  checked={enabled}
                  disabled={savingPref === 'mutedCategories'}
                  onCheckedChange={(v) => toggleCategory(cat, v)}
                />
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg">
        <Info className="size-4 shrink-0 text-primary" />
        <span>
          Actions you perform yourself never notify you. Only relevant
          executives (SUPER ADMIN, CEO, COO, CMO) and assigned coworkers receive
          instant alerts.
        </span>
      </div>
    </div>
  )
}
