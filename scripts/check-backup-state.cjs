const fs = require('fs')
const backup = JSON.parse(fs.readFileSync('backups/backup_2026-08-13T07-29-25-353Z.json', 'utf-8'))

// Supplier balances from backup
console.log('\n=== Suppliers in backup ===')
let totalAP = 0
for (const s of backup.data.Supplier) {
  console.log(`  ${s.name}: ${s.outstandingBalance}`)
  totalAP += parseFloat(s.outstandingBalance)
}
console.log(`  Total AP: ${totalAP}`)

// StockLayer inventory from backup
const layers = backup.data.StockLayer
let invValue = 0
for (const l of layers) {
  invValue += parseFloat(l.quantityRemaining) * parseFloat(l.unitCost)
}
console.log(`\nInventory from backup: ${invValue} (${layers.length} layers)`)

// Sales
const sales = backup.data.Sale.filter(s => !s.isQuotation)
let netSales = 0
for (const s of sales) {
  netSales += parseFloat(s.total) - parseFloat(s.discountAmt || '0')
}
console.log(`Net sales: ${netSales}`)

// Customer balances
const customers = backup.data.Customer
let totalAR = 0
for (const c of customers) {
  totalAR += parseFloat(c.outstandingBalance || '0')
}
console.log(`Customer AR: ${totalAR}`)

// Capital injections
const approved = (backup.data.CapitalInjection || []).filter(ci => ci.status === 'APPROVED')
let capital = 0
for (const ci of approved) { capital += parseFloat(ci.amount) }
console.log(`Capital (approved): ${capital}`)

console.log('\n=== PRE-CLEANUP ROUGH CHECK ===')
console.log(`  AP: ${totalAP.toFixed(2)}`)
console.log(`  AR: ${totalAR.toFixed(2)}`)
console.log(`  Inventory: ${invValue.toFixed(2)}`)
console.log(`  Net Sales: ${netSales.toFixed(2)}`)
console.log(`  Capital: ${capital.toFixed(2)}`)
