import { auth } from '@/auth'
import { validateOutletAccess } from '@/lib/actions/auth-guard'
import { getLowStockAlerts } from '@/lib/actions/products'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.outletId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const outletId = searchParams.get('outletId') || undefined
  const targetOutletId = outletId || session.user.outletId

  try {
    validateOutletAccess(session.user, targetOutletId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await getLowStockAlerts(targetOutletId)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result)
}