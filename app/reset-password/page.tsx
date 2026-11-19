'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  resetPasswordWithToken,
  validateResetToken,
} from '@/lib/actions/password-reset'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [checking, setChecking] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [accountInfo, setAccountInfo] = useState<{ email: string; name: string } | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function verify() {
      if (!token) {
        setTokenError('Missing password reset token. Please request a new reset link.')
        setChecking(false)
        return
      }
      try {
        const res = await validateResetToken(token)
        if (!active) return
        if (!res.success) {
          setTokenError(res.error)
          setTokenValid(false)
        } else {
          setAccountInfo(res.data)
          setTokenValid(true)
        }
      } catch {
        if (active) setTokenError('Failed to verify reset link.')
      } finally {
        if (active) setChecking(false)
      }
    }
    verify()
    return () => {
      active = false
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (newPassword.length < 6) {
      setFormError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await resetPasswordWithToken(token, newPassword)
      if (!res.success) {
        setFormError(res.error)
        return
      }
      router.push('/login?reset=success')
    } catch {
      setFormError('Unable to update password right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      {/* Ambient Brand Lighting */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] pointer-events-none opacity-40 dark:opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 50% 20%, oklch(0.62 0.19 255 / 0.35), oklch(0.25 0.08 255 / 0.15) 50%, transparent 80%)',
        }}
        aria-hidden="true"
      />

      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl shadow-2xl p-8 space-y-6 relative z-10 animate-in fade-in zoom-in-95 duration-300">
        {/* Brand Header */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="relative">
            <div className="size-14 rounded-2xl border border-primary/20 bg-background/95 shadow-md flex items-center justify-center overflow-hidden ring-4 ring-primary/10 p-2">
              <Image
                src="/artyx-logo.webp"
                alt="Artyx Digital logo"
                width={48}
                height={48}
                priority
                unoptimized
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
            </div>
            <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
              <KeyRound className="size-3" />
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Set New Password
            </h1>
            {accountInfo && (
              <p className="text-xs text-muted-foreground">
                Resetting password for <strong className="text-foreground">{accountInfo.name}</strong> ({accountInfo.email})
              </p>
            )}
          </div>
        </div>

        {checking ? (
          <div className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs font-medium">Verifying reset link…</span>
          </div>
        ) : !tokenValid ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25 text-xs text-destructive flex items-start gap-2.5">
              <ShieldAlert className="size-4 shrink-0 mt-0.5" />
              <span>{tokenError || 'This password reset link is invalid or expired.'}</span>
            </div>
            <Button asChild className="w-full h-11 text-sm font-semibold">
              <Link href="/forgot-password">Request a New Reset Link</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="newPassword"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoFocus
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setFormError(null)
                  }}
                  placeholder="Min. 6 characters"
                  className="pr-10 h-11 bg-muted/30 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="confirmPassword"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  setFormError(null)
                }}
                placeholder="Re-enter new password"
                className="h-11 bg-muted/30 text-sm font-mono"
              />
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center font-medium">
                {formError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold shadow-md"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving New Password…
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        )}

        <div className="pt-2 border-t border-border/60 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
