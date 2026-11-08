import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
  config({ path: '.env.local' })
  config()
}

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
let dbUrl = rawUrl
  .replace('-pooler.', '.')
  .replace('&channel_binding=require', '')
  .replace('sslmode=verify-full', 'sslmode=require')

if (!dbUrl.includes('sslmode=')) {
  dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'sslmode=disable'
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: dbUrl,
  },
})
