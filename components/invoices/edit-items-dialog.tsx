'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { 
  Package, 
  Trash2, 
  Search, 
  Loader2, 
  AlertCircle 
} from 'lucide-react'
import { toast } from 'sonner'
import { getProductsForPos } from '@/lib/actions/products'
import { updateSaleItems, getCheckoutPaymentOptions } from '@/lib/actions/sales'
import { evaluateDiscountApproval } from '@/lib/sales/discount-policy'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface LineItem {
  productId: string
  name: string
  quantity: number
  unitPriceOrCost: number
  discount: number // Explicit units: Percentage (0-100%) for sales ('sale'), Flat Currency Amount (৳) for purchases ('purchase')
  serialNumbers: string[]
  serialRaw?: string
  isGift?: boolean
  requiresSerial?: boolean
}

export interface EditItemsDialogProps {
  entityId: string
  entityType: 'sale' | 'purchase'
  initialLines: LineItem[]
  initialNotes: string
  initialAmountPaid: number
  outletId: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

export function EditItemsDialog({
  entityId,
  entityType,
  initialLines,
  initialNotes,
  initialAmountPaid,
  outletId,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
}: EditItemsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (isControlled) {
      setControlledOpen?.(val)
    } else {
      setInternalOpen(val)
    }
  }

  const [lines, setLines] = useState<LineItem[]>(initialLines)
  const [notes, setNotes] = useState(initialNotes)
  const [amountPaid, setAmountPaid] = useState(initialAmountPaid)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [approvers, setApprovers] = useState<
    Array<{ id: string; name: string; role: string; discountLimitPct: number }>
  >([])
  const [actorDiscountLimitPct, setActorDiscountLimitPct] = useState<number | null>(null)
  const [overrideApproverId, setOverrideApproverId] = useState<string>('')
  const [overridePin, setOverridePin] = useState<string>('')

