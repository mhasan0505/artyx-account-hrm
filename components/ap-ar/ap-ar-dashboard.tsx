'use client'

import React, { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Wallet,
  Building2,
  UserCheck,
  Receipt,
  RefreshCw,
  Calendar,
  CreditCard,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
} from 'lucide-react'
import { ApArOverviewData, getApArOverview } from '@/lib/actions/ap-ar'
import { LiquiditySummary } from './liquidity-summary'
import { ApTable } from './ap-table'
import { ArTable } from './ar-table'
import { VoucherRegister } from './voucher-register'
import { PaymentDialog } from './payment-dialog'
import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  initialData: ApArOverviewData
}

export function ApArDashboard({ initialData }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [data, setData] = useState<ApArOverviewData>(initialData)
  const tabMap: Record<string, string> = {
    payable: 'payables',
    payables: 'payables',
    receivable: 'receivables',
    receivables: 'receivables',
    vouchers: 'vouchers',
    voucher: 'vouchers',
    liquidity: 'liquidity',
  }
  const [activeTab, setActiveTab] = useState(
    initialTab && tabMap[initialTab] ? tabMap[initialTab] : 'liquidity'
  )
  const [dateFilter, setDateFilter] = useState('ALL')
  const [refreshing, setRefreshing] = useState(false)

  const [paymentMode, setPaymentMode] = useState<'SUPPLIER_PAYMENT' | 'CUSTOMER_COLLECTION' | null>(null)
  const [paymentTargetId, setPaymentTargetId] = useState<string | null>(null)
  const [paymentInvoiceOrSaleId, setPaymentInvoiceOrSaleId] = useState<string | null>(null)
  const [paymentDefaultAmount, setPaymentDefaultAmount] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    let startDate: string | undefined
    let endDate: string | undefined

    const now = new Date()
    if (dateFilter === 'TODAY') {
      startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString()
    } else if (dateFilter === 'WEEK') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      startDate = d.toISOString()
    } else if (dateFilter === 'MONTH') {
      const d = new Date()
      d.setDate(1)
      startDate = d.toISOString()
    }

    try {
      const updated = await getApArOverview({ startDate, endDate })
      setData(updated)
    } finally {
      setRefreshing(false)
      router.refresh()
    }
  }

  const openSupplierPayment = (supplierId: string, invoiceId?: string, defaultAmount?: number) => {
    setPaymentMode('SUPPLIER_PAYMENT')
    setPaymentTargetId(supplierId)
    setPaymentInvoiceOrSaleId(invoiceId || null)
    setPaymentDefaultAmount(defaultAmount ?? null)
    setDialogOpen(true)
  }

  const openCustomerCollection = (customerId: string, saleId?: string, defaultAmount?: number) => {
    setPaymentMode('CUSTOMER_COLLECTION')
    setPaymentTargetId(customerId)
    setPaymentInvoiceOrSaleId(saleId || null)
    setPaymentDefaultAmount(defaultAmount ?? null)
    setDialogOpen(true)
  }

  const netPosition = data.receivables.totalOutstanding - data.payables.totalOutstanding

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 sm:p-6 lg:p-8 space-y-7 max-w-[1600px] mx-auto">

        {/* ── Hero Header ── */}
        <div className="relative overflow-hidden surface-card p-6 sm:p-8">
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Title block */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/10 text-primary rounded-xl">
                  <Activity className="w-5 h-5" />
                </div>
                <h1 className="page-title text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-0">
                  Accounts Payable & Receivable
                </h1>
                <Badge className="hidden sm:flex bg-primary/10 text-primary border-primary/20 text-[10px] font-bold uppercase tracking-wider">
                  <Zap className="w-2.5 h-2.5 mr-1" /> Live
                </Badge>
              </div>
              <p className="page-subtitle text-sm text-muted-foreground pl-[52px]">
                Real-time cash flow, supplier dues, customer receivables & voucher management
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-1.5 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <Select value={dateFilter} onValueChange={val => { setDateFilter(val); handleRefresh(); }}>
                  <SelectTrigger className="h-auto border-none shadow-none focus:ring-0 text-xs bg-transparent text-foreground w-28 p-0">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Time</SelectItem>
                    <SelectItem value="TODAY">Today</SelectItem>
                    <SelectItem value="WEEK">Last 7 Days</SelectItem>
                    <SelectItem value="MONTH">This Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleRefresh}
                disabled={refreshing}
                className="gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted border border-border rounded-xl h-9 pressable-subtle"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <Button
                size="sm"
                className="gap-2 text-xs bg-destructive/70 hover:bg-destructive/60 text-white rounded-xl h-9 shadow-sm border-0 font-semibold pressable"
                onClick={() => openSupplierPayment('')}
              >
                <CreditCard className="w-3.5 h-3.5" />
                Pay Supplier
              </Button>

              <Button
                size="sm"
                className="gap-2 text-xs bg-primary/70 hover:bg-primary/60 text-white rounded-xl h-9 shadow-sm border-0 font-semibold pressable"
                onClick={() => openCustomerCollection('')}
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                Collect Due
              </Button>
            </div>
          </div>

          {/* Mini KPI strip inside hero */}
          <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/40 border border-transparent rounded-xl p-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Total Liquid</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-foreground tracking-tight">
                ৳{data.liquidity.netLiquidAssets.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Cash + Bank + MFS</p>
            </div>
            <div className="bg-muted/40 border border-transparent rounded-xl p-3.5">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">Receivables</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-primary tracking-tight">
                ৳{data.receivables.totalOutstanding.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{data.receivables.customersWithBalance} customers</p>
            </div>
            <div className="bg-muted/40 border border-transparent rounded-xl p-3.5">
              <p className="text-[10px] font-semibold text-destructive uppercase tracking-widest mb-1">Payables</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-destructive tracking-tight">
                ৳{data.payables.totalOutstanding.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{data.payables.suppliersWithBalance} suppliers</p>
            </div>
            <div className="bg-muted/40 border border-transparent rounded-xl p-3.5">
              <p className="text-[10px] font-semibold text-foreground uppercase tracking-widest mb-1">Net Position</p>
              <p className={`text-lg font-extrabold font-mono tabular-nums tracking-tight ${netPosition >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {netPosition >= 0 ? '+' : ''}৳{netPosition.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                {netPosition >= 0 ? (
                  <TrendingUp className="w-3 h-3 text-primary" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-destructive" />
                )}
                <p className="text-[10px] text-muted-foreground">AR minus AP</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabbed Content ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <div className="bg-card border border-transparent rounded-2xl p-1.5 shadow-sm">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto gap-1 bg-muted/40">
              <TabsTrigger
                value="liquidity"
                className="group relative gap-2 py-2.5 px-4 text-xs font-semibold rounded-xl data-[state=active]:bg-primary/90 data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground transition-all duration-200"
              >
                <Wallet className="w-4 h-4" />
                <span className="hidden sm:inline">Liquidity & Cash</span>
                <span className="sm:hidden">Cash</span>
              </TabsTrigger>
              <TabsTrigger
                value="payables"
                className="group relative gap-2 py-2.5 px-4 text-xs font-semibold rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground transition-all duration-200"
              >
                <Building2 className="w-4 h-4" />
                <span>Payables</span>
                {data.payables.suppliersWithBalance > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-muted text-muted-foreground group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white">
                    {data.payables.suppliersWithBalance}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="receivables"
                className="group relative gap-2 py-2.5 px-4 text-xs font-semibold rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground transition-all duration-200"
              >
                <UserCheck className="w-4 h-4" />
                <span>Receivables</span>
                {data.receivables.customersWithBalance > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-muted text-muted-foreground group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white">
                    {data.receivables.customersWithBalance}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="vouchers"
                className="group relative gap-2 py-2.5 px-4 text-xs font-semibold rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground transition-all duration-200"
              >
                <Receipt className="w-4 h-4" />
                <span>All Vouchers</span>
                {data.vouchers.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-muted text-muted-foreground group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white">
                    {data.vouchers.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="liquidity" className="space-y-4 mt-0">
            <LiquiditySummary liquidity={data.liquidity} />
          </TabsContent>

          <TabsContent value="payables" className="space-y-4 mt-0">
            <ApTable
              payables={data.payables}
              vouchers={data.vouchers}
              onRecordPayment={openSupplierPayment}
            />
          </TabsContent>

          <TabsContent value="receivables" className="space-y-4 mt-0">
            <ArTable
              receivables={data.receivables}
              vouchers={data.vouchers}
              onReceivePayment={openCustomerCollection}
            />
          </TabsContent>

          <TabsContent value="vouchers" className="space-y-4 mt-0">
            <VoucherRegister
              vouchers={data.vouchers}
              title="All Voucher Register"
              subtitle="Full cross-ledger journal: Payment, Receipt & Contra audit trail"
            />
          </TabsContent>
        </Tabs>

        <PaymentDialog
          mode={paymentMode}
          targetId={paymentTargetId}
          invoiceOrSaleId={paymentInvoiceOrSaleId}
          defaultAmount={paymentDefaultAmount}
          suppliers={data.payables.suppliers}
          customers={data.receivables.customers}
          bankAccounts={data.liquidity.bankAccounts}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={handleRefresh}
        />
      </div>
    </div>
  )
}
