'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Plus,
  Search,
  Lock,
  Unlock,
  Star,
  ShieldCheck,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
  Wand2,
  Download,
  Settings2,
  X,
  AlertTriangle,
  Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  VAULT_CATEGORIES,
  buildSshCommand,
  daysSince,
  getCategoryMeta,
  type VaultCategory,
  type VaultItemInput,
  type VaultItemRevealed,
  type VaultItemSummary,
} from '@/lib/vault/types'
import {
  deleteVaultItem,
  listVaultItems,
  lockVault,
  revealVaultItem,
  saveVaultItem,
  toggleVaultFavorite,
} from '@/lib/actions/vault'
import { VaultCategoryIcon } from './VaultCategoryIcon'
import { VaultLockGate } from './VaultLockGate'
import { VaultItemFormModal } from './VaultItemFormModal'
import { VaultItemDetailModal } from './VaultItemDetailModal'
import { VaultSecurityToolsModal, type SecurityToolTab } from './VaultSecurityToolsModal'
import { toast } from 'sonner'

interface CeoVaultClientProps {
  initialStatus: {
    hasPinSet: boolean
    isUnlocked: boolean
    expiresAt: number | null
    hasDedicatedKey: boolean
    itemCount: number
  }
  initialItems: VaultItemSummary[]
}

