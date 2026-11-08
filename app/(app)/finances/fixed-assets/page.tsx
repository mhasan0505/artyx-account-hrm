'use client'

import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createFixedAsset,
  deleteFixedAsset,
  FixedAssetValuation,
  getFixedAssetsAction,
  getFixedAssetsFundingOptions,
  updateFixedAsset,
} from '@/lib/actions/fixed-assets'
import { AssetCategory, FundingSource } from '@/types/enums'
import {
  Building2,
  DollarSign,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

function fmt(amount: number) {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  FURNITURE: 'Furniture',
  EQUIPMENT: 'Equipment',
  OFFICE_DEPOSIT: 'Office Deposit',
  INVESTMENT: 'Investment',
  OTHER: 'Other',
}

const CATEGORY_BADGE_VARIANTS: Record<AssetCategory, string> = {
  FURNITURE: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  EQUIPMENT: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300',
  OFFICE_DEPOSIT: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  INVESTMENT: 'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-300',
  OTHER: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAssetValuation[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Filter & Search states
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [selectedFunding, setSelectedFunding] = useState<string>('ALL')
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10))

  // Modal / Form state (Add)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [fundingOptions, setFundingOptions] = useState<{
    bankAccounts: { id: string; accountName: string; bankName: string; currentBalance: number }[]
    openDrawer: { id: string; openedAt: Date; balance: number } | null
  } | null>(null)

  // Form Fields (Add)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<AssetCategory>(AssetCategory.FURNITURE)
  const [acquisitionCost, setAcquisitionCost] = useState<string>('')
  const [acquisitionDate, setAcquisitionDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [depreciable, setDepreciable] = useState(true)
  const [usefulLifeYears, setUsefulLifeYears] = useState<string>('5')
  const [salvageValue, setSalvageValue] = useState<string>('0')
  const [fundingSource, setFundingSource] = useState<FundingSource>(FundingSource.HISTORICAL)
  const [fundingAccountType, setFundingAccountType] = useState<'DRAWER' | 'BANK'>('BANK')
  const [selectedBankId, setSelectedBankId] = useState<string>('')

  // Edit Modal State
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<FixedAssetValuation | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState<AssetCategory>(AssetCategory.FURNITURE)
  const [editCost, setEditCost] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editDepreciable, setEditDepreciable] = useState(true)
  const [editUsefulLife, setEditUsefulLife] = useState('5')
  const [editSalvage, setEditSalvage] = useState('0')

  // Delete Modal State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [deletingAsset, setDeletingAsset] = useState<FixedAssetValuation | null>(null)

  // Load assets & funding options
  const loadData = useCallback(() => {
    setLoading(true)
    startTransition(async () => {
      const res = await getFixedAssetsAction(asOfDate)
      if (res.success) {
        setAssets(res.data)
      } else {
        toast.error(res.error || 'Failed to load fixed assets')
      }
      setLoading(false)
    })
  }, [asOfDate])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Open add modal and load funding sources
  async function handleOpenAddModal() {
    setIsAddOpen(true)
    const optionsRes = await getFixedAssetsFundingOptions()
    if (optionsRes.success) {
      setFundingOptions(optionsRes.data)
      if (optionsRes.data.bankAccounts.length > 0) {
        setSelectedBankId(optionsRes.data.bankAccounts[0].id)
      }
    } else {
      toast.error('Failed to load funding accounts')
    }
  }

  // Handle Category change & update smart defaults for depreciable
  function handleCategoryChange(newCategory: AssetCategory) {
    setCategory(newCategory)
    if (newCategory === AssetCategory.OFFICE_DEPOSIT || newCategory === AssetCategory.INVESTMENT) {
      setDepreciable(false)
    } else if (newCategory === AssetCategory.FURNITURE || newCategory === AssetCategory.EQUIPMENT) {
      setDepreciable(true)
    }
  }

  // Form Submit (Add)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Asset name is required')
      return
    }

    const costNum = parseFloat(acquisitionCost)
    if (isNaN(costNum) || costNum <= 0) {
      toast.error('Acquisition cost must be a positive number')
      return
    }

    let lifeNum: number | undefined = undefined
    if (depreciable) {
      lifeNum = parseInt(usefulLifeYears, 10)
      if (isNaN(lifeNum) || lifeNum < 1) {
        toast.error('Useful life must be at least 1 year')
        return
      }
    }

    const salvageNum = parseFloat(salvageValue) || 0

    let bankAccountId: string | undefined = undefined
    let drawerId: string | undefined = undefined

    if (fundingSource === FundingSource.NEW_PURCHASE) {
      if (fundingAccountType === 'BANK') {
        if (!selectedBankId) {
          toast.error('Please select a bank account for payment')
          return
        }
        bankAccountId = selectedBankId
        const bankAcc = fundingOptions?.bankAccounts.find(b => b.id === selectedBankId)
        if (bankAcc && bankAcc.currentBalance < costNum) {
          toast.error(`Insufficient bank balance. Available: ${fmt(bankAcc.currentBalance)}`)
          return
        }
      } else {
        if (!fundingOptions?.openDrawer) {
          toast.error('No open cash drawer available for cash purchase')
          return
        }
        drawerId = fundingOptions.openDrawer.id
        if (fundingOptions.openDrawer.balance < costNum) {
          toast.error(`Insufficient cash in drawer. Available: ${fmt(fundingOptions.openDrawer.balance)}`)
          return
        }
      }
    }

    startTransition(async () => {
      const res = await createFixedAsset({
        name: name.trim(),
        category,
        acquisitionCost: costNum,
        acquisitionDate: new Date(acquisitionDate),
        depreciable,
        usefulLifeYears: depreciable ? lifeNum : undefined,
        salvageValue: depreciable ? salvageNum : 0,
        fundingSource,
        bankAccountId,
        drawerId,
      })

      if (!res.success) {
        toast.error(res.error || 'Failed to create fixed asset')
        return
      }

      toast.success(
        `Fixed asset "${res.data.name}" added successfully! Book Value: ${fmt(Number(res.data.acquisitionCost))}`
      )
      setIsAddOpen(false)
      setName('')
      setAcquisitionCost('')
      loadData()
    })
  }

  // Open Edit Modal
  function handleOpenEdit(asset: FixedAssetValuation) {
    setEditingAsset(asset)
    setEditName(asset.name)
    setEditCategory(asset.category as AssetCategory)
    setEditCost(asset.acquisitionCost.toString())
    setEditDate(new Date(asset.acquisitionDate).toISOString().slice(0, 10))
    setEditDepreciable(asset.depreciable)
    setEditUsefulLife(asset.usefulLifeYears ? asset.usefulLifeYears.toString() : '5')
    setEditSalvage(asset.salvageValue.toString())
    setIsEditOpen(true)
  }

  // Edit Submit
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingAsset) return

    if (!editName.trim()) {
      toast.error('Asset name is required')
      return
    }

    const costNum = parseFloat(editCost)
    if (isNaN(costNum) || costNum <= 0) {
      toast.error('Acquisition cost must be a positive number')
      return
    }

    let lifeNum: number | undefined = undefined
    if (editDepreciable) {
      lifeNum = parseInt(editUsefulLife, 10)
      if (isNaN(lifeNum) || lifeNum < 1) {
        toast.error('Useful life must be at least 1 year')
        return
      }
    }

    const salvageNum = parseFloat(editSalvage) || 0

    startTransition(async () => {
      const res = await updateFixedAsset(editingAsset.id, {
        name: editName.trim(),
        category: editCategory,
        acquisitionCost: costNum,
        acquisitionDate: new Date(editDate),
        depreciable: editDepreciable,
        usefulLifeYears: editDepreciable ? lifeNum : undefined,
        salvageValue: editDepreciable ? salvageNum : 0,
      })

      if (!res.success) {
        toast.error(res.error || 'Failed to update fixed asset')
        return
      }

      toast.success(`Fixed asset "${res.data.name}" updated successfully!`)
      setIsEditOpen(false)
      setEditingAsset(null)
      loadData()
    })
  }

  // Open Delete Dialog
  function handleOpenDelete(asset: FixedAssetValuation) {
    setDeletingAsset(asset)
    setIsDeleteOpen(true)
  }

  // Confirm Delete
  async function handleConfirmDelete() {
    if (!deletingAsset) return

    startTransition(async () => {
      const res = await deleteFixedAsset(deletingAsset.id)
      if (!res.success) {
        toast.error(res.error || 'Failed to delete fixed asset')
        return
      }

      toast.success(`Fixed asset "${deletingAsset.name}" deleted successfully!`)
      setIsDeleteOpen(false)
      setDeletingAsset(null)
      loadData()
    })
  }

  // Filtered Assets List
  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      const matchesSearch = asset.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCat = selectedCategory === 'ALL' || asset.category === selectedCategory
      const matchesFunding = selectedFunding === 'ALL' || asset.fundingSource === selectedFunding
      return matchesSearch && matchesCat && matchesFunding
    })
  }, [assets, searchTerm, selectedCategory, selectedFunding])

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalCount = filteredAssets.length
    const grossCost = filteredAssets.reduce((sum, a) => sum + a.acquisitionCost, 0)
    const accDep = filteredAssets.reduce((sum, a) => sum + a.accumulatedDepreciation, 0)
    const netBookValue = filteredAssets.reduce((sum, a) => sum + a.bookValue, 0)
    return { totalCount, grossCost, accDep, netBookValue }
  }, [filteredAssets])

  return (
    <div className="container mx-auto space-y-6 pb-12">
      <PageHeader
        title="Fixed Assets Management"
        description="Track capital assets, historical valuations, depreciation, and acquisition funding."
        action={
          <Button onClick={handleOpenAddModal} className="bg-primary shadow-sm hover:shadow">
            <Plus className="mr-2 h-4 w-4" />
            Add Fixed Asset
          </Button>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-5 dark:border-sky-900/50 dark:bg-sky-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400">
              Total Assets
            </span>
            <Building2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono text-sky-900 dark:text-sky-100">
            {metrics.totalCount} <span className="text-sm font-normal text-muted-foreground">Items</span>
          </p>
          <p className="mt-1 text-xs text-sky-600/80 dark:text-sky-400/80">Registered Fixed Assets</p>
        </div>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900/50 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
              Gross Acquisition Cost
            </span>
            <DollarSign className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono text-indigo-900 dark:text-indigo-100">
            {fmt(metrics.grossCost)}
          </p>
          <p className="mt-1 text-xs text-indigo-600/80 dark:text-indigo-400/80">Original Purchase Value</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Accumulated Depreciation
            </span>
            <TrendingDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono text-amber-900 dark:text-amber-100">
            {fmt(metrics.accDep)}
          </p>
          <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-400/80">Total Straight-Line Expense</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Net Book Value
            </span>
            <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono text-emerald-900 dark:text-emerald-100">
            {fmt(metrics.netBookValue)}
          </p>
          <p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">Gross Cost - Depreciation</p>
        </div>
      </div>

      {/* Filter and Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>

          <div className="w-48">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([catKey, label]) => (
                  <SelectItem key={catKey} value={catKey}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <Select value={selectedFunding} onValueChange={setSelectedFunding}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Funding Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sources</SelectItem>
                <SelectItem value="HISTORICAL">Historical</SelectItem>
                <SelectItem value="NEW_PURCHASE">New Purchase</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="valuationDate" className="text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">
              As Of:
            </Label>
            <Input
              id="valuationDate"
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="w-40 font-mono text-sm"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadData}
            disabled={loading || isPending}
            aria-label="Reload fixed assets"
          >
            <RefreshCw className={`h-4 w-4 ${loading || isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Assets Table */}
      <div className="surface-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-bold">Asset Name</TableHead>
              <TableHead className="font-bold">Category</TableHead>
              <TableHead className="font-bold">Acquisition Date</TableHead>
              <TableHead className="font-bold text-right">Gross Cost</TableHead>
              <TableHead className="font-bold text-right">Acc. Depreciation</TableHead>
              <TableHead className="font-bold text-right">Net Book Value</TableHead>
              <TableHead className="font-bold text-center">Status / Terms</TableHead>
              <TableHead className="font-bold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Loading fixed assets...
                </TableCell>
              </TableRow>
            ) : filteredAssets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No fixed assets found.
                </TableCell>
              </TableRow>
            ) : (
              filteredAssets.map(asset => (
                <TableRow key={asset.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-semibold text-foreground">{asset.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${CATEGORY_BADGE_VARIANTS[asset.category as AssetCategory] || ''}`}
                    >
                      {CATEGORY_LABELS[asset.category as AssetCategory] || asset.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {formatDate(asset.acquisitionDate)}
                  </TableCell>
                  <TableCell className="font-mono text-right font-medium">{fmt(asset.acquisitionCost)}</TableCell>
                  <TableCell className="font-mono text-right text-rose-600 dark:text-rose-400">
                    {asset.accumulatedDepreciation > 0 ? `- ${fmt(asset.accumulatedDepreciation)}` : '৳0.00'}
                  </TableCell>
                  <TableCell className="font-mono text-right font-bold text-emerald-600 dark:text-emerald-400">
                    {fmt(asset.bookValue)}
                  </TableCell>
                  <TableCell className="text-center">
                    {asset.depreciable ? (
                      <span className="inline-flex items-center text-xs text-muted-foreground font-mono">
                        {asset.usefulLifeYears} yrs (salvage {fmt(asset.salvageValue)})
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Non-Depreciable</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(asset)}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Edit Asset"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDelete(asset)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete Asset"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Asset Dialog Modal */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-135">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Building2 className="h-5 w-5 text-primary" />
              Add Fixed Asset
            </DialogTitle>
            <DialogDescription>
              Record a new capital asset or register historical valuation into the ledger.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="asset-name" className="text-xs font-semibold uppercase">
                  Asset Name *
                </Label>
                <Input
                  id="asset-name"
                  placeholder="e.g. Office Air Conditioner 2-Ton"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase">Category *</Label>
                <Select
                  value={category}
                  onValueChange={val => handleCategoryChange(val as AssetCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([catKey, label]) => (
                      <SelectItem key={catKey} value={catKey}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cost" className="text-xs font-semibold uppercase">
                  Acquisition Cost (BDT) *
                </Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={acquisitionCost}
                  onChange={e => setAcquisitionCost(e.target.value)}
                  className="font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="acq-date" className="text-xs font-semibold uppercase">
                  Acquisition Date *
                </Label>
                <Input
                  id="acq-date"
                  type="date"
                  value={acquisitionDate}
                  onChange={e => setAcquisitionDate(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase">Funding Source *</Label>
                <Select
                  value={fundingSource}
                  onValueChange={val => setFundingSource(val as FundingSource)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FundingSource.HISTORICAL}>
                      Historical Asset (Offsets Opening Balance Equity)
                    </SelectItem>
                    <SelectItem value={FundingSource.NEW_PURCHASE}>
                      New Purchase (Outflow from Cash / Bank)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* If New Purchase selected, show Cash/Bank Selector */}
            {fundingSource === FundingSource.NEW_PURCHASE && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <Label className="text-xs font-semibold uppercase text-primary">
                  Select Payment Outflow Account *
                </Label>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fundingAccountType"
                      checked={fundingAccountType === 'BANK'}
                      onChange={() => setFundingAccountType('BANK')}
                      className="accent-primary"
                    />
                    <Landmark className="h-4 w-4 text-muted-foreground" />
                    <span>Bank Account</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fundingAccountType"
                      checked={fundingAccountType === 'DRAWER'}
                      onChange={() => setFundingAccountType('DRAWER')}
                      className="accent-primary"
                    />
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <span>Cash Drawer</span>
                  </label>
                </div>

                {fundingAccountType === 'BANK' ? (
                  <div className="space-y-1">
                    <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                      <SelectTrigger className="bg-background text-sm">
                        <SelectValue placeholder="Select bank account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {fundingOptions?.bankAccounts.map(b => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.bankName} - {b.accountName} (Balance: {fmt(b.currentBalance)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground bg-background p-2.5 rounded border">
                    {fundingOptions?.openDrawer ? (
                      <div className="flex items-center justify-between">
                        <span>Active Cash Drawer</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          Available: {fmt(fundingOptions.openDrawer.balance)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-rose-600 font-medium">
                        No active cash drawer open for your outlet.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Depreciable Toggle & Options */}
            <div className="rounded-lg border p-4 space-y-4 bg-card">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">Depreciable Asset</Label>
                  <p className="text-xs text-muted-foreground">
                    Apply straight-line depreciation over useful life
                  </p>
                </div>
                <Switch checked={depreciable} onCheckedChange={setDepreciable} />
              </div>

              {depreciable && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="space-y-1.5">
                    <Label htmlFor="useful-life" className="text-xs font-semibold uppercase">
                      Useful Life (Years) *
                    </Label>
                    <Input
                      id="useful-life"
                      type="number"
                      min="1"
                      max="50"
                      value={usefulLifeYears}
                      onChange={e => setUsefulLifeYears(e.target.value)}
                      className="font-mono"
                      required={depreciable}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="salvage-val" className="text-xs font-semibold uppercase">
                      Salvage Value (BDT)
                    </Label>
                    <Input
                      id="salvage-val"
                      type="number"
                      step="0.01"
                      value={salvageValue}
                      onChange={e => setSalvageValue(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving Asset...' : 'Save Fixed Asset'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Asset Dialog Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-135">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Fixed Asset
            </DialogTitle>
            <DialogDescription>
              Update valuation, acquisition date, or depreciation parameters for this asset.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-asset-name" className="text-xs font-semibold uppercase">
                  Asset Name *
                </Label>
                <Input
                  id="edit-asset-name"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase">Category *</Label>
                <Select
                  value={editCategory}
                  onValueChange={val => setEditCategory(val as AssetCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([catKey, label]) => (
                      <SelectItem key={catKey} value={catKey}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cost" className="text-xs font-semibold uppercase">
                  Acquisition Cost (BDT) *
                </Label>
                <Input
                  id="edit-cost"
                  type="number"
                  step="0.01"
                  value={editCost}
                  onChange={e => setEditCost(e.target.value)}
                  className="font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-acq-date" className="text-xs font-semibold uppercase">
                  Acquisition Date *
                </Label>
                <Input
                  id="edit-acq-date"
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
              </div>
            </div>

            {/* Depreciable Toggle & Options */}
            <div className="rounded-lg border p-4 space-y-4 bg-card">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">Depreciable Asset</Label>
                  <p className="text-xs text-muted-foreground">
                    Apply straight-line depreciation over useful life
                  </p>
                </div>
                <Switch checked={editDepreciable} onCheckedChange={setEditDepreciable} />
              </div>

              {editDepreciable && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-useful-life" className="text-xs font-semibold uppercase">
                      Useful Life (Years) *
                    </Label>
                    <Input
                      id="edit-useful-life"
                      type="number"
                      min="1"
                      max="50"
                      value={editUsefulLife}
                      onChange={e => setEditUsefulLife(e.target.value)}
                      className="font-mono"
                      required={editDepreciable}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-salvage-val" className="text-xs font-semibold uppercase">
                      Salvage Value (BDT)
                    </Label>
                    <Input
                      id="edit-salvage-val"
                      type="number"
                      step="0.01"
                      value={editSalvage}
                      onChange={e => setEditSalvage(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Updating...' : 'Update Asset'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Asset Dialog Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-105">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5" />
              Delete Fixed Asset
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete asset <strong className="text-foreground">"{deletingAsset?.name}"</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            This action will permanently remove this asset record and reverse any historical opening balance equity ledger entries tied to it.
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isPending}
            >
              {isPending ? 'Deleting...' : 'Delete Asset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
