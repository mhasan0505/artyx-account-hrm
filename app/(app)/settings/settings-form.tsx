'use client'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { updateOutlet } from '@/lib/actions/settings'
import {
  SALES_TERMS_DEFAULT,
  PURCHASE_TERMS_DEFAULT,
  SERVICE_TERMS_DEFAULT,
  WARRANTY_TERMS_DEFAULT,
} from '@/lib/constants/invoice-terms'
import { DiscountLimitsCard } from '@/components/settings/discount-limits-card'
import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  FileText,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  UploadCloud,
  Wrench,
  Store,
  MapPin,
  Clock,
  Mail,
  Phone,
  ShieldAlert,
  ExternalLink,
  AlertTriangle,
  RotateCcw as ReturnIcon,
  CheckCircle2,
  Loader2,
  Sliders,
} from 'lucide-react'
import * as z from 'zod'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

const schema = z.object({
  name: z.string().min(1, 'Store name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  invoiceTerms: z.string().optional(),
  salesTerms: z.string().optional(),
  purchaseTerms: z.string().optional(),
  serviceTerms: z.string().optional(),
  warrantyTerms: z.string().optional(),
  logo: z.string().optional(),
  slogan: z.string().optional(),
  lowStockThreshold: z.coerce.number().int().min(0, 'Must be positive').default(5),
  cashDrawerVarianceThreshold: z.coerce.number().min(0, 'Must be positive').default(500),
  largeSaleThreshold: z.coerce.number().min(0, 'Must be positive').default(20000),
  returnApprovalThreshold: z.coerce.number().min(0, 'Must be positive').default(50000),
  returnWindowDays: z.coerce.number().int().min(0, 'Must be positive').default(30),
})

type FormValues = z.infer<typeof schema>

export type OutletOption = {
  id: string
  name: string
  code: string
  address?: string | null
  phone?: string | null
  email?: string | null
  isActive?: boolean
}

type Outlet = {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  openTime: string | null
  closeTime: string | null
  invoiceTerms?: string | null
  salesTerms?: string | null
  purchaseTerms?: string | null
  serviceTerms?: string | null
  warrantyTerms?: string | null
  logo?: string | null
  slogan?: string | null
  lowStockThreshold?: number
  cashDrawerVarianceThreshold?: number
  largeSaleThreshold?: number
  returnApprovalThreshold?: number
  returnWindowDays?: number
}

interface SettingsFormProps {
  outlet: Outlet | null
  outlets?: OutletOption[]
  selectedOutletId?: string
  userRole?: string
}

export function SettingsForm({
  outlet,
  outlets = [],
  selectedOutletId,
  userRole,
}: SettingsFormProps) {
  const router = useRouter()
  const [isSwitching, startTransition] = React.useTransition()
  const [logoPreview, setLogoPreview] = React.useState<string | null>(
    outlet?.logo ?? null
  )
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const canSwitchOutlets = userRole === 'SUPER_ADMIN' || outlets.length > 1

  const defaultValues = React.useMemo<FormValues>(
    () => ({
      name: outlet?.name ?? '',
      email: outlet?.email ?? '',
      phone: outlet?.phone ?? '',
      address: outlet?.address ?? '',
      openTime: outlet?.openTime ?? '',
      closeTime: outlet?.closeTime ?? '',
      invoiceTerms: outlet?.invoiceTerms ?? '',
      salesTerms:
        outlet?.salesTerms ||
        (outlet?.invoiceTerms ? outlet.invoiceTerms : SALES_TERMS_DEFAULT.join('\n')),
      purchaseTerms: outlet?.purchaseTerms || PURCHASE_TERMS_DEFAULT.join('\n'),
      serviceTerms: outlet?.serviceTerms || SERVICE_TERMS_DEFAULT.join('\n'),
      warrantyTerms: outlet?.warrantyTerms || WARRANTY_TERMS_DEFAULT.join('\n'),
      logo: outlet?.logo ?? '',
      slogan: outlet?.slogan ?? '',
      lowStockThreshold: outlet?.lowStockThreshold ?? 5,
      cashDrawerVarianceThreshold: outlet?.cashDrawerVarianceThreshold ?? 500,
      largeSaleThreshold: outlet?.largeSaleThreshold ?? 20000,
      returnApprovalThreshold: outlet?.returnApprovalThreshold ?? 50000,
      returnWindowDays: outlet?.returnWindowDays ?? 30,
    }),
    [outlet]
  )

  const form = useForm<FormValues>({
    resolver: (zodResolver as any)(schema) as Resolver<FormValues>,
    defaultValues,
  })

  // Synchronize form values whenever the selected outlet changes
  React.useEffect(() => {
    if (outlet) {
      form.reset({
        name: outlet.name ?? '',
        email: outlet.email ?? '',
        phone: outlet.phone ?? '',
        address: outlet.address ?? '',
        openTime: outlet.openTime ?? '',
        closeTime: outlet.closeTime ?? '',
        invoiceTerms: outlet.invoiceTerms ?? '',
        salesTerms:
          outlet.salesTerms ||
          (outlet.invoiceTerms ? outlet.invoiceTerms : SALES_TERMS_DEFAULT.join('\n')),
        purchaseTerms: outlet.purchaseTerms || PURCHASE_TERMS_DEFAULT.join('\n'),
        serviceTerms: outlet.serviceTerms || SERVICE_TERMS_DEFAULT.join('\n'),
        warrantyTerms: outlet.warrantyTerms || WARRANTY_TERMS_DEFAULT.join('\n'),
        logo: outlet.logo ?? '',
        slogan: outlet.slogan ?? '',
        lowStockThreshold: outlet.lowStockThreshold ?? 5,
        cashDrawerVarianceThreshold: outlet.cashDrawerVarianceThreshold ?? 500,
        largeSaleThreshold: outlet.largeSaleThreshold ?? 20000,
        returnApprovalThreshold: outlet.returnApprovalThreshold ?? 50000,
        returnWindowDays: outlet.returnWindowDays ?? 30,
      })
      setLogoPreview(outlet.logo ?? null)
    }
  }, [outlet, form])

  const handleOutletSelect = (newId: string) => {
    if (newId === outlet?.id) return
    startTransition(() => {
      router.push(`/settings?outletId=${encodeURIComponent(newId)}`)
    })
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_WIDTH = 300
        const MAX_HEIGHT = 300
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height
            height = MAX_HEIGHT
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setLogoPreview(dataUrl)
          form.setValue('logo', dataUrl, { shouldDirty: true })
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    setLogoPreview(null)
    form.setValue('logo', '', { shouldDirty: true })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onSubmit(values: FormValues) {
    if (!outlet) return
    const fd = new FormData()
    Object.entries(values).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, String(v))
    })
    const result = await updateOutlet(outlet.id, fd)
    if (result.success) {
      toast.success(`Settings saved successfully for ${values.name}`)
      form.reset(values)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  if (!outlet) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        <PageHeader title="Store Settings" />
        <div className="rounded-2xl border border-dashed p-12 text-center space-y-3 bg-muted/20">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto stroke-[1.5]" />
          <h3 className="text-base font-semibold">No Outlet Location Selected</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            You do not currently have an assigned outlet location or the selected location was not found. Please contact an administrator.
          </p>
        </div>
      </div>
    )
  }

  const isFormDirty = form.formState.isDirty

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6 pb-24">
      {/* Page Header */}
      <PageHeader
        title="Agency Settings"
        description="Manage agency identity, operational policies, billing terms, tax rules, and system configurations."
      />

      {/* Top Location & Allocation Card */}
      <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Location
                </span>
                <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 h-4 bg-muted/30">
                  {outlet.code}
                </Badge>
                {isSwitching && (
                  <span className="text-xs text-primary font-medium animate-pulse">
                    Switching…
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {outlet.name}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            {canSwitchOutlets && outlets.length > 1 && (
              <div className="w-full sm:w-56">
                <Select
                  value={outlet.id}
                  onValueChange={handleOutletSelect}
                  disabled={isSwitching}
                >
                  <SelectTrigger className="w-full h-9 text-xs font-medium">
                    <SelectValue placeholder="Switch Outlet" />
                  </SelectTrigger>
                  <SelectContent>
                    {outlets.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{o.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            ({o.code})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button variant="outline" size="sm" asChild className="h-9 text-xs shrink-0 font-medium">
              <Link href={`/settings/letterhead?outletId=${outlet.id}`}>
                <FileText className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <span>Letterhead</span>
                <ExternalLink className="w-3 h-3 ml-1 text-muted-foreground/70" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Location metadata sub-strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-3 mt-3 border-t border-border/50 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground/70" />
            <span className="truncate max-w-[240px] sm:max-w-none">
              {outlet.address || 'Address unconfigured'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-muted-foreground/70" />
            <span>{outlet.phone || 'Phone unconfigured'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
            <span className="font-mono">
              {outlet.openTime || '09:00'} - {outlet.closeTime || '20:00'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto text-[11px]">
            <span className="text-muted-foreground/70">Currency:</span>
            <span className="font-semibold text-foreground">BDT (৳)</span>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Main Navigation Tabs */}
          <Tabs defaultValue="profile" className="w-full space-y-6">
            <TabsList className="w-full sm:w-auto h-auto p-1 bg-muted/50 rounded-xl border border-border/60 grid grid-cols-3 sm:inline-flex">
              <TabsTrigger
                value="profile"
                className="rounded-lg px-4 py-2 text-xs font-medium gap-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
              >
                <Store className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Store Profile</span>
              </TabsTrigger>
              <TabsTrigger
                value="terms"
                className="rounded-lg px-4 py-2 text-xs font-medium gap-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Document Terms</span>
              </TabsTrigger>
              <TabsTrigger
                value="policies"
                className="rounded-lg px-4 py-2 text-xs font-medium gap-2 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
              >
                <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Policies & Alerts</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: STORE PROFILE */}
            <TabsContent value="profile" className="space-y-6 pt-1 focus-visible:outline-none">
              {/* Brand Identity & Logo Card */}
              <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-5">
                <div className="border-b border-border/50 pb-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Store Identity & Branding
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Store name, brand slogan, and official logo displayed on printed invoices and receipts.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                  <div className="md:col-span-2 space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium">Agency / Office Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Artyx Digital HQ" className="pos-input" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="slogan"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium">Store Slogan</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Precision hardware, reliable service"
                              className="pos-input"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-[11px] text-muted-foreground">
                            Sub-heading printed directly beneath the company name on receipts and invoices.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="md:col-span-1 flex flex-col items-center justify-center">
                    <span className="text-xs font-medium text-foreground mb-2 self-start md:self-center">
                      Official Logo
                    </span>
                    <div className="relative group flex flex-col items-center justify-center w-full max-w-[140px] aspect-square rounded-xl border border-dashed border-border/80 hover:border-primary/60 bg-muted/20 transition-all overflow-hidden">
                      {logoPreview ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={logoPreview}
                            alt="Store Logo"
                            className="size-full object-contain p-2.5"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-2">
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="size-8 rounded-lg"
                              onClick={handleRemoveLogo}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="flex flex-col items-center justify-center size-full p-4 text-muted-foreground hover:text-primary transition-colors gap-2 cursor-pointer"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <UploadCloud className="size-7 stroke-[1.5]" />
                          <span className="text-[10px] font-medium text-center">
                            Upload Logo
                          </span>
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-2 text-center">
                      PNG, JPG up to 5MB (auto-compressed)
                    </span>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={handleLogoChange}
                    />
                  </div>
                </div>
              </div>

              {/* Contact & Operating Schedule Card */}
              <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-5">
                <div className="border-b border-border/50 pb-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Contact Details & Store Hours
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Physical location, customer support contacts, and standard operating hours.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">Support Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="admin@artyxdigital.com"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">Contact Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+880 1XXX-XXXXXX" className="pos-input" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">Physical Store Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Shop 12, Level 3, Multiplan Center, Dhaka" className="pos-input" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
                  <FormField
                    control={form.control}
                    name="openTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium font-sans">Opening Time</FormLabel>
                        <FormControl>
                          <Input placeholder="09:00" className="pos-input" {...field} />
                        </FormControl>
                        <p className="text-[10px] text-muted-foreground font-sans">
                          24-hour format (e.g. 09:30)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="closeTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium font-sans">Closing Time</FormLabel>
                        <FormControl>
                          <Input placeholder="20:00" className="pos-input" {...field} />
                        </FormControl>
                        <p className="text-[10px] text-muted-foreground font-sans">
                          24-hour format (e.g. 20:30)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: DOCUMENT TERMS */}
            <TabsContent value="terms" className="space-y-6 pt-1 focus-visible:outline-none">
              <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-4">
                <div className="border-b border-border/50 pb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Document Terms & Conditions Setup
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Legal clauses, refund policies, and agreement terms printed on customer and vendor documents. Each line represents one bullet point.
                  </p>
                </div>

                <Tabs defaultValue="sales" className="w-full">
                  <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto p-1 bg-muted/40 rounded-xl border border-border/60">
                    <TabsTrigger value="sales" className="flex items-center gap-1.5 py-1.5 text-xs font-medium">
                      <ShoppingBag className="w-3.5 h-3.5 text-blue-600" />
                      <span>Sales Invoices</span>
                    </TabsTrigger>
                    <TabsTrigger value="purchase" className="flex items-center gap-1.5 py-1.5 text-xs font-medium">
                      <Truck className="w-3.5 h-3.5 text-amber-600" />
                      <span>Purchases & PO</span>
                    </TabsTrigger>
                    <TabsTrigger value="service" className="flex items-center gap-1.5 py-1.5 text-xs font-medium">
                      <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Service & Repair</span>
                    </TabsTrigger>
                    <TabsTrigger value="warranty" className="flex items-center gap-1.5 py-1.5 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
                      <span>Warranty & RMA</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* Sales Terms Tab */}
                  <TabsContent value="sales" className="space-y-3 pt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/30 border border-border/60 p-2.5 rounded-lg text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[10px] tracking-wider uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Applied In
                        </span>
                        <span className="text-muted-foreground">
                          Sales Invoices, POS Receipts, Delivery Challans, Customer Returns
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          form.setValue('salesTerms', SALES_TERMS_DEFAULT.join('\n'), {
                            shouldDirty: true,
                          })
                        }
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to Default
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="salesTerms"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              rows={7}
                              placeholder={SALES_TERMS_DEFAULT.join('\n')}
                              className="font-mono text-xs leading-relaxed bg-background"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-[11px] text-muted-foreground">
                            Enter one policy statement per line. Empty lines will be omitted in print layouts.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>

                  {/* Purchase Terms Tab */}
                  <TabsContent value="purchase" className="space-y-3 pt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/30 border border-border/60 p-2.5 rounded-lg text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[10px] tracking-wider uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Applied In
                        </span>
                        <span className="text-muted-foreground">
                          Purchase Invoices, Purchase Orders (PO), Supplier Return Slips
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          form.setValue('purchaseTerms', PURCHASE_TERMS_DEFAULT.join('\n'), {
                            shouldDirty: true,
                          })
                        }
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to Default
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="purchaseTerms"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              rows={7}
                              placeholder={PURCHASE_TERMS_DEFAULT.join('\n')}
                              className="font-mono text-xs leading-relaxed bg-background"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-[11px] text-muted-foreground">
                            Enter one procurement clause per line. Displayed on vendor purchase orders and receipts.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>

                  {/* Service Terms Tab */}
                  <TabsContent value="service" className="space-y-3 pt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/30 border border-border/60 p-2.5 rounded-lg text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[10px] tracking-wider uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Applied In
                        </span>
                        <span className="text-muted-foreground">
                          Service Invoices, Repair Job Sheets, Device Delivery Challans
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          form.setValue('serviceTerms', SERVICE_TERMS_DEFAULT.join('\n'), {
                            shouldDirty: true,
                          })
                        }
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to Default
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="serviceTerms"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              rows={7}
                              placeholder={SERVICE_TERMS_DEFAULT.join('\n')}
                              className="font-mono text-xs leading-relaxed bg-background"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-[11px] text-muted-foreground">
                            Enter one service condition per line. Covers customer data liability, diagnostic fees, and device collection.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>

                  {/* Warranty / RMA Terms Tab */}
                  <TabsContent value="warranty" className="space-y-3 pt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/30 border border-border/60 p-2.5 rounded-lg text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[10px] tracking-wider uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Applied In
                        </span>
                        <span className="text-muted-foreground">
                          RMA Intake Tickets, Official Warranty Claim Slips, Replacement Certificates
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          form.setValue('warrantyTerms', WARRANTY_TERMS_DEFAULT.join('\n'), {
                            shouldDirty: true,
                          })
                        }
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to Default
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="warrantyTerms"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              rows={7}
                              placeholder={WARRANTY_TERMS_DEFAULT.join('\n')}
                              className="font-mono text-xs leading-relaxed bg-background"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-[11px] text-muted-foreground">
                            Enter one warranty clause per line. Covers serial verification, void criteria, and RMA turnaround expectations.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </TabsContent>

            {/* TAB 3: POLICIES & GUARDRAILS */}
            <TabsContent value="policies" className="space-y-6 pt-1 focus-visible:outline-none">
              {/* Return & Customer Claims Policy */}
              <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <ReturnIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Customer Returns & Refunds Policy
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Define supervisor authorization limits and allowable return windows for customer claims.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="returnApprovalThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">
                          Manager Approval Threshold (BDT)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="50000"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Refunds exceeding this amount require manager/super-admin PIN approval.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="returnWindowDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">
                          Return Eligibility Window (Days)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="30"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Invoices older than this cannot be refunded by cashiers without administrative authorization.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Discount Limits Settings */}
              <DiscountLimitsCard />

              {/* Push & Financial Alert Thresholds */}
              <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Notification & Operational Alert Thresholds
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Tune automated alert triggers for stock depletion, cash drawer balance variance, and high-value transactions.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="lowStockThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">Low-Stock Alert (Units)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="5"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Triggers replenishment alert when product stock reaches this level.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cashDrawerVarianceThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">Drawer Variance Alert (BDT)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="500"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Alerts when drawer shift closing variance exceeds this threshold.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeSaleThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">High-Value Sale Alert (BDT)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="20000"
                            className="pos-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Alerts management for single invoices exceeding this amount (0 to disable).
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Sticky Bottom Save / Action Bar */}
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border/80 px-4 sm:px-8 py-3 shadow-lg">
            <div className="w-full flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground hidden sm:inline">Active Outlet:</span>
                <span className="font-semibold text-foreground">{outlet.name}</span>
                <Badge variant="outline" className="font-mono text-[10px] hidden sm:inline-flex">
                  {outlet.code}
                </Badge>
                {isFormDirty && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium ml-2">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved changes
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {isFormDirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => form.reset()}
                    disabled={form.formState.isSubmitting}
                  >
                    Discard
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 px-4 text-xs font-medium shadow-xs"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save Settings'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
