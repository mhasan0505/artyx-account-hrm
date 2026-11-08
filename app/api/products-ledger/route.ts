import { auth } from '@/auth'
import { getProductLedger } from '@/lib/actions/products'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.outletId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER']
  if (!session.user.role || !allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const productId = searchParams.get('productId') || undefined
  const movementType = searchParams.get('movementType') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined
  const page = Number(searchParams.get('page') || '1')
  const pageSize = Number(searchParams.get('pageSize') || '50')

  const result = await getProductLedger({
    productId,
    outletId: session.user.outletId,
    movementType,
    from,
    to,
    page,
    pageSize,
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result)
}