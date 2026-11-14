import { FinanceData, Account, Transaction, Budget, SavingsGoal, RecurringBill, UserSettings } from './types';
import { DEFAULT_CATEGORIES, CategoryDefinition } from './constants';

const STORAGE_KEY = 'artyx_ceo_money_management_data_v1';

export const INITIAL_SAMPLE_DATA: FinanceData = {
  settings: {
    currency: 'NONE',
    currencySymbol: '',
    theme: 'dark',
    name: 'Executive Portfolio',
    hideBalances: false,
  },
  categories: DEFAULT_CATEGORIES,
  accounts: [
    {
      id: 'acc_main_bank',
      name: 'Primary Executive Account',
      type: 'bank',
      currency: 'NONE',
      balance: 18500.0,
      color: '#0EA5E9',
      icon: 'Building',
      institution: 'Premier Commercial Bank',
      accountNumber: '•••• 4821',
    },
    {
      id: 'acc_savings',
      name: 'High Yield Wealth Reserve',
      type: 'savings',
      currency: 'NONE',
      balance: 45200.0,
      color: '#10B981',
      icon: 'PiggyBank',
      institution: 'Apex Capital Reserve',
      accountNumber: '•••• 9014',
    },
    {
      id: 'acc_credit',
      name: 'Executive Platinum Card',
      type: 'credit',
      currency: 'NONE',
      balance: -1420.5,
      color: '#6366F1',
      icon: 'CreditCard',
      institution: 'Chase Corporate',
      accountNumber: '•••• 3192',
    },
    {
      id: 'acc_cash',
      name: 'Vault Cash',
      type: 'cash',
      currency: 'NONE',
      balance: 850.0,
      color: '#F59E0B',
      icon: 'Wallet',
    },
    {
      id: 'acc_digital',
      name: 'Digital Executive Wallet',
      type: 'digital_wallet',
      currency: 'NONE',
      balance: 1250.0,
      color: '#EC4899',
      icon: 'Smartphone',
      institution: 'bKash Merchant / PayPal',
    },
    {
      id: 'acc_invest',
      name: 'Growth & Equity Portfolio',
      type: 'investment',
      currency: 'NONE',
      balance: 62000.0,
      color: '#8B5CF6',
      icon: 'TrendingUp',
      institution: 'Vanguard Index & Tech',
    },
  ],
  budgets: [
    {
      id: 'b_food',
      category: 'Food & Dining',
      monthlyLimit: 600,
      color: '#F97316',
      alertThreshold: 80,
    },
    {
      id: 'b_groceries',
      category: 'Groceries',
      monthlyLimit: 750,
      color: '#10B981',
      alertThreshold: 85,
    },
    {
      id: 'b_rent',
      category: 'Housing & Rent',
      monthlyLimit: 2200,
      color: '#6366F1',
      alertThreshold: 95,
    },
    {
      id: 'b_tech',
      category: 'Tech & Software',
      monthlyLimit: 450,
      color: '#8B5CF6',
      alertThreshold: 80,
    },
    {
      id: 'b_transport',
      category: 'Transportation',
      monthlyLimit: 300,
      color: '#EC4899',
      alertThreshold: 80,
    },
    {
      id: 'b_shopping',
      category: 'Shopping & Gear',
      monthlyLimit: 500,
      color: '#F43F5E',
      alertThreshold: 75,
    },
  ],
  goals: [
    {
      id: 'g_emergency',
      title: '12-Month Executive Runway',
      targetAmount: 50000,
      currentAmount: 45200,
      targetDate: '2027-06-30',
      color: '#10B981',
      icon: 'ShieldCheck',
      notes: 'Fully liquid strategic buffer in High Yield reserve',
    },
    {
      id: 'g_real_estate',
      title: 'Commercial Property Acquisition',
      targetAmount: 100000,
      currentAmount: 62000,
      targetDate: '2027-12-31',
      color: '#6366F1',
      icon: 'Building',
      notes: 'Down payment for upcoming office floor purchase',
    },
    {
      id: 'g_tech_hardware',
      title: 'Studio Tech & AI Workstation',
      targetAmount: 6000,
      currentAmount: 4800,
      targetDate: '2026-12-25',
      color: '#EC4899',
      icon: 'Laptop',
      notes: 'Dual M4 Max workstation and calibrated reference displays',
    },
  ],
  recurringBills: [
    {
      id: 'rec_rent',
      title: 'Executive Residence Lease',
      amount: 2100,
      frequency: 'monthly',
      dueDay: 1,
      category: 'Housing & Rent',
      accountId: 'acc_main_bank',
      autoPaid: true,
      lastPaidDate: '2026-11-01',
    },
    {
      id: 'rec_cloud',
      title: 'Dedicated Cloud Infrastructure',
      amount: 85,
      frequency: 'monthly',
      dueDay: 6,
      category: 'Tech & Software',
      accountId: 'acc_credit',
      autoPaid: true,
      lastPaidDate: '2026-11-06',
    },
    {
      id: 'rec_internet',
      title: 'Enterprise Fiber Internet & Static IP',
      amount: 95,
      frequency: 'monthly',
      dueDay: 14,
      category: 'Utilities & Bills',
      accountId: 'acc_credit',
      autoPaid: false,
    },
  ],
  transactions: [
    {
      id: 'tx_1',
      type: 'income',
      amount: 8500.0,
      currency: 'NONE',
      date: '2026-11-01',
      category: 'Business Profits',
      accountId: 'acc_main_bank',
      payee: 'Artyx Digital Agency Distribution',
      note: 'Monthly CEO profit share distribution',
      tags: ['profit-share', 'executive'],
      createdAt: 1730419200000,
    },
    {
      id: 'tx_2',
      type: 'expense',
      amount: 2100.0,
      currency: 'NONE',
      date: '2026-11-01',
      category: 'Housing & Rent',
      accountId: 'acc_main_bank',
      payee: 'Crown Heights Lease',
      note: 'Executive apartment monthly lease',
      tags: ['rent', 'fixed'],
      createdAt: 1730422800000,
    },
    {
      id: 'tx_3',
      type: 'transfer',
      amount: 2500.0,
      currency: 'NONE',
      date: '2026-11-02',
      category: 'Transfer',
      accountId: 'acc_main_bank',
      toAccountId: 'acc_savings',
      payee: 'Wealth Reserve Allocation',
      note: 'Monthly strategic liquidity deposit',
      tags: ['savings', 'automated'],
      createdAt: 1730509200000,
    },
    {
      id: 'tx_4',
      type: 'income',
      amount: 3200.0,
      currency: 'NONE',
      date: '2026-11-04',
      category: 'Investments & Dividends',
      accountId: 'acc_invest',
      payee: 'Equity Dividend Yield',
      note: 'Q3 private tech portfolio distribution',
      tags: ['dividend', 'investment'],
      createdAt: 1730682000000,
    },
    {
      id: 'tx_5',
      type: 'expense',
      amount: 195.4,
      currency: 'NONE',
      date: '2026-11-05',
      category: 'Groceries',
      accountId: 'acc_credit',
      payee: 'Gourmet Organic Market',
      note: 'Weekly provisions and specialty coffee',
      tags: ['groceries'],
      createdAt: 1730768400000,
    },
    {
      id: 'tx_6',
      type: 'expense',
      amount: 85.0,
      currency: 'NONE',
      date: '2026-11-06',
      category: 'Tech & Software',
      accountId: 'acc_credit',
      payee: 'Cloud Infrastructure & Servers',
      note: 'Primary server node subscription',
      tags: ['infrastructure', 'tech'],
      createdAt: 1730854800000,
    },
    {
      id: 'tx_7',
      type: 'expense',
      amount: 68.5,
      currency: 'NONE',
      date: '2026-11-07',
      category: 'Food & Dining',
      accountId: 'acc_credit',
      payee: 'The Capital Brasserie',
      note: 'Client executive lunch',
      tags: ['dining'],
      createdAt: 1730941200000,
    },
    {
      id: 'tx_8',
      type: 'expense',
      amount: 45.0,
      currency: 'NONE',
      date: '2026-11-09',
      category: 'Transportation',
      accountId: 'acc_digital',
      payee: 'Chauffeur & Airport Ride',
      note: 'Regional summit transport',
      tags: ['transit'],
      createdAt: 1731114000000,
    },
  ],
};

