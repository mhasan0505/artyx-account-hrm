/**
 * Brute-force lockout evaluation helper.
 * Enforces rate limiting on sensitive operations like PIN approvals.
 */

export interface FailedAttempt {
  createdAt: Date
}

export interface LockoutResult {
  isLocked: boolean
  remainingLockoutSeconds?: number
}

/**
 * Evaluates whether an account/action is locked out based on failed attempts in a rolling time window.
 * 
 * @param failedAttempts Array of records containing createdAt timestamp
 * @param windowMs Rolling window duration in milliseconds (default: 15 minutes)
 * @param maxAttempts Maximum allowed failed attempts before lockout (default: 5)
 */
export function isLockedOutByFailedAttempts(
  failedAttempts: FailedAttempt[],
  windowMs = 15 * 60 * 1000,
  maxAttempts = 5
): LockoutResult {
  const now = Date.now()
  const recentAttempts = failedAttempts.filter(
    a => now - new Date(a.createdAt).getTime() <= windowMs
  )

  if (recentAttempts.length < maxAttempts) {
    return { isLocked: false }
  }

  // The lockout lasts until windowMs has elapsed since the most recent failure
  const latestAttemptTime = Math.max(
    ...recentAttempts.map(a => new Date(a.createdAt).getTime())
  )
  const expiresAt = latestAttemptTime + windowMs
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))

  if (remainingSeconds <= 0) {
    return { isLocked: false }
  }

  return {
    isLocked: true,
    remainingLockoutSeconds: remainingSeconds,
  }
}
