'use client'

import * as React from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { verifySecurityPin } from '@/lib/actions/security-pin'
import { addClientCredential, deleteClientCredential } from '@/lib/actions/agency-clients'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LayoutDashboard,
  Lock,
  Plus,
  Search,
  Server,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react'
import { CredentialCategory } from '@prisma/client'

type CredentialRecord = {
  id: string
  clientId: string
  title: string
  category: CredentialCategory
  loginUrl: string | null
  username: string | null
  password: string | null
  apiKey: string | null
  notes: string | null
  createdAt: Date
  client: {
    id: string
    companyName: string
    clientCode: string
    contactPerson: string
  }
}

type ClientOption = {
  id: string
  companyName: string
  clientCode: string
}

const CATEGORY_TABS: Array<{ label: string; value: string; icon: any }> = [
  { label: 'All Vault', value: 'ALL', icon: Shield },
  { label: '.env Configs', value: 'ENV_VARIABLES', icon: Code2 },
  { label: 'Domains', value: 'DOMAIN', icon: Globe },
  { label: 'Servers & Hosting', value: 'HOSTING', icon: Server },
  { label: 'CMS Admin', value: 'CMS_ADMIN', icon: LayoutDashboard },
  { label: 'Databases', value: 'DATABASE', icon: Database },
  { label: 'API Keys', value: 'API_KEY', icon: KeyRound },
  { label: 'Other', value: 'OTHER', icon: Share2 },
]

