import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft, CreditCard, DollarSign } from 'lucide-react'

export default async function DrawingsPage() {
  const drawings = await prisma.ownerDrawing.findMany({
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          title: true,
        },
      },
      bankAccount: {
        select: {
          bankName: true,
          accountName: true,
          accountNumber: true,
        },
      },
    },
    orderBy: { drawingDate: 'desc' },
  })

  const totalDrawings = drawings.reduce((sum, d) => sum + Number(d.amount), 0)

  return (
    <div className="space-y-6 p-4 md:p-6 w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Link href="/equity">
            <Button size="icon" variant="outline" className="border-border text-foreground hover:bg-muted">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Partner Drawings Log
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Personal drawings and advances against profit share taken by agency partners
            </p>
          </div>
        </div>

        <div className="bg-muted/60 border border-border px-4 py-2 rounded-xl text-right">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider block font-medium">
            Total Drawings Disbursed
          </span>
          <span className="text-lg font-bold font-mono text-orange-600 dark:text-orange-400">
            ৳{totalDrawings.toLocaleString()}
          </span>
        </div>
      </div>

      {drawings.length === 0 ? (
        <Card className="bg-card border-border/80 text-center py-12 rounded-2xl shadow-xs">
          <CardContent className="space-y-2">
            <CreditCard className="size-10 text-muted-foreground mx-auto opacity-60" />
            <p className="text-sm text-foreground">No partner drawings recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Drawing #</th>
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Disbursement Method</th>
                <th className="px-4 py-3">Reason / Description</th>
                <th className="px-4 py-3 text-right">Amount (৳)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {drawings.map(d => (
                <tr key={d.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-foreground">{d.drawingNumber}</td>
                  <td className="px-4 py-3">
                    <Link href={`/equity/${d.owner.id}`} className="font-semibold text-foreground hover:underline">
                      {d.owner.name}
                    </Link>
                    <span className="text-[11px] text-muted-foreground block">{d.owner.title}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(d.drawingDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px] border-border text-foreground">
                      {d.paymentMethod}
                    </Badge>
                    {d.bankAccount && (
                      <span className="text-[11px] text-muted-foreground block mt-0.5 font-mono">
                        {d.bankAccount.bankName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                    {d.reason || 'Personal drawing'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-orange-600 dark:text-orange-400 text-sm">
                    ৳{Number(d.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
