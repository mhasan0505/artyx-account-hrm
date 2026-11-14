'use client';

import React, { useState, useEffect } from 'react';
import { ArrowDownRight, ArrowUpRight, ArrowRightLeft, Plus } from 'lucide-react';
import { Transaction, TransactionType, Account } from '@/lib/money-management/types';
import { DEFAULT_CATEGORIES, CategoryDefinition } from '@/lib/money-management/constants';
import { getTodayDateString } from '@/lib/money-management/utils';
import { CreateCategoryModal } from './CreateCategoryModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CategoryIcon } from './CategoryIcon';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tx: Omit<Transaction, 'id' | 'createdAt'>) => void;
  accounts: Account[];
  currency: string;
  categories?: CategoryDefinition[];
  onSaveCategory?: (category: CategoryDefinition) => void;
  initialData?: Transaction | null;
}

export function AddTransactionModal({
  isOpen,
  onClose,
  onSave,
  accounts,
  currency,
  categories = DEFAULT_CATEGORIES,
  onSaveCategory,
  initialData,
}: AddTransactionModalProps) {
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(getTodayDateString());
  const [category, setCategory] = useState<string>('Food & Dining');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState<string>(accounts[1]?.id || '');
  const [payee, setPayee] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [tagInput, setTagInput] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setType(initialData.type);
      setAmount(String(initialData.amount));
      setDate(initialData.date);
      setCategory(initialData.category);
      setAccountId(initialData.accountId);
      setToAccountId(initialData.toAccountId || accounts[1]?.id || '');
      setPayee(initialData.payee);
      setNote(initialData.note || '');
      setTags(initialData.tags || []);
      setIsRecurring(Boolean(initialData.isRecurring));
      setError(null);
    } else {
      setType('expense');
      setAmount('');
      setDate(getTodayDateString());
      setCategory('Food & Dining');
      setAccountId(accounts[0]?.id || '');
      setToAccountId(accounts[1]?.id || '');
      setPayee('');
      setNote('');
      setTags([]);
      setIsRecurring(false);
      setError(null);
    }
  }, [initialData, isOpen, accounts]);

  // Filter categories by type
  const availableCategories = categories.filter((c) => c.type === type);

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }

    if (!accountId) {
      setError('Please select an account');
      return;
    }

    if (type === 'transfer' && accountId === toAccountId) {
      setError('Source and destination accounts must be different');
      return;
    }

    onSave({
      type,
      amount: numAmount,
      currency,
      date,
      category: type === 'transfer' ? 'Transfer' : category,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      payee: payee.trim() || (type === 'transfer' ? 'Account Transfer' : 'Unspecified Payee'),
      note: note.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      isRecurring,
    });

    onClose();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {initialData ? 'Edit Transaction' : 'Record Transaction'}
            </DialogTitle>
            <DialogDescription>
              {initialData
                ? 'Update transaction amount, account, or classification.'
                : 'Log a new personal expense, income, or internal transfer.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {error}
              </div>
            )}

            {/* Type Switcher */}
            <div className="grid grid-cols-3 gap-2 p-1 rounded-lg bg-muted/60 border border-border">
              <button
                type="button"
                onClick={() => setType('expense')}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  type === 'expense'
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowDownRight className="size-3.5" />
                <span>Expense</span>
              </button>
              <button
                type="button"
                onClick={() => setType('income')}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  type === 'income'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowUpRight className="size-3.5" />
                <span>Income</span>
              </button>
              <button
                type="button"
                onClick={() => setType('transfer')}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  type === 'transfer'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowRightLeft className="size-3.5" />
                <span>Transfer</span>
              </button>
            </div>

            {/* Amount & Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Amount <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (error) setError(null);
                  }}
                  className="font-mono text-base font-bold"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Date <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>
            </div>

            {/* Accounts */}
            {type === 'transfer' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">From Account</label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-popover text-popover-foreground">
                        {a.name} ({a.balance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">To Account</label>
                  <select
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-popover text-popover-foreground">
                        {a.name} ({a.balance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {type === 'expense' ? 'Paid From' : 'Deposited To'}
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-popover text-popover-foreground">
                        {a.name} ({a.balance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-foreground">Category</label>
                    {onSaveCategory && (
                      <button
                        type="button"
                        onClick={() => setIsCreateCategoryOpen(true)}
                        className="text-[11px] text-primary hover:underline font-medium flex items-center gap-0.5"
                      >
                        <Plus className="size-3" /> New
                      </button>
                    )}
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {availableCategories.map((c) => (
                      <option key={c.name} value={c.name} className="bg-popover text-popover-foreground">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Payee / Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {type === 'expense' ? 'Payee / Merchant' : type === 'income' ? 'Payer / Source' : 'Reference / Description'}
              </label>
              <Input
                type="text"
                placeholder={
                  type === 'expense' ? 'e.g. Apex Hardware, Uber, Cloudflare' : 'e.g. Agency Distribution, Client Project'
                }
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                className="text-xs"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Notes (Optional)</label>
              <Input
                type="text"
                placeholder="Additional memo or reference notes..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="text-xs"
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Tags</label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Add tag and press Enter..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="text-xs"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddTag}>
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      onClick={() => handleRemoveTag(tag)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-muted border border-border text-foreground cursor-pointer hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                      title="Click to remove tag"
                    >
                      #{tag} ×
                    </span>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                {initialData ? 'Update Record' : 'Save Transaction'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Category Creation Sub-modal */}
      {onSaveCategory && (
        <CreateCategoryModal
          isOpen={isCreateCategoryOpen}
          onClose={() => setIsCreateCategoryOpen(false)}
          onSave={(newCat) => {
            onSaveCategory(newCat);
            setCategory(newCat.name);
          }}
          initialType={type === 'income' ? 'income' : 'expense'}
          existingCategories={categories}
        />
      )}
    </>
  );
}
