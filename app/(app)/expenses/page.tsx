'use client'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  approveExpense,
  createExpenseCategory,
  createExpense,
  getCustomExpenseCategories,
  getExpenses,
  rejectExpense,
} from '@/lib/actions/finance'
import { getBankAccounts } from '@/lib/actions/bank'
import { getEmployees } from '@/lib/actions/hr'
import { getEmployeeSalaryDetails } from '@/lib/actions/payroll'
import { VoucherPrintModal } from '@/components/ap-ar/voucher-print-modal'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Filter,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react'

type BankAccount = Awaited<ReturnType<typeof getBankAccounts>>[number]
type Expense = Awaited<ReturnType<typeof getExpenses>>[number]
type Employee = Awaited<ReturnType<typeof getEmployees>>[number]
type CustomExpenseCategory = Awaited<ReturnType<typeof getCustomExpenseCategories>>[number]

const EXPENSE_CATEGORIES = [
  { value: 'SaaS_Tools', label: 'SaaS Tools & Cloud (AWS, Vercel, OpenAI, Figma)' },
  { value: 'Contractor_Fees', label: 'Contractor / Freelancer Payouts' },
  { value: 'Client_Ad_Spend', label: 'Client Ad Spend (Meta, Google Ads)' },
  { value: 'Domains_Hosting', label: 'Client Domains & Server Renewals' },
  { value: 'Salary', label: 'Team Salary & Wages' },
  { value: 'Rent', label: 'Office Rent & Facilities' },
  { value: 'Utility', label: 'Electricity, Water & Utilities' },
  { value: 'Internet', label: 'High-Speed Office Internet' },
  { value: 'Transport', label: 'Transport & Client Visits' },
  { value: 'Marketing', label: 'Agency Marketing & Branding' },
  { value: 'Legal_Accounting', label: 'Legal, Audit & Taxes' },
  { value: 'Other', label: 'General / Other Operating Expense' },
] as const

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash Drawer' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD', label: 'Credit/Debit Card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'BKASH', label: 'bKash' },
  { value: 'NAGAD', label: 'Nagad' },
] as const

const statusBadge: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: 'Pending',
    className:
      'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  },
  APPROVED: {
    label: 'Approved',
    className:
      'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  },
  REJECTED: {
    label: 'Rejected',
    className:
      'bg-destructive/10 text-destructive border-destructive/20 dark:bg-destructive/20',
  },
}

function getExpenseCategory(e: Expense): string {
  if (e.account?.code === '5210' || e.description.includes('[Emp:')) return 'Salary'
  if (e.account?.code === '5220') return 'Rent'
  if (e.account?.code === '5230') return 'Utility'
  if (e.account?.code === '5240') return 'Internet'
  if (e.account?.code === '5270') return 'Transport'
  if (e.account?.code === '5280') return 'Maintenance'
  if (e.account?.code === '5260') return 'Marketing'
  if (e.account?.name) {
    const n = e.account.name.toLowerCase()
    if (n.includes('salary') || n.includes('wage')) return 'Salary'
    if (n.includes('rent')) return 'Rent'
    if (n.includes('utilit') || n.includes('electric') || n.includes('water')) return 'Utility'
    if (n.includes('internet') || n.includes('telecom')) return 'Internet'
    if (n.includes('transport') || n.includes('conveyance')) return 'Transport'
    if (n.includes('maintenance') || n.includes('repair')) return 'Maintenance'
    if (n.includes('market') || n.includes('ad')) return 'Marketing'
  }
  return 'Other'
}

