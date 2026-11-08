import { PageHeader } from '@/components/page-header'
import { DiscountLimitsCard } from '@/components/settings/discount-limits-card'

export default function DiscountSettingsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 w-full">
      <PageHeader title="Discount Limits & Authorization Policies" />
      <p className="text-sm text-muted-foreground">
        Configure store-wide limits for discretionary cashier and manager discounts, requiring personal bcrypt PIN authorization for overrides.
      </p>
      <DiscountLimitsCard />
    </div>
  )
}