export function CeoVaultClient({ initialStatus, initialItems }: CeoVaultClientProps) {
  const [hasPinSet, setHasPinSet] = useState(initialStatus.hasPinSet)
  const [isUnlocked, setIsUnlocked] = useState(initialStatus.isUnlocked)
  const [expiresAt, setExpiresAt] = useState<number | null>(initialStatus.expiresAt)
  const [remainingMs, setRemainingMs] = useState<number>(
    initialStatus.expiresAt ? Math.max(0, initialStatus.expiresAt - Date.now()) : 0
  )

  const [items, setItems] = useState<VaultItemSummary[]>(initialItems)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Modals
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<VaultItemRevealed | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [revealedItem, setRevealedItem] = useState<VaultItemRevealed | null>(null)
  const [loadingRevealId, setLoadingRevealId] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<SecurityToolTab>('generator')

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const handleLock = useCallback(async (silent = false) => {
    setIsUnlocked(false)
    setExpiresAt(null)
    setRemainingMs(0)
    setDetailOpen(false)
    setRevealedItem(null)
    setFormOpen(false)
    setEditingItem(null)
    await lockVault()
    if (!silent) {
      toast.info('CEO Vault locked.')
    }
  }, [])

  // Auto-lock countdown timer
  useEffect(() => {
    if (!isUnlocked || !expiresAt) return

    const tick = () => {
      const diff = expiresAt - Date.now()
      if (diff <= 0) {
        handleLock(true)
        toast.info('CEO Vault auto-locked due to inactivity.')
      } else {
        setRemainingMs(diff)
      }
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [isUnlocked, expiresAt, handleLock])

  // Keyboard shortcuts: '/' to focus search, 'N' to add credential
  useEffect(() => {
    if (!isUnlocked) return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if ((e.key === 'n' || e.key === 'N') && !formOpen && !detailOpen && !toolsOpen) {
        e.preventDefault()
        setEditingItem(null)
        setFormOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isUnlocked, formOpen, detailOpen, toolsOpen])

  const reloadItems = useCallback(async () => {
    const res = await listVaultItems()
    if (res.success) {
      setItems(res.data)
    }
  }, [])

  const handleUnlocked = async (nextExpiresAt: number) => {
    setHasPinSet(true)
    setIsUnlocked(true)
    setExpiresAt(nextExpiresAt)
    setRemainingMs(Math.max(0, nextExpiresAt - Date.now()))
    await reloadItems()
  }

  const handleInspectItem = async (id: string) => {
    setLoadingRevealId(id)
    try {
      const res = await revealVaultItem(id)
      if (!res.success) {
        if (res.error === 'VAULT_LOCKED') {
          await handleLock(true)
          toast.error('Vault session expired. Please unlock again.')
        } else {
          toast.error(res.error)
        }
        return
      }
      setRevealedItem(res.data)
      setDetailOpen(true)
      setExpiresAt(Date.now() + 10 * 60 * 1000)
    } finally {
      setLoadingRevealId(null)
    }
  }

  const handleSaveItem = async (input: VaultItemInput): Promise<boolean> => {
    const res = await saveVaultItem(input)
    if (!res.success) {
      if (res.error === 'VAULT_LOCKED') {
        await handleLock(true)
        toast.error('Vault session expired. Please unlock again.')
      } else {
        toast.error(res.error)
      }
      return false
    }

    setExpiresAt(res.data.expiresAt)
    setItems((prev) => {
      const exists = prev.some((i) => i.id === res.data.item.id)
      if (exists) {
        return prev.map((i) => (i.id === res.data.item.id ? res.data.item : i))
      }
      return [res.data.item, ...prev]
    })
    toast.success(input.id ? 'Credential updated & re-encrypted.' : 'Credential encrypted & saved.')
    return true
  }

  const handleDeleteItem = async (id: string) => {
    const res = await deleteVaultItem(id)
    if (!res.success) {
      if (res.error === 'VAULT_LOCKED') {
        await handleLock(true)
      } else {
        toast.error(res.error)
      }
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
    setDetailOpen(false)
    setRevealedItem(null)
    toast.success('Credential deleted permanently.')
  }

  const handleToggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const res = await toggleVaultFavorite(id)
    if (res.success) {
      setItems((prev) => prev.map((i) => (i.id === id ? res.data : i)))
    }
  }

  const handleQuickCopy = async (e: React.MouseEvent, key: string, label: string, value: string) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(value)
    setCopiedId(key)
    toast.success(`${label} copied!`)
    setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800)
  }

  // Unique folders
  const folders = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => set.add(i.folder))
    return Array.from(set).sort()
  }, [items])

  // Filtered list
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory === 'FAVORITES' && !item.isFavorite) return false
      if (selectedCategory === 'ROTATION' && daysSince(item.lastRotatedAt) < 90) return false
      if (
        selectedCategory !== 'ALL' &&
        selectedCategory !== 'FAVORITES' &&
        selectedCategory !== 'ROTATION' &&
        item.category !== selectedCategory
      ) {
        return false
      }
      if (selectedFolder !== 'ALL' && item.folder !== selectedFolder) return false

      if (search.trim()) {
        const q = search.toLowerCase()
        const hit =
          item.title.toLowerCase().includes(q) ||
          item.provider?.toLowerCase().includes(q) ||
          item.username?.toLowerCase().includes(q) ||
          item.host?.toLowerCase().includes(q) ||
          item.loginUrl?.toLowerCase().includes(q) ||
          item.folder.toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        if (!hit) return false
      }
      return true
    })
  }, [items, selectedCategory, selectedFolder, search])

  // Stats
  const stats = useMemo(() => {
    return {
      total: items.length,
      favorites: items.filter((i) => i.isFavorite).length,
      vpsCount: items.filter((i) => i.category === 'VPS_SSH').length,
      totpCount: items.filter((i) => i.hasTotp).length,
      needsRotation: items.filter((i) => daysSince(i.lastRotatedAt) >= 90).length,
    }
  }, [items])

  const formatCountdown = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000))
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // Locked gate screen
  if (!isUnlocked) {
    return (
      <VaultLockGate
        hasPinSet={hasPinSet}
        itemCount={items.length || initialStatus.itemCount}
        hasDedicatedKey={initialStatus.hasDedicatedKey}
        onUnlocked={handleUnlocked}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Executive Vault Control Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl bg-card border border-border shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Unlock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">Vault Unlocked</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Auto-locks in {formatCountdown(remainingMs)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              AES-256-GCM encrypted in PostgreSQL · Secrets decrypt only when opened
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setToolsTab('generator')
              setToolsOpen(true)
            }}
            className="text-xs font-semibold gap-1.5"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Generator</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setToolsTab('backup')
              setToolsOpen(true)
            }}
            className="text-xs font-semibold gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Backup</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setToolsTab('audit')
              setToolsOpen(true)
            }}
            className="text-xs font-semibold gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Security</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleLock(false)}
            className="text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock Now</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingItem(null)
              setFormOpen(true)
            }}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Credential</span>
            <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-primary-foreground/20 rounded">
              N
            </kbd>
          </Button>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          onClick={() => setSelectedCategory('ALL')}
          className="p-3.5 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left cursor-pointer"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total Credentials
          </span>
          <p className="text-xl font-bold text-foreground tabular-nums mt-1">{stats.total}</p>
        </button>

        <button
          onClick={() => setSelectedCategory('FAVORITES')}
          className="p-3.5 rounded-xl bg-card border border-border hover:border-amber-500/40 transition-colors text-left cursor-pointer"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pinned Favorites
          </span>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
            {stats.favorites}
          </p>
        </button>

        <button
          onClick={() => setSelectedCategory('VPS_SSH')}
          className="p-3.5 rounded-xl bg-card border border-border hover:border-emerald-500/40 transition-colors text-left cursor-pointer"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            VPS &amp; SSH Servers
          </span>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
            {stats.vpsCount}
          </p>
        </button>

        <div className="p-3.5 rounded-xl bg-card border border-border text-left">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            2FA Live TOTP
          </span>
          <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
            {stats.totpCount}
          </p>
        </div>

        <button
          onClick={() => setSelectedCategory('ROTATION')}
          className="p-3.5 rounded-xl bg-card border border-border hover:border-rose-500/40 transition-colors text-left cursor-pointer col-span-2 sm:col-span-1"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rotation Due (90d+)
          </span>
          <p
            className={`text-xl font-bold tabular-nums mt-1 ${
              stats.needsRotation > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
            }`}
          >
            {stats.needsRotation}
          </p>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-card border border-border shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, email, IP address, provider, or #tag... (Press /)"
              className="w-full bg-background border border-input rounded-lg pl-10 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            className="w-full sm:w-48 bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All Folders</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setSelectedCategory('FAVORITES')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedCategory === 'FAVORITES'
                ? 'bg-amber-500 text-white'
                : 'bg-muted/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <Star className="w-3 h-3" />
            Favorites
          </button>
          {VAULT_CATEGORIES.map((cat) => {
            const count = items.filter((i) => i.category === cat.value).length
            const active = selectedCategory === cat.value
            return (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                <VaultCategoryIcon category={cat.value} className="w-3.5 h-3.5" />
                <span>{cat.shortLabel}</span>
                {count > 0 && <span className="opacity-75">({count})</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Credentials Grid */}
      {filteredItems.length === 0 ? (
        <div className="p-12 rounded-xl bg-card border border-border text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-muted mx-auto flex items-center justify-center text-muted-foreground">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              {items.length === 0 ? 'Your CEO Credential Vault is Empty' : 'No matching credentials found'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              {items.length === 0
                ? 'Store your emails, social media logins, VPS SSH keys, domain registrars, and 2FA codes safely in one encrypted vault accessible from any device.'
                : 'Try clearing your search or switching category/folder filters.'}
            </p>
          </div>
          {items.length === 0 && (
            <Button
              size="sm"
              onClick={() => {
                setEditingItem(null)
                setFormOpen(true)
              }}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add Your First Credential
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const meta = getCategoryMeta(item.category)
            const sshCmd = item.category === 'VPS_SSH' ? buildSshCommand(item) : null
            const ageDays = daysSince(item.lastRotatedAt)
            const isLoadingThis = loadingRevealId === item.id

            return (
              <div
                key={item.id}
                onClick={() => handleInspectItem(item.id)}
                className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-all shadow-xs flex flex-col justify-between gap-3 cursor-pointer group relative overflow-hidden"
              >
                <div
                  className="absolute top-0 inset-x-0 h-0.5"
                  style={{ backgroundColor: meta.color }}
                />

                {/* Top Header */}
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                      >
                        <VaultCategoryIcon category={item.category} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors truncate">
                          {item.title}
                        </h3>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.provider || meta.shortLabel} · {item.folder}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleToggleFavorite(e, item.id)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                        item.isFavorite
                          ? 'text-amber-500'
                          : 'text-muted-foreground/50 hover:text-amber-500'
                      }`}
                      title="Toggle favorite"
                    >
                      <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {/* Primary Identifier Preview */}
                  <div className="p-2.5 rounded-lg bg-muted/35 border border-border/60 space-y-1 text-xs">
                    {item.category === 'VPS_SSH' && item.host ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-foreground truncate">
                          {item.username || 'root'}@{item.host}
                          {item.port && item.port !== '22' ? `:${item.port}` : ''}
                        </span>
                        {sshCmd && (
                          <button
                            type="button"
                            onClick={(e) => handleQuickCopy(e, `ssh-${item.id}`, 'SSH Command', sshCmd)}
                            className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            {copiedId === `ssh-${item.id}` ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Terminal className="w-3 h-3" />
                            )}
                            SSH
                          </button>
                        )}
                      </div>
                    ) : item.username ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-foreground truncate">
                          {item.username}
                        </span>
                        <button
                          type="button"
                          onClick={(e) =>
                            handleQuickCopy(e, `user-${item.id}`, 'Username', item.username!)
                          }
                          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                          title="Copy username"
                        >
                          {copiedId === `user-${item.id}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground italic">
                        Click to reveal encrypted secrets
                      </span>
                    )}
                  </div>

                  {/* Badges & Tags */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.hasTotp && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        2FA Live
                      </span>
                    )}
                    {item.hasSshKey && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <KeyRound className="w-2.5 h-2.5" />
                        SSH Key
                      </span>
                    )}
                    {ageDays >= 90 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {ageDays}d old
                      </span>
                    )}
                    {item.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="flex items-center justify-between pt-2.5 border-t border-border/60 text-[11px]">
                  {item.loginUrl ? (
                    <a
                      href={
                        item.loginUrl.startsWith('http')
                          ? item.loginUrl
                          : `https://${item.loginUrl}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-primary flex items-center gap-1 font-medium"
                    >
                      Launch <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">AES-256 Encrypted</span>
                  )}

                  <span className="font-semibold text-primary flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />
                    {isLoadingThis ? 'Decrypting...' : 'Reveal Secrets'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <VaultItemFormModal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingItem(null)
        }}
        initialItem={editingItem}
        defaultCategory={
          selectedCategory !== 'ALL' &&
          selectedCategory !== 'FAVORITES' &&
          selectedCategory !== 'ROTATION'
            ? (selectedCategory as VaultCategory)
            : 'EMAIL'
        }
        onSave={handleSaveItem}
      />

      {/* Reveal / Inspect Modal */}
      <VaultItemDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        item={revealedItem}
        onEdit={(item) => {
          setDetailOpen(false)
          setEditingItem(item)
          setFormOpen(true)
        }}
        onDelete={handleDeleteItem}
        onVaultLocked={() => handleLock(true)}
      />

      {/* Security Tools Modal */}
      <VaultSecurityToolsModal
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        initialTab={toolsTab}
        onVaultChanged={reloadItems}
        onVaultLocked={() => handleLock(true)}
      />
    </div>
  )
}
