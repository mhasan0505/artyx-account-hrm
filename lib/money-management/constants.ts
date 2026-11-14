export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
}

// Dollar currencies (USD, CAD, AUD, SGD) are excluded per user preference
export const CURRENCIES: CurrencyOption[] = [
  { code: 'NONE', symbol: '', name: 'No Currency Symbol (Plain 1,234.00)' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka (BDT)' },
  { code: 'EUR', symbol: '€', name: 'Euro (EUR)' },
  { code: 'GBP', symbol: '£', name: 'British Pound (GBP)' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee (INR)' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen (JPY)' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham (AED)' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc (CHF)' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan (CNY)' },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyal (SAR)' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit (MYR)' },
];

export interface CategoryDefinition {
  id?: string;
  name: string;
  type: 'expense' | 'income';
  color: string;
  icon: string;
  isCustom?: boolean;
}

export const AVAILABLE_CATEGORY_ICONS: string[] = [
  'Utensils',
  'Coffee',
  'ShoppingCart',
  'ShoppingBag',
  'Home',
  'Zap',
  'Car',
  'Fuel',
  'Laptop',
  'Smartphone',
  'Gamepad2',
  'Film',
  'Music',
  'Activity',
  'Dumbbell',
  'Heart',
  'Plane',
  'BookOpen',
  'GraduationCap',
  'Briefcase',
  'Code',
  'TrendingUp',
  'Gift',
  'Sparkles',
  'Tag',
  'Wallet',
  'Landmark',
  'PiggyBank',
  'Coins',
];

export const CATEGORY_COLORS: string[] = [
  '#F97316', // Orange
  '#10B981', // Emerald
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#0EA5E9', // Sky
  '#8B5CF6', // Purple
  '#F43F5E', // Rose
  '#EAB308', // Yellow
  '#14B8A6', // Teal
  '#A855F7', // Violet
  '#06B6D4', // Cyan
  '#84CC16', // Lime
];

export const ACCOUNT_COLORS: string[] = [
  '#6366F1', // Indigo
  '#0EA5E9', // Sky
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#14B8A6', // Teal
  '#F43F5E', // Rose
];

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  // Expenses
  { name: 'Food & Dining', type: 'expense', color: '#F97316', icon: 'Utensils' },
  { name: 'Groceries', type: 'expense', color: '#10B981', icon: 'ShoppingCart' },
  { name: 'Housing & Rent', type: 'expense', color: '#6366F1', icon: 'Home' },
  { name: 'Utilities & Bills', type: 'expense', color: '#0EA5E9', icon: 'Zap' },
  { name: 'Transportation', type: 'expense', color: '#EC4899', icon: 'Car' },
  { name: 'Tech & Software', type: 'expense', color: '#8B5CF6', icon: 'Laptop' },
  { name: 'Shopping & Gear', type: 'expense', color: '#F43F5E', icon: 'ShoppingBag' },
  { name: 'Health & Fitness', type: 'expense', color: '#14B8A6', icon: 'Activity' },
  { name: 'Entertainment', type: 'expense', color: '#A855F7', icon: 'Film' },
  { name: 'Travel & Vacations', type: 'expense', color: '#3B82F6', icon: 'Plane' },
  { name: 'Education & Books', type: 'expense', color: '#06B6D4', icon: 'BookOpen' },
  { name: 'Gifts & Donations', type: 'expense', color: '#F59E0B', icon: 'Heart' },
  { name: 'Miscellaneous', type: 'expense', color: '#64748B', icon: 'MoreHorizontal' },

  // Income
  { name: 'Salary & Employment', type: 'income', color: '#10B981', icon: 'Briefcase' },
  { name: 'Freelance & Projects', type: 'income', color: '#059669', icon: 'Code' },
  { name: 'Business Profits', type: 'income', color: '#34D399', icon: 'TrendingUp' },
  { name: 'Investments & Dividends', type: 'income', color: '#6366F1', icon: 'TrendingUp' },
  { name: 'Rental Income', type: 'income', color: '#3B82F6', icon: 'Building' },
  { name: 'Gifts & Rewards', type: 'income', color: '#F59E0B', icon: 'Gift' },
  { name: 'Other Income', type: 'income', color: '#64748B', icon: 'Coins' },
];
