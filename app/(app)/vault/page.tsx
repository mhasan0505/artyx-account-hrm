import { Metadata } from 'next'
import { requireCeoUser } from '@/lib/actions/money-management'
import { getVaultStatus, listVaultItems } from '@/lib/actions/vault'
import { PageHeader } from '@/components/page-header'
import { CeoVaultClient } from '@/components/vault/CeoVaultClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'CEO Credential Vault | Artyx Digital Office',
  description:
    'AES-256-GCM encrypted personal & agency credential vault exclusively for the CEO.',
}

export default async function CeoVaultPage() {
  // Strictly enforce CEO email / CEO role access
  await requireCeoUser()

  const [statusRes, itemsRes] = await Promise.all([getVaultStatus(), listVaultItems()])

  const initialStatus = statusRes.success
    ? statusRes.data
    : {
        hasPinSet: false,
        isUnlocked: false,
        expiresAt: null,
        hasDedicatedKey: false,
        itemCount: 0,
      }

  const initialItems = itemsRes.success ? itemsRes.data : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="CEO Credential Vault"
        description="AES-256-GCM encrypted vault for your email, social media, VPS/SSH keys, domains, and 2FA codes."
        customBreadcrumbLabel="Credential Vault"
      />
      <CeoVaultClient initialStatus={initialStatus} initialItems={initialItems} />
    </div>
  )
}
