'use client';

import React from 'react';
import {
  Utensils,
  Coffee,
  ShoppingCart,
  ShoppingBag,
  Home,
  Zap,
  Car,
  Fuel,
  Laptop,
  Smartphone,
  Gamepad2,
  Film,
  Music,
  Activity,
  Dumbbell,
  Heart,
  Plane,
  BookOpen,
  GraduationCap,
  Briefcase,
  Code,
  TrendingUp,
  Gift,
  Sparkles,
  Tag,
  Wallet,
  Landmark,
  PiggyBank,
  Coins,
  Building,
  RotateCcw,
  PlusCircle,
  MoreHorizontal,
  ArrowRightLeft,
} from 'lucide-react';

interface CategoryIconProps {
  name: string;
  iconName?: string;
  className?: string;
  color?: string;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Utensils,
  Coffee,
  ShoppingCart,
  ShoppingBag,
  Home,
  Zap,
  Car,
  Fuel,
  Laptop,
  Smartphone,
  Gamepad2,
  Film,
  Music,
  Activity,
  Dumbbell,
  Heart,
  Plane,
  BookOpen,
  GraduationCap,
  Briefcase,
  Code,
  TrendingUp,
  Gift,
  Sparkles,
  Tag,
  Wallet,
  Landmark,
  PiggyBank,
  Coins,
  Building,
  RotateCcw,
  PlusCircle,
  MoreHorizontal,
  ArrowRightLeft,
};

export function CategoryIcon({ name, iconName, className = 'size-4', color }: CategoryIconProps) {
  const iconKey = iconName && ICON_MAP[iconName] ? iconName : getIconForCategory(name);
  const IconComponent = ICON_MAP[iconKey] || MoreHorizontal;

  return (
    <IconComponent
      className={className}
      style={color ? { color } : undefined}
    />
  );
}

function getIconForCategory(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('food') || lower.includes('dining') || lower.includes('restaurant')) return 'Utensils';
  if (lower.includes('coffee') || lower.includes('cafe')) return 'Coffee';
  if (lower.includes('grocer') || lower.includes('market')) return 'ShoppingCart';
  if (lower.includes('housing') || lower.includes('rent') || lower.includes('apartment')) return 'Home';
  if (lower.includes('util') || lower.includes('electric') || lower.includes('bill')) return 'Zap';
  if (lower.includes('transport') || lower.includes('transit') || lower.includes('car')) return 'Car';
  if (lower.includes('fuel') || lower.includes('gas')) return 'Fuel';
  if (lower.includes('tech') || lower.includes('software') || lower.includes('computer')) return 'Laptop';
  if (lower.includes('phone') || lower.includes('mobile')) return 'Smartphone';
  if (lower.includes('game') || lower.includes('gaming')) return 'Gamepad2';
  if (lower.includes('entertain') || lower.includes('movie') || lower.includes('film')) return 'Film';
  if (lower.includes('music') || lower.includes('audio')) return 'Music';
  if (lower.includes('health') || lower.includes('medical') || lower.includes('fitness')) return 'Activity';
  if (lower.includes('gym') || lower.includes('workout')) return 'Dumbbell';
  if (lower.includes('travel') || lower.includes('flight') || lower.includes('vacation')) return 'Plane';
  if (lower.includes('edu') || lower.includes('school') || lower.includes('book')) return 'BookOpen';
  if (lower.includes('salary') || lower.includes('payroll') || lower.includes('wage')) return 'Briefcase';
  if (lower.includes('freelance') || lower.includes('project') || lower.includes('client')) return 'Code';
  if (lower.includes('profit') || lower.includes('dividend') || lower.includes('invest')) return 'TrendingUp';
  if (lower.includes('gift') || lower.includes('donation')) return 'Gift';
  if (lower.includes('shop') || lower.includes('gear') || lower.includes('clothing')) return 'ShoppingBag';
  if (lower.includes('transfer')) return 'ArrowRightLeft';
  return 'Tag';
}
