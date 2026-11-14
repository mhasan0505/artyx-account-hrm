import { CategoryDefinition } from './constants';

export type TransactionType = 'income' | 'expense' | 'transfer';

export type AccountType = 
  | 'cash' 
  | 'bank' 
  | 'credit' 
  | 'savings' 
  | 'investment' 
  | 'digital_wallet';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  category: string;
  accountId: string;
  toAccountId?: string; // only for transfer
  payee: string; // Merchant, sender, recipient, or employer
  note?: string;
  tags?: string[];
  isRecurring?: boolean;
  createdAt: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  color: string;
  icon: string;
  accountNumber?: string;
  institution?: string;
}

export interface Budget {
  id: string;
  category: string;
  monthlyLimit: number;
  color: string;
  alertThreshold: number; // e.g. 80 for 80%
}

export interface SavingsGoal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string; // YYYY-MM-DD
  color: string;
  icon: string;
  notes?: string;
}

export interface RecurringBill {
  id: string;
  title: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'weekly';
  dueDay: number; // 1-31
  category: string;
  accountId: string;
  autoPaid: boolean;
  lastPaidDate?: string;
}

export interface UserSettings {
  currency: string; // 'NONE', 'BDT', 'EUR', 'GBP', etc.
  currencySymbol: string; // '', '৳', '€', '£', etc.
  theme: 'dark' | 'light' | 'system';
  name: string;
  hideBalances: boolean;
}

export interface FinanceData {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: SavingsGoal[];
  recurringBills: RecurringBill[];
  settings: UserSettings;
  categories: CategoryDefinition[];
}
