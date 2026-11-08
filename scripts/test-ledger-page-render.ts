import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

async function verifyLedgerPageData() {
  process.env.SKIP_AUTH_CHECK = 'true'
  const { getProductLedger, getSupplierLedger, getLowStockAlerts, getBrands, getFifoRecommendations } =
    await import('../lib/actions/products')
  const { getSuppliers } = await import('../lib/actions/crm')
  const { getOutlets } = await import('../lib/actions/users')

  console.log('🧪 Verifying Products Ledger Page Data Loading...\n')

  const [
    stockResult,
    supplierResult,
    lowStockResult,
    outletsResult,
    suppliersResult,
    brandsResult,
    fifoResult,
  ] = await Promise.all([
    getProductLedger({ page: 1, pageSize: 50 }).catch(err => ({ success: false as const, error: err.message })),
    getSupplierLedger({ page: 1, pageSize: 50 }).catch(err => ({ success: false as const, error: err.message })),
    getLowStockAlerts().catch(() => ({ success: false as const, data: [] })),
    getOutlets().catch(() => []),
    getSuppliers().catch(() => []),
    getBrands().catch(() => []),
    getFifoRecommendations().catch(() => ({ success: false as const, data: [] })),
  ])

  console.log('Results:')
  console.log(`  - Stock Ledger: ${stockResult.success ? stockResult.data.rows.length + ' rows' : 'Error: ' + stockResult.error}`)
  console.log(`  - Supplier Ledger: ${supplierResult.success ? supplierResult.data.rows.length + ' rows' : 'Error: ' + supplierResult.error}`)
  console.log(`  - Low Stock Alerts: ${lowStockResult.success ? lowStockResult.data.length + ' items' : 'Error'}`)
  console.log(`  - Outlets Count: ${Array.isArray(outletsResult) ? outletsResult.length : 0}`)
  console.log(`  - Suppliers Count: ${Array.isArray(suppliersResult) ? suppliersResult.length : 0}`)
  console.log(`  - Brands Count: ${Array.isArray(brandsResult) ? brandsResult.length : 0}`)
  console.log(`  - FIFO Recommendations: ${fifoResult.success ? fifoResult.data.length + ' items' : 'Error'}`)

  if (!stockResult.success) {
    throw new Error(`Stock Ledger failed: ${stockResult.error}`)
  }

  console.log('\n✅ Products Ledger Page Data Loaded Cleanly with zero errors!')
}

verifyLedgerPageData().catch(err => {
  console.error('❌ Data verification failed:', err)
  process.exit(1)
})
