import { defineConfig } from 'vitest/config'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '.env.test.local') })
dotenv.config({ path: path.resolve(__dirname, '.env.test') })
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

// Guard: Never fall back to .env.local's DATABASE_URL in tests.
// Only explicit DATABASE_URL_TEST containing "test" in host or database name is permitted.
if (!process.env.DATABASE_URL_TEST) {
  delete process.env.DATABASE_URL
} else {
  try {
    const parsed = new URL(process.env.DATABASE_URL_TEST)
    const host = (parsed.hostname || '').toLowerCase()
    const dbName = (parsed.pathname || '').replace(/^\//, '').toLowerCase()
    if (!host.includes('test') && !dbName.includes('test')) {
      throw new Error(
        `ABORT: DATABASE_URL_TEST must contain "test" in host or database name. Host: "${parsed.hostname}", DB: "${dbName}". Never fall back to .env.local's DATABASE_URL.`
      )
    }
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
  } catch (err: any) {
    if (err.message?.startsWith('ABORT:')) throw err
    throw new Error(`ABORT: Invalid DATABASE_URL_TEST: ${err.message}`)
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.kilo/**', '**/.next/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'next/server': 'next/server.js',
    },
  },
})
