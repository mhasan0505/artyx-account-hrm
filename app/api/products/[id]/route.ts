import { requireRole, validateOutletAccess } from '@/lib/actions/auth-guard'
import { getPrismaDatabaseErrorMessage, prisma } from '@/lib/db'
import { UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<any> }
) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER
    )

    const { id } = await context.params

    const product = await prisma.product.findFirst({
      where: {
        id,
        isActive: true,
      },
      select: { id: true, outletId: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    validateOutletAccess(user, product.outletId)

    const stock = await prisma.stockLedger.aggregate({
      where: {
        productId: id,
        outletId: product.outletId,
      },
      _sum: { quantity: true },
    })

    const currentStock = Number(stock._sum.quantity ?? 0)
    if (currentStock > 0) {
      return NextResponse.json(
        {
          error: `Cannot archive product while ${currentStock} unit(s) remain in stock`,
        },
        { status: 400 }
      )
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    })

    revalidatePath('/products')
    revalidatePath('/create-products')

    return NextResponse.json({ success: true })
  } catch (error: any) {
    const dbMessage = getPrismaDatabaseErrorMessage(error)
    if (dbMessage) {
      return NextResponse.json({ error: dbMessage }, { status: 503 })
    }
    if (
      error?.message?.includes('Unauthorized') ||
      error?.message?.includes('Insufficient permissions') ||
      error?.message?.includes('Access denied')
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    throw error
  }
}

export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<any> }
) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER
    )

    const { id } = await context.params

    const product = await prisma.product.findFirst({
      where: {
        id,
        isActive: false,
      },
      select: { id: true, outletId: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    validateOutletAccess(user, product.outletId)

    await prisma.product.update({
      where: { id },
      data: { isActive: true },
    })

    revalidatePath('/products')
    revalidatePath('/create-products')

    return NextResponse.json({ success: true })
  } catch (error: any) {
    const dbMessage = getPrismaDatabaseErrorMessage(error)
    if (dbMessage) {
      return NextResponse.json({ error: dbMessage }, { status: 503 })
    }
    if (
      error?.message?.includes('Unauthorized') ||
      error?.message?.includes('Insufficient permissions') ||
      error?.message?.includes('Access denied')
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    throw error
  }
}
