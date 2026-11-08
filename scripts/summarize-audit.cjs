const fs = require('fs')
const d = JSON.parse(fs.readFileSync('audit_candidates.json', 'utf-8'))

console.log('\n=== ALL SALES ===')
for (const s of d.allRecords.sales) {
  const custName = s.customer ? s.customer.name : '(walk-in)'
  const dt = new Date(s.createdAt).toISOString().slice(0, 16)
  console.log(`  ${s.saleNumber} | ${custName} | ৳${s.total} | ${dt} | cashier:${s.cashier ? s.cashier.name.trim() : '?'}`)
}

console.log('\n=== ALL CUSTOMERS ===')
for (const c of d.allRecords.customers) {
  const dt = new Date(c.createdAt).toISOString().slice(0, 10)
  console.log(`  ${c.name} | ${c.phone || 'no-phone'} | sales:${c.sales.length} | balance:${c.outstandingBalance} | ${dt}`)
}
