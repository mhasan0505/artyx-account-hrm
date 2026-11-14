'use client';

import React, { useState } from 'react';
import { FinanceData } from '@/lib/money-management/types';
import { formatCurrency, formatDate } from '@/lib/money-management/utils';
import { CategoryDonutChart } from './charts/CategoryDonutChart';
import { TrendBarChart, MonthlyTrendData } from './charts/TrendBarChart';
import { CategoryIcon } from './CategoryIcon';

interface AnalyticsViewProps {
  data: FinanceData;
}

export function AnalyticsView({ data }: AnalyticsViewProps) {
  const { transactions, settings } = data;

  const [timeHorizon, setTimeHorizon] = useState<'30d' | '90d' | '180d' | 'all'>('90d');

  const now = new Date();

  // Filter transactions according to timeHorizon
  const cutoffDate = new Date();
  if (timeHorizon === '30d') cutoffDate.setDate(now.getDate() - 30);
  else if (timeHorizon === '90d') cutoffDate.setDate(now.getDate() - 90);
  else if (timeHorizon === '180d') cutoffDate.setDate(now.getDate() - 180);
  else cutoffDate.setFullYear(2000);

  const horizonTransactions = transactions.filter(
    (tx) => new Date(tx.date) >= cutoffDate
  );

  const totalIncome = horizonTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpense = horizonTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

  // Day count for velocity calculation
  const dayCount = timeHorizon === '30d' ? 30 : timeHorizon === '90d' ? 90 : timeHorizon === '180d' ? 180 : 365;
  const dailyBurnRate = totalExpense / Math.max(1, Math.min(dayCount, 30));

  // Category Distribution
  const categoryMap = new Map<string, { amount: number; count: number }>();
  horizonTransactions
    .filter((tx) => tx.type === 'expense')
    .forEach((tx) => {
      const cur = categoryMap.get(tx.category) || { amount: 0, count: 0 };
      categoryMap.set(tx.category, {
        amount: cur.amount + tx.amount,
        count: cur.count + 1,
      });
    });

  const colors = ['#F97316', '#10B981', '#6366F1', '#EC4899', '#0EA5E9', '#8B5CF6', '#F43F5E', '#EAB308'];
  const categoryChartData = Array.from(categoryMap.entries())
    .map(([cat, info], index) => {
      const catDef = data.categories?.find((c) => c.name === cat);
      return {
        category: cat,
        amount: info.amount,
        count: info.count,
        color: catDef?.color || colors[index % colors.length],
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

  // Top 5 largest single expenses
  const topExpenses = [...horizonTransactions]
    .filter((tx) => tx.type === 'expense')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Financial Intelligence & Analytics
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Diagnostic insights into capital efficiency, cash burn rate, and operating margins.
          </p>
        </div>

        {/* Time Horizon Pills */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border">
          {(
            [
              { id: '30d', label: '30 Days' },
              { id: '90d', label: '90 Days' },
              { id: '180d', label: '6 Months' },
              { id: 'all', label: 'All-Time' },
            ] as const
          ).map((h) => (
            <button
              key={h.id}
              onClick={() => setTimeHorizon(h.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                timeHorizon === h.id
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Inflow</span>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
            +{formatCurrency(totalIncome, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Across selected horizon</p>
        </div>

        <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Outflow</span>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-1">
            -{formatCurrency(totalExpense, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Gross expenses incurred</p>
        </div>

        <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Net Retained Surplus</span>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-1">
            {formatCurrency(netSavings, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">{savingsRate}% retention rate</p>
        </div>

        <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Average Daily Burn</span>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
            {formatCurrency(dailyBurnRate, settings.currency)}
            <span className="text-xs font-normal text-muted-foreground">/day</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Cash outflow velocity</p>
        </div>
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-5 rounded-xl bg-card border border-border shadow-xs">
          <h2 className="text-base font-bold text-foreground tracking-tight mb-1">
            Historical Trajectory
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Inflow vs. outflow dynamics across past six billing cycles
          </p>
          <TrendBarChart data={trendData} currency={settings.currency} />
        </div>

        <div className="lg:col-span-5 p-5 rounded-xl bg-card border border-border shadow-xs">
          <h2 className="text-base font-bold text-foreground tracking-tight mb-1">
            Category Concentration
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Dominant spending vectors for chosen period
          </p>
          <CategoryDonutChart
            data={categoryChartData}
            totalAmount={totalExpense}
            currency={settings.currency}
          />
        </div>
      </div>

      {/* Largest Outflows Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden shadow-xs p-5">
        <h2 className="text-base font-bold text-foreground tracking-tight mb-1">
          Top Single Outflows
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Peak expenditure events requiring executive audit
        </p>

        <div className="divide-y divide-border/60">
          {topExpenses.map((tx, idx) => (
            <div key={tx.id} className="py-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-bold tabular-nums">#{idx + 1}</span>
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border/50">
                  <CategoryIcon name={tx.category} className="w-3.5 h-3.5 text-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{tx.payee}</p>
                  <p className="text-muted-foreground">{tx.category} • {formatDate(tx.date)}</p>
                </div>
              </div>

              <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums text-sm">
                -{formatCurrency(tx.amount, settings.currency, settings.hideBalances)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
