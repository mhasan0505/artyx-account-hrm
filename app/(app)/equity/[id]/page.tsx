import { RecordDrawingModal } from '@/components/agency/drawing-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAgencyOwnerById } from '@/lib/actions/agency-equity'
import { prisma } from '@/lib/db'
import {
  ArrowDownRight,
  ArrowLeft,
  Coins,
  DollarSign,
  History,
  Scale,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const owner = await getAgencyOwnerById(id)
  if (!owner) {
    notFound()
  }

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
    },
  })

  const eqPct = Number(owner.equityPercentage)
  const capBal = Number(owner.currentCapitalBalance)
  const drawings = Number(owner.totalDrawings)
  const distributed = Number(owner.totalProfitDistributed)

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/equity">
            <Button
              size="icon"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs font-mono font-bold">
                {eqPct.toFixed(1)}% Shareholding
              </Badge>
              <Badge
                variant="outline"
                className="text-xs border-border text-foreground"
              >
                {owner.isActive ? 'Active Partner' : 'Inactive'}
              </Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mt-1 tracking-tight">
              {owner.name}
            </h1>
            <p className="text-xs text-primary font-medium">{owner.title}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <RecordDrawingModal
            ownerId={owner.id}
            ownerName={owner.name}
            bankAccounts={bankAccounts}
          />
        </div>
      </div>

      {/* KPI Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">
              Equity Share
            </CardTitle>
            <Scale className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {eqPct.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Ownership stake</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">
              Current Capital Balance
            </CardTitle>
            <DollarSign className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ৳{capBal.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Initial: ৳{Number(owner.initialCapital).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">
              Total Drawings Taken
            </CardTitle>
            <ArrowDownRight className="size-4 text-orange-600 dark:text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-orange-600 dark:text-orange-400">
              ৳{drawings.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Withdrawn against equity
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/80 text-card-foreground artyx-card rounded-2xl shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">
              Dividends Distributed
            </CardTitle>
            <Coins className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              ৳{distributed.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Profit share payouts received
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Partner Equity Ledger */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          Owner Equity Statement & Transaction Ledger
        </h2>

        {owner.ledger.length === 0 ? (
          <Card className="bg-card border-border/80 text-center py-8 rounded-2xl shadow-xs">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No equity transactions recorded yet
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Transaction Type</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Debit / Credit</th>
                  <th className="px-4 py-3 text-right">Capital Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {owner.ledger.map(entry => {
                  const isCredit =
                    entry.entryType === 'CAPITAL_INJECTED' ||
                    entry.entryType === 'PROFIT_SHARE'
                  return (
                    <tr key={entry.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            isCredit
                              ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                              : 'border-orange-500/30 text-orange-600 dark:text-orange-400 bg-orange-500/10'
                          }
                        >
                          {entry.entryType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {entry.reference || '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {entry.description}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold ${
                          isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'
                        }`}
                      >
                        {isCredit ? '+' : '-'}৳
                        {Number(entry.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                        ৳{Number(entry.balance).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