export function loadFinanceData(): FinanceData {
  if (typeof window === 'undefined') {
    return INITIAL_SAMPLE_DATA;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SAMPLE_DATA));
      return INITIAL_SAMPLE_DATA;
    }

    const parsed: FinanceData = JSON.parse(raw);

    const cleanSettings: UserSettings = {
      ...INITIAL_SAMPLE_DATA.settings,
      ...parsed.settings,
      currency: parsed.settings?.currency || 'NONE',
      currencySymbol: (parsed.settings?.currencySymbol || '').replace(/\$/g, ''),
    };

    const cleanAccounts = (parsed.accounts || INITIAL_SAMPLE_DATA.accounts).map((acc) => ({
      ...acc,
      currency: acc.currency ? acc.currency.replace(/\$/g, '') : cleanSettings.currency,
    }));

    const cleanTransactions = (parsed.transactions || INITIAL_SAMPLE_DATA.transactions).map((tx) => ({
      ...tx,
      currency: tx.currency ? tx.currency.replace(/\$/g, '') : cleanSettings.currency,
    }));

    let loadedCategories: CategoryDefinition[] = Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories
      : DEFAULT_CATEGORIES;

    const existingCatNames = new Set(loadedCategories.map((c) => c.name.toLowerCase()));
    const missingDefaults = DEFAULT_CATEGORIES.filter((dc) => !existingCatNames.has(dc.name.toLowerCase()));
    if (missingDefaults.length > 0) {
      loadedCategories = [...loadedCategories, ...missingDefaults];
    }

    const mergedData: FinanceData = {
      settings: cleanSettings,
      accounts: cleanAccounts,
      transactions: cleanTransactions,
      budgets: parsed.budgets || INITIAL_SAMPLE_DATA.budgets,
      goals: parsed.goals || INITIAL_SAMPLE_DATA.goals,
      recurringBills: parsed.recurringBills || INITIAL_SAMPLE_DATA.recurringBills,
      categories: loadedCategories,
    };

    return mergedData;
  } catch (err) {
    console.error('Failed to parse financial data from localStorage:', err);
    return INITIAL_SAMPLE_DATA;
  }
}

