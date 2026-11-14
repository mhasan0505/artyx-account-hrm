'use client';

import React from 'react';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { FinanceData, Transaction } from '@/lib/money-management/types';
import { formatCurrency, formatRelativeDate, getDaysRemainingInMonth } from '@/lib/money-management/utils';
import { CategoryIcon } from './CategoryIcon';
import { AccountIcon } from './AccountIcon';
import { CategoryDonutChart } from './charts/CategoryDonutChart';
import { TrendBarChart, MonthlyTrendData } from './charts/TrendBarChart';
import { Button } from '@/components/ui/button';

interface DashboardViewProps {
  data: FinanceData;
  onOpenAddModal: () => void;
  onSelectTab: (tab: any) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
}

export function DashboardView({
  data,
  onOpenAddModal,
  onSelectTab,
  onEditTransaction,
  onDeleteTransaction,
}: DashboardViewProps) {
  const { accounts, transactions, budgets, settings } = data;

  // Calculate Net Worth, Assets, Debts
  let totalAssets = 0;
  let totalDebt = 0;
  accounts.forEach((acc) => {
    if (acc.balance >= 0) {
      totalAssets += acc.balance;
    } else {
      totalDebt += Math.abs(acc.balance);
    }
  });
  const netWorth = totalAssets - totalDebt;

  // Current month's calculations
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTransactions = transactions.filter((tx) =>
    tx.date.startsWith(currentMonthStr)
  );

  const monthIncome = currentMonthTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const monthExpense = currentMonthTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netSavings = monthIncome - monthExpense;
  const savingsRate = monthIncome > 0 ? Math.round((netSavings / monthIncome) * 100) : 0;

  // Category breakdown for donut chart
  const categorySpendMap = new Map<string, { amount: number; count: number }>();
  currentMonthTransactions
    .filter((tx) => tx.type === 'expense')
    .forEach((tx) => {
      const existing = categorySpendMap.get(tx.category) || { amount: 0, count: 0 };
      categorySpendMap.set(tx.category, {
        amount: existing.amount + tx.amount,
        count: existing.count + 1,
      });
    });

  const categoryChartData = Array.from(categorySpendMap.entries())
    .map(([category, info], index) => {
      const budget = budgets.find((b) => b.category === category);
      const catDef = data.categories?.find((c) => c.name === category);
      const colors = ['#F97316', '#10B981', '#6366F1', '#EC4899', '#0EA5E9', '#8B5CF6', '#F43F5E', '#EAB308'];
      return {
        category,
        amount: info.amount,
        count: info.count,
        color: catDef?.color || budget?.color || colors[index % colors.length],
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // 6-Month Trend Data
  const trendData: MonthlyTrendData[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mName = d.toLocaleDateString('en-US', { month: 'short' });

    const mTx = transactions.filter((tx) => tx.date.startsWith(mStr));
    const inc = mTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = mTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    trendData.push({
      month: mName,
      income: inc,
      expense: exp,
    });
  }

  // Days remaining & Daily runway
  const daysLeft = getDaysRemainingInMonth();
  const totalBudgetLimit = budgets.reduce((sum, b) => sum + b.monthlyLimit, 0);
  const remainingBudget = Math.max(0, totalBudgetLimit - monthExpense);
  const dailyRunway = daysLeft > 0 ? remainingBudget / daysLeft : 0;

  // Recent 5 transactions
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.createdAt - a.createdAt)
    .slice(0, 5);

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      {/* Top Welcome & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            CEO Financial Intelligence
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Real-time executive ledger of company capital, cash flow velocity, and account allocations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectTab('transactions')}
            className="text-xs font-semibold"
          >
            View Ledger
          </Button>
          <Button
            size="sm"
            onClick={onOpenAddModal}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Transaction</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Net Worth Card */}
        <div className="p-5 rounded-xl bg-card border border-border shadow-xs relative overflow-hidden group hover:border-border/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total Net Worth
            </span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
            {formatCurrency(netWorth, settings.currency, settings.hideBalances)}
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-2">
            <span>Assets: {formatCurrency(totalAssets, settings.currency, settings.hideBalances)}</span>
            <span className="text-rose-500 font-medium">Debt: {formatCurrency(totalDebt, settings.currency, settings.hideBalances)}</span>
          </div>
        </div>

        {/* Monthly Income Card */}
        <div className="p-5 rounded-xl bg-card border border-border shadow-xs relative overflow-hidden group hover:border-border/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Monthly Inflow
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight tabular-nums">
            +{formatCurrency(monthIncome, settings.currency, settings.hideBalances)}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground border-t border-border/50 pt-2 flex items-center justify-between">
            <span>Active Month</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{currentMonthTransactions.filter((t) => t.type === 'income').length} deposits</span>
          </div>
        </div>

        {/* Monthly Expenses Card */}
        <div className="p-5 rounded-xl bg-card border border-border shadow-xs relative overflow-hidden group hover:border-border/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Monthly Outflow
            </span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight tabular-nums">
            -{formatCurrency(monthExpense, settings.currency, settings.hideBalances)}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground border-t border-border/50 pt-2 flex items-center justify-between">
            <span>{currentMonthTransactions.filter((t) => t.type === 'expense').length} expenses</span>
            <span className="font-medium">{daysLeft} days left</span>
          </div>
        </div>

        {/* Savings Rate / Net Cash Flow */}
        <div className="p-5 rounded-xl bg-card border border-border shadow-xs relative overflow-hidden group hover:border-border/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Net Savings Rate
            </span>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              savingsRate >= 20 ? 'bg-indigo-500/10 text-indigo-500' : 'bg-amber-500/10 text-amber-500'
            }`}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight tabular-nums flex items-baseline gap-2">
            <span>{savingsRate}%</span>
            <span className={`text-xs font-semibold ${netSavings >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              ({formatCurrency(netSavings, settings.currency, settings.hideBalances)})
            </span>
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground border-t border-border/50 pt-2 flex items-center justify-between">
            <span>Daily Runway</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{formatCurrency(dailyRunway, settings.currency)}/day</span>
          </div>
        </div>
      </div>

      {/* Charts Section: Trend & Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Income vs Expense 6-Month Trend */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">Income vs. Expense Trend</h2>
              <p className="text-xs text-muted-foreground">6-month monthly cash flow comparison</p>
            </div>
            <button
              onClick={() => onSelectTab('analytics')}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              Analytics <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <TrendBarChart data={trendData} currency={settings.currency} />
        </div>

        {/* Category Breakdown Donut */}
        <div className="lg:col-span-5 p-5 rounded-xl bg-card border border-border shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-bold text-foreground tracking-tight">Monthly Expense Mix</h2>
                <p className="text-xs text-muted-foreground">Distribution by spending category</p>
              </div>
              <button
                onClick={() => onSelectTab('budgets')}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                Budgets <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <CategoryDonutChart
              data={categoryChartData}
              totalAmount={monthExpense}
              currency={settings.currency}
            />
          </div>
        </div>
      </div>

      {/* Row 3: Recent Transactions & Account Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recent Transactions List */}
        <div className="lg:col-span-8 p-5 rounded-xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">Recent Ledger Entries</h2>
              <p className="text-xs text-muted-foreground">Latest recorded company cash movements</p>
            </div>
            <button
              onClick={() => onSelectTab('transactions')}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              All Transactions ({transactions.length}) <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No transactions recorded yet. Click &quot;Add Transaction&quot; to start!
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {recentTransactions.map((tx) => {
                const acc = accountMap.get(tx.accountId);
                const isIncome = tx.type === 'income';
                const isTransfer = tx.type === 'transfer';

                return (
                  <div
                    key={tx.id}
                    className="py-3 flex items-center justify-between hover:bg-muted/40 px-2 rounded-lg transition-colors group cursor-pointer"
                    onClick={() => onEditTransaction(tx)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border/50">
                        <CategoryIcon name={tx.category} className="w-4 h-4 text-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">{tx.payee}</p>
                          {tx.tags && tx.tags.length > 0 && (
                            <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
                              #{tx.tags[0]}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{tx.category}</span>
                          <span>•</span>
                          <span>{acc?.name || 'Account'}</span>
                          <span>•</span>
                          <span>{formatRelativeDate(tx.date)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 tabular-nums">
                      <span
                        className={`text-sm font-bold ${
                          isIncome
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isTransfer
                            ? 'text-sky-600 dark:text-sky-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isIncome ? '+' : tx.type === 'expense' ? '-' : ''}
                        {formatCurrency(tx.amount, settings.currency, settings.hideBalances)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Accounts Snapshot Sidebar */}
        <div className="lg:col-span-4 p-5 rounded-xl bg-card border border-border shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-foreground tracking-tight">Accounts & Balances</h2>
                <p className="text-xs text-muted-foreground">{accounts.length} monitored accounts</p>
              </div>
              <button
                onClick={() => onSelectTab('accounts')}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                Manage <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/70 hover:border-border transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${acc.color}20`, color: acc.color }}
                    >
                      <AccountIcon type={acc.type} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{acc.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-medium">{acc.type.replace('_', ' ')}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <p
                      className={`text-xs font-bold ${
                        acc.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
                      }`}
                    >
                      {formatCurrency(acc.balance, settings.currency, settings.hideBalances)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
