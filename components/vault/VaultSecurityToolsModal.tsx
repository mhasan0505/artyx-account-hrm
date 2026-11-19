'use client'

import React, { useState, useEffect } from 'react'
import {
  Wand2,
  Download,
  Upload,
  KeyRound,
  History,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  evaluatePasswordStrength,
  generateStrongPassword,
  type VaultAuditEntry,
} from '@/lib/vault/types'
import {
  changeVaultPin,
  exportEncryptedVaultBackup,
  getVaultAuditLogs,
  importEncryptedVaultBackup,
} from '@/lib/actions/vault'
import { toast } from 'sonner'

export type SecurityToolTab = 'generator' | 'backup' | 'pin' | 'audit'

interface VaultSecurityToolsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SecurityToolTab
  onVaultChanged: () => void
  onVaultLocked: () => void
}

export function VaultSecurityToolsModal({
  open,
  onOpenChange,
  initialTab = 'generator',
  onVaultChanged,
  onVaultLocked,
}: VaultSecurityToolsModalProps) {
  const [tab, setTab] = useState<SecurityToolTab>(initialTab)

  // Password Generator state
  const [pwLength, setPwLength] = useState(20)
  const [useUpper, setUseUpper] = useState(true)
  const [useLower, setUseLower] = useState(true)
  const [useNums, setUseNums] = useState(true)
  const [useSyms, setUseSyms] = useState(true)
  const [generatedPw, setGeneratedPw] = useState('')
  const [copiedPw, setCopiedPw] = useState(false)

  // Encrypted Backup state
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importRawJson, setImportRawJson] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)

  // Change PIN state
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [changingPin, setChangingPin] = useState(false)

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<VaultAuditEntry[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setGeneratedPw(
        generateStrongPassword({
          length: pwLength,
          uppercase: useUpper,
          lowercase: useLower,
          numbers: useNums,
          symbols: useSyms,
        })
      )
    }
  }, [open, initialTab])

  useEffect(() => {
    if (open && tab === 'audit') {
      setLoadingAudit(true)
      getVaultAuditLogs(30)
        .then((res) => {
          if (res.success) setAuditLogs(res.data)
        })
        .finally(() => setLoadingAudit(false))
    }
  }, [open, tab])

  const regeneratePassword = (
    len = pwLength,
    up = useUpper,
    lo = useLower,
    nu = useNums,
    sy = useSyms
  ) => {
    setGeneratedPw(
      generateStrongPassword({
        length: len,
        uppercase: up,
        lowercase: lo,
        numbers: nu,
        symbols: sy,
      })
    )
  }

  const handleCopyGenerated = async () => {
    await navigator.clipboard.writeText(generatedPw)
    setCopiedPw(true)
    toast.success('Generated password copied!')
    setTimeout(() => setCopiedPw(false), 2000)
  }

  const handleExportBackup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (exportPassphrase.trim().length < 8) {
      toast.error('Backup passphrase must be at least 8 characters.')
      return
    }
    setExporting(true)
    try {
      const res = await exportEncryptedVaultBackup(exportPassphrase)
      if (!res.success) {
        if (res.error === 'VAULT_LOCKED') onVaultLocked()
        else toast.error(res.error)
        return
      }
      const blob = new Blob([res.data.content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = res.data.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(`Exported ${res.data.count} encrypted credentials!`)
      setExportPassphrase('')
    } finally {
      setExporting(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportRawJson(String(ev.target?.result || ''))
    }
    reader.readAsText(file)
  }

  const handleImportBackup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importRawJson) {
      toast.error('Please select an encrypted backup file (.enc.json).')
      return
    }
    if (!importPassphrase.trim()) {
      toast.error('Please enter the backup decryption passphrase.')
      return
    }
    setImporting(true)
    try {
      const res = await importEncryptedVaultBackup(importRawJson, importPassphrase)
      if (!res.success) {
        if (res.error === 'VAULT_LOCKED') onVaultLocked()
        else toast.error(res.error)
        return
      }
      toast.success(`Restored ${res.data.importedCount} credentials into your CEO Vault!`)
      setImportRawJson('')
      setImportFileName('')
      setImportPassphrase('')
      onVaultChanged()
    } finally {
      setImporting(false)
    }
  }

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPin.trim().length < 6) {
      toast.error('New Vault PIN must be at least 6 characters.')
      return
    }
    if (newPin !== confirmNewPin) {
      toast.error('New PINs do not match.')
      return
    }
    setChangingPin(true)
    try {
      const res = await changeVaultPin(currentPin, newPin)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('Vault PIN updated successfully!')
      setCurrentPin('')
      setNewPin('')
      setConfirmNewPin('')
    } finally {
      setChangingPin(false)
    }
  }

  const strength = evaluatePasswordStrength(generatedPw)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Vault Security &amp; Tools
          </DialogTitle>
        </DialogHeader>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border">
          {(
            [
              { id: 'generator', label: 'Generator', icon: Wand2 },
              { id: 'backup', label: 'Backup', icon: Download },
              { id: 'pin', label: 'Vault PIN', icon: KeyRound },
              { id: 'audit', label: 'Audit Log', icon: History },
            ] as const
          ).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  tab === t.id
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* 1. Password Generator */}
        {tab === 'generator' && (
          <div className="space-y-4 pt-2 text-xs">
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-sm sm:text-base font-bold text-foreground break-all">
                  {generatedPw}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => regeneratePassword()}
                    title="Regenerate"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button size="sm" onClick={handleCopyGenerated} className="h-8 text-xs gap-1">
                    {copiedPw ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${strength.colorClass}`}
                    style={{ width: `${(strength.score / 4) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {strength.label}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-muted-foreground">Length</span>
                <span className="font-mono font-bold text-foreground">{pwLength} chars</span>
              </div>
              <input
                type="range"
                min={10}
                max={48}
                value={pwLength}
                onChange={(e) => {
                  const len = Number(e.target.value)
                  setPwLength(len)
                  regeneratePassword(len)
                }}
                className="w-full accent-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Uppercase (A-Z)', checked: useUpper, set: setUseUpper, key: 'up' },
                { label: 'Lowercase (a-z)', checked: useLower, set: setUseLower, key: 'lo' },
                { label: 'Numbers (0-9)', checked: useNums, set: setUseNums, key: 'nu' },
                { label: 'Symbols (!@#$)', checked: useSyms, set: setUseSyms, key: 'sy' },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={opt.checked}
                    onChange={(e) => {
                      const next = e.target.checked
                      opt.set(next)
                      regeneratePassword(
                        pwLength,
                        opt.key === 'up' ? next : useUpper,
                        opt.key === 'lo' ? next : useLower,
                        opt.key === 'nu' ? next : useNums,
                        opt.key === 'sy' ? next : useSyms
                      )
                    }}
                    className="rounded border-input accent-primary"
                  />
                  <span className="font-medium text-foreground">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 2. Encrypted Backup & Restore */}
        {tab === 'backup' && (
          <div className="space-y-5 pt-2 text-xs">
            <form
              onSubmit={handleExportBackup}
              className="p-4 rounded-xl bg-muted/30 border border-border space-y-3"
            >
              <div>
                <h4 className="font-bold text-foreground flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  Export Encrypted Recovery Kit (.enc.json)
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Downloads a portable AES-256-GCM encrypted backup file locked by a passphrase you choose.
                </p>
              </div>
              <input
                type="password"
                required
                minLength={8}
                value={exportPassphrase}
                onChange={(e) => setExportPassphrase(e.target.value)}
                placeholder="Choose backup passphrase (min 8 chars)"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground"
              />
              <Button type="submit" size="sm" disabled={exporting} className="w-full gap-1.5">
                <Download className="w-3.5 h-3.5" />
                {exporting ? 'Encrypting Export...' : 'Download Encrypted Backup'}
              </Button>
            </form>

            <form
              onSubmit={handleImportBackup}
              className="p-4 rounded-xl bg-muted/30 border border-border space-y-3"
            >
              <div>
                <h4 className="font-bold text-foreground flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-sky-500" />
                  Restore From Encrypted Backup
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Import credentials from a previously exported `.enc.json` vault backup.
                </p>
              </div>
              <label className="flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed border-input bg-background hover:bg-muted/40 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">
                  {importFileName || 'Select .enc.json backup file'}
                </span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
              <input
                type="password"
                required
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
                placeholder="Enter backup decryption passphrase"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={importing}
                className="w-full gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                {importing ? 'Decrypting & Importing...' : 'Restore Credentials'}
              </Button>
            </form>
          </div>
        )}

        {/* 3. Change Vault PIN */}
        {tab === 'pin' && (
          <form onSubmit={handleChangePin} className="space-y-3.5 pt-2 text-xs">
            <p className="text-muted-foreground">
              Update your personal Vault unlock PIN or passphrase. All encrypted credentials remain untouched.
            </p>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Current Vault PIN
              </label>
              <input
                type="password"
                required
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                New Vault PIN / Passphrase (6+ chars)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Confirm New PIN
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmNewPin}
                onChange={(e) => setConfirmNewPin(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>
            <Button type="submit" size="sm" disabled={changingPin} className="w-full">
              {changingPin ? 'Updating PIN...' : 'Update Vault PIN'}
            </Button>
          </form>
        )}

        {/* 4. Vault Audit Logs */}
        {tab === 'audit' && (
          <div className="space-y-2 pt-2 text-xs">
            {loadingAudit ? (
              <div className="py-8 text-center text-muted-foreground">Loading audit trail...</div>
            ) : auditLogs.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No vault events recorded yet.</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-80 overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-foreground">
                        {log.action.replace('VAULT_', '')}
                      </span>
                      {typeof log.metadata?.title === 'string' && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {log.metadata.title}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
