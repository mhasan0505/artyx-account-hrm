'use client'

import { signOut } from 'next-auth/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { performLogoutCleanup } from '@/lib/auth/logout-cleanup'

function parseSeconds(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Idle period before the warning modal appears and the user is logged out.
// Default: 30 minutes. Tune via NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_SECONDS.
const IDLE_TIMEOUT_SECONDS = parseSeconds(
  process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_SECONDS,
  60 * 30,
)

// Grace period shown in the warning modal before the auto sign-out fires.
const WARNING_SECONDS = 60

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
]

export function SessionIdleTracker() {
  const { status } = useSession()
  const [warning, setWarning] = useState(false)
  const [countdown, setCountdown] = useState(WARNING_SECONDS)

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const signOutRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (warningTimer.current) clearInterval(warningTimer.current)
    idleTimer.current = null
    warningTimer.current = null
  }, [])

  const performSignOut = useCallback(async () => {
    if (signOutRef.current) return
    signOutRef.current = true
    clearTimers()
    setWarning(false)
    await performLogoutCleanup()
    void signOut({ callbackUrl: '/login' })
  }, [clearTimers])

  const startIdleTimer = useCallback(() => {
    clearTimers()
    idleTimer.current = setTimeout(() => {
      setWarning(true)
      setCountdown(WARNING_SECONDS)
      warningTimer.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            performSignOut()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }, IDLE_TIMEOUT_SECONDS * 1000)
  }, [clearTimers, performSignOut])

  const resetActivity = useCallback(() => {
    if (signOutRef.current) return
    if (warning) {
      setWarning(false)
      clearTimers()
      startIdleTimer()
      return
    }
    startIdleTimer()
  }, [warning, clearTimers, startIdleTimer])

  useEffect(() => {
    if (status !== 'authenticated') {
      clearTimers()
      setWarning(false)
      return
    }

    signOutRef.current = false
    startIdleTimer()

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, resetActivity, { passive: true }),
    )

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, resetActivity),
      )
      clearTimers()
    }
  }, [status, startIdleTimer, resetActivity, clearTimers])

  if (!warning) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 text-center shadow-xl">
        <h2 className="text-lg font-semibold">Session about to expire</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve been inactive for {IDLE_TIMEOUT_SECONDS / 60} minutes. For
          your security, you&apos;ll be signed out automatically in{' '}
          <span className="font-semibold text-foreground">{countdown}s</span>.
        </p>
        <button
          type="button"
          onClick={resetActivity}
          className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Stay signed in
        </button>
      </div>
    </div>
  )
}
