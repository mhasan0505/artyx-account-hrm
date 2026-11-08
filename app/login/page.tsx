'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'
import { signIn } from 'next-auth/react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type FormValues = z.infer<typeof schema>

function getLoginErrorMessage(errorCode: string | undefined) {
  switch (errorCode) {
    case 'CredentialsSignin':
      return 'Invalid email or password'
    case 'Configuration':
      return 'Authentication is not configured correctly. Check AUTH_SECRET and AUTH_URL.'
    case 'CallbackRouteError':
      return 'Login service is unavailable. Check DATABASE_URL and database connectivity.'
    default:
      return 'Unable to sign in right now. Please try again.'
  }
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrlParam = searchParams.get('callbackUrl')
  const callbackUrl =
    callbackUrlParam && callbackUrlParam.startsWith('/')
      ? callbackUrlParam
      : '/'
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: (zodResolver as any)(schema) as never,
  })

  const onSubmit = async (data: FormValues) => {
    try {
      setError(null)
      const result = await signIn('credentials', {
        email: data.email.trim().toLowerCase(),
        password: data.password,
        callbackUrl,
        redirect: false,
      })

      if (result?.error) {
        setError(getLoginErrorMessage(result.error))
        return
      }

      if (!result?.ok) {
        setError('Unable to sign in right now. Please try again.')
        return
      }

      router.push(callbackUrl)
      router.refresh()
    } catch {
      setError('Login request failed. Check your network and try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      {/* Ambient Brand Lighting (Midnight Sapphire) */}
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

      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl shadow-2xl p-8 space-y-6 relative z-10 animate-in fade-in zoom-in-95 duration-300">
        {/* Logo & Brand Presentation */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="relative group">
            <div className="size-16 rounded-2xl border border-primary/20 bg-background/95 shadow-md flex items-center justify-center overflow-hidden ring-4 ring-primary/10 transition-all duration-300 group-hover:scale-105 p-2">
              <Image
                src="/artyx-logo.webp"
                alt="Artyx Digital logo"
                width={56}
                height={56}
                priority
                unoptimized
                style={{ width: 'auto', height: 'auto' }}
                className="object-contain"
              />
            </div>
            <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-[#7FFF00] text-black flex items-center justify-center shadow-xs">
              <ShieldCheck className="size-3" />
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Artyx Digital
            </h1>
            <p className="text-xs text-muted-foreground">
              Agency Operations & Financial Accounting ERP
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@artyxdigital.com"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 bg-muted/30 focus-visible:ring-primary text-sm shadow-xs"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-destructive font-medium">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="current-password"
                autoCorrect="off"
                className="pr-10 h-11 bg-muted/30 focus-visible:ring-primary text-sm shadow-xs font-mono"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-destructive font-medium">
                {errors.password.message}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center font-medium animate-in fade-in">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-11 text-sm font-semibold pressable shadow-md"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign In to Terminal'
            )}
          </Button>
        </form>

        <div className="pt-2 text-center border-t border-border/40">
          <p className="text-[11px] text-muted-foreground font-mono">
            Authorized Personnel Only • Secure Access
          </p>
        </div>
      </div>
    </div>
  )
}
