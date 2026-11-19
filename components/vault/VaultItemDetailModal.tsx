'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Terminal,
  Download,
  Edit3,
  Trash2,
  ShieldCheck,
  Clock,
  Star,
  KeyRound,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  buildSshCommand,
  daysSince,
  evaluatePasswordStrength,
  getCategoryMeta,
  type VaultItemRevealed,
} from '@/lib/vault/types'
import { refreshVaultItemTotp } from '@/lib/actions/vault'
import { VaultCategoryIcon } from './VaultCategoryIcon'
import { toast } from 'sonner'

interface VaultItemDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: VaultItemRevealed | null
  onEdit: (item: VaultItemRevealed) => void
  onDelete: (id: string) => void
  onVaultLocked: () => void
}

export function VaultItemDetailModal({
  open,
  onOpenChange,
  item,
  onEdit,
  onDelete,
  onVaultLocked,
}: VaultItemDetailModalProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showSshKey, setShowSshKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showEnv, setShowEnv] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Live TOTP state
  const [totpCode, setTotpCode] = useState<string | null>(null)
  const [totpRemaining, setTotpRemaining] = useState<number>(30)
  const [totpPeriod, setTotpPeriod] = useState<number>(30)

  useEffect(() => {
    if (!open || !item) return
    setShowPassword(false)
    setShowSshKey(false)
    setShowApiKey(false)
    setShowEnv(false)
    setCopiedField(null)

    if (item.currentTotp) {
      setTotpCode(item.currentTotp.code)
      setTotpRemaining(item.currentTotp.remainingSeconds)
      setTotpPeriod(item.currentTotp.period)
    } else {
      setTotpCode(null)
    }
  }, [open, item])

  // Ticking countdown + server refresh when TOTP window rolls over
  useEffect(() => {
    if (!open || !item?.hasTotp || !totpCode) return

    const interval = setInterval(async () => {
      setTotpRemaining((prev) => {
        if (prev <= 1) {
          refreshVaultItemTotp(item.id).then((res) => {
            if (!res.success) {
              if (res.error === 'VAULT_LOCKED') onVaultLocked()
              return
            }
            if (res.data) {
              setTotpCode(res.data.code)
              setTotpRemaining(res.data.remainingSeconds)
              setTotpPeriod(res.data.period)
            }
          })
          return totpPeriod
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [open, item?.id, item?.hasTotp, totpCode, totpPeriod, onVaultLocked])

  const copySecret = useCallback(async (label: string, value: string, autoClear = true) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(label)
      toast.success(
        autoClear
          ? `${label} copied! Clipboard auto-clears in 30s.`
          : `${label} copied to clipboard.`
      )
      setTimeout(() => setCopiedField((prev) => (prev === label ? null : prev)), 2000)

      if (autoClear) {
        setTimeout(async () => {
          try {
            const current = await navigator.clipboard.readText()
            if (current === value) {
              await navigator.clipboard.writeText('')
            }
          } catch {
            // Clipboard permission may not allow background read
          }
        }, 30000)
      }
    } catch {
      toast.error('Failed to copy to clipboard.')
    }
  }, [])

  const handleDownloadPem = () => {
    if (!item?.secrets.sshPrivateKey) return
    const safeName = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const blob = new Blob([item.secrets.sshPrivateKey], { type: 'application/x-pem-file' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeName}.pem`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`Downloaded ${safeName}.pem`)
  }

  if (!item) return null

  const meta = getCategoryMeta(item.category)
  const sshCommand = item.category === 'VPS_SSH' ? buildSshCommand(item) : null
  const passwordStrength = item.secrets.password ? evaluatePasswordStrength(item.secrets.password) : null
  const ageDays = daysSince(item.lastRotatedAt)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
              >
                <VaultCategoryIcon category={item.category} className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold flex items-center gap-2 truncate">
                  <span className="truncate">{item.title}</span>
                  {item.isFavorite && <Star className="w-4 h-4 text-amber-500 fill-current shrink-0" />}
                </DialogTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                  <span>{meta.label}</span>
                  <span>•</span>
                  <span>{item.folder}</span>
                  {item.provider && (
                    <>
                      <span>•</span>
                      <span className="font-medium text-foreground">{item.provider}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Login URL Bar */}
          {item.loginUrl && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border border-border">
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Login URL
                </span>
                <a
                  href={item.loginUrl.startsWith('http') ? item.loginUrl : `https://${item.loginUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline truncate block"
                >
                  {item.loginUrl}
                </a>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => copySecret('URL', item.loginUrl!, false)}
                >
                  {copiedField === 'URL' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
                <Button size="sm" variant="outline" asChild className="h-8 text-xs gap-1">
                  <a
                    href={item.loginUrl.startsWith('http') ? item.loginUrl : `https://${item.loginUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* VPS / SSH Quick Command Block */}
          {sshCommand && (
            <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  Quick SSH Command
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copySecret('SSH Command', sshCommand, false)}
                  className="h-7 text-[11px] gap-1"
                >
                  {copiedField === 'SSH Command' ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  Copy Command
                </Button>
              </div>
              <pre className="p-2.5 rounded-lg bg-background border border-border font-mono text-xs text-foreground overflow-x-auto">
                {sshCommand}
              </pre>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                {item.host && (
                  <span>
                    Host: <strong className="font-mono text-foreground">{item.host}</strong>
                  </span>
                )}
                <span>
                  Port: <strong className="font-mono text-foreground">{item.port || '22'}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Live 2FA Authenticator (TOTP) */}
          {totpCode && (
            <div className="p-3.5 rounded-xl bg-indigo-500/5 border border-indigo-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Live 2FA Authenticator Code
                </span>
                <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {totpRemaining}s
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-2xl font-bold font-mono tracking-[0.25em] text-foreground tabular-nums">
                  {totpCode.slice(0, 3)} {totpCode.slice(3)}
                </span>
                <Button
                  size="sm"
                  onClick={() => copySecret('2FA Code', totpCode, false)}
                  className="h-8 text-xs gap-1.5"
                >
                  {copiedField === '2FA Code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Code
                </Button>
              </div>

              <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    totpRemaining <= 5 ? 'bg-rose-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${(totpRemaining / totpPeriod) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Username & Password Fields */}
          <div className="space-y-2.5">
            {item.username && (
              <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-card border border-border">
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Username / Email
                  </span>
                  <p className="text-sm font-medium text-foreground font-mono truncate">
                    {item.username}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1 shrink-0"
                  onClick={() => copySecret('Username', item.username!, false)}
                >
                  {copiedField === 'Username' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy
                </Button>
              </div>
            )}

            {item.secrets.password && (
              <div className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Password
                      </span>
                      {passwordStrength && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                          {passwordStrength.label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground font-mono break-all mt-0.5">
                      {showPassword ? item.secrets.password : '••••••••••••••••••••'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setShowPassword((v) => !v)}
                      title={showPassword ? 'Hide' : 'Reveal'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      onClick={() => copySecret('Password', item.secrets.password!, true)}
                    >
                      {copiedField === 'Password' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* SSH Private Key */}
            {item.secrets.sshPrivateKey && (
              <div className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    SSH Private Key (.pem)
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setShowSshKey((v) => !v)}
                    >
                      {showSshKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => copySecret('SSH Private Key', item.secrets.sshPrivateKey!, true)}
                    >
                      {copiedField === 'SSH Private Key' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] gap-1"
                      onClick={handleDownloadPem}
                    >
                      <Download className="w-3 h-3" />
                      .pem
                    </Button>
                  </div>
                </div>
                <pre className="p-2.5 rounded-md bg-muted/40 border border-border font-mono text-[11px] text-foreground overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                  {showSshKey
                    ? item.secrets.sshPrivateKey
                    : '-----BEGIN PRIVATE KEY-----\n[ENCRYPTED SSH KEY HIDDEN — CLICK EYE OR COPY]\n-----END PRIVATE KEY-----'}
                </pre>
                {item.secrets.sshPassphrase && (
                  <div className="flex items-center justify-between pt-1 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground">Key Passphrase</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => copySecret('SSH Passphrase', item.secrets.sshPassphrase!, true)}
                    >
                      <Copy className="w-3 h-3" /> Copy Passphrase
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* API Key */}
            {item.secrets.apiKey && (
              <div className="p-3 rounded-lg bg-card border border-border flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    API Key / Token / URI
                  </span>
                  <p className="text-xs font-mono text-foreground break-all mt-0.5">
                    {showApiKey ? item.secrets.apiKey : '••••••••••••••••••••••••'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={() => copySecret('API Key', item.secrets.apiKey!, true)}
                  >
                    {copiedField === 'API Key' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy
                  </Button>
                </div>
              </div>
            )}

            {/* .env Block */}
            {item.secrets.envBlock && (
              <div className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    .env / Configuration Secrets
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setShowEnv((v) => !v)}
                    >
                      {showEnv ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => copySecret('.env Block', item.secrets.envBlock!, true)}
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </Button>
                  </div>
                </div>
                <pre className="p-2.5 rounded-md bg-muted/40 border border-border font-mono text-[11px] text-foreground overflow-x-auto max-h-40">
                  {showEnv ? item.secrets.envBlock : '••••••••=.env secrets hidden'}
                </pre>
              </div>
            )}

            {/* Recovery Info & Backup Codes */}
            {(item.secrets.recoveryEmail || item.secrets.recoveryPhone || item.secrets.backupCodes) && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recovery &amp; Emergency Info
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {item.secrets.recoveryEmail && (
                    <div>
                      <span className="text-muted-foreground">Recovery Email: </span>
                      <span className="font-medium text-foreground">{item.secrets.recoveryEmail}</span>
                    </div>
                  )}
                  {item.secrets.recoveryPhone && (
                    <div>
                      <span className="text-muted-foreground">Recovery Phone: </span>
                      <span className="font-medium text-foreground">{item.secrets.recoveryPhone}</span>
                    </div>
                  )}
                </div>
                {item.secrets.backupCodes && (
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-muted-foreground">Backup Codes</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] gap-1"
                        onClick={() => copySecret('Backup Codes', item.secrets.backupCodes!, true)}
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </Button>
                    </div>
                    <pre className="p-2 rounded bg-background border border-border font-mono text-[11px] whitespace-pre-wrap">
                      {item.secrets.backupCodes}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {item.secrets.notes && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Encrypted Notes
                </span>
                <p className="text-xs text-foreground whitespace-pre-wrap">{item.secrets.notes}</p>
              </div>
            )}
          </div>

          {/* Metadata & Actions Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="text-[11px] text-muted-foreground">
              Rotated {ageDays === 0 ? 'today' : `${ageDays}d ago`}
              {ageDays >= 90 && (
                <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                  (Consider rotating)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => {
                  if (confirm(`Permanently delete "${item.title}" from your CEO Vault?`)) {
                    onDelete(item.id)
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => onEdit(item)}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit Credential
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
