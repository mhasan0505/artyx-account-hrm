'use client';

import React, { useState } from 'react';
import {
  Plus,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Edit2,
} from 'lucide-react';
import { FinanceData, Budget } from '@/lib/money-management/types';
import { formatCurrency, getDaysRemainingInMonth } from '@/lib/money-management/utils';
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

interface BudgetsViewProps {
  data: FinanceData;
  onSaveBudget: (budget: Budget) => void;
  onDeleteBudget: (budgetId: string) => void;
  onSaveCategory?: (category: CategoryDefinition) => void;
}

export function BudgetsView({ data, onSaveBudget, onDeleteBudget, onSaveCategory }: BudgetsViewProps) {
  const { budgets, transactions, settings, categories = DEFAULT_CATEGORIES } = data;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const [category, setCategory] = useState<string>('Food & Dining');
  const [monthlyLimit, setMonthlyLimit] = useState<string>('');
  const [alertThreshold, setAlertThreshold] = useState<number>(85);

  const daysRemaining = getDaysRemainingInMonth();

  // Current month string
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Spent per category this month
  const categorySpentMap = new Map<string, number>();
  transactions
    .filter((tx) => tx.type === 'expense' && tx.date.startsWith(currentMonthStr))
    .forEach((tx) => {
      const current = categorySpentMap.get(tx.category) || 0;
      categorySpentMap.set(tx.category, current + tx.amount);
    });

  // Total budget metrics
  const totalBudget = budgets.reduce((sum, b) => sum + b.monthlyLimit, 0);
  const totalSpentAcrossBudgets = budgets.reduce((sum, b) => {
    return sum + (categorySpentMap.get(b.category) || 0);
  }, 0);
  const totalRemaining = Math.max(0, totalBudget - totalSpentAcrossBudgets);
  const overallPercentage = totalBudget > 0 ? Math.min(100, Math.round((totalSpentAcrossBudgets / totalBudget) * 100)) : 0;

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const handleOpenModal = (budget?: Budget) => {
    if (budget) {
      setEditingBudget(budget);
      setCategory(budget.category);
      setMonthlyLimit(String(budget.monthlyLimit));
      setAlertThreshold(budget.alertThreshold || 85);
    } else {
      setEditingBudget(null);
      // Pick first category not yet budgeted
      const existingCategories = new Set(budgets.map((b) => b.category));
      const available = expenseCategories.filter((c) => !existingCategories.has(c.name));
      setCategory(available[0]?.name || expenseCategories[0]?.name || 'Food & Dining');
      setMonthlyLimit('300');
      setAlertThreshold(85);
    }
    setIsModalOpen(true);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(monthlyLimit);
    if (isNaN(limit) || limit <= 0) {
      alert('Please enter a valid monthly limit greater than 0.');
      return;
    }

    const catDef = categories.find((c) => c.name === category);

    const newBudget: Budget = {
      id: editingBudget ? editingBudget.id : `b_${Date.now()}`,
      category,
      monthlyLimit: limit,
      color: catDef?.color || '#6366F1',
      alertThreshold: alertThreshold || 85,
    };

    onSaveBudget(newBudget);
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Budgets & Spending Limits
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Cap monthly company expenditures, forecast runway, and prevent cost overruns.
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
            <span>New Budget</span>
          </Button>
        </div>
      </div>

      {/* Aggregate Overview Card */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total Monthly Spending Envelope
            </span>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
                {formatCurrency(totalSpentAcrossBudgets, settings.currency, settings.hideBalances)}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                of {formatCurrency(totalBudget, settings.currency, settings.hideBalances)} ceiling
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-muted-foreground font-medium">Remaining Envelope</span>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatCurrency(totalRemaining, settings.currency, settings.hideBalances)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">Month Consumption</span>
              <p className="text-sm font-bold text-foreground tabular-nums">
                {overallPercentage}%
              </p>
            </div>
          </div>
        </div>

        {/* Aggregate Progress Bar */}
        <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden border border-border">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              overallPercentage >= 100
                ? 'bg-rose-500'
                : overallPercentage >= 85
                ? 'bg-amber-500'
                : 'bg-primary'
            }`}
            style={{ width: `${Math.min(100, overallPercentage)}%` }}
          />
        </div>
      </div>

      {/* Grid of Budget Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {budgets.map((b) => {
          const spent = categorySpentMap.get(b.category) || 0;
          const remaining = Math.max(0, b.monthlyLimit - spent);
          const percent = Math.min(100, Math.round((spent / b.monthlyLimit) * 100));
          const isOver = spent > b.monthlyLimit;
          const isWarning = percent >= (b.alertThreshold || 85) && !isOver;
          const dailyCategoryRunway = remaining / daysRemaining;

          return (
            <div
              key={b.id}
              className={`p-5 rounded-xl bg-card border transition-all duration-200 relative overflow-hidden group hover:border-border/80 ${
                isOver
                  ? 'border-rose-500/60'
                  : isWarning
                  ? 'border-amber-500/60'
                  : 'border-border'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${b.color}20`, color: b.color }}
                  >
                    <CategoryIcon name={b.category} className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-sm tracking-tight">{b.category}</h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span>Limit: {formatCurrency(b.monthlyLimit, settings.currency, settings.hideBalances)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenModal(b)}
                    className="w-7 h-7"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete budget for "${b.category}"?`)) {
                        onDeleteBudget(b.id);
                      }
                    }}
                    className="w-7 h-7 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Progress Figures */}
              <div className="flex items-baseline justify-between mb-1.5">
                <div>
                  <span className="text-[11px] text-muted-foreground">Spent this month</span>
                  <p className={`text-lg font-bold ${isOver ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                    {formatCurrency(spent, settings.currency, settings.hideBalances)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Remaining</span>
                  <p className="text-xs font-semibold text-foreground">
                    {formatCurrency(remaining, settings.currency, settings.hideBalances)}
                  </p>
                </div>
              </div>

              {/* Visual Progress Bar */}
              <div className="w-full bg-muted h-2 rounded-full overflow-hidden border border-border my-2">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isOver
                      ? 'bg-rose-500'
                      : isWarning
                      ? 'bg-amber-500'
                      : 'bg-primary'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* Card Footer Insights */}
              <div className="flex items-center justify-between pt-2 border-t border-border/60 text-[11px]">
                <div className="flex items-center gap-1.5">
                  {isOver ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                      <AlertTriangle className="w-3 h-3" />
                      Over by {formatCurrency(spent - b.monthlyLimit, settings.currency)}
                    </span>
                  ) : isWarning ? (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                      <AlertTriangle className="w-3 h-3" />
                      {percent}% spent
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      On track ({percent}%)
                    </span>
                  )}
                </div>

                <span className="text-muted-foreground font-medium">
                  {isOver ? 'No runway' : `${formatCurrency(dailyCategoryRunway, settings.currency)}/day`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Budget Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingBudget ? 'Edit Spending Limit' : 'Create Budget Limit'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground text-[11px]">
                  Category
                </label>
                {onSaveCategory && !editingBudget && (
                  <button
                    type="button"
                    onClick={() => setIsCreateCategoryOpen(true)}
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Category</span>
                  </button>
                )}
              </div>
              <select
                value={category}
                disabled={Boolean(editingBudget)}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                Monthly Limit
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                placeholder="e.g. 400"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Warning Alert Threshold ({alertThreshold}%)
              </label>
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                <span>50% (Strict)</span>
                <span>85% (Standard)</span>
                <span>100% (Permissive)</span>
              </div>
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
                {editingBudget ? 'Update Budget' : 'Save Budget'}
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
