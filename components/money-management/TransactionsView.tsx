'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  Trash2,
  Edit3,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  X,
  Plus,
} from 'lucide-react';
import { FinanceData, Transaction } from '@/lib/money-management/types';
import { formatCurrency, formatDate } from '@/lib/money-management/utils';
import { exportTransactionsAsCSV } from '@/lib/money-management/storage';
import { CategoryDefinition, DEFAULT_CATEGORIES } from '@/lib/money-management/constants';
import { CategoryIcon } from './CategoryIcon';
import { CreateCategoryModal } from './CreateCategoryModal';
import { Button } from '@/components/ui/button';

interface TransactionsViewProps {
  data: FinanceData;
  onOpenAddModal: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onSaveCategory?: (category: CategoryDefinition) => void;
}

export function TransactionsView({
  data,
  onOpenAddModal,
  onEditTransaction,
  onDeleteTransaction,
  onSaveCategory,
}: TransactionsViewProps) {
  const { transactions, accounts, settings, categories = DEFAULT_CATEGORIES } = data;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // Unique categories in transactions + registered categories
  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => set.add(c.name));
    transactions.forEach((tx) => {
      if (tx.category) set.add(tx.category);
    });
    return Array.from(set).sort();
  }, [transactions, categories]);

  // Filtered & Sorted Transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesPayee = tx.payee.toLowerCase().includes(q);
          const matchesNote = tx.note?.toLowerCase().includes(q);
          const matchesCategory = tx.category.toLowerCase().includes(q);
          const matchesTag = tx.tags?.some((t) => t.toLowerCase().includes(q));
          if (!matchesPayee && !matchesNote && !matchesCategory && !matchesTag) {
            return false;
          }
        }

        // Type filter
        if (selectedType !== 'all' && tx.type !== selectedType) {
          return false;
        }

        // Account filter
        if (selectedAccount !== 'all') {
          if (tx.accountId !== selectedAccount && tx.toAccountId !== selectedAccount) {
            return false;
          }
        }

        // Category filter
        if (selectedCategory !== 'all' && tx.category !== selectedCategory) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date_desc') {
          return new Date(b.date).getTime() - new Date(a.date).getTime() || b.createdAt - a.createdAt;
        }
        if (sortBy === 'date_asc') {
          return new Date(a.date).getTime() - new Date(b.date).getTime() || a.createdAt - b.createdAt;
        }
        if (sortBy === 'amount_desc') {
          return b.amount - a.amount;
        }
        if (sortBy === 'amount_asc') {
          return a.amount - b.amount;
        }
        return 0;
      });
  }, [transactions, searchQuery, selectedType, selectedAccount, selectedCategory, sortBy]);

  // Calculate filtered totals
  const filteredInflow = filteredTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const filteredOutflow = filteredTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const handleExportCSV = () => {
    const csv = exportTransactionsAsCSV(filteredTransactions, accounts);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `artyx_transactions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedType('all');
    setSelectedAccount('all');
    setSelectedCategory('all');
    setSortBy('date_desc');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedType !== 'all' ||
    selectedAccount !== 'all' ||
    selectedCategory !== 'all' ||
    sortBy !== 'date_desc';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Ledger & Transaction History
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Audit logs, account transfers, category tagging, and cash flow entries.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="text-xs font-semibold gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </Button>

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
            onClick={onOpenAddModal}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Transaction</span>
          </Button>
        </div>
      </div>

      {/* Filtered Summary Capsule */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-medium">Filtered Outflow</span>
          <p className="text-lg font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
            -{formatCurrency(filteredOutflow, settings.currency, settings.hideBalances)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-medium">Filtered Inflow</span>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
            +{formatCurrency(filteredInflow, settings.currency, settings.hideBalances)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-medium">Matching Records</span>
          <p className="text-lg font-bold text-foreground tabular-nums mt-0.5">
            {filteredTransactions.length} <span className="text-xs font-normal text-muted-foreground">of {transactions.length} total</span>
          </p>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="p-4 rounded-xl bg-card border border-border shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search payee, note, or #tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background border border-input rounded-lg pl-10 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Type Filter Tabs */}
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border shrink-0 w-full md:w-auto">
            {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all cursor-pointer ${
                  selectedType === type
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Dropdowns Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
          {/* Account Filter */}
          <div>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Categories</option>
              {allCategoryNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="date_desc">Date (Newest First)</option>
              <option value="date_asc">Date (Oldest First)</option>
              <option value="amount_desc">Amount (Highest First)</option>
              <option value="amount_asc">Amount (Lowest First)</option>
            </select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-xs h-9 px-2.5"
                title="Reset all filters"
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Transactions Table / List */}
      <div className="rounded-xl bg-card border border-border shadow-xs overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <p className="text-sm font-semibold">No transactions found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your search terms or active filters
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-muted-foreground uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 pl-4">Transaction / Payee</th>
                  <th className="py-3">Category</th>
                  <th className="py-3">Account</th>
                  <th className="py-3">Date</th>
                  <th className="py-3 text-right">Amount</th>
                  <th className="py-3 text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredTransactions.map((tx) => {
                  const acc = accountMap.get(tx.accountId);
                  const toAcc = tx.toAccountId ? accountMap.get(tx.toAccountId) : null;

                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* Payee, Note & Tags */}
                      <td className="py-3 pl-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              tx.type === 'income'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : tx.type === 'expense'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            }`}
                          >
                            {tx.type === 'income' ? (
                              <ArrowDownLeft className="w-4 h-4" />
                            ) : tx.type === 'expense' ? (
                              <ArrowUpRight className="w-4 h-4" />
                            ) : (
                              <ArrowRightLeft className="w-4 h-4" />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-foreground text-xs">{tx.payee}</p>
                            {tx.note && (
                              <p className="text-[11px] text-muted-foreground line-clamp-1">{tx.note}</p>
                            )}
                            {tx.tags && tx.tags.length > 0 && (
                              <div className="flex items-center gap-1 mt-1">
                                {tx.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-foreground font-medium border border-border/50"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border border-border/60 text-foreground font-medium">
                          <CategoryIcon name={tx.category} className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{tx.category}</span>
                        </span>
                      </td>

                      {/* Account */}
                      <td className="py-3 text-muted-foreground">
                        {tx.type === 'transfer' ? (
                          <div className="flex items-center gap-1.5 text-foreground font-medium">
                            <span>{acc?.name || 'Account'}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-sky-600 dark:text-sky-400">{toAcc?.name || 'Account'}</span>
                          </div>
                        ) : (
                          <span className="text-foreground font-medium">{acc?.name || 'Account'}</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDate(tx.date)}
                      </td>

                      {/* Amount */}
                      <td className="py-3 text-right tabular-nums whitespace-nowrap">
                        <span
                          className={`font-bold ${
                            tx.type === 'income'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.type === 'expense'
                              ? 'text-foreground'
                              : 'text-sky-600 dark:text-sky-400'
                          }`}
                        >
                          {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                          {formatCurrency(tx.amount, settings.currency, settings.hideBalances)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right pr-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEditTransaction(tx)}
                            title="Edit"
                            className="w-7 h-7"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm(`Delete transaction "${tx.payee}"?`)) {
                                onDeleteTransaction(tx.id);
                              }
                            }}
                            title="Delete"
                            className="w-7 h-7 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Embedded Create Category Modal */}
      {isCreateCategoryOpen && onSaveCategory && (
        <CreateCategoryModal
          isOpen={isCreateCategoryOpen}
          onClose={() => setIsCreateCategoryOpen(false)}
          existingCategories={categories}
          onSave={(newCat) => {
            onSaveCategory(newCat);
          }}
        />
      )}
    </div>
  );
}
