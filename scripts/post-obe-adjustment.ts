import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getBalanceSheet } from '../lib/actions/reports'
import { prisma } from '../lib/db'

async function postObeAdjustment() {
  console.log('====================================================')
  console.log('1. RUNNING FRESH BALANCE SHEET ANALYSIS')
  console.log('====================================================')

  const initialBs = await getBalanceSheet()
  if (!initialBs.success) {
    console.error('Failed to calculate balance sheet:', initialBs.error)
    process.exit(1)
  }

  const { assets, liabilities, equity, discrepancy, isBalanced } = initialBs.data

  console.log(`Total Assets:             ৳${assets.totalAssets.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Total Liabilities:        ৳${liabilities.totalLiabilities.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Owner's Capital:          ৳${equity.ownersCapital.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Opening Balance Equity:   ৳${equity.openingBalanceEquity.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Retained Earnings:        ৳${equity.retainedEarnings.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Total Equity:             ৳${equity.totalEquity.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Total Liabilities + Eq:   ৳${(liabilities.totalLiabilities + equity.totalEquity).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Current Discrepancy:      ৳${discrepancy.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Is Balanced:              ${isBalanced}`)

  // 2. CHECK FOR EXISTING OBE INITIALIZATION TRANSACTION (IDEMPOTENCY / BLOCK DUPLICATES)
  const existingObe = await prisma.accountLedgerEntry.findFirst({
    where: {
      referenceType: 'OBE_INITIALIZATION',
    },
  })

  if (existingObe) {
    console.log('\n[BLOCK] One-time Opening Balance Equity adjustment has ALREADY been posted!')
    console.log(`  Reference ID: ${existingObe.referenceId}`)
    console.log(`  Amount: ৳${Number(existingObe.amount)} (${existingObe.type})`)
    console.log(`  Date Posted: ${existingObe.createdAt}`)
    console.log('  Duplicate execution prevented.')
    process.exit(0)
  }

  if (isBalanced || Math.abs(discrepancy) < 0.01) {
    console.log('\nBalance sheet is already perfectly balanced! No OBE entry needed.')
    process.exit(0)
  }

  console.log('\n====================================================')
  console.log('2. CREATING ONE-TIME OPENING BALANCE EQUITY ENTRY')
  console.log('====================================================')

  // Get or Create Chart of Account 3200
  let coa3200 = await prisma.chartOfAccount.findUnique({
    where: { code: '3200' },
  })

  if (!coa3200) {
    coa3200 = await prisma.chartOfAccount.create({
      data: {
        code: '3200',
        name: 'Opening Balance Equity',
        type: 'EQUITY',
      },
    })
    console.log('Created Chart of Account 3200 (Opening Balance Equity)')
  }

  const adjustmentAmount = Math.abs(discrepancy)
  const entryType = discrepancy > 0 ? 'CREDIT' : 'DEBIT'

  const entry = await prisma.accountLedgerEntry.create({
    data: {
      accountId: coa3200.id,
      type: entryType,
      amount: adjustmentAmount,
      description: 'Initial Opening Balance Equity Adjustment to align historical balance sheet',
      referenceType: 'OBE_INITIALIZATION',
      referenceId: 'OBE_INITIALIZATION_2026',
    },
  })

  console.log(`[SUCCESS] Single Auditable Entry Posted:`)
  console.log(`  ID:            ${entry.id}`)
  console.log(`  Account:       3200 (${coa3200.name})`)
  console.log(`  Type:          ${entry.type}`)
  console.log(`  Amount:        ৳${Number(entry.amount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`  ReferenceType: ${entry.referenceType}`)

  console.log('\n====================================================')
  console.log('3. VERIFYING UPDATED BALANCE SHEET')
  console.log('====================================================')

  const updatedBs = await getBalanceSheet()
  if (!updatedBs.success) {
    console.error('Failed to re-evaluate balance sheet:', updatedBs.error)
    process.exit(1)
  }

  const uData = updatedBs.data
  console.log(`Updated Total Assets:          ৳${uData.assets.totalAssets.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Updated Total Liabilities:     ৳${uData.liabilities.totalLiabilities.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Updated Opening Balance Eq:    ৳${uData.equity.openingBalanceEquity.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Updated Total Equity:          ৳${uData.equity.totalEquity.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Updated Total Liab + Eq:       ৳${(uData.liabilities.totalLiabilities + uData.equity.totalEquity).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`)
  console.log(`Updated Discrepancy:           ৳${uData.discrepancy}`)
  console.log(`Is Balanced:                   ${uData.isBalanced}`)

  if (uData.isBalanced) {
    console.log('\n🎉 BALANCE SHEET IS NOW FULLY BALANCED! 🎉')
  } else {
    console.error('\n⚠️ Balance sheet still has discrepancy:', uData.discrepancy)
  }
}

postObeAdjustment().catch(console.error)
