import { getBalanceSheet } from '../lib/actions/reports'
import { prisma } from '../lib/db'

async function checkLiveBalanceSheet() {
  console.log('--- Checking Balance Sheet on Live Data ---')
  
  const outlets = await prisma.outlet.findMany()
  
  for (const outlet of outlets) {
    console.log(`\nChecking Outlet: ${outlet.name} (${outlet.id})`)
    const bs = await getBalanceSheet(undefined, outlet.id)
    
    if (bs.success) {
      console.log('--- ASSETS ---')
      console.log(`Cash: ${bs.data.assets.cashOnHand}`)
      console.log(`Bank: ${bs.data.assets.bankBalances}`)
      console.log(`AR:   ${bs.data.assets.accountsReceivable}`)
      console.log(`Inv:  ${bs.data.assets.inventoryValue}`)
      console.log(`Total Assets: ${bs.data.assets.totalAssets}`)
      
      console.log('\n--- LIABILITIES ---')
      console.log(`AP:   ${bs.data.liabilities.accountsPayable}`)
      console.log(`Accrued Payroll: ${bs.data.liabilities.accruedPayroll}`)
      console.log(`Total Liabilities: ${bs.data.liabilities.totalLiabilities}`)
      
      console.log('\n--- EQUITY ---')
      console.log(`Capital: ${bs.data.equity.ownersCapital}`)
      console.log(`Retained Earnings: ${bs.data.equity.retainedEarnings}`)
      console.log(`Total Equity: ${bs.data.equity.totalEquity}`)
      
      console.log('\n--- BALANCING ---')
      console.log(`Discrepancy: ${bs.data.discrepancy}`)
      console.log(`isBalanced: ${bs.data.isBalanced}`)
    } else {
      console.error('Failed:', bs.error)
    }
  }
}

// Bypass Next.js Auth Guard for this script by mocking requireAuth in a quick & dirty way
// Actually, since we import getBalanceSheet directly, we can just stub headers if needed, 
// but it's easier to just temporarily comment out requireAuth in getBalanceSheet or pass a flag.
// Or we can just use vitest to run this script with a mocked requireAuth!
