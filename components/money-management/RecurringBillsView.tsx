'use client';

import React, { useState } from 'react';
import {
  CalendarClock,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  Trash2,
  Edit2,
} from 'lucide-react';
import { FinanceData, RecurringBill } from '@/lib/money-management/types';
import { formatCurrency } from '@/lib/money-management/utils';
import { DEFAULT_CATEGORIES, CategoryDefinition } from '@/lib/money-management/constants';
import { CategoryIcon } from './CategoryIcon';
import { CreateCategoryModal } from './CreateCategoryModal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RecurringBillsViewProps {
  data: FinanceData;
  onSaveBill: (bill: RecurringBill) => void;
  onDeleteBill: (billId: string) => void;
  onMarkPaid: (bill: RecurringBill) => void;
  onSaveCategory?: (category: CategoryDefinition) => void;
}

export function RecurringBillsView({
  data,
  onSaveBill,
  onDeleteBill,
  onMarkPaid,
  onSaveCategory,
}: RecurringBillsViewProps) {
  const { recurringBills, accounts, settings, categories = DEFAULT_CATEGORIES } = data;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'yearly' | 'weekly'>('monthly');
  const [dueDay, setDueDay] = useState<number>(1);
  const [category, setCategory] = useState<string>('Utilities & Bills');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [autoPaid, setAutoPaid] = useState<boolean>(true);

  const today = new Date();
  const currentDay = today.getDate();

  // Metrics
  const monthlyTotal = recurringBills.reduce((sum, b) => {
    if (b.frequency === 'monthly') return sum + b.amount;
    if (b.frequency === 'yearly') return sum + b.amount / 12;
    if (b.frequency === 'weekly') return sum + b.amount * 4.33;
    return sum + b.amount;
  }, 0);

  const annualTotal = monthlyTotal * 12;

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const handleOpenModal = (bill?: RecurringBill) => {
    if (bill) {
      setEditingBill(bill);
      setTitle(bill.title);
      setAmount(String(bill.amount));
      setFrequency(bill.frequency);
      setDueDay(bill.dueDay);
      setCategory(bill.category);
      setAccountId(bill.accountId);
      setAutoPaid(bill.autoPaid);
    } else {
      setEditingBill(null);
      setTitle('');
      setAmount('');
      setFrequency('monthly');
      setDueDay(15);
      setCategory(expenseCategories[0]?.name || 'Utilities & Bills');
      setAccountId(accounts[0]?.id || '');
      setAutoPaid(true);
    }
    setIsModalOpen(true);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!title.trim() || isNaN(numAmount) || numAmount <= 0) {
      alert('Please fill in a valid title and amount.');
      return;
    }

    const newBill: RecurringBill = {
      id: editingBill ? editingBill.id : `rec_${Date.now()}`,
      title: title.trim(),
      amount: numAmount,
      frequency,
      dueDay: Math.min(31, Math.max(1, dueDay)),
      category,
      accountId,
      autoPaid,
      lastPaidDate: editingBill?.lastPaidDate,
    };

    onSaveBill(newBill);
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Recurring Subscriptions & Fixed Overhead
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Monitor corporate software licenses, utility obligations, and vendor retainers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onSaveCategory && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateCategoryOpen(true)}
              className="text-xs font-semibold gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Category</span>
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => handleOpenModal()}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Subscription</span>
          </Button>
        </div>
      </div>

      {/* Aggregate Overview Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Monthly Fixed Overhead
            </span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <CalendarClock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
            {formatCurrency(monthlyTotal, settings.currency, settings.hideBalances)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Calculated normalized per month</p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Annual Recurring Cost
            </span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight tabular-nums">
            {formatCurrency(annualTotal, settings.currency, settings.hideBalances)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Yearly run rate without termination</p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Active Subscriptions
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
            {recurringBills.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {recurringBills.filter((b) => b.autoPaid).length} on automatic debit
          </p>
        </div>
      </div>

      {/* Grid of Recurring Bill Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recurringBills.map((bill) => {
          const daysUntil = bill.dueDay - currentDay;
          const isDueSoon = daysUntil >= 0 && daysUntil <= 5;
          const isPastDue = daysUntil < 0;

          const currentMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
          const isPaidThisMonth = bill.lastPaidDate?.startsWith(currentMonthPrefix);

          return (
            <div
              key={bill.id}
              className={`p-5 rounded-xl bg-card border transition-all duration-200 relative overflow-hidden group hover:border-border/80 ${
                isPaidThisMonth
                  ? 'border-emerald-500/40'
                  : isDueSoon
                  ? 'border-amber-500/50'
                  : 'border-border'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border/50 text-foreground">
                    <CategoryIcon name={bill.category} className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-sm tracking-tight">{bill.title}</h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span>{bill.category}</span>
                      <span>•</span>
                      <span className="capitalize">{bill.frequency}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenModal(bill)}
                    className="w-7 h-7"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Remove subscription "${bill.title}"?`)) {
                        onDeleteBill(bill.id);
                      }
                    }}
                    className="w-7 h-7 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Price & Schedule */}
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-xl font-bold text-foreground tracking-tight tabular-nums">
                  {formatCurrency(bill.amount, settings.currency, settings.hideBalances)}
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    /{bill.frequency === 'monthly' ? 'mo' : bill.frequency === 'yearly' ? 'yr' : 'wk'}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Due day {bill.dueDay}th
                  </span>
                </div>
              </div>

              {/* Card Footer: Status & Pay Button */}
              <div className="flex items-center justify-between pt-3 border-t border-border/60 text-xs">
                <div className="flex items-center gap-1.5">
                  {isPaidThisMonth ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Paid this month
                    </span>
                  ) : isDueSoon ? (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold text-[11px]">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Due in {daysUntil === 0 ? 'today' : `${daysUntil}d`}
                    </span>
                  ) : isPastDue ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px]">
                      <Clock className="w-3.5 h-3.5" />
                      Due next cycle
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">
                      Due in {daysUntil} days
                    </span>
                  )}
                </div>

                {!isPaidThisMonth && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onMarkPaid(bill)}
                    className="h-7 px-2.5 text-[11px] font-semibold"
                  >
                    Log Payment
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bill Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingBill ? 'Edit Subscription' : 'Add Recurring Subscription'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Subscription Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. OpenAI API, Google Workspace, AWS, Office Rent"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Day of Month (1-31)
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={dueDay}
                  onChange={(e) => setDueDay(parseInt(e.target.value))}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold uppercase tracking-wider text-muted-foreground text-[11px]">
                    Category
                  </label>
                  {onSaveCategory && (
                    <button
                      type="button"
                      onClick={() => setIsCreateCategoryOpen(true)}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New</span>
                    </button>
                  )}
                </div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {expenseCategories.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {c.isCustom ? '★' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Debit Account
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="autoPayCheck"
                checked={autoPaid}
                onChange={(e) => setAutoPaid(e.target.checked)}
                className="rounded border-input text-primary focus:ring-ring"
              />
              <label htmlFor="autoPayCheck" className="text-xs text-foreground cursor-pointer">
                Mark as Auto-Paid (Automatic standing order or debit)
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
              >
                {editingBill ? 'Update Subscription' : 'Save Subscription'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Embedded Create Category Modal */}
      {isCreateCategoryOpen && onSaveCategory && (
        <CreateCategoryModal
          isOpen={isCreateCategoryOpen}
          onClose={() => setIsCreateCategoryOpen(false)}
          initialType="expense"
          existingCategories={categories}
          onSave={(newCat) => {
            onSaveCategory(newCat);
            if (isModalOpen) {
              setCategory(newCat.name);
            }
          }}
        />
      )}
    </div>
  );
}
