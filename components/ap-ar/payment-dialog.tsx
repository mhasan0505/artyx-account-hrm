'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PaymentMethod } from '@prisma/client'
import { recordSupplierPaymentAction, recordCustomerCollectionAction } from '@/lib/actions/ap-ar'
import { ApArOverviewData } from '@/lib/actions/ap-ar'
import {
  CreditCard,
  ArrowDownLeft,
  Banknote,
  Smartphone,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Building2,
  Hash,
  FileText,
  User,
  Calendar,
} from 'lucide-react'

interface Props {
  mode: 'SUPPLIER_PAYMENT' | 'CUSTOMER_COLLECTION' | null
  targetId: string | null
  invoiceOrSaleId?: string | null
  defaultAmount?: number | null
  suppliers: ApArOverviewData['payables']['suppliers']
  customers: ApArOverviewData['receivables']['customers']
  bankAccounts: ApArOverviewData['liquidity']['bankAccounts']
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const METHOD_OPTIONS = [
  { value: PaymentMethod.CASH, label: 'Cash (Drawer)', icon: Banknote },
  { value: PaymentMethod.BANK_TRANSFER, label: 'Bank Transfer', icon: Building2 },
  { value: PaymentMethod.BKASH, label: 'bKash', icon: Smartphone },
  { value: PaymentMethod.NAGAD, label: 'Nagad', icon: Smartphone },
  { value: PaymentMethod.ROCKET, label: 'Rocket', icon: Smartphone },
  { value: PaymentMethod.CHEQUE, label: 'Cheque', icon: CreditCard },
]

export function PaymentDialog({
  mode,
  targetId,
  invoiceOrSaleId,
  defaultAmount,
  suppliers,
  customers,
  bankAccounts,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [selectedId, setSelectedId] = useState(targetId || '')
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '')
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH)
  const [bankAccountId, setBankAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  React.useEffect(() => {
    if (targetId) setSelectedId(targetId)
    if (defaultAmount !== undefined && defaultAmount !== null && defaultAmount > 0) {
      setAmount(String(defaultAmount))
    }
  }, [targetId, defaultAmount, open])

  if (!mode) return null

  const isSupplier = mode === 'SUPPLIER_PAYMENT'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId) return setErrorMsg('Please select a party')
    if (!amount || Number(amount) <= 0) return setErrorMsg('Please enter a valid amount')

    setLoading(true)
    setErrorMsg('')

    let res
    if (isSupplier) {
      res = await recordSupplierPaymentAction({
        supplierId: selectedId,
        invoiceId: invoiceOrSaleId || undefined,
        amount: Number(amount),
        method,
        bankAccountId: bankAccountId || undefined,
        reference: reference || undefined,
        description: description || `Payment to supplier${invoiceOrSaleId ? ` for invoice #${invoiceOrSaleId}` : ''}`,
        chequeDate: method === PaymentMethod.CHEQUE && chequeDate ? chequeDate : undefined,
      })
    } else {
      res = await recordCustomerCollectionAction({
        customerId: selectedId,
        saleId: invoiceOrSaleId || undefined,
        amount: Number(amount),
        method,
        bankAccountId: bankAccountId || undefined,
        reference: reference || undefined,
        description: description || `Collection from customer${invoiceOrSaleId ? ` for sale #${invoiceOrSaleId}` : ''}`,
        chequeDate: method === PaymentMethod.CHEQUE && chequeDate ? chequeDate : undefined,
      })
    }

    setLoading(false)

