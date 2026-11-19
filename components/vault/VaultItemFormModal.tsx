'use client'

import React, { useState, useEffect } from 'react'
import {
  Eye,
  EyeOff,
  Wand2,
  Star,
  Terminal,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  VAULT_CATEGORIES,
  VAULT_FOLDERS,
  buildSshCommand,
  evaluatePasswordStrength,
  generateStrongPassword,
  getCategoryMeta,
  type VaultCategory,
  type VaultItemInput,
  type VaultItemRevealed,
} from '@/lib/vault/types'
import { VaultCategoryIcon } from './VaultCategoryIcon'

interface VaultItemFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialItem?: VaultItemRevealed | null
  defaultCategory?: VaultCategory
  onSave: (input: VaultItemInput) => Promise<boolean>
}

export function VaultItemFormModal({
  open,
  onOpenChange,
  initialItem,
  defaultCategory = 'EMAIL',
  onSave,
}: VaultItemFormModalProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<VaultCategory>(defaultCategory)
  const [folder, setFolder] = useState<string>('CEO Personal')
  const [provider, setProvider] = useState('')
  const [loginUrl, setLoginUrl] = useState('')
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [tagsText, setTagsText] = useState('')
  const [isFavorite, setIsFavorite] = useState(false)

  // Secret fields
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [sshPrivateKey, setSshPrivateKey] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [envBlock, setEnvBlock] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryPhone, setRecoveryPhone] = useState('')
  const [backupCodes, setBackupCodes] = useState('')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (initialItem) {
      setTitle(initialItem.title)
      setCategory(initialItem.category)
      setFolder(initialItem.folder)
      setProvider(initialItem.provider || '')
      setLoginUrl(initialItem.loginUrl || '')
      setUsername(initialItem.username || '')
      setHost(initialItem.host || '')
      setPort(initialItem.port || (initialItem.category === 'VPS_SSH' ? '22' : ''))
      setTagsText((initialItem.tags || []).join(', '))
      setIsFavorite(initialItem.isFavorite)

      setPassword(initialItem.secrets.password || '')
      setSshPrivateKey(initialItem.secrets.sshPrivateKey || '')
      setSshPassphrase(initialItem.secrets.sshPassphrase || '')
      setApiKey(initialItem.secrets.apiKey || '')
      setEnvBlock(initialItem.secrets.envBlock || '')
      setTotpSecret(initialItem.secrets.totpSecret || '')
      setRecoveryEmail(initialItem.secrets.recoveryEmail || '')
      setRecoveryPhone(initialItem.secrets.recoveryPhone || '')
      setBackupCodes(initialItem.secrets.backupCodes || '')
      setNotes(initialItem.secrets.notes || '')
    } else {
      const meta = getCategoryMeta(defaultCategory)
      setTitle('')
      setCategory(defaultCategory)
      setFolder(meta.defaultFolder)
      setProvider('')
      setLoginUrl('')
      setUsername('')
      setHost('')
      setPort(defaultCategory === 'VPS_SSH' ? '22' : '')
      setTagsText('')
      setIsFavorite(false)

      setPassword('')
      setSshPrivateKey('')
      setSshPassphrase('')
      setApiKey('')
      setEnvBlock('')
      setTotpSecret('')
      setRecoveryEmail('')
      setRecoveryPhone('')
      setBackupCodes('')
      setNotes('')
    }
    setShowPassword(false)
  }, [open, initialItem, defaultCategory])

  const handleCategoryChange = (next: VaultCategory) => {
    setCategory(next)
    if (!initialItem) {
      const meta = getCategoryMeta(next)
      setFolder(meta.defaultFolder)
      if (next === 'VPS_SSH' && !port) {
        setPort('22')
      }
    }
  }

  const handleSshKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '')
      setSshPrivateKey(text)
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSaving(true)
    try {
      const ok = await onSave({
        id: initialItem?.id,
        title: title.trim(),
        category,
        folder: folder.trim() || 'Agency Core',
        provider: provider.trim() || undefined,
        loginUrl: loginUrl.trim() || undefined,
        username: username.trim() || undefined,
        host: host.trim() || undefined,
        port: port.trim() || undefined,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        isFavorite,
        secrets: {
          password,
          sshPrivateKey,
          sshPassphrase,
          apiKey,
          envBlock,
          totpSecret,
          recoveryEmail,
          recoveryPhone,
          backupCodes,
          notes,
        },
      })
      if (ok) {
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const strength = evaluatePasswordStrength(password)
  const sshPreview =
    category === 'VPS_SSH'
      ? buildSshCommand({
          username: username || 'root',
          host,
          port,
          hasSshKey: Boolean(sshPrivateKey.trim()),
        })
      : null

  const isVps = category === 'VPS_SSH'
  const isDevOrApi = category === 'DATABASE_API' || category === 'AGENCY_TOOL' || category === 'DOMAIN_HOSTING'
  const isSocialOrEmail = category === 'EMAIL' || category === 'SOCIAL_MEDIA' || category === 'FINANCE_BILLING'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            {initialItem ? `Edit Credential: ${initialItem.title}` : 'Add New Encrypted Credential'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            All passwords, SSH keys, API tokens, 2FA secrets, and recovery codes are encrypted with AES-256-GCM before saving.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          {/* Category Selector Pills */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Credential Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {VAULT_CATEGORIES.map((cat) => {
                const active = category === cat.value
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => handleCategoryChange(cat.value)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-primary bg-primary/10 text-foreground font-semibold'
                        : 'border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                    >
                      <VaultCategoryIcon category={cat.value} className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate text-[11px]">{cat.shortLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Core Identification */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  isVps
                    ? 'e.g. Production Hetzner VPS (Ubuntu)'
                    : category === 'EMAIL'
                    ? 'e.g. CEO Google Workspace Gmail'
                    : category === 'SOCIAL_MEDIA'
                    ? 'e.g. Artyx Official Instagram'
                    : 'e.g. Cloudflare Main Account'
                }
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Folder
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {VAULT_FOLDERS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  {!VAULT_FOLDERS.includes(folder as any) && folder && (
                    <option value={folder}>{folder}</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setIsFavorite((v) => !v)}
                  title="Pin to Favorites"
                  className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                    isFavorite
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                      : 'border-input bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Provider / Platform
              </label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder={
                  isVps
                    ? 'e.g. DigitalOcean, Hetzner, Contabo, AWS'
                    : category === 'SOCIAL_MEDIA'
                    ? 'e.g. Meta / Instagram / LinkedIn / X'
                    : 'e.g. Google, Namecheap, Stripe, GitHub'
                }
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {isVps ? 'Control Panel URL (Optional)' : 'Login URL'}
              </label>
              <input
                type="text"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* VPS / SSH Specific Fields */}
          {isVps && (
            <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Terminal className="w-4 h-4 text-emerald-500" />
                <span>VPS / Server SSH Connection</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Host / IP Address
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="e.g. 165.22.104.88 or vps.artyxdigital.com"
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    SSH Port
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="22"
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              {sshPreview && (
                <div className="px-3 py-2 rounded-lg bg-background border border-border font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                  $ {sshPreview}
                </div>
              )}
            </div>
          )}

          {/* Username & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {isVps
                  ? 'SSH Username (e.g. root / ubuntu)'
                  : category === 'EMAIL'
                  ? 'Email Address'
                  : category === 'SOCIAL_MEDIA'
                  ? 'Handle / Login Email / Phone'
                  : 'Username / Email'}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isVps ? 'root' : 'ceo@artyxdigital.com'}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isVps ? 'Root / SSH Password' : 'Password'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generateStrongPassword({ length: 20 }))
                    setShowPassword(true)
                  }}
                  className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Wand2 className="w-3 h-3" />
                  Generate Strong
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Encrypted password"
                  className="w-full bg-background border border-input rounded-lg pl-3 pr-9 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${strength.colorClass}`}
                      style={{ width: `${(strength.score / 4) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {strength.label}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* SSH Private Key & Passphrase for VPS */}
          {isVps && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    SSH Private Key (.pem / id_ed25519 / id_rsa)
                  </label>
                  <label className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer">
                    <Upload className="w-3 h-3" />
                    Load .pem file
                    <input
                      type="file"
                      accept=".pem,.key,.txt,.ppk"
                      onChange={handleSshKeyFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <textarea
                  rows={4}
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  className="w-full bg-background border border-input rounded-lg p-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  SSH Key Passphrase (Optional)
                </label>
                <input
                  type="password"
                  value={sshPassphrase}
                  onChange={(e) => setSshPassphrase(e.target.value)}
                  placeholder="Passphrase for private key if protected"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* API Key & .env Block for Dev / DB / Hosting */}
          {isDevOrApi && (
            <div className="space-y-3 p-3.5 rounded-xl bg-muted/30 border border-border">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  API Key / Access Token / Connection URI
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_live_... or postgresql://..."
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  .env Secrets / Multi-line Config Block (Optional)
                </label>
                <textarea
                  rows={3}
                  value={envBlock}
                  onChange={(e) => setEnvBlock(e.target.value)}
                  placeholder="API_SECRET=...&#10;WEBHOOK_SECRET=..."
                  className="w-full bg-background border border-input rounded-lg p-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* 2FA (TOTP) & Recovery Section */}
          <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                2FA Authenticator & Recovery
              </span>
              <span className="text-[10px] text-muted-foreground">
                Generates live 6-digit TOTP codes inside vault
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                2FA / TOTP Secret Key (Base32 or otpauth:// URI)
              </label>
              <input
                type="text"
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                placeholder="e.g. JBSWY3DPEHPK3PXP (paste setup key from Authenticator setup)"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {(isSocialOrEmail || recoveryEmail || recoveryPhone || backupCodes) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Recovery Email
                  </label>
                  <input
                    type="text"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="backup@gmail.com"
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Recovery / 2FA Phone
                  </label>
                  <input
                    type="text"
                    value={recoveryPhone}
                    onChange={(e) => setRecoveryPhone(e.target.value)}
                    placeholder="+8801..."
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                2FA Backup / Recovery Codes (Optional)
              </label>
              <textarea
                rows={2}
                value={backupCodes}
                onChange={(e) => setBackupCodes(e.target.value)}
                placeholder="Paste one-time emergency backup codes here..."
                className="w-full bg-background border border-input rounded-lg p-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Tags & Encrypted Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="production, main, meta-ads, critical"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Encrypted Notes / Security Q&amp;A
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Business Manager ID, PIN, special instructions..."
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Encrypting & Saving...' : initialItem ? 'Save Changes' : 'Encrypt & Save Credential'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
