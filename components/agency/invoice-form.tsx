'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAgencyInvoice } from '@/lib/actions/agency-invoices'
import { toast } from 'sonner'
import { Plus, Trash2, Receipt, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

type LineItem = {
  id: string
  description: string
  serviceCategory: string
  quantity: number
  unitPrice: number
}

export function InvoiceForm({
  clients = [],
  preselectedClientId,
}: {
  clients: Array<{
    id: string
    companyName: string
    clientCode: string
    contactPerson: string
    projects: Array<{ id: string; name: string }>
  }>
  preselectedClientId?: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const [clientId, setClientId] = useState(preselectedClientId || clients[0]?.id || '')
  const [projectId, setProjectId] = useState('')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [discount, setDiscount] = useState('0')
  const [taxRate, setTaxRate] = useState('0')
  const [paymentTerms, setPaymentTerms] = useState('Net 15')
  const [notes, setNotes] = useState(
    'Thank you for partnering with Artyx Digital. Please make payments via bank transfer or mobile banking to our authorized account.'
  )

  const [items, setItems] = useState<LineItem[]>([
    {
      id: '1',
      description: 'Custom Web Application Development — Phase 1 Milestone',
      serviceCategory: 'Software Development',
      quantity: 1,
      unitPrice: 50000,
    },
  ])

  const selectedClient = clients.find(c => c.id === clientId)
  const availableProjects = selectedClient?.projects || []

  function addItem() {
    setItems([
      ...items,
      {
        id: Math.random().toString(),
        description: '',
        serviceCategory: 'Software Development',
        quantity: 1,
        unitPrice: 0,
      },
    ])
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    setItems(items.filter(i => i.id !== id))
  }

  function updateItem(id: string, field: keyof LineItem, value: any) {
    setItems(items.map(item => (item.id === id ? { ...item, [field]: value } : item)))
  }

  // Calculate Subtotal & Totals
  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0
  )
  const discountAmt = parseFloat(discount) || 0
  const taxableBase = Math.max(0, subtotal - discountAmt)
  const taxPct = parseFloat(taxRate) || 0
  const taxAmt = (taxableBase * taxPct) / 100
  const totalAmount = taxableBase + taxAmt

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      toast.error('Please select a client')
      return
    }

    if (items.some(i => !i.description.trim() || Number(i.unitPrice) <= 0)) {
      toast.error('All line items must have a description and unit price greater than 0')
      return
    }

    try {
      setLoading(true)
      const res = await createAgencyInvoice({
        clientId,
        projectId: projectId && projectId !== 'unassigned' ? projectId : undefined,
        issueDate: new Date(issueDate),
        dueDate: new Date(dueDate),
        discount: discountAmt,
        taxRate: taxPct,
        paymentTerms,
        notes,
        items: items.map(i => ({
          description: i.description,
          serviceCategory: i.serviceCategory,
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
        })),
      })

      if (res.success) {
        toast.success(`Invoice ${res.invoice.invoiceNumber} created successfully!`)
        router.push(`/invoices/${res.invoice.id}`)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold text-foreground">Create Agency Invoice</h1>
            <p className="text-xs text-muted-foreground">
              Generate a professional BDT service invoice for your client
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            disabled={loading}
            className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
          >
            {loading ? 'Creating...' : 'Issue Invoice'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Client & Metadata */}
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs md:col-span-1 space-y-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-foreground">Invoice Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Client <span className="text-rose-500">*</span></Label>
              {clients.length === 0 ? (
                <div className="p-2.5 rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground flex flex-col gap-1.5">
                  <span>No active clients found in directory.</span>
                  <Link href="/clients" className="text-primary hover:underline font-semibold flex items-center gap-1">
                    <Plus className="size-3" /> Add your first client
                  </Link>
                </div>
              ) : (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Select Client" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-card-foreground">
                    {clients.map(c => (
                      <SelectItem key={c.id} value={c.id || 'unknown'}>
                        {c.companyName} ({c.clientCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {availableProjects.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Linked Project (Optional)</Label>
                <Select value={projectId || 'unassigned'} onValueChange={setProjectId}>
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Select Project" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-card-foreground">
                    <SelectItem value="unassigned">No specific project</SelectItem>
                    {availableProjects.map(p => (
                      <SelectItem key={p.id} value={p.id || 'unassigned'}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Issue Date</Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="bg-background border-border text-foreground"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-medium">Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="bg-background border-border text-foreground"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Payment Terms</Label>
              <Input
                value={paymentTerms}
                onChange={e => setPaymentTerms(e.target.value)}
                placeholder="e.g. Net 15 / Due upon receipt"
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Invoice Currency</Label>
              <div className="bg-muted/60 border border-border rounded-md p-2 font-mono text-foreground flex justify-between items-center">
                <span>BDT (Bangladeshi Taka)</span>
                <span className="text-[#3E7000] dark:text-[#7FFF00] font-bold">৳</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Line Items & Calculation */}
        <div className="md:col-span-2 space-y-4">
          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <CardTitle className="text-sm font-bold text-foreground">
                Service Line Items & Deliverables
              </CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={addItem}
                className="border-border text-[#3E7000] dark:text-[#7FFF00] hover:bg-muted text-xs"
                variant="outline"
              >
                <Plus className="size-3.5 mr-1" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              {items.map((item, index) => {
                const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                return (
                  <div
                    key={item.id}
                    className="p-3 bg-muted/50 rounded-xl border border-border space-y-3"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-mono text-muted-foreground uppercase font-medium">
                        Item #{index + 1}
                      </span>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeItem(item.id)}
                          className="size-6 text-muted-foreground hover:text-rose-500 hover:bg-transparent"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <div className="md:col-span-6 space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">Description / Deliverable</Label>
                        <Input
                          placeholder="e.g. Custom Web Development or Monthly Ad Management"
                          value={item.description}
                          onChange={e => updateItem(item.id, 'description', e.target.value)}
                          className="bg-background border-border text-foreground text-xs"
                        />
                      </div>

                      <div className="md:col-span-2 space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">Category</Label>
                        <select
                          value={item.serviceCategory}
                          onChange={e => updateItem(item.id, 'serviceCategory', e.target.value)}
                          className="h-9 w-full px-2 rounded-md bg-background border border-border text-[11px] text-foreground"
                        >
                          <option value="Software Development">Software</option>
                          <option value="Performance Marketing">Marketing</option>
                          <option value="UI/UX Design">UI/UX</option>
                          <option value="SEO & Content">SEO</option>
                          <option value="Ad Spend">Ad Spend</option>
                        </select>
                      </div>

                      <div className="md:col-span-1 space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">Qty</Label>
                        <Input
                          type="number"
                          step="any"
                          min="1"
                          value={item.quantity}
                          onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                          className="bg-background border-border text-foreground font-mono text-xs"
                        />
                      </div>

                      <div className="md:col-span-3 space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">Unit Price (৳)</Label>
                        <Input
                          type="number"
                          step="any"
                          value={item.unitPrice}
                          onChange={e => updateItem(item.id, 'unitPrice', e.target.value)}
                          className="bg-background border-border text-foreground font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1 text-xs">
                      <span className="text-muted-foreground mr-2">Line Total:</span>
                      <span className="font-mono font-bold text-foreground">৳{lineTotal.toLocaleString()}</span>
                    </div>
                  </div>
                )
              })}

              {/* Totals Summary */}
              <div className="border-t border-border pt-3 space-y-2 max-w-xs ml-auto text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span className="font-mono text-foreground font-semibold">৳{subtotal.toLocaleString()}</span>
                </div>

                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Discount (৳):</span>
                  <Input
                    type="number"
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    className="w-24 h-7 bg-background border-border text-right font-mono text-xs text-foreground"
                  />
                </div>

                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Tax / VAT (%):</span>
                  <Input
                    type="number"
                    value={taxRate}
                    onChange={e => setTaxRate(e.target.value)}
                    className="w-24 h-7 bg-background border-border text-right font-mono text-xs text-foreground"
                  />
                </div>

                <div className="flex justify-between text-base font-bold text-foreground border-t border-border pt-2">
                  <span>Total Amount:</span>
                  <span className="font-mono text-[#3E7000] dark:text-[#7FFF00]">৳{totalAmount.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground">
                Invoice Notes & Bank Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="bg-background border-border text-foreground text-xs min-h-[70px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  )
}
