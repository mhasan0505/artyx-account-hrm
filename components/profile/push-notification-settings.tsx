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
  Send,
  ShieldAlert,
  Smartphone,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  isPushNotificationSupported,
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getActivePushSubscriptionEndpoint,
} from '@/lib/notifications/push-client'
import {
  savePushSubscription,
  deletePushSubscription,
  getPushSubscriptionStatus,
  sendTestPushToCurrentUser,
} from '@/lib/actions/push-notifications'

export function PushNotificationSettings() {
  const [isSupported, setIsSupported] = React.useState(false)
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>('default')
  const [isSubscribed, setIsSubscribed] = React.useState(false)
  const [subscriptionCount, setSubscriptionCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [toggling, setToggling] = React.useState(false)
  const [sendingTest, setSendingTest] = React.useState(false)

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

  const checkStatus = React.useCallback(async () => {
    try {
      const supported = isPushNotificationSupported()
      setIsSupported(supported)

      if (!supported) {
        setPermission('unsupported')
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
      }
    } catch (err) {
      console.error('Failed to check push subscription status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const handleToggle = async (checked: boolean) => {
    if (!isSupported) {
      toast.error('Web Push notifications are not supported on this browser.')
      return
    }

    if (!vapidPublicKey) {
      toast.error('VAPID Public Key is not configured on the server.')
      return
    }

    setToggling(true)
    try {
      if (checked) {
        // Subscribe
        const subData = await subscribeToPush(vapidPublicKey)
        const saveRes = await savePushSubscription(subData)

        if (saveRes.success) {
          setIsSubscribed(true)
          setPermission('granted')
          toast.success('Push notifications enabled for this device!')
          await checkStatus()
        } else {
          toast.error(saveRes.error || 'Failed to save subscription.')
          setIsSubscribed(false)
        }
      } else {
        // Unsubscribe
        const endpoint = await unsubscribeFromPush()
        if (endpoint) {
          await deletePushSubscription(endpoint)
        }
        setIsSubscribed(false)
        toast.success('Push notifications disabled for this device.')
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

  const handleSendTestPush = async () => {
    if (!isSubscribed) {
      toast.error('Please enable push notifications first to receive a test push.')
      return
    }

    setSendingTest(true)
    try {
      const res = await sendTestPushToCurrentUser()
      if (res.success) {
        toast.success(res.message || 'Test push notification dispatched!')
      } else {
        toast.error(res.error || 'Failed to send test push.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error sending test push'
      toast.error(msg)
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
            <BellRing className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Web Push Notifications</h3>
            <p className="text-sm text-muted-foreground">
              Receive real-time alerts for low stock, drawer closing variance, balance sheet checks, and security signals.
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {!isSupported ? (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              Unsupported
            </Badge>
          ) : permission === 'denied' ? (
            <Badge variant="destructive">Blocked in Browser</Badge>
          ) : isSubscribed ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Active</Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          )}
        </div>
      </div>

      {/* Main Controls */}
      <div className="rounded-lg border bg-muted/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="font-medium text-sm flex items-center gap-2">
              <Smartphone className="size-4 text-muted-foreground" />
              Notifications on this device
            </div>
            <p className="text-xs text-muted-foreground">
              {isSubscribed
                ? 'This device is currently registered to receive instant role and outlet alerts.'
                : 'Turn on to register this browser for real-time notifications.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {loading || toggling ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={isSubscribed}
                onCheckedChange={handleToggle}
                disabled={!isSupported || permission === 'denied' || toggling}
                aria-label="Toggle Web Push Notifications"
              />
            )}
          </div>
        </div>

        {/* Permission Denied Warning */}
        {permission === 'denied' && (
          <div className="flex items-start gap-2.5 p-3 rounded-md bg-destructive/10 text-destructive text-xs">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Notifications are blocked in your browser.</p>
              <p className="text-muted-foreground mt-0.5">
                To enable alerts, click the lock/settings icon next to the URL bar in your browser and allow Notifications for this site.
              </p>
            </div>
          </div>
        )}

        {/* Active subscription summary & test button */}
        {isSubscribed && (
          <div className="pt-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
              <span>
                {subscriptionCount} active device{subscriptionCount > 1 ? 's' : ''} registered on your account
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSendTestPush}
              disabled={sendingTest}
              className="w-full sm:w-auto text-xs"
            >
              {sendingTest ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : (
                <Send className="mr-2 size-3.5" />
              )}
              Send Test Notification
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-md">
        <Info className="size-4 shrink-0 text-primary" />
        <span>
          Push alerts are strictly filtered by your assigned role and outlet to prevent notification spam across outlets.
        </span>
      </div>
    </div>
  )
}
