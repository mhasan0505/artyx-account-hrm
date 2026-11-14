'use client';

import React from 'react';
import {
  Wallet,
  Building,
  CreditCard,
  PiggyBank,
  Smartphone,
  TrendingUp,
  Landmark,
} from 'lucide-react';
import { AccountType } from '@/lib/money-management/types';

interface AccountIconProps {
  type: AccountType;
  className?: string;
  color?: string;
}

export function AccountIcon({ type, className = 'size-4', color }: AccountIconProps) {
  const iconProps = {
    className,
    style: color ? { color } : undefined,
  };

  switch (type) {
    case 'cash':
      return <Wallet {...iconProps} />;
    case 'bank':
      return <Building {...iconProps} />;
    case 'credit':
      return <CreditCard {...iconProps} />;
    case 'savings':
      return <PiggyBank {...iconProps} />;
    case 'digital_wallet':
      return <Smartphone {...iconProps} />;
    case 'investment':
      return <TrendingUp {...iconProps} />;
    default:
      return <Landmark {...iconProps} />;
  }
}
