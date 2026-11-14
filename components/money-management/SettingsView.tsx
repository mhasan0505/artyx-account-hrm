'use client';

import React, { useState } from 'react';
import {
  Coins,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  Cloud,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Tag,
  Plus,
} from 'lucide-react';
import { FinanceData, UserSettings } from '@/lib/money-management/types';
import { CURRENCIES, DEFAULT_CATEGORIES, CategoryDefinition } from '@/lib/money-management/constants';
import {
  exportDataAsJSON,
  importDataFromJSON,
  resetToSampleData,
  clearAllData,
  exportTransactionsAsCSV,
} from '@/lib/money-management/storage';
import { saveCeoFinanceDataServer } from '@/lib/actions/money-management';
import { CategoryIcon } from './CategoryIcon';
import { CreateCategoryModal } from './CreateCategoryModal';
import { Button } from '@/components/ui/button';

interface SettingsViewProps {
  data: FinanceData;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onReloadData: (freshData: FinanceData) => void;
  onSaveCategory?: (category: CategoryDefinition) => void;
  onDeleteCategory?: (categoryName: string) => void;
}

export function SettingsView({
  data,
  onUpdateSettings,
  onReloadData,
  onSaveCategory,
  onDeleteCategory,
}: SettingsViewProps) {
  const { settings, transactions, accounts, categories = DEFAULT_CATEGORIES } = data;

  const [importJsonText, setImportJsonText] = useState('');
  const [showImportArea, setShowImportArea] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [categoryTab, setCategoryTab] = useState<'all' | 'expense' | 'income'>('all');
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);

  const handleCurrencyChange = (code: string) => {
    const selected = CURRENCIES.find((c) => c.code === code);
    if (selected) {
      onUpdateSettings({
        currency: selected.code,
        currencySymbol: selected.symbol,
      });
    }
  };

  const handleExportJSON = () => {
    const jsonStr = exportDataAsJSON(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `artyx_finance_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportCSV = () => {
    const csv = exportTransactionsAsCSV(transactions, accounts);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `artyx_transactions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const imported = importDataFromJSON(text);
        onReloadData(imported);
        alert('Data imported and restored successfully!');
      } catch (err: any) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleManualImportText = () => {
    try {
      const imported = importDataFromJSON(importJsonText);
      onReloadData(imported);
      setImportJsonText('');
      setShowImportArea(false);
      alert('Data imported and restored successfully!');
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    }
  };

  const handleResetSampleData = () => {
    if (confirm('Load sample demonstration data? Any existing edits will be replaced with rich default demo figures.')) {
      const sample = resetToSampleData();
      onReloadData(sample);
    }
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to completely erase all transactions, accounts, and budgets? This cannot be undone unless you have a backup.')) {
      const blank = clearAllData();
      onReloadData(blank);
    }
  };

  const handleCloudSync = async () => {
    setSyncStatus('syncing');
    setSyncMessage('Syncing financial state to encrypted executive server vault...');

    try {
      const result = await saveCeoFinanceDataServer(data);
      if (result.success) {
        setSyncStatus('success');
        setSyncMessage('Financial ledger saved successfully to the corporate server database!');
      } else {
        setSyncStatus('error');
        setSyncMessage(result.error || 'Server sync error.');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Sync failed.');
    }
  };

  const filteredCategories = categories.filter((c) => {
    if (categoryTab === 'all') return true;
    return c.type === categoryTab;
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top Header */}
      <div className="pb-2 border-b border-border/70">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Preferences & Data Sovereignty
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Configure currency standards, category taxomony, backup vaults, and server persistence.
        </p>
      </div>

      {/* Currency & Appearance Section */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs space-y-5">
        <h2 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
          <Coins className="w-4 h-4 text-emerald-500" />
          <span>Currency & Regional Formats</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-[11px]">
              Primary Currency
            </label>
            <select
              value={settings.currency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} {c.symbol ? `(${c.symbol})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Active symbol:{' '}
              <span className="font-bold text-foreground">
                {settings.currencySymbol ? settings.currencySymbol : 'None (Plain numbers)'}
              </span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-[11px]">
              Executive Privacy Mask
            </label>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border">
              <span className="text-xs text-foreground">Mask balances in public</span>
              <Button
                variant={settings.hideBalances ? 'default' : 'outline'}
                size="sm"
                onClick={() => onUpdateSettings({ hideBalances: !settings.hideBalances })}
                className="text-xs font-semibold gap-1.5 h-8"
              >
                {settings.hideBalances ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{settings.hideBalances ? 'Masked' : 'Visible'}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Custom Currency Symbol input for full personalization */}
        <div className="pt-2 border-t border-border/60">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-[11px]">
            Custom Currency Symbol / Notation (Optional)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="e.g. ৳, BDT, Tk, €, Rs, or leave empty"
              value={settings.currencySymbol}
              onChange={(e) => {
                const val = e.target.value.replace(/\$/g, '');
                onUpdateSettings({ currencySymbol: val });
              }}
              className="max-w-xs bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-[11px] text-muted-foreground">
              Type custom prefix or leave blank for numerical values
            </span>
          </div>
        </div>
      </div>

      {/* Category Management Section */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              <span>Category Management</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customize categories used across transactions, budgets, and recurring subscriptions
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => setIsCreateCategoryOpen(true)}
            className="text-xs font-semibold gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Category</span>
          </Button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border w-fit">
          {(['all', 'expense', 'income'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setCategoryTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all cursor-pointer ${
                categoryTab === tab
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'all' ? `All (${categories.length})` : `${tab}s (${categories.filter((c) => c.type === tab).length})`}
            </button>
          ))}
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-2">
          {filteredCategories.map((cat) => (
            <div
              key={cat.name}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/70 hover:border-border transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${cat.color}25`, color: cat.color }}
                >
                  <CategoryIcon name={cat.name} iconName={cat.icon} className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{cat.name}</p>
                  <span className="text-[10px] text-muted-foreground capitalize">{cat.type}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                {cat.isCustom ? (
                  <>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      Custom
                    </span>
                    {onDeleteCategory && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete custom category "${cat.name}"?`)) {
                            onDeleteCategory(cat.name);
                          }
                        }}
                        className="w-6 h-6 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 ml-1"
                        title="Delete category"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5">
                    Default
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Backup, Export & Restore Section */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs space-y-4">
        <h2 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />
          <span>Data Export & Archival</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Your financial ledger is private and protected. You can export complete JSON snapshots or CSV spreadsheets anytime.
        </p>

        <div className="flex flex-wrap gap-2.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJSON}
            className="text-xs font-semibold gap-2"
          >
            <Download className="w-4 h-4 text-primary" />
            <span>Download JSON Backup</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="text-xs font-semibold gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>Export CSV</span>
          </Button>

          <label className="inline-flex items-center justify-center gap-2 rounded-lg text-xs font-semibold border border-input bg-background hover:bg-muted/80 px-3 py-2 cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-sky-500" />
            <span>Restore Backup File (.json)</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Text paste area for restore */}
        <div className="pt-2">
          <button
            onClick={() => setShowImportArea(!showImportArea)}
            className="text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            {showImportArea ? 'Hide raw JSON paste area' : 'Paste raw JSON backup string...'}
          </button>

          {showImportArea && (
            <div className="mt-2 space-y-2">
              <textarea
                rows={5}
                placeholder="Paste valid JSON backup string here..."
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="w-full bg-background border border-input rounded-lg p-3 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                onClick={handleManualImportText}
                className="text-xs font-semibold"
              >
                Restore from Paste
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Cloud & Server Sync */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs space-y-4">
        <h2 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
          <Cloud className="w-4 h-4 text-sky-500" />
          <span>Server Database Persistence</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Persist your full financial ledger to the secure server database so your balances and transactions stay in sync across devices.
        </p>

        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-foreground font-medium">
              Encrypted Corporate Postgres Vault
            </span>
          </div>

          <Button
            size="sm"
            onClick={handleCloudSync}
            disabled={syncStatus === 'syncing'}
            className="text-xs font-semibold"
          >
            {syncStatus === 'syncing' ? 'Syncing to Server...' : 'Sync to Server Vault'}
          </Button>
        </div>

        {syncMessage && (
          <p
            className={`text-xs p-2.5 rounded-lg border ${
              syncStatus === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
            }`}
          >
            {syncMessage}
          </p>
        )}
      </div>

      {/* Dangerous Zone */}
      <div className="p-5 rounded-xl bg-card border border-rose-500/30 space-y-4">
        <h2 className="text-base font-bold text-rose-600 dark:text-rose-400 tracking-tight flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-rose-500" />
          <span>Danger Zone & Reset</span>
        </h2>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetSampleData}
            className="text-xs font-semibold gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
            <span>Load Sample Demo Data</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            className="text-xs font-semibold gap-2 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear All Data</span>
          </Button>
        </div>
      </div>

      {/* Embedded Create Category Modal */}
      {isCreateCategoryOpen && (
        <CreateCategoryModal
          isOpen={isCreateCategoryOpen}
          onClose={() => setIsCreateCategoryOpen(false)}
          existingCategories={categories}
          onSave={(newCat) => {
            if (onSaveCategory) {
              onSaveCategory(newCat);
            }
          }}
        />
      )}
    </div>
  );
}