    if (!res.success) {
      setErrorMsg(res.error || 'Failed to record transaction')
    } else {
      onOpenChange(false)
      setAmount('')
      setReference('')
      setChequeDate('')
      setDescription('')
      onSuccess()
    }
  }

  const accentColor = 'from-primary to-primary/80'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden rounded-2xl border-0 shadow-2xl">
        {/* Colored Header */}
        <div className={`bg-gradient-to-r ${accentColor} p-6 pb-5`}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-sm">
                {isSupplier
                  ? <CreditCard className="w-5 h-5 text-white" />
                  : <ArrowDownLeft className="w-5 h-5 text-white" />}
              </div>
              <div>
                <DialogTitle className="text-white text-base font-bold">
                  {isSupplier ? 'Pay Supplier' : 'Collect Customer Due'}
                </DialogTitle>
                <p className="text-white/70 text-xs mt-0.5">
                  {isSupplier ? 'Record a supplier payment voucher' : 'Record a customer receipt voucher'}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-background">
          {/* Error */}
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 bg-destructive/10 text-destructive text-xs rounded-xl border border-destructive/20">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Party Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              {isSupplier ? 'Supplier' : 'Customer'}
            </Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="rounded-xl border-border h-10 text-sm bg-muted/30 focus:ring-2 focus:ring-offset-0">
                <SelectValue placeholder={`Select ${isSupplier ? 'supplier' : 'customer'}`} />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {isSupplier
                  ? suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id} className="text-sm">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
                          {s.phone ? `· ${s.phone}` : ''} — Due: ৳{s.outstandingBalance.toLocaleString()}
                        </span>
                      </SelectItem>
                    ))
                  : customers.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-sm">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
                          {c.phone ? `· ${c.phone}` : ''} — Due: ৳{c.outstandingBalance.toLocaleString()}
                        </span>
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" />
              Settlement Amount (৳)
            </Label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">৳</span>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                className="pl-8 h-10 rounded-xl border-border bg-muted/30 text-sm font-mono tabular-nums focus:ring-2 focus:ring-offset-0"
              />
            </div>
          </div>

          {/* Payment Method - pill selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">
              Payment Method
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {METHOD_OPTIONS.map(opt => {
                const Icon = opt.icon
                const isActive = method === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMethod(opt.value)}
                    className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-semibold transition-all duration-150 pressable-subtle ${
                      isActive
                        ? 'bg-primary text-primary-foreground border-transparent shadow-md'
                        : 'bg-muted/30 border-border text-muted-foreground hover:border-border hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] leading-none">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Bank / MFS Account */}
          {method !== PaymentMethod.CASH && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                Bank / MFS Account
              </Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger className="rounded-xl border-border h-10 text-sm bg-muted/30 focus:ring-2 focus:ring-offset-0">
                  <SelectValue placeholder="Select target account" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {bankAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-sm">
                      <span className="flex items-center justify-between gap-4">
                        <span>
                          {a.bankName} – {a.accountName}
                          <span className="text-muted-foreground ml-1 text-xs font-mono">({a.accountNumber})</span>
                        </span>
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                          Bal: ৳{Number(a.currentBalance).toLocaleString()}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Cheque Maturity Date */}
          {method === PaymentMethod.CHEQUE && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Cheque Maturity Date
              </Label>
              <Input
                type="date"
                value={chequeDate}
                onChange={e => setChequeDate(e.target.value)}
                className="rounded-xl h-10 border-border bg-muted/30 text-sm focus:ring-2 focus:ring-offset-0"
              />
            </div>
          )}

          {/* Reference & Description in a 2-col */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" />
                Reference / Cheque #
              </Label>
              <Input
                placeholder="e.g. TXN98726"
                value={reference}
                onChange={e => setReference(e.target.value)}
                className="rounded-xl h-10 border-border bg-muted/30 text-sm focus:ring-2 focus:ring-offset-0"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Notes
              </Label>
              <Input
                placeholder="Optional note..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="rounded-xl h-10 border-border bg-muted/30 text-sm focus:ring-2 focus:ring-offset-0"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2.5 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-xl text-xs h-10 font-semibold text-muted-foreground hover:text-foreground hover:bg-muted pressable-subtle"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className={`rounded-xl text-xs h-10 font-bold bg-gradient-to-r ${accentColor} text-primary-foreground border-0 shadow-md min-w-[150px] pressable`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                  Save & Generate Voucher
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
