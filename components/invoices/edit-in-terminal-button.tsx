'use client'

import { Button } from '@/components/ui/button'
import { getSaleForEdit } from '@/lib/actions/sales'
import { usePosCartStore } from '@/lib/stores/pos-cart'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditInTerminalButtonProps {
  saleId: string
}

export function EditInTerminalButton({ saleId }: EditInTerminalButtonProps) {
  const router = useRouter()
  const { loadSaleIntoCart, setEditMode, clearCart } = usePosCartStore()
  const [isLoading, setIsLoading] = useState(false)

  async function handleEdit() {
    setIsLoading(true)
    try {
      const result = await getSaleForEdit(saleId)
      if (!result.success) {
        toast.error(result.error)
        return
      }

      const {
        saleId: id,
        saleNumber,
        customerId,
        customerName,
        customerPhone,
        groupDiscountPct,
        groupName,
        lines,
      } = result.data

      // Clear any existing cart before loading the sale
      clearCart()

      // Load the sale lines and customer into the POS cart
      loadSaleIntoCart(lines, customerId, customerName, customerPhone, groupDiscountPct, groupName)

      // Mark the terminal as being in edit mode
      setEditMode(id, saleNumber)

      toast.success(`Editing ${saleNumber} — redirecting to terminal…`)
      router.push('/sales')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open sale for editing')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      id="edit-in-terminal-btn"
      variant="outline"
      onClick={handleEdit}
      disabled={isLoading}
      className="h-9 gap-2 border-primary/30 text-primary hover:bg-primary/10 transition-all duration-200 active:scale-[0.98]"
    >
      <Pencil className="h-4 w-4" />
      {isLoading ? 'Loading…' : 'Edit in Terminal'}
    </Button>
  )
}