function getMethodBadge(method: string | null) {
  switch (method) {
    case 'CASH':
      return {
        label: 'Cash',
        className:
          'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400',
      }
    case 'BANK_TRANSFER':
      return {
        label: 'Bank',
        className:
          'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-400',
      }
    case 'CARD':
      return {
        label: 'Card',
        className:
          'bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-purple-950/40 dark:text-purple-400',
      }
    case 'CHEQUE':
      return {
        label: 'Cheque',
        className:
          'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400',
      }
    case 'BKASH':
      return {
        label: 'bKash',
        className:
          'bg-pink-50 text-pink-700 border-pink-200/80 dark:bg-pink-950/40 dark:text-pink-400',
      }
    case 'NAGAD':
      return {
        label: 'Nagad',
        className:
          'bg-orange-50 text-orange-700 border-orange-200/80 dark:bg-orange-950/40 dark:text-orange-400',
      }
    default:
      return {
        label: method || 'Other',
        className: 'bg-muted text-muted-foreground border-border',
      }
  }
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [customCategories, setCustomCategories] = useState<CustomExpenseCategory[]>([])
  const [outletId, setOutletId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [printVoucher, setPrintVoucher] = useState<any | null>(null)
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Form states
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10))
  const [expCategory, setExpCategory] = useState<string>('Rent')
  const [expCategoryAccountId, setExpCategoryAccountId] = useState('')
  const [expEmployeeId, setExpEmployeeId] = useState<string>('')
  const [expSalaryMonth, setExpSalaryMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [expAmount, setExpAmount] = useState<string>('')
  const [expMethod, setExpMethod] = useState<string>('CASH')
  const [expBankAccountId, setExpBankAccountId] = useState<string>('')
  const [expChequeDate, setExpChequeDate] = useState<string>('')
  const [expNotes, setExpNotes] = useState<string>('')
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  // Live Salary preview states
  const [salaryDetails, setSalaryDetails] = useState<any>(null)
  const [loadingSalaryDetails, setLoadingSalaryDetails] = useState(false)

  // Frequent items
  const FREQUENT_ITEMS_KEY = 'pos-frequent-expense-items'
  const [frequentItems, setFrequentItems] = useState<string[]>([])
  const [selectedFrequentItem, setSelectedFrequentItem] = useState('')
  const [showAddFrequentItem, setShowAddFrequentItem] = useState(false)
  const [newFrequentItem, setNewFrequentItem] = useState('')

  async function loadData(oid: string) {
    if (!oid) return
    const [expList, banks, emps, categories] = await Promise.all([
      getExpenses(oid),
      getBankAccounts(),
      getEmployees(),
      getCustomExpenseCategories(),
    ])
    setExpenses(expList)
    setBankAccounts(banks)
    setEmployees(emps.filter(e => e.isActive))
    setCustomCategories(categories)
  }

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(s => {
        const oid = s?.user?.outletId ?? ''
        setOutletId(oid)
        if (oid) loadData(oid)
      })
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FREQUENT_ITEMS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const sanitized = parsed
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
        setFrequentItems(Array.from(new Set(sanitized)))
      }
    } catch {
      setFrequentItems([])
    }
  }, [])

  function persistFrequentItems(items: string[]) {
    const normalized = Array.from(
      new Set(items.map(item => item.trim()).filter(Boolean))
    )
    setFrequentItems(normalized)
    localStorage.setItem(FREQUENT_ITEMS_KEY, JSON.stringify(normalized))
  }

  function handleAddFrequentItem() {
    const value = newFrequentItem.trim()
    if (!value) {
      toast.error('Enter an item name')
      return
    }
    if (frequentItems.some(item => item.toLowerCase() === value.toLowerCase())) {
      toast.error('This frequent item already exists')
      return
    }

    const updated = [...frequentItems, value]
    persistFrequentItems(updated)
    setExpNotes(value)
    setSelectedFrequentItem(value)
    setNewFrequentItem('')
    setShowAddFrequentItem(false)
    toast.success('Frequent expense item added')
  }

  // Live salary details fetcher when employee or salary month changes
  useEffect(() => {
    if (expCategory !== 'Salary' || !expEmployeeId || !expSalaryMonth) {
      setSalaryDetails(null)
      return
    }

    const [yearStr, monthStr] = expSalaryMonth.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    if (!year || !month) return

    let cancelled = false
    setLoadingSalaryDetails(true)

    getEmployeeSalaryDetails({
      employeeId: expEmployeeId,
      month,
      year,
    })
      .then(res => {
        if (cancelled) return
        setLoadingSalaryDetails(false)
        if (res.success && res.data) {
          setSalaryDetails(res.data)
          // Automatically suggest remaining payable salary if user hasn't typed an amount yet
          if (!expAmount || Number(expAmount) === 0) {
            setExpAmount(res.data.remainingDue > 0 ? String(res.data.remainingDue) : '0')
          }
        } else {
          setSalaryDetails(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingSalaryDetails(false)
          setSalaryDetails(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [expCategory, expEmployeeId, expSalaryMonth])

  function openModal() {
    setExpDate(new Date().toISOString().slice(0, 10))
    setExpCategory('Rent')
    setExpCategoryAccountId('')
    setExpEmployeeId('')
    setExpAmount('')
    setExpMethod('CASH')
    setExpBankAccountId('')
    setExpChequeDate('')
    setExpNotes('')
    setSalaryDetails(null)
    setSelectedFrequentItem('')
    setShowAddCategory(false)
    setNewCategoryName('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
  }

  function handleAddCategory() {
    const name = newCategoryName.trim()
    if (!name) {
      toast.error('Enter a category name')
      return
    }

    startTransition(async () => {
      const res = await createExpenseCategory(name)
      if (!res.success) {
        toast.error(res.error)
        return
      }

      setCustomCategories(current => [...current, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setExpCategory(res.data.name)
      setExpCategoryAccountId(res.data.id)
      setSalaryDetails(null)
      setNewCategoryName('')
      setShowAddCategory(false)
      toast.success('Expense category added')
    })
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()

    const amt = Number(expAmount)
    if (!amt || amt <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    if (expCategory === 'Salary') {
      if (!expEmployeeId) {
        toast.error('Please select an employee for salary expense')
        return
      }
      if (!expSalaryMonth) {
        toast.error('Please select the salary month')
        return
      }
      if (salaryDetails && amt > salaryDetails.remainingDue + 0.01) {
        toast.error(
          `Amount exceeds remaining payable salary (৳${salaryDetails.remainingDue.toLocaleString()})`
        )
        return
      }
    }

    if (expMethod !== 'CASH' && !expBankAccountId) {
      toast.error('Bank/MFS account is required for non-cash payment')
      return
    }

    if (expMethod === 'CHEQUE' && !expChequeDate) {
      toast.error('Cheque maturity date is required for cheque payments')
      return
    }

    startTransition(async () => {
      const res = await createExpense({
        category: expCategory,
        accountId: expCategoryAccountId || undefined,
        employeeId: expCategory === 'Salary' ? expEmployeeId : undefined,
        salaryMonth: expCategory === 'Salary' ? expSalaryMonth : undefined,
        chequeDate: expMethod === 'CHEQUE' ? expChequeDate : undefined,
        description: expNotes || (expCategory === 'Salary' ? 'Staff Salary' : `${expCategory} Expense`),
        amount: amt,
        expenseDate: new Date(expDate),
        outletId,
        method: expMethod as any,
        bankAccountId: expMethod !== 'CASH' ? expBankAccountId : undefined,
      })

      if (!res.success) {
        toast.error(res.error)
        return
      }

      toast.success('Expense recorded successfully')
      closeModal()
      await loadData(outletId)
    })
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const res = await approveExpense(id)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('Expense approved and balance updated')
      await loadData(outletId)
    })
  }

  function handleReject(id: string) {
    startTransition(async () => {
      const res = await rejectExpense(id)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('Expense rejected')
      await loadData(outletId)
    })
  }

  // Quick Date Preset Shortcuts
  function setDatePreset(type: 'TODAY' | 'THIS_MONTH' | 'ALL') {
    if (type === 'TODAY') {
      const today = new Date().toISOString().slice(0, 10)
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'THIS_MONTH') {
      const now = new Date()
      const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      setDateFrom(first)
      setDateTo(last)
    } else {
      setDateFrom('')
      setDateTo('')
      setCategoryFilter('ALL')
      setSearchQuery('')
    }
  }

  // Filtered expenses calculation
  const filteredExpenses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0
    let toTime = Infinity
    if (dateTo) {
      const d = new Date(dateTo)
      d.setHours(23, 59, 59, 999)
      toTime = d.getTime()
    }

    return expenses.filter(item => {
      const cat = getExpenseCategory(item)
      if (categoryFilter !== 'ALL' && cat.toLowerCase() !== categoryFilter.toLowerCase()) {
        return false
      }

      const desc = item.description.toLowerCase()
      const id = item.id.toLowerCase()
      const matchesSearch = !q || cat.toLowerCase().includes(q) || desc.includes(q) || id.includes(q)

      const itemTime = new Date(item.expenseDate).getTime()
      const matchesDate = itemTime >= fromTime && itemTime <= toTime

      return matchesSearch && matchesDate
    })
  }, [expenses, searchQuery, categoryFilter, dateFrom, dateTo])

  // Metric aggregates
  const metrics = useMemo(() => {
    let total = 0
    let approved = 0
    let pending = 0
    let pendingCount = 0
    let thisMonth = 0

    const now = new Date()
    const curMonth = now.getMonth()
    const curYear = now.getFullYear()

    for (const e of filteredExpenses) {
      const amt = Number(e.amount)
      total += amt

      if (e.status === 'APPROVED') {
        approved += amt
      } else if (e.status === 'PENDING') {
        pending += amt
        pendingCount++
      }

      const d = new Date(e.expenseDate)
      if (d.getMonth() === curMonth && d.getFullYear() === curYear) {
        thisMonth += amt
      }
    }

    return { total, approved, pending, pendingCount, thisMonth }
  }, [filteredExpenses])

  const isFiltered = Boolean(searchQuery || categoryFilter !== 'ALL' || dateFrom || dateTo)

  return (
    <div className="w-full space-y-5">
      {/* Page Header with Breadcrumbs & Action Button */}
      <PageHeader
        title="Expense Master"
        description="Track operating expenses, office bills, and employee salaries with live payroll and general ledger synchronization."
        action={
          <Button onClick={openModal} className="pressable gap-2 shadow-xs">
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        }
      />

      {/* Sleek KPI Summary Metric Cards (Full Width 4-Card Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-xs border bg-card/80 transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Expenses
              </p>
              <div className="text-2xl font-bold tracking-tight text-foreground mt-1">
                ৳{metrics.total.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filteredExpenses.length} {filteredExpenses.length === 1 ? 'entry' : 'entries'}{' '}
                {isFiltered && <span className="text-primary font-medium">(Filtered)</span>}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border bg-card/80 transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                This Month Outflow
              </p>
              <div className="text-2xl font-bold tracking-tight text-foreground mt-1">
                ৳{metrics.thisMonth.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Current billing cycle
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border bg-card/80 transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Approved & Cleared
              </p>
              <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-1">
                ৳{metrics.approved.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Paid from Drawer / Bank
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border bg-card/80 transition-all hover:shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pending Approval
              </p>
              <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 mt-1">
                ৳{metrics.pending.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {metrics.pendingCount} awaiting approval
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Toolbar (Clean Full-Width Bar) */}
      <div className="rounded-xl border bg-card p-3 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search Box */}
          <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search category, notes, ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background pl-8.5 pr-8 text-xs outline-none transition-colors focus:border-primary shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium outline-none focus:border-primary shadow-2xs"
          >
            <option value="ALL">All Categories</option>
            {EXPENSE_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1 text-xs shadow-2xs">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground text-[11px] font-medium">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border-none bg-transparent text-xs outline-none cursor-pointer p-0"
            />
            <span className="text-muted-foreground text-[11px] font-medium ml-1">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border-none bg-transparent text-xs outline-none cursor-pointer p-0"
            />
          </div>
        </div>

        {/* Quick Date Presets & Reset */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDatePreset('TODAY')}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDatePreset('THIS_MONTH')}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            This Month
          </Button>
          {isFiltered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDatePreset('ALL')}
              className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 gap-1"
              title="Reset all filters"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Full-Width Expenses Table */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 uppercase tracking-wider text-[11px] text-muted-foreground font-semibold">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Expense ID</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Description / Notes</th>
                <th className="px-4 py-3 text-left">Payment Method</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8">
                    <EmptyState
                      icon={Receipt}
                      title="No expenses found"
                      description={
                        isFiltered
                          ? 'No expense records match your active search or date filters.'
                          : 'No expenses have been recorded yet. Click below to add your first expense.'
                      }
                      action={
                        isFiltered
                          ? {
                              label: 'Clear Filters',
                              onClick: () => setDatePreset('ALL'),
                              variant: 'outline',
                            }
                          : {
                              label: 'Add Expense',
                              onClick: openModal,
                              variant: 'default',
                            }
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(item => {
                  const category = getExpenseCategory(item)
                  const dateObj = new Date(item.expenseDate)
                  const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(
                    dateObj.getMonth() + 1
                  ).padStart(2, '0')}/${dateObj.getFullYear()}`
                  const methodBadge = getMethodBadge(item.method)
                  const statusInfo = statusBadge[item.status] || {
                    label: item.status,
                    className: 'bg-muted text-muted-foreground border-border',
                  }
                  const displayId = `EXP-${item.id.slice(-6).toUpperCase()}`

                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {formattedDate}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-muted-foreground whitespace-nowrap">
                        {displayId}
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {category === 'Salary' ? (
                            <span className="h-5 px-2 rounded-md bg-primary/10 text-primary flex items-center gap-1 text-[11px]">
                              <User className="h-3 w-3" />
                              Salary
                            </span>
                          ) : (
                            <span className="text-foreground">{category}</span>
                          )}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-muted-foreground max-w-[320px] truncate"
                        title={item.description}
                      >
                        {item.description || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${methodBadge.className}`}
                        >
                          {methodBadge.label}
                        </span>
                        {item.bankAccount && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5 truncate max-w-[150px]">
                            {item.bankAccount.bankName}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-destructive whitespace-nowrap text-sm">
                        -৳{Number(item.amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${statusInfo.className}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {item.status === 'PENDING' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs text-primary border-primary/30 hover:bg-primary/10 transition-all active:scale-95"
                              onClick={() => handleApprove(item.id)}
                              disabled={isPending}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 transition-all active:scale-95"
                              onClick={() => handleReject(item.id)}
                              disabled={isPending}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-[11px] text-muted-foreground italic">
                              {item.status === 'APPROVED' ? 'Cleared' : 'Rejected'}
                            </span>
                            {item.status === 'APPROVED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs gap-1 border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                                onClick={() => {
                                  setPrintVoucher({
                                    voucherNumber: `EXP-${item.id.slice(-6).toUpperCase()}`,
                                    voucherType: 'EXPENSE',
                                    date: item.expenseDate,
                                    partyName: item.account?.name || getExpenseCategory(item),
                                    accountName: item.bankAccount
                                      ? `${item.bankAccount.bankName} - ${item.bankAccount.accountName}`
                                      : 'Cash Drawer',
                                    method: item.method || 'CASH',
                                    amount: Number(item.amount),
                                    description: item.description,
                                    createdByName: item.createdBy?.name || 'Authorized User',
                                  })
                                  setPrintModalOpen(true)
                                }}
                              >
                                <Receipt className="size-3 text-slate-500" />
                                <span>Voucher</span>
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD EXPENSE MODAL (Clean Dialog matching Expanse.html with Live Salary Sync) */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="relative w-full max-w-[500px] rounded-xl border bg-card p-6 shadow-xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            <button
              onClick={closeModal}
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-5">
              <h2 className="text-base font-bold text-foreground">Add New Expense</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Record general operating expenses or employee salary with live payroll sync.
              </p>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Date</Label>
                  <Input
                    type="date"
                    required
                    value={expDate}
                    onChange={e => setExpDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">Category</Label>
                    <button
                      type="button"
                      onClick={() => setShowAddCategory(current => !current)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      <Plus className="size-3" />
                      Add category
                    </button>
                  </div>
                  <select
                    value={expCategory}
                    onChange={e => {
                      setExpCategory(e.target.value)
                      setExpCategoryAccountId(
                        customCategories.find(category => category.name === e.target.value)?.id || ''
                      )
                      if (e.target.value !== 'Salary') {
                        setSalaryDetails(null)
                      }
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                    required
                  >
                    {EXPENSE_CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                    {customCategories.map(category => (
                      <option key={category.id} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {showAddCategory && (
                    <div className="flex gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2">
                      <Input
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddCategory()
                          }
                        }}
                        placeholder="Category name"
                        className="h-8 text-xs"
                        maxLength={80}
                        autoFocus
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={handleAddCategory}
                        disabled={isPending}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* DYNAMIC EMPLOYEE SALARY FIELDS (Shown when Category === 'Salary') */}
              {expCategory === 'Salary' && (
                <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3.5 space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      Employee Salary Details
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-muted-foreground">
                        Select Employee
                      </Label>
                      <select
                        value={expEmployeeId}
                        onChange={e => setExpEmployeeId(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                        required={expCategory === 'Salary'}
                      >
                        <option value="">-- Choose Employee --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} ({emp.employeeCode || `EMP-${emp.id.slice(-4)}`})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-muted-foreground">
                        Salary Month
                      </Label>
                      <input
                        type="month"
                        value={expSalaryMonth}
                        onChange={e => setExpSalaryMonth(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none"
                        required={expCategory === 'Salary'}
                      />
                    </div>
                  </div>

                  {/* LIVE PAYROLL BREAKDOWN BANNER */}
                  {loadingSalaryDetails ? (
                    <div className="flex items-center justify-center py-3 text-xs text-muted-foreground gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                      Calculating net payable, advances & deductions...
                    </div>
                  ) : salaryDetails ? (
                    <div className="rounded-md border bg-background/80 p-2.5 text-xs space-y-1.5 shadow-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Basic Salary:</span>
                        <span className="font-mono font-medium text-foreground">
                          ৳{salaryDetails.baseSalary.toLocaleString('en-IN')}
                        </span>
                      </div>
                      {salaryDetails.deductions > 0 && (
                        <div className="flex justify-between text-destructive">
                          <span>Absence / Deductions:</span>
                          <span className="font-mono font-medium">
                            -৳{salaryDetails.deductions.toLocaleString('en-IN')}
                          </span>
                        </div>
                      )}
                      {salaryDetails.advanceRecovered > 0 && (
                        <div className="flex justify-between text-amber-600 dark:text-amber-400">
                          <span>Advance Recovery:</span>
                          <span className="font-mono font-medium">
                            -৳{salaryDetails.advanceRecovered.toLocaleString('en-IN')}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-1 font-semibold text-foreground">
                        <span>Net Payable:</span>
                        <span className="font-mono">
                          ৳{salaryDetails.netPayable.toLocaleString('en-IN')}
                        </span>
                      </div>
                      {salaryDetails.paidAmount > 0 && (
                        <div className="flex justify-between text-muted-foreground text-[11px]">
                          <span>Already Paid:</span>
                          <span className="font-mono">
                            ৳{salaryDetails.paidAmount.toLocaleString('en-IN')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t pt-1 font-bold">
                        <span className="text-primary">Remaining Due:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-emerald-600 dark:text-emerald-400">
                            ৳{salaryDetails.remainingDue.toLocaleString('en-IN')}
                          </span>
                          {salaryDetails.remainingDue > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpAmount(String(salaryDetails.remainingDue))}
                              className="text-[10px] text-primary hover:underline font-semibold"
                            >
                              Pay Full
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : expEmployeeId ? (
                    <div className="text-[11px] text-muted-foreground italic text-center py-1">
                      No active payroll records found for this employee/month.
                    </div>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Amount (BDT)</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={expAmount}
                    onChange={e => setExpAmount(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Payment Method</Label>
                  <select
                    value={expMethod}
                    onChange={e => {
                      setExpMethod(e.target.value)
                      if (e.target.value === 'CASH') {
                        setExpBankAccountId('')
                        setExpChequeDate('')
                      }
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                    required
                  >
                    {PAYMENT_METHODS.map(m => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DYNAMIC CHEQUE FIELD (Shown when expMethod === 'CHEQUE') */}
              {expMethod === 'CHEQUE' && (
                <div className="rounded-md border border-dashed border-amber-400 bg-amber-500/10 p-3 space-y-1.5">
                  <Label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Cheque Maturity Date
                  </Label>
                  <Input
                    type="date"
                    required={expMethod === 'CHEQUE'}
                    value={expChequeDate}
                    onChange={e => setExpChequeDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              )}

              {/* BANK ACCOUNT SELECTION (Shown when payment is not CASH) */}
              {expMethod !== 'CASH' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Select Bank/MFS Account</Label>
                  <select
                    value={expBankAccountId}
                    onChange={e => setExpBankAccountId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                    required={expMethod !== 'CASH'}
                  >
                    <option value="">-- Choose Account --</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} - {b.accountName} (৳{Number(b.currentBalance).toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Frequent Items Shortcut */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Description / Notes</Label>
                  {frequentItems.length > 0 && (
                    <select
                      value={selectedFrequentItem}
                      onChange={e => {
                        const val = e.target.value
                        setSelectedFrequentItem(val)
                        if (val) setExpNotes(val)
                      }}
                      className="text-[11px] border border-input rounded px-1.5 py-0.5 bg-background text-muted-foreground"
                    >
                      <option value="">Quick Presets</option>
                      {frequentItems.map(item => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  value={expNotes}
                  onChange={e => {
                    setExpNotes(e.target.value)
                    setSelectedFrequentItem('')
                  }}
                  placeholder={
                    expCategory === 'Salary'
                      ? 'e.g. October Staff Salary or bonus'
                      : 'Details about this expense...'
                  }
                  rows={2}
                  className="w-full rounded-md border border-input bg-background p-2.5 text-xs outline-none focus:border-primary transition-colors resize-none"
                />
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeModal}
                  disabled={isPending}
                  className="h-9 px-4 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-9 px-5 text-xs font-semibold pressable"
                >
                  {isPending ? 'Saving Expense…' : 'Save Expense'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Voucher Print Modal */}
      <VoucherPrintModal
        voucher={printVoucher}
        open={printModalOpen}
        onOpenChange={setPrintModalOpen}
      />
    </div>
  )
}
