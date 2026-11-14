'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  ReceiptText,
  Wallet,
  Sliders,
  CalendarClock,
  Target,
  BarChart3,
  Settings,
  Plus,
  Eye,
  EyeOff,
  CloudCheck,
} from 'lucide-react';
import {
  FinanceData,
  Transaction,
  Account,
  Budget,
  SavingsGoal,
  RecurringBill,
  UserSettings,
} from '@/lib/money-management/types';
import { CategoryDefinition } from '@/lib/money-management/constants';
import { loadFinanceData, saveFinanceData } from '@/lib/money-management/storage';
import { formatCurrency, getTodayDateString } from '@/lib/money-management/utils';
import {
  getCeoFinanceDataServer,
  saveCeoFinanceDataServer,
} from '@/lib/actions/money-management';
import { DashboardView } from './DashboardView';
import { TransactionsView } from './TransactionsView';
import { AccountsView } from './AccountsView';
import { BudgetsView } from './BudgetsView';
import { RecurringBillsView } from './RecurringBillsView';
import { GoalsView } from './GoalsView';
import { AnalyticsView } from './AnalyticsView';
import { SettingsView } from './SettingsView';
import { AddTransactionModal } from './AddTransactionModal';
import { Button } from '@/components/ui/button';

export type NavTab =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'recurring'
  | 'goals'
  | 'analytics'
  | 'settings';

