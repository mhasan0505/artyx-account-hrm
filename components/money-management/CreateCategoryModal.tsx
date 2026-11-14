'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, Check, Tag } from 'lucide-react';
import { CategoryDefinition, AVAILABLE_CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/money-management/constants';
import { CategoryIcon } from './CategoryIcon';
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

interface CreateCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (category: CategoryDefinition) => void;
  initialType?: 'expense' | 'income';
  existingCategories?: CategoryDefinition[];
}

export function CreateCategoryModal({
  isOpen,
  onClose,
  onSave,
  initialType = 'expense',
  existingCategories = [],
}: CreateCategoryModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'expense' | 'income'>(initialType);
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState('Tag');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setType(initialType);
      setColor(CATEGORY_COLORS[0]);
      setIcon(initialType === 'expense' ? 'ShoppingBag' : 'TrendingUp');
      setError(null);
    }
  }, [isOpen, initialType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a category name');
      return;
    }

    const isDuplicate = existingCategories.some(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase() && c.type === type
    );
    if (isDuplicate) {
      setError(`A ${type} category named "${trimmed}" already exists`);
      return;
    }

    onSave({
      id: `custom_cat_${Date.now()}`,
      name: trimmed,
      type,
      color,
      icon,
      isCustom: true,
    });

    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle>New Custom Category</DialogTitle>
              <DialogDescription>
                Create a customized label with an icon and badge color.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* Type Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Category Classification</label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted/60 border border-border">
              <button
                type="button"
                onClick={() => {
                  setType('expense');
                  setIcon('ShoppingBag');
                }}
                className={`py-1.5 rounded-md text-xs font-semibold transition-all ${
                  type === 'expense'
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Expense
              </button>
              <button
                type="button"
                onClick={() => {
                  setType('income');
                  setIcon('TrendingUp');
                }}
                className={`py-1.5 rounded-md text-xs font-semibold transition-all ${
                  type === 'income'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Income
              </button>
            </div>
          </div>

          {/* Category Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. AI Subscriptions, Studio Gear"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              className="text-xs"
              autoFocus
            />
          </div>

          {/* Color Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Badge Accent Color</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => {
                const isSelected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`size-6 rounded-full transition-transform flex items-center justify-center text-white ${
                      isSelected ? 'ring-2 ring-primary ring-offset-2 scale-110 shadow-sm' : 'opacity-85 hover:opacity-100 hover:scale-105'
                    }`}
                  >
                    {isSelected && <Check className="size-3" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Select Icon</label>
            <div className="grid grid-cols-6 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border max-h-36 overflow-y-auto">
              {AVAILABLE_CATEGORY_ICONS.map((iconName) => {
                const isSelected = icon === iconName;
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setIcon(iconName)}
                    className={`p-2 rounded-lg flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-xs font-bold scale-105'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <CategoryIcon name="" iconName={iconName} className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Preview */}
          <div className="p-3 rounded-lg border border-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Category Badge Preview:</span>
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
              style={{
                backgroundColor: `${color}18`,
                borderColor: `${color}40`,
                color: color,
              }}
            >
              <CategoryIcon name="" iconName={icon} className="size-3.5" color={color} />
              <span>{name.trim() || 'Sample Category'}</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save Category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
