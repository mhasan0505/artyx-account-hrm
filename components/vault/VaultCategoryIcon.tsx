'use client'

import React from 'react'
import {
  Mail,
  Share2,
  Terminal,
  Globe,
  Briefcase,
  Database,
  CreditCard,
  KeyRound,
} from 'lucide-react'
import type { VaultCategory } from '@/lib/vault/types'

export function VaultCategoryIcon({
  category,
  className = 'w-4 h-4',
}: {
  category: VaultCategory
  className?: string
}) {
  switch (category) {
    case 'EMAIL':
      return <Mail className={className} />
    case 'SOCIAL_MEDIA':
      return <Share2 className={className} />
    case 'VPS_SSH':
      return <Terminal className={className} />
    case 'DOMAIN_HOSTING':
      return <Globe className={className} />
    case 'AGENCY_TOOL':
      return <Briefcase className={className} />
    case 'DATABASE_API':
      return <Database className={className} />
    case 'FINANCE_BILLING':
      return <CreditCard className={className} />
    default:
      return <KeyRound className={className} />
  }
}
