import { auth } from '@/auth'
import { getSupplierLedger } from '@/lib/actions/products'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.outletId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const supplierId = searchParams.get('supplierId') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined
  const page = Number(searchParams.get('page') || '1')
  const pageSize = Number(searchParams.get('pageSize') || '50')

  const result = await getSupplierLedger({
    supplierId,
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