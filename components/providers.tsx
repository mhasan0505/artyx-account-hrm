'use client'

import { SessionProvider } from 'next-auth/react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { SessionIdleTracker } from '@/components/session-idle-tracker'

const OfflineSyncProvider = dynamic(
  () =>
    import('@/components/offline-sync-provider').then(
      mod => mod.OfflineSyncProvider
    ),
  {
    ssr: false,
  }
)

const AppToaster = dynamic(() => import('sonner').then(mod => mod.Toaster), {
  ssr: false,
})

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginRoute = pathname?.startsWith('/login')

  return (
    <SessionProvider>
      {!isLoginRoute ? <OfflineSyncProvider /> : null}
      {children}
      {!isLoginRoute ? <SessionIdleTracker /> : null}
      <AppToaster richColors position="top-right" />
    </SessionProvider>
  )
}
