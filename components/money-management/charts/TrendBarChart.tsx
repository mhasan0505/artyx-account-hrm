'use client';

import React, { useState } from 'react';
import { formatCurrency } from '@/lib/money-management/utils';

export interface MonthlyTrendData {
  month: string;
  income: number;
  expense: number;
}

interface TrendBarChartProps {
  data: MonthlyTrendData[];
  currency: string;
}

export function TrendBarChart({ data, currency }: TrendBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No historical comparison data available
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.income, d.expense, 100))) * 1.15;
  const chartHeight = 160;

  return (
    <div className="w-full">
      {/* Chart Canvas */}
      <div className="relative h-[190px] flex items-end justify-between gap-3 pt-6 pb-6 px-2 border-b border-border">
        {/* Background Grid Lines */}
        <div className="absolute inset-x-0 top-6 border-t border-border/50 pointer-events-none" />
        <div className="absolute inset-x-0 top-1/2 border-t border-border/30 pointer-events-none" />

        {data.map((item, idx) => {
          const incomeHeight = Math.max(6, (item.income / maxVal) * chartHeight);
          const expenseHeight = Math.max(6, (item.expense / maxVal) * chartHeight);
          const net = item.income - item.expense;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={item.month}
              className="flex-1 flex flex-col items-center justify-end h-full relative group cursor-pointer"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Tooltip on hover */}
              {isHovered && (
                <div className="absolute -top-14 z-30 bg-popover text-popover-foreground border border-border shadow-md rounded-lg px-3 py-1.5 text-xs pointer-events-none whitespace-nowrap">
                  <p className="font-semibold mb-0.5">{item.month}</p>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      +{formatCurrency(item.income, currency)}
                    </span>
                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                      -{formatCurrency(item.expense, currency)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Net: {net >= 0 ? '+' : ''}{formatCurrency(net, currency)}
                  </p>
                </div>
              )}

              {/* Bars side by side */}
              <div className="flex items-end gap-1.5 w-full max-w-[36px] justify-center">
                {/* Income Bar */}
                <div
                  style={{ height: `${incomeHeight}px` }}
                  className={`w-3 sm:w-3.5 rounded-t-sm transition-all duration-200 bg-emerald-500 ${
                    isHovered ? 'brightness-110 shadow-sm shadow-emerald-500/20' : 'opacity-85'
                  }`}
                />

                {/* Expense Bar */}
                <div
                  style={{ height: `${expenseHeight}px` }}
                  className={`w-3 sm:w-3.5 rounded-t-sm transition-all duration-200 bg-rose-500 ${
                    isHovered ? 'brightness-110 shadow-sm shadow-rose-500/20' : 'opacity-85'
                  }`}
                />
              </div>

              {/* Month label */}
              <span className={`text-[11px] mt-2 transition-colors ${
                isHovered ? 'text-foreground font-semibold' : 'text-muted-foreground'
              }`}>
                {item.month}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend & Stats Footer */}
      <div className="flex items-center justify-between pt-3 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-emerald-500" />
            <span className="text-muted-foreground">Income</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-rose-500" />
            <span className="text-muted-foreground">Expense</span>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">Hover bar for monthly totals</span>
      </div>
    </div>
  );
}