  useEffect(() => {
    if (open) {
      setLines(
        initialLines.map(l => ({
          ...l,
          serialRaw: l.serialNumbers.join('\n'),
        }))
      )
      setNotes(initialNotes)
      setAmountPaid(initialAmountPaid)
      setReason('')
      setOverridePin('')
      setOverrideApproverId('')
      if (entityType === 'sale') {
        getCheckoutPaymentOptions()
          .then(res => {
            if (!res.success) return
            if (res.data.approvers) {
              setApprovers(res.data.approvers)
            }
            if (res.data.actorDiscountLimitPct !== undefined) {
              setActorDiscountLimitPct(res.data.actorDiscountLimitPct)
            }
          })
          .catch(console.error)
      }
    }
  }, [open, entityType, initialLines, initialNotes, initialAmountPaid])
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Handle outside click for search results
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search logic
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await getProductsForPos(outletId, searchQuery)
        setSearchResults(results)
        setShowResults(true)
      } catch (error) {
        console.error('Search failed', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, outletId])

  const addProduct = (product: any) => {
    const existingIndex = lines.findIndex(l => l.productId === product.id)
    if (existingIndex > -1) {
      const newLines = [...lines]
      newLines[existingIndex].quantity += 1
      setLines(newLines)
    } else {
      setLines([
        ...lines,
        {
          productId: product.id,
          name: product.name,
          quantity: 1,
          unitPriceOrCost: entityType === 'sale' ? product.sellingPrice : (product.costPrice ?? 0),
          discount: 0,
          serialNumbers: [],
          serialRaw: '',
          requiresSerial: product.requiresSerial,
        },
      ])
    }
    setSearchQuery('')
    setShowResults(false)
  }

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index))
  }

  const updateLine = (index: number, updates: Partial<LineItem>) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], ...updates }
    setLines(newLines)
  }

  async function handleSave() {
    if (reason.trim().length < 5) {
      toast.error('Please provide a reason (min 5 characters)')
      return
    }

    if (lines.length === 0) {
      toast.error('At least one product is required')
      return
    }

    setSubmitting(true)
    try {
      if (entityType === 'sale') {
        if (needsManagerOverride) {
          if (!overrideApproverId || overrideApproverId === 'none') {
            toast.error('Please select an authorizing manager')
            setSubmitting(false)
            return
          }
          if (!overridePin.trim()) {
            toast.error('Authorizing manager PIN is required')
            setSubmitting(false)
            return
          }
        }

        const result = await updateSaleItems({
          saleId: entityId,
          reason,
          lines: lines.map(l => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPriceOrCost,
            discountPct: l.discount,
            serialNumbers: (l.serialRaw || '').split('\n').map(s => s.trim()).filter(Boolean),
            isGift: !!l.isGift,
          })),
          orderDiscountPct: 0, // Simplified
          overrideApproverId: overrideApproverId || undefined,
          overridePin: overridePin.trim() || undefined,
          notes,
          amountPaid,
        })
        if (!result.success) throw new Error(result.error)
      } else {
        throw new Error('Modifying finalized purchase orders is disabled. Please create a Purchase Return instead.')
      }

      toast.success('Items updated successfully')
      setOpen(false)
    } catch (error: any) {
      toast.error(error.message || 'Failed to update items')
    } finally {
      setSubmitting(false)
    }
  }

  // Subtotal and Line Discounts:
  // For 'sale': l.discount is a PERCENTAGE (0-100%) of the line gross (quantity * unitPriceOrCost).
  // For 'purchase': l.discount is a flat TAKA AMOUNT (৳) subtracted from the line gross.
  const subtotal = lines.reduce((acc, l) => acc + (l.quantity * l.unitPriceOrCost), 0)
  const discountTotal = lines.reduce((acc, l) => {
    if (entityType === 'sale') {
      return acc + (l.quantity * l.unitPriceOrCost * (l.discount / 100))
    }
    return acc + l.discount
  }, 0)
  const total = Math.max(0, subtotal - discountTotal)

  // Map of initial unit prices to detect price reductions
  const initialPriceMap = useMemo(() => {
    return new Map(initialLines.map(il => [il.productId, il.unitPriceOrCost]))
  }, [initialLines])

  // Compute discretionary discount % identically to the server using evaluateDiscountApproval
  const saleDiscountEval = useMemo(() => {
    if (entityType !== 'sale') return null
    return evaluateDiscountApproval({
      role: 'CASHIER', // Baseline role for evaluating discretionary discount
      lines: lines.map(l => ({
        quantity: l.quantity,
        unitPrice: l.unitPriceOrCost,
        discountPct: l.discount, // l.discount is percentage for sales
        originalUnitPrice: initialPriceMap.get(l.productId),
        isGift: !!l.isGift,
      })),
      orderDiscountPct: 0,
      groupDiscountPct: 0,
      overrideApproverId,
      overridePin,
    })
  }, [entityType, lines, initialPriceMap, overrideApproverId, overridePin])

  const discretionaryDiscountPct = saleDiscountEval ? saleDiscountEval.discretionaryDiscountPct : 0
  const discountLimit = actorDiscountLimitPct ?? 0
  const needsManagerOverride = entityType === 'sale' && discretionaryDiscountPct > discountLimit
  const eligibleApprovers = approvers.filter(
    a => a.discountLimitPct >= discretionaryDiscountPct
  )

  return (
    <>
      {trigger === null ? null : trigger !== undefined ? (
        trigger
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true)
          }}
          className="h-9 gap-1.5 text-xs font-medium border-border"
        >
          <Package className="h-4 w-4 text-amber-600" /> Correct Invoice & Items
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>Edit Items - {entityType === 'sale' ? 'Sale' : 'Purchase'}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 space-y-6 min-h-[400px]">
            {/* Search Section */}
            <div className="relative" ref={searchRef}>
              <Label className="mb-2 block">Add Product</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, SKU or barcode..."
                  className="pl-9 pr-10"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    if (searchResults.length > 0) setShowResults(true)
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSearchResults([])
                      setShowResults(false)
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-full"
                  >
                    <Trash2 className="size-3 text-muted-foreground" />
                  </button>
                )}
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {showResults && searchResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border shadow-lg rounded-lg max-h-64 overflow-y-auto">
                  {searchResults.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-4 py-2 hover:bg-muted/20 border-b border-border last:border-0 flex items-center justify-between"
                      onClick={() => addProduct(p)}
                    >
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.sku} | Stock: {p.availableStock}</div>
                      </div>
                      <div className="text-sm font-semibold font-mono tabular-nums">
                        ৳{entityType === 'sale' ? p.sellingPrice : (p.costPrice ?? 0)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Product</th>
                    <th className="px-4 py-2 text-center font-semibold w-24">Qty</th>
                    <th className="px-4 py-2 text-right font-semibold w-32">Price</th>
                    <th className="px-4 py-2 text-right font-semibold w-28">
                      {entityType === 'sale' ? 'Disc %' : 'Disc ৳'}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold w-32">Total</th>
                    <th className="px-4 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l, i) => (
                    <tr key={i} className="group hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{l.name}</div>
                        {l.requiresSerial && (
                          <div className="mt-1.5">
                            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1 block">
                              Serial Numbers
                            </Label>
                            <Textarea
                              className="text-xs h-16 min-h-0 py-1"
                              placeholder="Enter one serial per line..."
                              value={l.serialRaw || ''}
                              onChange={e => updateLine(i, { serialRaw: e.target.value })}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          type="number"
                          className="text-center h-8 px-1"
                          value={l.quantity}
                          min={1}
                          onChange={e => updateLine(i, { quantity: parseInt(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          type="number"
                          className="text-right h-8 px-1 font-mono tabular-nums"
                          value={l.unitPriceOrCost}
                          min={0}
                          onChange={e => updateLine(i, { unitPriceOrCost: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          type="number"
                          className="text-right h-8 px-1 font-mono tabular-nums text-primary"
                          value={l.discount}
                          min={0}
                          max={entityType === 'sale' ? 100 : undefined}
                          onChange={e => updateLine(i, { discount: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top text-right font-semibold font-mono tabular-nums">
                        ৳{((l.quantity * l.unitPriceOrCost) - (entityType === 'sale' ? (l.quantity * l.unitPriceOrCost * l.discount / 100) : l.discount)).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          onClick={() => removeLine(i)}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        No products added yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals & Reason */}
            <div className="grid grid-cols-2 gap-8 py-4 border-t">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Amount Paid ৳</Label>
                    <Input
                      type="number"
                      className="font-mono tabular-nums"
                      value={amountPaid}
                      onChange={e => setAmountPaid(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Total Discount ৳</Label>
                    <Input
                      className="bg-muted font-mono tabular-nums"
                      value={discountTotal.toLocaleString()}
                      disabled
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Invoice Notes</Label>
                  <Textarea
                    placeholder="Enter invoice notes..."
                    className="h-20 resize-none"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {needsManagerOverride ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive tabular-nums">
                    Discretionary discount ({discretionaryDiscountPct.toFixed(1)}%) exceeds your role limit ({discountLimit}%) and requires manager approval.
                  </div>
                ) : null}

                {needsManagerOverride && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                        Authorizing Manager
                      </Label>
                      <Select
                        value={overrideApproverId}
                        onValueChange={setOverrideApproverId}
                      >
                        <SelectTrigger className="bg-background h-10">
                          <SelectValue placeholder="Select Manager" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleApprovers.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No manager with sufficient limit ({discretionaryDiscountPct.toFixed(0)}%)
                            </SelectItem>
                          ) : (
                            eligibleApprovers.map(a => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name} ({a.role} - {a.discountLimitPct}%)
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                        Manager PIN
                      </Label>
                      <Input
                        type="password"
                        value={overridePin}
                        onChange={e => setOverridePin(e.target.value)}
                        placeholder="Enter PIN"
                        className="bg-background h-10"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Reason for correction <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Textarea
                    placeholder="Enter the reason for this correction (min 5 characters)..."
                    className="h-20 resize-none"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="size-3" /> This will be recorded in the audit trail.
                  </p>
                </div>
              </div>
              <div className="bg-muted/30 p-6 rounded-xl space-y-3 h-fit border border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium font-mono tabular-nums">৳{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm text-primary">
                  <span>Item Discounts</span>
                  <span className="font-medium font-mono tabular-nums">-৳{discountTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
                  <span>New Grand Total</span>
                  <span className="text-primary font-mono tabular-nums">৳{total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span className="font-medium font-mono tabular-nums">৳{amountPaid.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground font-semibold">Balance Due</span>
                  <span className={`font-bold font-mono tabular-nums ${total - amountPaid > 0 ? 'text-destructive' : 'text-foreground'}`}>
                    ৳{Math.max(0, total - amountPaid).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 border-t bg-background flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={submitting || reason.length < 5 || lines.length === 0}
              className="px-8 pressable"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Saving Changes
                </>
              ) : 'Save Corrections'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
