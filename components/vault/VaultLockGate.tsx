'use client'

import React, { useState } from 'react'
import {
  ShieldCheck,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  setupVaultPin,
  unlockVault,
  resetVaultPinWithAccountPassword,
} from '@/lib/actions/vault'
import { toast } from 'sonner'

interface VaultLockGateProps {
  hasPinSet: boolean
  itemCount: number
  hasDedicatedKey: boolean
  onUnlocked: (expiresAt: number) => void
}

export function VaultLockGate({
  hasPinSet,
  itemCount,
  hasDedicatedKey,
  onUnlocked,
}: VaultLockGateProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Recoverable reset modal state
  const [resetOpen, setResetOpen] = useState(false)
  const [accountPassword, setAccountPassword] = useState('')
  const [newResetPin, setNewResetPin] = useState('')
  const [confirmResetPin, setConfirmResetPin] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!hasPinSet) {
      if (pin.trim().length < 6) {
        setError('Please choose a Vault PIN or passphrase of at least 6 characters.')
        return
      }
      if (pin !== confirmPin) {
        setError('PINs do not match. Please confirm again.')
        return
      }
      setLoading(true)
      try {
        const res = await setupVaultPin(pin)
        if (!res.success) {
          setError(res.error)
          return
        }
        toast.success('CEO Credential Vault initialized and unlocked!')
        onUnlocked(res.data.expiresAt)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!pin.trim()) {
      setError('Enter your Vault PIN or passphrase.')
      return
    }

    setLoading(true)
    try {
      const res = await unlockVault(pin)
      if (!res.success) {
        setError(res.error)
        return
      }
      toast.success('Vault unlocked for 10 minutes.')
      setPin('')
      onUnlocked(res.data.expiresAt)
    } finally {
      setLoading(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError('')
    if (newResetPin.trim().length < 6) {
      setResetError('New Vault PIN must be at least 6 characters.')
      return
    }
    if (newResetPin !== confirmResetPin) {
      setResetError('New Vault PINs do not match.')
      return
    }

    setResetLoading(true)
    try {
      const res = await resetVaultPinWithAccountPassword(accountPassword, newResetPin)
      if (!res.success) {
        setResetError(res.error)
        return
      }
      toast.success('Vault PIN reset successfully. All encrypted credentials remain intact.')
      setResetOpen(false)
      setAccountPassword('')
      setNewResetPin('')
      setConfirmResetPin('')
      onUnlocked(res.data.expiresAt)
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center py-8 sm:py-14">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        {/* Top Accent Strip */}
        <div className="h-1.5 bg-gradient-to-r from-amber-500 via-emerald-500 to-indigo-500" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col items-center text-center space-y-2.5">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              {hasPinSet ? <Lock className="w-7 h-7" /> : <ShieldCheck className="w-7 h-7" />}
            </div>

            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                {hasPinSet ? 'CEO Vault is Locked' : 'Set Up Your CEO Vault PIN'}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {hasPinSet
                  ? `Enter your personal Vault PIN to decrypt and manage ${itemCount} protected credential${itemCount === 1 ? '' : 's'}.`
                  : 'Create a private PIN or passphrase (6+ characters) to guard your AES-256-GCM encrypted credentials.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {hasPinSet ? 'Personal Vault PIN / Passphrase' : 'Create Vault PIN / Passphrase'}
              </label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value)
                    setError('')
                  }}
                  autoFocus
                  placeholder={hasPinSet ? 'Enter Vault PIN...' : 'Min. 6 characters or digits'}
                  className="w-full bg-background border border-input rounded-lg pl-3.5 pr-10 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  tabIndex={-1}
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!hasPinSet && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Confirm Vault PIN / Passphrase
                </label>
                <input
                  type={showPin ? 'text' : 'password'}
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value)
                    setError('')
                  }}
                  placeholder="Re-enter PIN to confirm"
                  className="w-full bg-background border border-input rounded-lg px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full font-semibold h-10 gap-2">
              <KeyRound className="w-4 h-4" />
              <span>
                {loading
                  ? hasPinSet
                    ? 'Verifying...'
                    : 'Initializing Vault...'
                  : hasPinSet
                  ? 'Unlock Vault'
                  : 'Save PIN & Open Vault'}
              </span>
            </Button>
          </form>

          {/* Security Indicators */}
          <div className="pt-4 border-t border-border/70 space-y-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                AES-256-GCM Server Encryption
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground">
                {hasDedicatedKey ? 'Dedicated Key' : 'Derived Key'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Auto-locks after 10 min · Full Audit Log
              </span>
              {hasPinSet && (
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  className="text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Forgot PIN?
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recoverable PIN Reset Modal */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-primary" />
              Reset Forgotten Vault PIN
            </DialogTitle>
            <DialogDescription className="text-xs">
              Verify your CEO account login password to set a new Vault PIN. Your encrypted credentials will remain completely intact.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetSubmit} className="space-y-4 pt-2 text-xs">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Account Login Password
              </label>
              <input
                type="password"
                required
                value={accountPassword}
                onChange={(e) => setAccountPassword(e.target.value)}
                placeholder="Your Artyx Office login password"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                New Vault PIN / Passphrase (6+ chars)
              </label>
              <input
                type="password"
                required
                value={newResetPin}
                onChange={(e) => setNewResetPin(e.target.value)}
                placeholder="Enter new Vault PIN"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Confirm New Vault PIN
              </label>
              <input
                type="password"
                required
                value={confirmResetPin}
                onChange={(e) => setConfirmResetPin(e.target.value)}
                placeholder="Confirm new Vault PIN"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {resetError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400">
                {resetError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" variant="outline" size="sm" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={resetLoading}>
                {resetLoading ? 'Resetting...' : 'Reset Vault PIN'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
