'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { syncAgencyCoaAction } from '@/lib/actions/agency-accounting'

export function SyncAgencyCoaButton() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  async function handleSync() {
    try {
      setLoading(true)
      const res = await syncAgencyCoaAction()
      toast.success(
        `Agency CoA synced (${res.createdCount} added, ${res.updatedCount} classified).`
      )
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync Agency CoA')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleSync}
      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-2xs transition-all hover:brightness-105 disabled:opacity-50"
    >
      <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
      <span>{loading ? 'Syncing Template...' : 'Sync Agency CoA Template'}</span>
    </button>
  )
}
