'use client'

import { DateCorrectionDialog } from '@/components/invoices/date-correction-dialog'
import { EditItemsDialog } from '@/components/invoices/edit-items-dialog'
import { PrintActions } from '@/components/receipt/print-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getSaleForEdit } from '@/lib/actions/sales'
import { usePosCartStore } from '@/lib/stores/pos-cart'
import { cn } from '@/lib/utils'
import {
  Calendar,
  ChevronDown,
  History,
  Loader2,
  Monitor,
  Package,
  Pencil,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

export interface SalesInvoiceActionsProps {
  sale: {
    id: string
    saleNumber: string
    outletId: string
    customer?: {
      id?: string
      name?: string
      phone?: string | null
      email?: string | null
      address?: string | null
    } | null
    outlet: {
      id: string
      name: string
    }
    createdAt: Date | string
    notes?: string | null
    amountPaid: number | string | any
    lines: Array<{
      id: string
      productId: string
      product: {
        id: string
        name: string
        requiresSerial?: boolean
        processor?: string | null
        processorGen?: string | null
        ram?: string | null
        storage?: string | null
        display?: string | null
      }
      quantity: number
      unitPrice: number | string | any
      discountPct: number | string | any
      serials: Array<{
        serialUnit: {
          serialNumber: string
        }
      }>
      isGift?: boolean
    }>
  }
  editLogs?: Array<{
    id: string
    reason: string
    createdAt: Date | string
    fieldName: string
    oldValue: string | null
    newValue: string | null
    editedBy: {
      name: string
    }
  }>
}

export function SalesInvoiceActions({
  sale,
  editLogs = [],
}: SalesInvoiceActionsProps) {
  const [editItemsOpen, setEditItemsOpen] = useState(false)
  const [dateCorrectionOpen, setDateCorrectionOpen] = useState(false)
  const [isTerminalLoading, setIsTerminalLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const router = useRouter()
  const { loadSaleIntoCart, setEditMode, clearCart } = usePosCartStore()

  async function handleEditInTerminal() {
    setIsTerminalLoading(true)
    try {
      const result = await getSaleForEdit(sale.id)
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

      clearCart()
      loadSaleIntoCart(
        lines,
        customerId,
        customerName,
        customerPhone,
        groupDiscountPct,
        groupName
      )
      setEditMode(id, saleNumber)

      toast.success(`Editing ${saleNumber} — redirecting to terminal…`)
      router.push('/sales')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open sale for editing')
    } finally {
      setIsTerminalLoading(false)
    }
  }

  // Format line descriptions with specs
  const initialLines = useMemo(() => {
    return sale.lines.map(line => {
      const p = line.product as any
      const cpuParts: string[] = []
      if (p.processor) cpuParts.push(p.processor.trim())
      if (
        p.processorGen &&
        (!p.processor ||
          !p.processor.toLowerCase().includes(p.processorGen.toLowerCase()))
      ) {
        cpuParts.push(p.processorGen.trim())
      }
      const cpu = cpuParts.join(' ')
      const ram = p.ram
        ? p.ram.toUpperCase().includes('RAM')
          ? p.ram.trim()
          : `${p.ram.trim()} RAM`
        : null
      const storage = p.storage
        ? p.storage.toUpperCase().includes('SSD') ||
          p.storage.toUpperCase().includes('HDD')
          ? p.storage.trim()
          : `${p.storage.trim()} SSD`
        : null
      const display = p.display ? p.display.trim() : null
      const baseName = String(p.name ?? '').trim()
      const fullName = baseName.includes('|')
        ? baseName
        : [baseName, cpu, ram, storage, display].filter(Boolean).join(' | ')

      return {
        productId: line.productId,
        name: fullName,
        quantity: line.quantity,
        unitPriceOrCost: Number(line.unitPrice),
        discount: Number(line.discountPct),
        serialNumbers: line.serials.map(s => s.serialUnit.serialNumber),
        isGift: line.isGift,
        requiresSerial: Boolean(line.product.requiresSerial),
      }
    })
  }, [sale.lines])

  const saleDate = useMemo(() => {
    return typeof sale.createdAt === 'string'
      ? new Date(sale.createdAt)
      : sale.createdAt
  }, [sale.createdAt])

  return (
    <div className="mx-auto mt-6 max-w-4xl space-y-3 print:hidden">
      {/* Sleek, Unified Invoice Action Bar */}
      <PrintActions
        backHref="/sales-orders/invoices"
        backLabel="Back to Invoices"
        challanHref={`/sales-orders/invoices/${sale.id}/challan`}
        shareTitle={`Sales Invoice ${sale.saleNumber}`}
        shareText={`Invoice ${sale.saleNumber} from ${sale.outlet.name}`}
        customerPhone={sale.customer?.phone}
        customerEmail={sale.customer?.email}
        entityType="sale"
        entityId={sale.id}
        targetId="a4-invoice-container"
        fileName={`Invoice_${sale.saleNumber}`}
        extraActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 px-3 rounded-xl gap-1.5 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-medium"
              >
                {isTerminalLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                <span>Edit / Correct</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 p-1.5 rounded-xl shadow-lg border-border"
            >
              <DropdownMenuItem
                onClick={handleEditInTerminal}
                disabled={isTerminalLoading}
                className="gap-2.5 py-2 cursor-pointer rounded-lg text-xs"
              >
                <Monitor className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <div className="font-medium text-foreground">
                    Edit in POS Terminal
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Load sale back into register cart
                  </div>
                </div>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => setEditItemsOpen(true)}
                className="gap-2.5 py-2 cursor-pointer rounded-lg text-xs"
              >
                <Package className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <div>
                  <div className="font-medium text-foreground">
                    Correct Items & Prices
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Adjust items, serials, and discounts
                  </div>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => setDateCorrectionOpen(true)}
                className="gap-2.5 py-2 cursor-pointer rounded-lg text-xs"
              >
                <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="font-medium text-foreground">
                    Correct Sale Date
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Adjust invoice issue timestamp
                  </div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Controlled Correction Dialogs (Mounted with trigger=null so no extra buttons render) */}
      <EditItemsDialog
        open={editItemsOpen}
        onOpenChange={setEditItemsOpen}
        trigger={null}
        entityId={sale.id}
        entityType="sale"
        outletId={sale.outletId}
        initialNotes={sale.notes ?? ''}
        initialAmountPaid={Number(sale.amountPaid)}
        initialLines={initialLines}
      />

      <DateCorrectionDialog
        open={dateCorrectionOpen}
        onOpenChange={setDateCorrectionOpen}
        trigger={null}
        saleId={sale.id}
        saleDate={saleDate}
      />

      {/* Minimal, Collapsible Edit History */}
      {editLogs.length > 0 && (
        <div className="rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs text-xs overflow-hidden transition-all duration-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setShowHistory(prev => !prev)}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors text-left select-none"
          >
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">Edit History</span>
              <Badge
                variant="secondary"
                className="h-4.5 px-1.5 text-[10px] font-normal"
              >
                {editLogs.length} revision{editLogs.length > 1 ? 's' : ''}
              </Badge>
              {editLogs[0] && (
                <span className="text-muted-foreground/80 hidden sm:inline text-[11px]">
                  • Latest by{' '}
                  <span className="font-medium text-foreground">
                    {editLogs[0].editedBy.name}
                  </span>{' '}
                  ({editLogs[0].reason})
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{showHistory ? 'Hide log' : 'View log'}</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform duration-200',
                  showHistory && 'rotate-180'
                )}
              />
            </div>
          </button>

          {showHistory && (
            <div className="px-4 pb-3 pt-1 border-t border-border/50 divide-y divide-border/40">
              {editLogs.map(log => (
                <div key={log.id} className="py-2 first:pt-1.5 last:pb-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {log.editedBy.name}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        {log.reason}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">
                      {new Date(log.createdAt).toLocaleString('en-GB')}
                    </span>
                  </div>
                  {log.oldValue !== log.newValue && (
                    <div className="mt-1 text-[11px] text-muted-foreground font-mono bg-muted/40 rounded px-2 py-1">
                      <span className="capitalize font-sans text-foreground/80 font-medium">
                        {log.fieldName}
                      </span>
                      : &ldquo;{log.oldValue || '(empty)'}&rdquo; → &ldquo;
                      {log.newValue || '(empty)'}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
