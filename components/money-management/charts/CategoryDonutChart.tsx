'use client';

import React, { useState } from 'react';
import { formatCurrency } from '@/lib/money-management/utils';
import { CategoryIcon } from '../CategoryIcon';

interface CategorySpend {
  category: string;
  amount: number;
  color: string;
  count: number;
}

interface CategoryDonutChartProps {
  data: CategorySpend[];
  totalAmount: number;
  currency: string;
  title?: string;
}

export function CategoryDonutChart({
  data,
  totalAmount,
  currency,
}: CategoryDonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!data || data.length === 0 || totalAmount <= 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <div className="size-16 rounded-full border border-dashed border-border flex items-center justify-center mb-3">
          <span className="text-xs">No data</span>
        </div>
        <p className="text-sm">No expenses recorded for this period</p>
      </div>
    );
  }

  // Calculate angles for donut SVG
  const size = 200;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const slices = data.map((item, index) => {
    const percentage = item.amount / totalAmount;
    const strokeDasharray = `${percentage * circumference} ${circumference}`;
    const strokeDashoffset = -cumulativeOffset;
    cumulativeOffset += percentage * circumference;

    return {
      ...item,
      percentage: Math.round(percentage * 100),
      strokeDasharray,
      strokeDashoffset,
      index,
    };
  });

  const activeItem = hoveredIndex !== null ? slices[hoveredIndex] : null;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 justify-between">
      {/* SVG Donut Visual */}
      <div className="relative shrink-0 flex items-center justify-center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background circle track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />

          {/* Slices */}
          {slices.map((slice) => {
            const isHovered = hoveredIndex === slice.index;
            return (
              <circle
                key={slice.category}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-200 cursor-pointer"
                onMouseEnter={() => setHoveredIndex(slice.index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
          {activeItem ? (
            <>
              <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[110px]">
                {activeItem.category}
              </span>
              <span className="text-base font-bold text-foreground tracking-tight">
                {activeItem.percentage}%
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatCurrency(activeItem.amount, currency)}
              </span>
            </>
          ) : (
            <>
              <span className="text-[11px] font-medium text-muted-foreground">Total Spend</span>
              <span className="text-sm font-bold text-foreground tracking-tight">
                {formatCurrency(totalAmount, currency)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {data.length} {data.length === 1 ? 'category' : 'categories'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend list */}
      <div className="flex-1 w-full space-y-2 max-h-[220px] overflow-y-auto pr-1">
        {data.map((item, index) => {
          const percentage = Math.round((item.amount / totalAmount) * 100);
          const isHovered = hoveredIndex === index;

          return (
            <div
              key={item.category}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`flex items-center justify-between p-2 rounded-lg text-xs transition-colors cursor-pointer border ${
                isHovered
                  ? 'bg-muted border-border font-medium'
                  : 'hover:bg-muted/50 border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <CategoryIcon name={item.category} className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-foreground">{item.category}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="text-foreground font-medium">
                  {formatCurrency(item.amount, currency)}
                </span>
                <span className="text-[11px] text-muted-foreground w-8 text-right">
                  {percentage}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
