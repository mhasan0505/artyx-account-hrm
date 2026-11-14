import { CURRENCIES } from './constants';

export function formatCurrency(
  amount: number,
  currencyCode: string = 'NONE',
  hideBalance: boolean = false
): string {
  if (hideBalance) {
    return '••••••';
  }

  const curr = CURRENCIES.find((c) => c.code === currencyCode) || {
    code: currencyCode,
    symbol: '',
    name: currencyCode,
  };

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  // Formatter with localized thousands separator
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absAmount);

  const cleanSymbol = (curr.symbol || '').replace(/\$/g, '').trim();

  if (!cleanSymbol || curr.code === 'NONE' || curr.code === 'USD') {
    return `${isNegative ? '-' : ''}${formattedNumber}`;
  }

  if (cleanSymbol.length > 1) {
    return `${isNegative ? '-' : ''}${cleanSymbol} ${formattedNumber}`;
  }

  return `${isNegative ? '-' : ''}${cleanSymbol}${formattedNumber}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;

  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '';
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';

  return formatDate(dateStr);
}

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDaysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate());
}

export function getMonthName(monthIndex?: number): string {
  const d = new Date();
  if (typeof monthIndex === 'number') {
    d.setMonth(monthIndex);
  }
  return d.toLocaleDateString('en-US', { month: 'long' });
}
