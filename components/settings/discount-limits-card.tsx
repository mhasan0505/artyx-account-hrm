'use client'

import { useEffect, useState, useTransition } from 'react'
import { getDiscountLimitSettings, updateDiscountLimitSettings } from '@/lib/actions/settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ShieldAlert, Percent, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export function DiscountLimitsCard() {
  const [cashierLimit, setCashierLimit] = useState<number>(0)
  const [managerLimit, setManagerLimit] = useState<number>(10)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getDiscountLimitSettings()
      .then(res => {
        if (res.success && res.data) {
          setCashierLimit(res.data.cashierLimitPct)
          setManagerLimit(res.data.managerLimitPct)
        }
      })
      .catch(err => {
        console.error('Failed to load discount limits:', err)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  function handleSave() {
    if (cashierLimit < 0 || cashierLimit > 100) {
      toast.error('Cashier limit must be between 0% and 100%')
      return
    }
    if (managerLimit < 0 || managerLimit > 100) {
      toast.error('Manager limit must be between 0% and 100%')
      return
    }
    if (cashierLimit > managerLimit) {
      toast.error('Cashier limit cannot exceed Manager limit')
      return
    }

    startTransition(async () => {
      const res = await updateDiscountLimitSettings({
        cashierLimitPct: cashierLimit,
        managerLimitPct: managerLimit,
      })
      if (!res.success) {
        toast.error(res.error || 'Failed to update discount limits')
        return
      }
      toast.success('Discount limits saved successfully')
    })
  }

  return (
    <Card className="border-border/60 bg-muted/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Percent className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Discretionary Discount Approval Limits</CardTitle>
            <CardDescription className="text-xs">
              Configure maximum discretionary discount percentages permitted before requiring supervisory authorization.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-6 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading discount policies…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 p-3 rounded-lg border bg-background">
                <Label htmlFor="cashier-discount-limit" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Cashier Maximum Discount</span>
                  <span className="font-mono text-primary">{cashierLimit}%</span>
                </Label>
                <div className="relative">
                  <Input
                    id="cashier-discount-limit"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={cashierLimit}
                    onChange={e => setCashierLimit(Number(e.target.value))}
                    className="font-mono pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Discounts exceeding this threshold require selection of an authorizing manager and entry of their bcrypt PIN.
                </p>
              </div>

              <div className="space-y-1.5 p-3 rounded-lg border bg-background">
                <Label htmlFor="manager-discount-limit" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Manager Maximum Discount</span>
                  <span className="font-mono text-primary">{managerLimit}%</span>
                </Label>
                <div className="relative">
                  <Input
                    id="manager-discount-limit"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={managerLimit}
                    onChange={e => setManagerLimit(Number(e.target.value))}
                    className="font-mono pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Discounts exceeding this limit require approval from an Admin or Super-Admin with sufficient authority.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Security & Audit Compliance</p>
                <p className="text-[11px] text-muted-foreground dark:text-blue-300">
                  Shared plaintext override PINs are eliminated. Approvals use individual bcrypt manager credentials with rate-limiting and audit trail logging.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={handleSave} disabled={isPending} size="sm" className="gap-1.5 pressable">
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving Limits…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Save Discount Limits
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