export function CredentialsVaultClient({
  initialCredentials,
  clients,
}: {
  initialCredentials: CredentialRecord[]
  clients: ClientOption[]
}) {
  const [credentials, setCredentials] = React.useState<CredentialRecord[]>(initialCredentials)
  const [search, setSearch] = React.useState('')
  const [selectedCategory, setSelectedCategory] = React.useState('ALL')

  // Security PIN states
  const [isUnlocked, setIsUnlocked] = React.useState(false)
  const [pinModalOpen, setPinModalOpen] = React.useState(false)
  const [pinInput, setPinInput] = React.useState('')
  const [pinError, setPinError] = React.useState('')
  const [verifying, setVerifying] = React.useState(false)
  const [targetCredentialIdToReveal, setTargetCredentialIdToReveal] = React.useState<string | null>(null)

  // Copy state tracker
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)

  // Add Credential modal
  const [addModalOpen, setAddModalOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [formData, setFormData] = React.useState({
    clientId: clients[0]?.id || '',
    title: '',
    category: 'ENV_VARIABLES' as CredentialCategory,
    loginUrl: '',
    username: '',
    password: '',
    apiKey: '',
    envSnippet: '',
    notes: '',
  })

  // Filtered list
  const filteredCredentials = React.useMemo(() => {
    return credentials.filter(cred => {
      const matchCat = selectedCategory === 'ALL' || cred.category === selectedCategory
      const query = search.toLowerCase()
      const matchSearch =
        !query ||
        cred.title.toLowerCase().includes(query) ||
        cred.client.companyName.toLowerCase().includes(query) ||
        cred.client.clientCode.toLowerCase().includes(query) ||
        (cred.username && cred.username.toLowerCase().includes(query)) ||
        (cred.notes && cred.notes.toLowerCase().includes(query))
      return matchCat && matchSearch
    })
  }, [credentials, selectedCategory, search])

  // Handle PIN verification
  async function handleVerifyPin(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!pinInput.trim()) {
      setPinError('Please enter your PIN')
      return
    }

    try {
      setVerifying(true)
      setPinError('')
      const res = await verifySecurityPin(pinInput)
      if (res.success) {
        setIsUnlocked(true)
        setPinModalOpen(false)
        setPinInput('')
        toast.success('Security PIN verified. Vault unlocked for this session!')
      } else {
        setPinError(res.error || 'Incorrect PIN')
      }
    } catch {
      setPinError('Error verifying PIN')
    } finally {
      setVerifying(false)
    }
  }

  function handleLockVault() {
    setIsUnlocked(false)
    toast.info('Credentials Vault has been secured and locked.')
  }

  function copyToClipboard(text: string, key: string, label = 'Secret copied') {
    if (!text) return
    if (!isUnlocked) {
      setPinModalOpen(true)
      return
    }
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success(label)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  async function handleDeleteCredential(id: string, clientId: string, title: string) {
    if (!confirm(`Are you sure you want to delete credential "${title}"?`)) return
    try {
      const res = await deleteClientCredential(id, clientId)
      if (res.success) {
        setCredentials(prev => prev.filter(c => c.id !== id))
        toast.success(`Credential "${title}" removed`)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete credential')
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.title.trim() || !formData.clientId) {
      toast.error('Client and title are required')
      return
    }

    try {
      setIsSubmitting(true)

      // If category is ENV_VARIABLES, merge envSnippet into apiKey/notes
      const submissionData = {
        title: formData.title,
        category: formData.category,
        loginUrl: formData.loginUrl || undefined,
        username: formData.username || undefined,
        password: formData.password || undefined,
        apiKey: formData.category === 'ENV_VARIABLES' ? formData.envSnippet : formData.apiKey || undefined,
        notes: formData.notes || undefined,
      }

      const res = await addClientCredential(formData.clientId, submissionData)
      if (res.success && res.credential) {
        const selectedClientObj = clients.find(c => c.id === formData.clientId)!
        const newRecord: CredentialRecord = {
          ...res.credential,
          client: {
            id: selectedClientObj.id,
            companyName: selectedClientObj.companyName,
            clientCode: selectedClientObj.clientCode,
            contactPerson: '',
          },
        }
        setCredentials([newRecord, ...credentials])
        setAddModalOpen(false)
        setFormData({
          clientId: clients[0]?.id || '',
          title: '',
          category: 'ENV_VARIABLES',
          loginUrl: '',
          username: '',
          password: '',
          apiKey: '',
          envSnippet: '',
          notes: '',
        })
        toast.success(`Credential "${formData.title}" added to secure vault!`)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create credential')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Parse .env string into key-value pairs
  function parseEnv(raw: string | null): Array<{ key: string; value: string }> {
    if (!raw) return []
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const idx = line.indexOf('=')
        if (idx === -1) return { key: line, value: '' }
        return {
          key: line.slice(0, idx).trim(),
          value: line.slice(idx + 1).trim().replace(/^["']|["']$/g, ''),
        }
      })
  }

  return (
    <div className="space-y-6 w-full">
      {/* 1. VAULT HEADER & SECURITY CONTROLS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/clients">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${isUnlocked ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-2">
                Agency Credentials Vault
                {isUnlocked ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs font-mono font-bold">
                    <ShieldCheck className="size-3 mr-1" />
                    Unlocked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-mono font-bold bg-amber-500/10">
                    <Lock className="size-3 mr-1" />
                    PIN Protected
                  </Badge>
                )}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Encrypted access tokens, cPanels, domains, CMS passwords, and client .env configurations
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          {isUnlocked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLockVault}
              className="border-border hover:bg-muted text-foreground text-xs font-semibold gap-1.5 h-9 px-3 rounded-xl shadow-2xs"
            >
              <Lock className="size-3.5 text-amber-500" />
              Lock Vault
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPinError('')
                setPinInput('')
                setPinModalOpen(true)
              }}
              className="border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold gap-1.5 h-9 px-3 rounded-xl shadow-2xs"
            >
              <Unlock className="size-3.5" />
              Unlock with PIN
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setAddModalOpen(true)}
            className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
          >
            <Plus className="size-3.5 stroke-[2.5]" />
            Add Credential
          </Button>
        </div>
      </div>

      {/* 2. SEARCH & MINIMAL CATEGORY FILTER TABS */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {CATEGORY_TABS.map(tab => {
            const Icon = tab.icon
            const isActive = selectedCategory === tab.value
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSelectedCategory(tab.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black shadow-xs font-bold'
                    : 'bg-card text-muted-foreground hover:text-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                <Icon className="size-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Search input */}
        <div className="relative min-w-64">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search credentials, clients, or tokens..."
            className="pl-8.5 h-9 text-xs bg-card border-border text-foreground rounded-xl"
          />
        </div>
      </div>

      {/* 3. CREDENTIALS GRID */}
      {filteredCredentials.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-16 rounded-2xl shadow-xs">
          <CardContent className="space-y-3">
            <Shield className="size-12 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-base font-bold text-foreground">No matching credentials found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Store client environment variables, server logins, or domain credentials securely.
            </p>
            <Button
              size="sm"
              onClick={() => setAddModalOpen(true)}
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:text-black font-semibold text-xs mt-2"
            >
              <Plus className="size-3.5 mr-1" />
              Add First Credential
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {filteredCredentials.map(cred => {
            const isEnv = cred.category === 'ENV_VARIABLES'
            const envPairs = isEnv ? parseEnv(cred.apiKey || cred.notes) : []

            return (
              <Card
                key={cred.id}
                className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs flex flex-col justify-between overflow-hidden group hover:border-primary/40 transition-all"
              >
                <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-muted text-[#3E7000] dark:text-[#7FFF00] border border-border">
                          {cred.client.clientCode}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground truncate max-w-[140px]">
                          {cred.client.companyName}
                        </span>
                      </div>
                      <h3 className="text-sm font-extrabold text-foreground tracking-tight flex items-center gap-1.5">
                        {isEnv && <Code2 className="size-4 text-[#3E7000] dark:text-[#7FFF00]" />}
                        {cred.category === 'DOMAIN' && <Globe className="size-4 text-blue-500" />}
                        {cred.category === 'HOSTING' && <Server className="size-4 text-purple-500" />}
                        {cred.category === 'CMS_ADMIN' && <LayoutDashboard className="size-4 text-emerald-500" />}
                        {cred.category === 'DATABASE' && <Database className="size-4 text-amber-500" />}
                        {cred.category === 'API_KEY' && <KeyRound className="size-4 text-rose-500" />}
                        <span>{cred.title}</span>
                      </h3>
                    </div>

                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] uppercase font-mono font-bold border-border text-muted-foreground">
                        {cred.category.replace('_', ' ')}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleDeleteCredential(cred.id, cred.clientId, cred.title)}
                        className="p-1 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                        title="Delete Credential"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-3.5 pb-4 space-y-3 flex-1 text-xs">
                  {/* Login URL if available */}
                  {cred.loginUrl && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono font-semibold">Portal URL</span>
                      <a
                        href={cred.loginUrl.startsWith('http') ? cred.loginUrl : `https://${cred.loginUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border text-[#3E7000] dark:text-[#7FFF00] hover:underline font-mono text-xs truncate"
                      >
                        <span className="truncate">{cred.loginUrl}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </div>
                  )}

                  {/* Username / Email */}
                  {cred.username && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono font-semibold">Username / Email</span>
                      <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground font-mono text-xs">
                        <span className="truncate select-all">{cred.username}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cred.username!, `user-${cred.id}`, 'Username copied')}
                          className="text-muted-foreground hover:text-foreground"
                          title="Copy Username"
                        >
                          {copiedKey === `user-${cred.id}` ? (
                            <Check className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Password / Access Key with PIN Guard */}
                  {cred.password && (
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono font-semibold">Password</span>
                        {!isUnlocked && (
                          <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1 font-bold">
                            <Lock className="size-2.5" />
                            PIN Protected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground font-mono text-xs">
                        {isUnlocked ? (
                          <span className="truncate select-all font-semibold text-amber-600 dark:text-amber-400">
                            {cred.password}
                          </span>
                        ) : (
                          <span className="tracking-widest text-muted-foreground select-none">••••••••••••••</span>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (!isUnlocked) {
                                setPinError('')
                                setPinModalOpen(true)
                              }
                            }}
                            className="text-muted-foreground hover:text-foreground p-0.5"
                            title={isUnlocked ? 'Visible' : 'Unlock with PIN'}
                          >
                            {isUnlocked ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-amber-500" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(cred.password!, `pass-${cred.id}`, 'Password copied')}
                            className="text-muted-foreground hover:text-foreground p-0.5"
                            title="Copy Password"
                          >
                            {copiedKey === `pass-${cred.id}` ? (
                              <Check className="size-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Standard API Key (Non-Env) */}
                  {!isEnv && cred.apiKey && (
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono font-semibold">API Key / Token</span>
                        {!isUnlocked && <Lock className="size-2.5 text-amber-500" />}
                      </div>
                      <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground font-mono text-xs">
                        {isUnlocked ? (
                          <span className="truncate select-all text-sky-600 dark:text-sky-400 text-[11px]">
                            {cred.apiKey}
                          </span>
                        ) : (
                          <span className="tracking-widest text-muted-foreground select-none">••••••••••••••••••••</span>
                        )}
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cred.apiKey!, `api-${cred.id}`, 'API Key copied')}
                          className="text-muted-foreground hover:text-foreground"
                          title="Copy API Key"
                        >
                          {copiedKey === `api-${cred.id}` ? (
                            <Check className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Dedicated ENV Credential UI */}
                  {isEnv && (
                    <div className="space-y-2 pt-1 border-t border-border/70">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#3E7000] dark:text-[#7FFF00] font-mono font-bold uppercase flex items-center gap-1">
                          <Code2 className="size-3" />
                          Client .env Configuration ({envPairs.length} vars)
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(cred.apiKey || cred.notes || '', `all-env-${cred.id}`, 'Full .env configuration copied!')}
                          className="h-6 px-2 text-[10px] font-mono font-bold border-border hover:bg-muted"
                        >
                          {copiedKey === `all-env-${cred.id}` ? (
                            <>
                              <Check className="size-2.5 mr-1 text-emerald-500" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="size-2.5 mr-1" />
                              Copy .env
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Key-Value Table Snippet */}
                      <div className="rounded-xl border border-border/80 bg-muted/40 overflow-hidden divide-y divide-border/60 font-mono text-[11px]">
                        {envPairs.slice(0, 4).map((pair, idx) => (
                          <div key={idx} className="flex items-center justify-between px-2.5 py-1.5 gap-2">
                            <span className="font-semibold text-foreground truncate max-w-[140px]" title={pair.key}>
                              {pair.key}
                            </span>
                            <div className="flex items-center gap-1.5 truncate">
                              {isUnlocked ? (
                                <span className="text-muted-foreground truncate select-all max-w-[120px]" title={pair.value}>
                                  {pair.value || '""'}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60 select-none">••••••••</span>
                              )}
                              <button
                                type="button"
                                onClick={() => copyToClipboard(pair.value, `pair-${cred.id}-${idx}`, `${pair.key} copied`)}
                                className="text-muted-foreground hover:text-foreground shrink-0"
                                title={`Copy ${pair.key}`}
                              >
                                {copiedKey === `pair-${cred.id}-${idx}` ? (
                                  <Check className="size-3 text-emerald-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                        {envPairs.length > 4 && (
                          <div className="px-2.5 py-1 text-[10px] text-muted-foreground text-center bg-muted/20">
                            +{envPairs.length - 4} more environment variables
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Notes / IP info */}
                  {cred.notes && !isEnv && (
                    <div className="space-y-0.5 pt-1 border-t border-border/60">
                      <span className="text-[10px] text-muted-foreground font-mono uppercase">Notes & Server Host</span>
                      <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-2">
                        {cred.notes}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 4. PIN VERIFICATION MODAL */}
      <Dialog open={pinModalOpen} onOpenChange={setPinModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-card-foreground shadow-2xl p-6 rounded-2xl">
          <DialogHeader className="text-center space-y-2">
            <div className="mx-auto size-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-xs">
              <Lock className="size-6" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
              Security PIN Required
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter your Security PIN to decrypt, reveal, and copy sensitive client credentials and environment secrets.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVerifyPin} className="space-y-4 pt-2">
            <div className="space-y-1.5 text-center">
              <Input
                type="password"
                maxLength={8}
                autoFocus
                placeholder="••••"
                value={pinInput}
                onChange={e => {
                  setPinInput(e.target.value)
                  setPinError('')
                }}
                className="text-center text-2xl font-mono tracking-widest h-12 bg-muted/40 border-border text-foreground rounded-xl"
              />
              {pinError && (
                <p className="text-xs font-semibold text-rose-500 mt-1 flex items-center justify-center gap-1">
                  <ShieldAlert className="size-3.5" />
                  {pinError}
                </p>
              )}
            </div>

            {/* Quick numeric buttons */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫'].map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k === 'Clear') setPinInput('')
                    else if (k === '⌫') setPinInput(p => p.slice(0, -1))
                    else if (pinInput.length < 8) setPinInput(p => p + k)
                    setPinError('')
                  }}
                  className="h-10 rounded-xl border border-border bg-card hover:bg-muted/60 text-foreground font-mono font-bold text-sm active:scale-95 transition-all shadow-2xs"
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="p-2.5 rounded-xl bg-muted/40 border border-border text-[11px] text-muted-foreground text-center">
              Default master PIN is <span className="font-mono font-bold text-foreground">1234</span>. You can change your personal PIN in your Profile settings.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPinModalOpen(false)}
                className="border-border text-foreground hover:bg-muted text-xs rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={verifying}
                className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black font-bold text-xs rounded-xl shadow-xs"
              >
                {verifying ? 'Verifying...' : 'Unlock Vault'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. ADD CREDENTIAL / ENV MODAL */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-xl bg-card border-border text-card-foreground shadow-2xl p-6 rounded-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Shield className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
              Store Client Credential & Secrets
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Encrypted credentials stored with strict PIN protection and audit logging.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddSubmit} className="space-y-4 pt-2 text-xs">
            {/* Client selection */}
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground font-medium">Agency Client <span className="text-rose-500">*</span></Label>
              <select
                value={formData.clientId}
                onChange={e => setFormData({ ...formData, clientId: e.target.value })}
                className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground"
                required
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.companyName} ({c.clientCode})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground font-medium">Title <span className="text-rose-500">*</span></Label>
                <Input
                  required
                  placeholder="e.g. Production .env / cPanel Hostinger"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="bg-background border-border text-foreground rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground font-medium">Category</Label>
                <select
                  value={formData.category}
                  onChange={(e: any) => setFormData({ ...formData, category: e.target.value })}
                  className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground"
                >
                  <option value="ENV_VARIABLES">Environment Variables (.env)</option>
                  <option value="DOMAIN">Domain Registrar</option>
                  <option value="HOSTING">Hosting / Server / cPanel</option>
                  <option value="CMS_ADMIN">CMS Admin (WordPress/Shopify)</option>
                  <option value="DATABASE">Database Access</option>
                  <option value="API_KEY">API Key / Token</option>
                  <option value="OTHER">Other Credentials</option>
                </select>
              </div>
            </div>

            {/* If Category is ENV_VARIABLES: show dedicated .env text editor */}
            {formData.category === 'ENV_VARIABLES' ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs text-foreground font-medium flex items-center gap-1.5">
                    <Code2 className="size-3.5 text-[#3E7000] dark:text-[#7FFF00]" />
                    Raw .env Configuration Snippet
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">KEY=value format</span>
                </div>
                <Textarea
                  placeholder={`# Paste client .env file here:\nDATABASE_URL=postgresql://...\nNEXTAUTH_SECRET=...\nSTRIPE_API_KEY=sk_live_...`}
                  value={formData.envSnippet}
                  onChange={e => setFormData({ ...formData, envSnippet: e.target.value })}
                  className="min-h-[140px] font-mono text-xs bg-muted/40 border-border text-foreground rounded-xl"
                />
                <p className="text-[11px] text-muted-foreground">
                  Variables are parsed automatically into the key-value table and protected by PIN.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground font-medium">Portal / Login URL</Label>
                  <Input
                    placeholder="https://cpanel.client.com or https://client.com/wp-admin"
                    value={formData.loginUrl}
                    onChange={e => setFormData({ ...formData, loginUrl: e.target.value })}
                    className="bg-background border-border text-foreground rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground font-medium">Username / Email</Label>
                    <Input
                      placeholder="admin@client.com"
                      value={formData.username}
                      onChange={e => setFormData({ ...formData, username: e.target.value })}
                      className="bg-background border-border text-foreground font-mono rounded-xl"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground font-medium">Password / Access Key</Label>
                    <Input
                      type="text"
                      placeholder="Secure password or secret"
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      className="bg-background border-border text-foreground font-mono rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground font-medium">API Token (Optional)</Label>
                  <Input
                    placeholder="sk_live_..."
                    value={formData.apiKey}
                    onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                    className="bg-background border-border text-foreground font-mono text-xs rounded-xl"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-foreground font-medium">Notes & Server Host (Optional)</Label>
              <Textarea
                placeholder="Server IP, port, nameservers, 2FA backup codes, or instructions..."
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="bg-background border-border text-foreground min-h-[60px] rounded-xl"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddModalOpen(false)}
                className="border-border text-foreground hover:bg-muted text-xs rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black font-bold text-xs rounded-xl shadow-xs"
              >
                {isSubmitting ? 'Saving...' : 'Save Credential'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

