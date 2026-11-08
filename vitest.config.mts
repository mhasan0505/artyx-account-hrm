import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: process.env as Record<string, string>,
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
})
