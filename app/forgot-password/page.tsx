'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  requestPasswordReset,
  resetPasswordWithEmailCode,
} from '@/lib/actions/password-reset'

export default function ForgotPasswordPage() {
  const router = useRouter()

  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [devPreview, setDevPreview] = useState<{
    resetUrl: string
    otpCode: string
  } | null>(null)

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfoMessage(null)
    setDevPreview(null)

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError('Please enter your work email address.')
      return
    }

    setLoading(true)
    try {
      const res = await requestPasswordReset(cleanEmail)
      if (!res.success) {
        setError(res.error)
        return
      }
      setInfoMessage(res.data.message)
      if (res.data.devPreview) {
        setDevPreview(res.data.devPreview)
      }
      setStep('verify')
    } catch {
      setError('Request failed. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await resetPasswordWithEmailCode(email, otpCode, newPassword)
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/login?reset=success')
    } catch {
      setError('Failed to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      {/* Ambient Brand Lighting (matches Login page) */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] pointer-events-none opacity-40 dark:opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 50% 20%, oklch(0.62 0.19 255 / 0.35), oklch(0.25 0.08 255 / 0.15) 50%, transparent 80%)',
        }}
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full pointer-events-none opacity-20 dark:opacity-30 blur-3xl bg-primary/20"
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
              {step === 'request' ? 'Forgot Password' : 'Reset Your Password'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {step === 'request'
                ? 'Enter your account email to receive a reset link and 6-digit verification code.'
                : 'Click the link in your email or enter the 6-digit verification code below.'}
            </p>
          </div>
        </div>

        {/* Step 1: Enter Email */}
        {step === 'request' && (
          <form onSubmit={handleRequestReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Work Email Address
              </Label>
              <div className="relative">
                <Mail className="size-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  placeholder="name@artyxdigital.com"
                  autoComplete="email"
                  className="h-11 pl-10 bg-muted/30 focus-visible:ring-primary text-sm shadow-xs"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2 font-medium">
                <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold shadow-md"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Sending Reset Instructions…
                </>
              ) : (
                'Send Reset Link & Code'
              )}
            </Button>

            <div className="p-3 rounded-lg bg-muted/40 border border-border/70 text-[11px] text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Email password reset is available for all staff roles (Admin, Manager, Accountant, HR, Cashier, Technician).{' '}
                <strong className="text-foreground">Super Admin</strong> accounts are excluded for security.
              </span>
            </div>
          </form>
        )}

        {/* Step 2: Enter 6-digit OTP + New Password */}
        {step === 'verify' && (
          <form onSubmit={handleVerifyAndReset} className="space-y-4">
            {infoMessage && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
                <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                <span>{infoMessage}</span>
              </div>
            )}

            {devPreview && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs space-y-1.5">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Local Dev Preview (SMTP not configured)
                </p>
                <p className="text-muted-foreground">
                  6-Digit Code:{' '}
                  <strong className="font-mono text-foreground text-sm tracking-widest">
                    {devPreview.otpCode}
                  </strong>
                </p>
                <Link
                  href={devPreview.resetUrl.replace(/^https?:\/\/[^/]+/, '')}
                  className="inline-block text-primary hover:underline font-semibold"
                >
                  Open Direct Reset Link →
                </Link>
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="otp"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                6-Digit Verification Code
              </Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setError(null)
                }}
                placeholder="123456"
                className="h-11 bg-muted/30 text-center font-mono text-lg tracking-[0.35em]"
              />
            </div>

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
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setError(null)
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
                  setError(null)
                }}
                placeholder="Re-enter new password"
                className="h-11 bg-muted/30 text-sm font-mono"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center font-medium">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold shadow-md"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Updating Password…
                </>
              ) : (
                'Reset Password'
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep('request')
                setError(null)
                setOtpCode('')
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Use a different email or resend code
            </button>
          </form>
        )}

        {/* Back to Login */}
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
