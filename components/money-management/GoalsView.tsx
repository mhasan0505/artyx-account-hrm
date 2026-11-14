'use client';

import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Target,
  Plus,
  Trophy,
  Sparkles,
  Trash2,
  Edit2,
  CheckCircle2,
} from 'lucide-react';
import { FinanceData, SavingsGoal } from '@/lib/money-management/types';
import { formatCurrency, formatDate } from '@/lib/money-management/utils';
import { ACCOUNT_COLORS } from '@/lib/money-management/constants';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface GoalsViewProps {
  data: FinanceData;
  onSaveGoal: (goal: SavingsGoal) => void;
  onDeleteGoal: (goalId: string) => void;
  onContributeToGoal: (goalId: string, amount: number) => void;
}

export function GoalsView({
  data,
  onSaveGoal,
  onDeleteGoal,
  onContributeToGoal,
}: GoalsViewProps) {
  const { goals, settings } = data;

  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [activeGoal, setActiveGoal] = useState<SavingsGoal | null>(null);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [targetDate, setTargetDate] = useState('2027-06-30');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]);
  const [notes, setNotes] = useState('');

  // Deposit input
  const [depositAmount, setDepositAmount] = useState('');

  const triggerCelebration = () => {
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10B981', '#6366F1', '#EC4899', '#F59E0B'],
      });
    } catch (e) {
      console.log('Confetti triggered', e);
    }
  };

  const handleOpenGoalModal = (goal?: SavingsGoal) => {
    if (goal) {
      setEditingGoal(goal);
      setTitle(goal.title);
      setTargetAmount(String(goal.targetAmount));
      setCurrentAmount(String(goal.currentAmount));
      setTargetDate(goal.targetDate);
      setColor(goal.color);
      setNotes(goal.notes || '');
    } else {
      setEditingGoal(null);
      setTitle('');
      setTargetAmount('2500');
      setCurrentAmount('500');
      setTargetDate('2027-06-30');
      setColor(ACCOUNT_COLORS[0]);
      setNotes('');
    }
    setIsGoalModalOpen(true);
  };

  const handleSaveGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(targetAmount);
    const current = parseFloat(currentAmount) || 0;
    if (!title.trim() || isNaN(target) || target <= 0) {
      alert('Please enter a valid title and target amount.');
      return;
    }

    const newGoal: SavingsGoal = {
      id: editingGoal ? editingGoal.id : `g_${Date.now()}`,
      title: title.trim(),
      targetAmount: target,
      currentAmount: current,
      targetDate,
      color,
      icon: 'Target',
      notes: notes.trim() || undefined,
    };

    onSaveGoal(newGoal);
    setIsGoalModalOpen(false);

    if (current >= target) {
      triggerCelebration();
    }
  };

  const handleOpenDepositModal = (goal: SavingsGoal) => {
    setActiveGoal(goal);
    setDepositAmount('');
    setIsDepositModalOpen(true);
  };

  const handleDepositSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(depositAmount);
    if (!activeGoal || isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    onContributeToGoal(activeGoal.id, amount);
    setIsDepositModalOpen(false);

    if (activeGoal.currentAmount + amount >= activeGoal.targetAmount) {
      triggerCelebration();
    }
  };

  // Metrics
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.currentAmount, 0);
  const totalProgress = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/70">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Savings Goals & Strategic Reserves
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Set aside retained earnings, runway targets, and capital expansion funds.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => handleOpenGoalModal()}
          className="text-xs font-semibold gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Goal</span>
        </Button>
      </div>

      {/* Aggregate Progress Banner */}
      <div className="p-5 rounded-xl bg-card border border-border shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total Capital Stash
            </span>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight tabular-nums">
                {formatCurrency(totalSaved, settings.currency, settings.hideBalances)}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                of {formatCurrency(totalTarget, settings.currency, settings.hideBalances)} target ({totalProgress}%)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={triggerCelebration}
              className="text-xs font-semibold gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Celebrate</span>
            </Button>
          </div>
        </div>

        <div className="w-full bg-muted rounded-full h-3 overflow-hidden p-0.5 border border-border">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${Math.min(100, totalProgress)}%` }}
          />
        </div>
      </div>

      {/* Goals Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {goals.map((g) => {
          const percent = Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100));
          const isCompleted = g.currentAmount >= g.targetAmount;
          const remainingAmount = Math.max(0, g.targetAmount - g.currentAmount);

          return (
            <div
              key={g.id}
              className="p-5 rounded-xl bg-card border border-border hover:border-border/80 transition-all shadow-xs flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${g.color}20`, color: g.color }}
                    >
                      {isCompleted ? <Trophy className="w-5 h-5 text-amber-500" /> : <Target className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {g.title}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        Target: {formatDate(g.targetDate)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenGoalModal(g)}
                      className="w-7 h-7"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Delete goal "${g.title}"?`)) {
                          onDeleteGoal(g.id);
                        }
                      }}
                      className="w-7 h-7 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {g.notes && (
                  <p className="text-xs text-muted-foreground mt-2.5 line-clamp-2 italic">
                    &ldquo;{g.notes}&rdquo;
                  </p>
                )}

                {/* Amount figures */}
                <div className="mt-4 flex items-baseline justify-between tabular-nums">
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">Saved</span>
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(g.currentAmount, settings.currency, settings.hideBalances)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">Target</span>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {formatCurrency(g.targetAmount, settings.currency, settings.hideBalances)}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2.5 w-full bg-muted rounded-full h-2.5 overflow-hidden border border-border">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: isCompleted ? '#10B981' : g.color,
                    }}
                  />
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                {isCompleted ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4" /> Goal Achieved!
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {formatCurrency(remainingAmount, settings.currency)} to go ({percent}%)
                  </span>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenDepositModal(g)}
                  className="h-7 px-2.5 text-xs font-semibold gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Contribute</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Goal Add/Edit Modal */}
      <Dialog open={isGoalModalOpen} onOpenChange={setIsGoalModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingGoal ? 'Edit Savings Goal' : 'Create Savings Goal'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveGoalSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Goal Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Q4 Executive Bonus Pool, Tech Infrastructure Upgrade"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Target Amount
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  required
                  placeholder="3000"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                  Initial Saved
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={currentAmount}
                  onChange={(e) => setCurrentAmount(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Target Date
              </label>
              <input
                type="date"
                required
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Why this matters, purpose, or milestone terms"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsGoalModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
              >
                Save Goal
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deposit Modal */}
      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Contribute to {activeGoal?.title}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleDepositSubmit} className="space-y-4 text-xs pt-2">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-muted-foreground mb-1 text-[11px]">
                Contribution Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                autoFocus
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsDepositModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Add Contribution
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
