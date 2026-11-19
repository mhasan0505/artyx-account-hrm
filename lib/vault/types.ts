export type VaultCategory =
  | 'EMAIL'
  | 'SOCIAL_MEDIA'
  | 'VPS_SSH'
  | 'DOMAIN_HOSTING'
  | 'AGENCY_TOOL'
  | 'DATABASE_API'
  | 'FINANCE_BILLING'
  | 'OTHER'

export const VAULT_FOLDERS = [
  'CEO Personal',
  'Agency Core',
  'Servers & VPS',
  'Social & Marketing',
  'Finance & Billing',
  'Domains & DNS',
  'Dev & APIs',
] as const

export interface VaultSecretPayload {
  password?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  apiKey?: string
  envBlock?: string
  totpSecret?: string
  recoveryEmail?: string
  recoveryPhone?: string
  backupCodes?: string
  notes?: string
}

/**
 * Non-secret metadata safe to display before revealing secrets.
 */
export interface VaultItemSummary {
  id: string
  title: string
  category: VaultCategory
  folder: string
  provider: string | null
  loginUrl: string | null
  username: string | null
  host: string | null
  port: string | null
  tags: string[]
  isFavorite: boolean
  hasTotp: boolean
  hasSshKey: boolean
  lastRotatedAt: string
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VaultItemRevealed extends VaultItemSummary {
  secrets: VaultSecretPayload
  currentTotp?: {
    code: string
    remainingSeconds: number
    period: number
  } | null
}

export interface VaultItemInput {
  id?: string
  title: string
  category: VaultCategory
  folder: string
  provider?: string
  loginUrl?: string
  username?: string
  host?: string
  port?: string
  tags?: string[]
  isFavorite?: boolean
  secrets: VaultSecretPayload
}

export interface VaultAuditEntry {
  id: string
  action: string
  entityId: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface VaultCategoryMeta {
  value: VaultCategory
  label: string
  shortLabel: string
  description: string
  defaultFolder: string
  color: string
}

export const VAULT_CATEGORIES: VaultCategoryMeta[] = [
  {
    value: 'EMAIL',
    label: 'Email & Workspace',
    shortLabel: 'Email',
    description: 'Gmail, Google Workspace, Zoho, IMAP/SMTP & recovery info',
    defaultFolder: 'CEO Personal',
    color: '#0EA5E9',
  },
  {
    value: 'SOCIAL_MEDIA',
    label: 'Social Media',
    shortLabel: 'Social',
    description: 'Facebook, Instagram, LinkedIn, X, YouTube, Meta Business',
    defaultFolder: 'Social & Marketing',
    color: '#EC4899',
  },
  {
    value: 'VPS_SSH',
    label: 'VPS & Server SSH',
    shortLabel: 'VPS / SSH',
    description: 'VPS IP, SSH port, root password, .pem keys & SSH command',
    defaultFolder: 'Servers & VPS',
    color: '#10B981',
  },
  {
    value: 'DOMAIN_HOSTING',
    label: 'Domains & Hosting',
    shortLabel: 'Domains',
    description: 'Cloudflare, Namecheap, GoDaddy, cPanel, Vercel & DNS',
    defaultFolder: 'Domains & DNS',
    color: '#F59E0B',
  },
  {
    value: 'AGENCY_TOOL',
    label: 'Agency & SaaS Tools',
    shortLabel: 'Agency Tools',
    description: 'GitHub, Figma, Slack, Notion, OpenAI, Adobe & SaaS logins',
    defaultFolder: 'Agency Core',
    color: '#6366F1',
  },
  {
    value: 'DATABASE_API',
    label: 'Databases, APIs & .env',
    shortLabel: 'DB & APIs',
    description: 'Postgres URLs, API tokens, webhooks & .env secrets',
    defaultFolder: 'Dev & APIs',
    color: '#8B5CF6',
  },
  {
    value: 'FINANCE_BILLING',
    label: 'Finance & Gateways',
    shortLabel: 'Finance',
    description: 'Stripe, PayPal, Wise, Payoneer, bank & tax portals',
    defaultFolder: 'Finance & Billing',
    color: '#14B8A6',
  },
  {
    value: 'OTHER',
    label: 'Other Secrets',
    shortLabel: 'Other',
    description: 'Software licenses, recovery notes & miscellaneous logins',
    defaultFolder: 'CEO Personal',
    color: '#64748B',
  },
]

export function getCategoryMeta(category: VaultCategory): VaultCategoryMeta {
  return VAULT_CATEGORIES.find((c) => c.value === category) || VAULT_CATEGORIES[VAULT_CATEGORIES.length - 1]
}

export function buildSshCommand(item: {
  username?: string | null
  host?: string | null
  port?: string | null
  hasSshKey?: boolean
}): string | null {
  const host = item.host?.trim()
  if (!host) return null
  const user = item.username?.trim() || 'root'
  const port = item.port?.trim()
  const portFlag = port && port !== '22' ? ` -p ${port}` : ''
  const keyFlag = item.hasSshKey ? ' -i ~/.ssh/id_rsa' : ''
  return `ssh${keyFlag}${portFlag} ${user}@${host}`
}

export function generateStrongPassword(options?: {
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  numbers?: boolean
  symbols?: boolean
}): string {
  const length = options?.length ?? 20
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const nums = '23456789'
  const syms = '!@#$%^&*-_=+?'

  let pool = ''
  const guaranteed: string[] = []

  const getRandIndex = (max: number) => {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      const arr = new Uint32Array(1)
      window.crypto.getRandomValues(arr)
      return arr[0] % max
    }
    return Math.floor(Math.random() * max)
  }

  if (options?.uppercase !== false) {
    pool += upper
    guaranteed.push(upper[getRandIndex(upper.length)])
  }
  if (options?.lowercase !== false) {
    pool += lower
    guaranteed.push(lower[getRandIndex(lower.length)])
  }
  if (options?.numbers !== false) {
    pool += nums
    guaranteed.push(nums[getRandIndex(nums.length)])
  }
  if (options?.symbols !== false) {
    pool += syms
    guaranteed.push(syms[getRandIndex(syms.length)])
  }

  if (!pool) pool = upper + lower + nums

  const result = [...guaranteed]
  while (result.length < length) {
    result.push(pool[getRandIndex(pool.length)])
  }

  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = getRandIndex(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }

  return result.join('')
}

export function evaluatePasswordStrength(password: string): {
  score: number // 0-4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Fortress'
  colorClass: string
} {
  if (!password) return { score: 0, label: 'Weak', colorClass: 'bg-rose-500' }
  let points = 0
  if (password.length >= 8) points++
  if (password.length >= 14) points++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points++
  if (/\d/.test(password)) points++
  if (/[^a-zA-Z0-9]/.test(password)) points++

  if (points <= 1) return { score: 1, label: 'Weak', colorClass: 'bg-rose-500' }
  if (points === 2) return { score: 2, label: 'Fair', colorClass: 'bg-amber-500' }
  if (points === 3) return { score: 3, label: 'Good', colorClass: 'bg-sky-500' }
  if (points === 4) return { score: 4, label: 'Strong', colorClass: 'bg-emerald-500' }
  return { score: 4, label: 'Fortress', colorClass: 'bg-emerald-600' }
}

export function daysSince(isoDate: string): number {
  const diff = Date.now() - new Date(isoDate).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}
