import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { PosDashboardHeader } from '@/components/pos-dashboard-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { FloatingChatbox } from '@/components/chat/floating-chatbox'
import { prisma } from '@/lib/db'
import { getPosContext } from '@/lib/pos-context'

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  const posContext = getPosContext()

  const userName = session?.user?.name ?? posContext.userName
  const outletName = session?.user?.outletName ?? posContext.outletName
  const userRole = session?.user?.role ?? 'CASHIER'
  
  let userImage = session?.user?.image ?? null
  if (!userImage && session?.user?.id) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { image: true },
      })
      userImage = dbUser?.image ?? null
    } catch {
      // Ignore fallback failure safely
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar className="print:hidden" />
      <SidebarInset className="min-w-0 max-w-full overflow-x-hidden">
        <PosDashboardHeader
          className="print:hidden"
          userName={userName}
          outletName={outletName}
          outletId={session?.user?.outletId ?? null}
          userRole={userRole}
          userImage={userImage}
        />
        <div className="flex flex-1 flex-col p-2 sm:p-4 print:block print:p-0 min-w-0 max-w-full overflow-x-hidden">
          {children}
        </div>
        <FloatingChatbox />
      </SidebarInset>
    </SidebarProvider>
  )
}
