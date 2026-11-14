'use client';

import React, { useState } from 'react';
import {
  Plus,
  ArrowRightLeft,
  Edit2,
  Trash2,
  Check,
} from 'lucide-react';
import { FinanceData, Account, AccountType } from '@/lib/money-management/types';
import { formatCurrency } from '@/lib/money-management/utils';
import { ACCOUNT_COLORS } from '@/lib/money-management/constants';
import { AccountIcon } from './AccountIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AccountsViewProps {
  data: FinanceData;
  onSaveAccount: (account: Account) => void;
  onDeleteAccount: (accountId: string) => void;
  onTransfer: (fromId: string, toId: string, amount: number, note?: string) => void;
}

export function AccountsView({
  data,
  onSaveAccount,
  onDeleteAccount,
  onTransfer,
}: AccountsViewProps) {
  const { accounts, settings, transactions } = data;

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Form states for account
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('bank');
  const [accBalance, setAccBalance] = useState('');
  const [accInstitution, setAccInstitution] = useState('');
  const [accNumber, setAccNumber] = useState('');
  const [accColor, setAccColor] = useState(ACCOUNT_COLORS[0]);

  // Form states for transfer
  const [transferFrom, setTransferFrom] = useState(accounts[0]?.id || '');
  const [transferTo, setTransferTo] = useState(accounts[1]?.id || '');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');

  // Assets and liabilities
  let totalAssets = 0;
  let totalLiabilities = 0;
  accounts.forEach((acc) => {
    if (acc.balance >= 0) {
      totalAssets += acc.balance;
    } else {
      totalLiabilities += Math.abs(acc.balance);
    }
  });

  const handleOpenAccountModal = (account?: Account) => {
    if (account) {
      setEditingAccount(account);
      setAccName(account.name);
      setAccType(account.type);
      setAccBalance(String(account.balance));
      setAccInstitution(account.institution || '');
      setAccNumber(account.accountNumber || '');
      setAccColor(account.color || ACCOUNT_COLORS[0]);
    } else {
      setEditingAccount(null);
      setAccName('');
      setAccType('bank');
      setAccBalance('0.00');
      setAccInstitution('');
      setAccNumber('');
      setAccColor(ACCOUNT_COLORS[0]);
    }
    setIsAccountModalOpen(true);
  };

  const handleSaveAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) {
      alert('Please enter an account name.');
      return;
    }

    const numBalance = parseFloat(accBalance) || 0;

    const newAccount: Account = {
      id: editingAccount ? editingAccount.id : `acc_${Date.now()}`,
      name: accName.trim(),
      type: accType,
      currency: settings.currency,
      balance: numBalance,
      color: accColor,
      icon: accType,
      institution: accInstitution.trim() || undefined,
      accountNumber: accNumber.trim() ? (accNumber.startsWith('••••') ? accNumber : `•••• ${accNumber.slice(-4)}`) : undefined,
    };

    onSaveAccount(newAccount);
    setIsAccountModalOpen(false);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid transfer amount.');
      return;
    }
    if (transferFrom === transferTo) {
      alert('Source and destination accounts must be different.');
      return;
    }

    onTransfer(transferFrom, transferTo, amount, transferNote.trim() || undefined);
    setIsTransferModalOpen(false);
    setTransferAmount('');
    setTransferNote('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Accounts & Wallets
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Monitor bank deposits, cash vaults, credit facilities, and corporate reserves.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsTransferModalOpen(true)}
            className="text-xs font-semibold gap-1.5"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-sky-500" />
            <span>Transfer Funds</span>
          </Button>
          <Button
            size="sm"
            onClick={() => handleOpenAccountModal()}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Account</span>
          </Button>
        </div>
      </div>

      {/* Aggregate Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">
            Total Assets
          </span>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
            {formatCurrency(totalAssets, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Bank deposits, cash, and investments</p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">
            Total Liabilities
          </span>
          <p className="text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-1">
            {formatCurrency(totalLiabilities, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Credit cards & outstanding debt</p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs text-xs">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">
            Net Capital Position
          </span>
          <p className="text-xl font-bold text-foreground tabular-nums mt-1">
            {formatCurrency(totalAssets - totalLiabilities, settings.currency, settings.hideBalances)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{accounts.length} active institutions</p>
        </div>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((acc) => {
          const accTxCount = transactions.filter(
            (t) => t.accountId === acc.id || t.toAccountId === acc.id
          ).length;

          return (
            <div
              key={acc.id}
              className="rounded-xl bg-card border border-border hover:border-border/80 transition-all p-5 flex flex-col justify-between shadow-xs relative overflow-hidden group"
            >
              {/* Top Accent Strip */}
              <div
                className="absolute top-0 inset-x-0 h-1"
                style={{ backgroundColor: acc.color }}
              />

              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${acc.color}20`, color: acc.color }}
                    >
                      <AccountIcon type={acc.type} className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {acc.name}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {acc.institution || acc.type.replace('_', ' ').toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenAccountModal(acc)}
                      title="Edit Account"
                      className="w-7 h-7"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    {accounts.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete "${acc.name}"?`)) {
                            onDeleteAccount(acc.id);
                          }
                        }}
                        title="Delete Account"
                        className="w-7 h-7 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Account Number & Info */}
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground font-mono">
                  <span>{acc.accountNumber || 'Primary Vault'}</span>
                  <span className="text-[11px] font-sans capitalize">{acc.type.replace('_', ' ')}</span>
                </div>

                {/* Balance display */}
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                    Current Balance
                  </p>
                  <p
                    className={`text-2xl font-bold tracking-tight tabular-nums mt-0.5 ${
                      acc.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
                    }`}
                  >
                    {formatCurrency(acc.balance, settings.currency, settings.hideBalances)}
                  </p>
                </div>
              </div>

              {/* Bottom Quick Row */}
              <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                <span>{accTxCount} transactions logged</span>
                <button
                  onClick={() => {
                    setTransferFrom(acc.id);
                    setIsTransferModalOpen(true);
                  }}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  Transfer <ArrowRightLeft className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Account Add/Edit Modal */}
      <Dialog open={isAccountModalOpen} onOpenChange={setIsAccountModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingAccount ? 'Edit Account' : 'Add New Account'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveAccountSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Account Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. City Bank Operating, bKash, Vault"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Account Type
                </label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value as AccountType)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="bank">Bank Checking</option>
                  <option value="savings">Savings Account</option>
                  <option value="credit">Credit Card</option>
                  <option value="cash">Physical Cash</option>
                  <option value="digital_wallet">Digital Wallet</option>
                  <option value="investment">Investment Portfolio</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Balance
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={accBalance}
                  onChange={(e) => setAccBalance(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Institution / Provider
                </label>
                <input
                  type="text"
                  placeholder="e.g. City Bank, HSBC"
                  value={accInstitution}
                  onChange={(e) => setAccInstitution(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Account Mask (Last 4)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 4821"
                  value={accNumber}
                  onChange={(e) => setAccNumber(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Color swatch picker */}
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-[11px]">
                Color Theme
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {ACCOUNT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAccColor(c)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                      accColor === c ? 'scale-110 ring-2 ring-primary ring-offset-2' : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  >
                    {accColor === c && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAccountModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
              >
                Save Account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transfer Modal */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-sky-500" />
              Transfer Funds Between Accounts
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleTransferSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-lg font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  From Account
                </label>
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  To Account
                </label>
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id} disabled={acc.id === transferFrom}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Memo / Note (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Move to savings vault"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsTransferModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-sky-600 hover:bg-sky-700 text-white"
              >
                Confirm Transfer
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