export function saveFinanceData(data: FinanceData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event('finance_data_updated'));
  } catch (err) {
    console.error('Failed to save financial data to localStorage:', err);
  }
}

export function resetToSampleData(): FinanceData {
  saveFinanceData(INITIAL_SAMPLE_DATA);
  return INITIAL_SAMPLE_DATA;
}

export function clearAllData(): FinanceData {
  const blank: FinanceData = {
    settings: INITIAL_SAMPLE_DATA.settings,
    categories: DEFAULT_CATEGORIES,
    accounts: [
      {
        id: 'acc_cash_clean',
        name: 'Cash Vault',
        type: 'cash',
        currency: INITIAL_SAMPLE_DATA.settings.currency,
        balance: 0,
        color: '#10B981',
        icon: 'Wallet',
      },
      {
        id: 'acc_bank_clean',
        name: 'Primary Checking',
        type: 'bank',
        currency: INITIAL_SAMPLE_DATA.settings.currency,
        balance: 0,
        color: '#0EA5E9',
        icon: 'Building',
      },
    ],
    transactions: [],
    budgets: [],
    goals: [],
    recurringBills: [],
  };
  saveFinanceData(blank);
  return blank;
}

export function exportDataAsJSON(data: FinanceData): string {
  return JSON.stringify(data, null, 2);
}

export function importDataFromJSON(jsonString: string): FinanceData {
  const parsed = JSON.parse(jsonString) as FinanceData;
  if (!parsed.accounts || !parsed.transactions) {
    throw new Error('Invalid financial backup format.');
  }

  if (!parsed.categories || !Array.isArray(parsed.categories)) {
    parsed.categories = DEFAULT_CATEGORIES;
  }

  saveFinanceData(parsed);
  return parsed;
}

export function exportTransactionsAsCSV(transactions: Transaction[], accounts: Account[]): string {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const headers = ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'To Account', 'Payee', 'Note', 'Tags'];

  const rows = transactions.map((tx) => [
    tx.date,
    tx.type,
    tx.amount.toFixed(2),
    tx.currency,
    `"${(tx.category || '').replace(/"/g, '""')}"`,
    `"${(accountMap.get(tx.accountId) || tx.accountId).replace(/"/g, '""')}"`,
    tx.toAccountId ? `"${(accountMap.get(tx.toAccountId) || tx.toAccountId).replace(/"/g, '""')}"` : '',
    `"${(tx.payee || '').replace(/"/g, '""')}"`,
    `"${(tx.note || '').replace(/"/g, '""')}"`,
    `"${(tx.tags || []).join('; ')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
