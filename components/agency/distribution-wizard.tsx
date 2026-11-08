'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  calculateProfitDistributionPreview,
  createProfitDistributionBatch,
} from '@/lib/actions/agency-equity'
import { toast } from 'sonner'
import { Coins, Calculator, CheckCircle2, DollarSign, Scale, ArrowRight } from 'lucide-react'

export function DistributionWizard() {
  const router = useRouter()
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [creatingBatch, setCreatingBatch] = useState(false)

  // Default to previous month or current quarter
  const now = new Date()
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 0)

  const [startDate, setStartDate] = useState(firstDayOfMonth.toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(lastDayOfMonth.toISOString().split('T')[0])
  const [retainedReservePct, setRetainedReservePct] = useState('20')
  const [batchTitle, setBatchTitle] = useState(
    `Profit Share Distribution — ${firstDayOfMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}`
  )

  const [preview, setPreview] = useState<any>(null)

  async function handleCalculate() {
    try {
      setLoadingPreview(true)
      const data = await calculateProfitDistributionPreview({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        retainedReservePercentage: parseFloat(retainedReservePct) || 20,
      })
      setPreview(data)
      toast.success('Profit distribution calculated successfully!')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Calculation failed')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleCreateBatch() {
    if (!preview || preview.distributableProfit <= 0) {
      toast.error('Distributable profit must be greater than zero')
      return
    }

    try {
      setCreatingBatch(true)
      const res = await createProfitDistributionBatch({
        title: batchTitle,
        periodStartDate: new Date(startDate),
        periodEndDate: new Date(endDate),
        periodType: 'MONTHLY',
        retainedReservePercentage: parseFloat(retainedReservePct) || 20,
      })

      if (res.success) {
        toast.success(`Distribution batch ${res.batch.batchNumber} approved!`)
        setPreview(null)
        router.refresh()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve distribution batch')
    } finally {
      setCreatingBatch(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Wizard Form */}
      <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
            <Calculator className="size-5 text-[#3E7000] dark:text-[#7FFF00]" />
            Profit Share Calculator & Distribution Wizard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Period Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Period End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Company Retained Reserve (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={retainedReservePct}
                onChange={e => setRetainedReservePct(e.target.value)}
                className="bg-background border-border text-foreground font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Kept in bank as operational buffer</p>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                onClick={handleCalculate}
                disabled={loadingPreview}
                className="w-full bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
              >
                {loadingPreview ? 'Calculating...' : 'Calculate Profit Split'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Preview Result */}
      {preview && (
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs space-y-6 p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
            <div>
              <h3 className="text-lg font-bold text-foreground">Period Calculation Summary</h3>
              <p className="text-xs text-muted-foreground">
                {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground font-medium">Distribution Batch Title</Label>
              <Input
                value={batchTitle}
                onChange={e => setBatchTitle(e.target.value)}
                className="bg-background border-border text-foreground text-xs w-72"
              />
            </div>
          </div>

          {/* Metric Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className="bg-muted/50 p-3 rounded-xl border border-border">
              <span className="text-muted-foreground uppercase text-[10px] block">Period Revenue</span>
              <span className="font-mono font-bold text-base text-foreground">
                ৳{preview.totalRevenue.toLocaleString()}
              </span>
            </div>

            <div className="bg-muted/50 p-3 rounded-xl border border-border">
              <span className="text-muted-foreground uppercase text-[10px] block">Period Expenses</span>
              <span className="font-mono font-bold text-base text-rose-600 dark:text-rose-400">
                -৳{preview.totalExpenses.toLocaleString()}
              </span>
            </div>

            <div className="bg-muted/50 p-3 rounded-xl border border-border">
              <span className="text-muted-foreground uppercase text-[10px] block">Net Operating Profit</span>
              <span className="font-mono font-bold text-base text-sky-600 dark:text-sky-400">
                ৳{preview.netProfit.toLocaleString()}
              </span>
            </div>

            <div className="bg-muted/50 p-3 rounded-xl border border-border">
              <span className="text-muted-foreground uppercase text-[10px] block">
                Retained Reserve ({preview.retainedReservePercentage}%)
              </span>
              <span className="font-mono font-bold text-base text-amber-600 dark:text-amber-400">
                ৳{preview.retainedReserveAmount.toLocaleString()}
              </span>
            </div>

            <div className="bg-muted/50 p-3 rounded-xl border border-border col-span-2 md:col-span-1">
              <span className="text-muted-foreground uppercase text-[10px] block">Distributable Profit</span>
              <span className="font-mono font-bold text-base text-[#3E7000] dark:text-[#7FFF00]">
                ৳{preview.distributableProfit.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Breakdown Per Partner */}
          <div className="space-y-3">
            <h4 className="font-bold text-foreground uppercase text-xs tracking-wider">
              Partner Equity Profit Allocation
            </h4>
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Partner</th>
                    <th className="px-4 py-3 text-center">Equity %</th>
                    <th className="px-4 py-3 text-right">Gross Dividend Share</th>
                    <th className="px-4 py-3 text-right">Drawings Deducted</th>
                    <th className="px-4 py-3 text-right">Net Payable Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {preview.owners.map((owner: any) => (
                    <tr key={owner.ownerId} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {owner.name}
                        <span className="text-[11px] text-muted-foreground block font-normal">{owner.title}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                        {owner.equityPercentage}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        ৳{owner.calculatedShare.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-orange-600 dark:text-orange-400">
                        -৳{owner.drawingsInPeriod.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-[#3E7000] dark:text-[#7FFF00] text-sm">
                        ৳{owner.netPayable.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex justify-end items-center gap-3 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(null)}
              className="border-border text-foreground hover:bg-muted"
            >
              Discard Preview
            </Button>
            <Button
              type="button"
              onClick={handleCreateBatch}
              disabled={creatingBatch || preview.distributableProfit <= 0}
              className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#6ee600] dark:text-black font-semibold shadow-xs"
            >
              <CheckCircle2 className="size-4 mr-1.5" />
              {creatingBatch ? 'Approving...' : 'Approve & Create Distribution Batch'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