const TABS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Ledger', icon: ReceiptText },
  { id: 'accounts', label: 'Accounts', icon: Wallet },
  { id: 'budgets', label: 'Budgets', icon: Sliders },
  { id: 'recurring', label: 'Subscriptions', icon: CalendarClock },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function MoneyManagementClient() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load finance data on initial mount (check server vault first, fallback to localStorage)
  useEffect(() => {
    let isMounted = true;

    async function initData() {
      try {
        const serverResult = await getCeoFinanceDataServer();
        if (serverResult && serverResult.success && serverResult.data) {
          if (isMounted) {
            setData(serverResult.data);
            saveFinanceData(serverResult.data);
            return;
          }
        }
      } catch (err) {
        console.error('Failed to load server CEO finance data:', err);
      }

      // Fallback to client localStorage or initial data
      if (isMounted) {
        const local = loadFinanceData();
        setData(local);
      }
    }

    initData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Sync to localStorage and debounce sync to server Postgres vault
  const updateData = useCallback((updater: (prev: FinanceData) => FinanceData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      saveFinanceData(next);

      // Debounce server backup
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
      setIsSyncing(true);
      syncTimerRef.current = setTimeout(async () => {
        try {
          await saveCeoFinanceDataServer(next);
        } catch (err) {
          console.error('Server sync error:', err);
        } finally {
          setIsSyncing(false);
        }
      }, 1500);

      return next;
    });
  }, []);

  // Global hotkey 'N' to open Add Transaction modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setEditingTransaction(null);
        setIsAddModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Loading Executive Ledger...
          </span>
        </div>
      </div>
    );
  }

  // Calculate Net Worth
  const totalAssets = data.accounts
    .filter((a) => a.balance >= 0)
    .reduce((sum, a) => sum + a.balance, 0);
  const totalDebt = data.accounts
    .filter((a) => a.balance < 0)
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);
  const netWorth = totalAssets - totalDebt;

  // Pending recurring bills this month
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const pendingBillsCount = data.recurringBills.filter((b) => {
    return !b.lastPaidDate || !b.lastPaidDate.startsWith(currentMonthStr);
  }).length;

  // Transaction Handlers
  const handleSaveTransaction = (txData: Omit<Transaction, 'id' | 'createdAt'>) => {
    updateData((prev) => {
      let updatedAccounts = [...prev.accounts];

      // Revert old transaction balance impact if editing
      if (editingTransaction) {
        const old = editingTransaction;
        if (old.type === 'income') {
          updatedAccounts = updatedAccounts.map((a) =>
            a.id === old.accountId ? { ...a, balance: a.balance - old.amount } : a
          );
        } else if (old.type === 'expense') {
          updatedAccounts = updatedAccounts.map((a) =>
            a.id === old.accountId ? { ...a, balance: a.balance + old.amount } : a
          );
        } else if (old.type === 'transfer' && old.toAccountId) {
          updatedAccounts = updatedAccounts.map((a) => {
            if (a.id === old.accountId) return { ...a, balance: a.balance + old.amount };
            if (a.id === old.toAccountId) return { ...a, balance: a.balance - old.amount };
            return a;
          });
        }
      }

      // Apply new transaction balance impact
      if (txData.type === 'income') {
        updatedAccounts = updatedAccounts.map((a) =>
          a.id === txData.accountId ? { ...a, balance: a.balance + txData.amount } : a
        );
      } else if (txData.type === 'expense') {
        updatedAccounts = updatedAccounts.map((a) =>
          a.id === txData.accountId ? { ...a, balance: a.balance - txData.amount } : a
        );
      } else if (txData.type === 'transfer' && txData.toAccountId) {
        updatedAccounts = updatedAccounts.map((a) => {
          if (a.id === txData.accountId) return { ...a, balance: a.balance - txData.amount };
          if (a.id === txData.toAccountId) return { ...a, balance: a.balance + txData.amount };
          return a;
        });
      }

      let updatedTransactions: Transaction[];
      if (editingTransaction) {
        updatedTransactions = prev.transactions.map((t) =>
          t.id === editingTransaction.id ? { ...t, ...txData } : t
        );
      } else {
        const newTx: Transaction = {
          ...txData,
          id: `tx_${Date.now()}`,
          createdAt: Date.now(),
        };
        updatedTransactions = [newTx, ...prev.transactions];
      }

      return {
        ...prev,
        accounts: updatedAccounts,
        transactions: updatedTransactions,
      };
    });

    setEditingTransaction(null);
  };

  const handleDeleteTransaction = (id: string) => {
    updateData((prev) => {
      const target = prev.transactions.find((t) => t.id === id);
      if (!target) return prev;

      let updatedAccounts = [...prev.accounts];
      if (target.type === 'income') {
        updatedAccounts = updatedAccounts.map((a) =>
          a.id === target.accountId ? { ...a, balance: a.balance - target.amount } : a
        );
      } else if (target.type === 'expense') {
        updatedAccounts = updatedAccounts.map((a) =>
          a.id === target.accountId ? { ...a, balance: a.balance + target.amount } : a
        );
      } else if (target.type === 'transfer' && target.toAccountId) {
        updatedAccounts = updatedAccounts.map((a) => {
          if (a.id === target.accountId) return { ...a, balance: a.balance + target.amount };
          if (a.id === target.toAccountId) return { ...a, balance: a.balance - target.amount };
          return a;
        });
      }

      return {
        ...prev,
        accounts: updatedAccounts,
        transactions: prev.transactions.filter((t) => t.id !== id),
      };
    });
  };

  // Account Handlers
  const handleSaveAccount = (account: Account) => {
    updateData((prev) => {
      const exists = prev.accounts.some((a) => a.id === account.id);
      return {
        ...prev,
        accounts: exists
          ? prev.accounts.map((a) => (a.id === account.id ? account : a))
          : [...prev.accounts, account],
      };
    });
  };

  const handleDeleteAccount = (accountId: string) => {
    updateData((prev) => ({
      ...prev,
      accounts: prev.accounts.filter((a) => a.id !== accountId),
    }));
  };

  const handleTransfer = (fromId: string, toId: string, amount: number, note?: string) => {
    const toAcc = data.accounts.find((a) => a.id === toId);

    handleSaveTransaction({
      type: 'transfer',
      amount,
      currency: data.settings.currency,
      date: getTodayDateString(),
      category: 'Transfer',
      accountId: fromId,
      toAccountId: toId,
      payee: `Transfer to ${toAcc?.name || 'Account'}`,
      note: note || undefined,
      tags: ['transfer'],
    });
  };

  // Budget Handlers
  const handleSaveBudget = (budget: Budget) => {
    updateData((prev) => {
      const exists = prev.budgets.some((b) => b.id === budget.id);
      return {
        ...prev,
        budgets: exists
          ? prev.budgets.map((b) => (b.id === budget.id ? budget : b))
          : [...prev.budgets, budget],
      };
    });
  };

  const handleDeleteBudget = (budgetId: string) => {
    updateData((prev) => ({
      ...prev,
      budgets: prev.budgets.filter((b) => b.id !== budgetId),
    }));
  };

  // Recurring Bill Handlers
  const handleSaveBill = (bill: RecurringBill) => {
    updateData((prev) => {
      const exists = prev.recurringBills.some((b) => b.id === bill.id);
      return {
        ...prev,
        recurringBills: exists
          ? prev.recurringBills.map((b) => (b.id === bill.id ? bill : b))
          : [...prev.recurringBills, bill],
      };
    });
  };

  const handleDeleteBill = (billId: string) => {
    updateData((prev) => ({
      ...prev,
      recurringBills: prev.recurringBills.filter((b) => b.id !== billId),
    }));
  };

  const handleMarkPaidBill = (bill: RecurringBill) => {
    const todayStr = getTodayDateString();

    handleSaveTransaction({
      type: 'expense',
      amount: bill.amount,
      currency: data.settings.currency,
      date: todayStr,
      category: bill.category,
      accountId: bill.accountId,
      payee: bill.title,
      note: `Recurring subscription payment for ${bill.title}`,
      tags: ['recurring', 'subscription'],
      isRecurring: true,
    });

    updateData((prev) => ({
      ...prev,
      recurringBills: prev.recurringBills.map((b) =>
        b.id === bill.id ? { ...b, lastPaidDate: todayStr } : b
      ),
    }));
  };

  // Goal Handlers
  const handleSaveGoal = (goal: SavingsGoal) => {
    updateData((prev) => {
      const exists = prev.goals.some((g) => g.id === goal.id);
      return {
        ...prev,
        goals: exists
          ? prev.goals.map((g) => (g.id === goal.id ? goal : g))
          : [...prev.goals, goal],
      };
    });
  };

  const handleDeleteGoal = (goalId: string) => {
    updateData((prev) => ({
      ...prev,
      goals: prev.goals.filter((g) => g.id !== goalId),
    }));
  };

  const handleContributeToGoal = (goalId: string, amount: number) => {
    updateData((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === goalId ? { ...g, currentAmount: g.currentAmount + amount } : g
      ),
    }));
  };

  // Category Handlers
  const handleSaveCategory = (category: CategoryDefinition) => {
    updateData((prev) => {
      const existingCategories = prev.categories || [];
      const existingIndex = existingCategories.findIndex(
        (c) => c.name.toLowerCase() === category.name.toLowerCase() && c.type === category.type
      );
      let updatedCategories: CategoryDefinition[];
      if (existingIndex >= 0) {
        updatedCategories = existingCategories.map((c, i) =>
          i === existingIndex ? { ...c, ...category } : c
        );
      } else {
        updatedCategories = [...existingCategories, { ...category, isCustom: true }];
      }
      return {
        ...prev,
        categories: updatedCategories,
      };
    });
  };

  const handleDeleteCategory = (categoryName: string) => {
    updateData((prev) => ({
      ...prev,
      categories: (prev.categories || []).filter((c) => c.name !== categoryName),
    }));
  };

  // Settings Handlers
  const handleUpdateSettings = (newSettings: Partial<UserSettings>) => {
    updateData((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...newSettings },
    }));
  };

  const handleToggleHideBalances = () => {
    handleUpdateSettings({ hideBalances: !data.settings.hideBalances });
  };

  return (
    <div className="space-y-6">
      {/* Executive Control Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl bg-card border border-border shadow-xs">
        {/* Net Worth & Mask */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  CEO Capital Vault
                </span>
                {isSyncing && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground animate-pulse">
                    <CloudCheck className="w-3 h-3" /> saving...
                  </span>
                )}
              </div>
              <div className="text-xl font-bold text-foreground tracking-tight tabular-nums">
                {formatCurrency(netWorth, data.settings.currency, data.settings.hideBalances)}
              </div>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground border-l border-border pl-4">
            <div>
              <span className="block text-[10px] uppercase font-semibold">Total Assets</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalAssets, data.settings.currency, data.settings.hideBalances)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-semibold">Total Liabilities</span>
              <span className="font-bold text-rose-600 dark:text-rose-400">
                {formatCurrency(totalDebt, data.settings.currency, data.settings.hideBalances)}
              </span>
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleHideBalances}
            className="text-xs font-semibold gap-1.5"
            title="Toggle privacy mask"
          >
            {data.settings.hideBalances ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{data.settings.hideBalances ? 'Masked' : 'Visible'}</span>
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setEditingTransaction(null);
              setIsAddModalOpen(true);
            }}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Transaction</span>
            <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-primary-foreground/20 rounded">
              N
            </kbd>
          </Button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.id === 'recurring' && pendingBillsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  {pendingBillsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab View */}
      <div>
        {activeTab === 'dashboard' && (
          <DashboardView
            data={data}
            onOpenAddModal={() => {
              setEditingTransaction(null);
              setIsAddModalOpen(true);
            }}
            onSelectTab={setActiveTab}
            onEditTransaction={(tx) => {
              setEditingTransaction(tx);
              setIsAddModalOpen(true);
            }}
            onDeleteTransaction={handleDeleteTransaction}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsView
            data={data}
            onOpenAddModal={() => {
              setEditingTransaction(null);
              setIsAddModalOpen(true);
            }}
            onEditTransaction={(tx) => {
              setEditingTransaction(tx);
              setIsAddModalOpen(true);
            }}
            onDeleteTransaction={handleDeleteTransaction}
            onSaveCategory={handleSaveCategory}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsView
            data={data}
            onSaveAccount={handleSaveAccount}
            onDeleteAccount={handleDeleteAccount}
            onTransfer={handleTransfer}
          />
        )}

        {activeTab === 'budgets' && (
          <BudgetsView
            data={data}
            onSaveBudget={handleSaveBudget}
            onDeleteBudget={handleDeleteBudget}
            onSaveCategory={handleSaveCategory}
          />
        )}

        {activeTab === 'recurring' && (
          <RecurringBillsView
            data={data}
            onSaveBill={handleSaveBill}
            onDeleteBill={handleDeleteBill}
            onMarkPaid={handleMarkPaidBill}
            onSaveCategory={handleSaveCategory}
          />
        )}

        {activeTab === 'goals' && (
          <GoalsView
            data={data}
            onSaveGoal={handleSaveGoal}
            onDeleteGoal={handleDeleteGoal}
            onContributeToGoal={handleContributeToGoal}
          />
        )}

        {activeTab === 'analytics' && <AnalyticsView data={data} />}

        {activeTab === 'settings' && (
          <SettingsView
            data={data}
            onUpdateSettings={handleUpdateSettings}
            onReloadData={(fresh) => {
              setData(fresh);
              saveFinanceData(fresh);
              saveCeoFinanceDataServer(fresh);
            }}
            onSaveCategory={handleSaveCategory}
            onDeleteCategory={handleDeleteCategory}
          />
        )}
      </div>

      {/* Add / Edit Transaction Modal */}
      <AddTransactionModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingTransaction(null);
        }}
        onSave={handleSaveTransaction}
        accounts={data.accounts}
        currency={data.settings.currency}
        categories={data.categories}
        onSaveCategory={handleSaveCategory}
        initialData={editingTransaction}
      />
    </div>
  );
}
