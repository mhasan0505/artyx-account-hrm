import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

async function runBackup() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.resolve(process.cwd(), 'backups')
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    const sqlBackupFile = path.join(backupDir, `pg_backup_pre_reset_${timestamp}.sql`)
    const jsonBackupFile = path.join(backupDir, `pg_backup_pre_reset_${timestamp}.json`)

    console.log(`📦 Taking full database backup from Neon PostgreSQL...`)
    console.log(`📁 Backup destination: ${sqlBackupFile}`)

    // 1. Get all public table names
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)

    const tables: string[] = tablesRes.rows.map(r => r.table_name)
    console.log(`Found ${tables.length} tables in public schema.`)

    const SENSITIVE_TABLE_COLUMNS: Record<string, string[]> = {
      User: ['password', 'pin'],
      user: ['password', 'pin'],
    }

    const fullDump: Record<string, any[]> = {}
    let sqlContent = `-- =========================================================================\n`
    sqlContent += `-- WARNING: SENSITIVE DATABASE BACKUP. NEVER COMMIT TO GIT OR VERSION CONTROL.\n`
    sqlContent += `-- FULL POSTGRESQL DATABASE DUMP (PRE-RESET BACKUP)\n`
    sqlContent += `-- Created at: ${new Date().toISOString()}\n`
    sqlContent += `-- Total Tables: ${tables.length}\n`
    sqlContent += `-- Sensitive credentials (passwords, PINs) are redacted in this dump.\n`
    sqlContent += `-- =========================================================================\n\n`
    sqlContent += `BEGIN;\nSET CONSTRAINTS ALL DEFERRED;\n\n`

    let totalRowsCount = 0

    for (const table of tables) {
      // Get all columns and rows
      const dataRes = await client.query(`SELECT * FROM "${table}"`)
      const sensitiveCols = SENSITIVE_TABLE_COLUMNS[table] || []
      const rows = dataRes.rows.map(r => {
        if (sensitiveCols.length === 0) return r
        const sanitized = { ...r }
        for (const col of sensitiveCols) {
          if (col in sanitized && sanitized[col] !== null) {
            sanitized[col] = '[REDACTED_FOR_SECURITY]'
          }
        }
        return sanitized
      })

      fullDump[table] = rows
      totalRowsCount += rows.length

      sqlContent += `-- Table: "${table}" (${rows.length} rows)\n`
      if (rows.length > 0) {
        for (const row of rows) {
          const keys = Object.keys(row)
          const cols = keys.map(k => `"${k}"`).join(', ')
          const vals = keys
            .map(k => {
              const val = row[k]
              if (val === null || val === undefined) return 'NULL'
              if (typeof val === 'number' || typeof val === 'bigint') return val.toString()
              if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
              if (val instanceof Date) return `'${val.toISOString()}'`
              if (typeof val === 'object') {
                return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`
              }
              return `'${String(val).replace(/'/g, "''")}'`
            })
            .join(', ')

          sqlContent += `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;\n`
        }
      }
      sqlContent += `\n`
      console.log(`  ✓ Dumped "${table}": ${dataRes.rows.length} rows`)
    }

    sqlContent += `COMMIT;\n`

    fs.writeFileSync(sqlBackupFile, sqlContent, 'utf-8')
    fs.writeFileSync(jsonBackupFile, JSON.stringify(fullDump, null, 2), 'utf-8')

    const sqlSize = fs.statSync(sqlBackupFile).size
    const jsonSize = fs.statSync(jsonBackupFile).size

    console.log(`\n🎉 Full database backup completed successfully!`)
    console.log(`  • SQL Dump File: ${sqlBackupFile} (${(sqlSize / 1024).toFixed(2)} KB)`)
    console.log(`  • JSON Dump File: ${jsonBackupFile} (${(jsonSize / 1024).toFixed(2)} KB)`)
    console.log(`  • Total Tables Backed Up: ${tables.length}`)
    console.log(`  • Total Rows Backed Up: ${totalRowsCount}`)
  } finally {
    client.release()
    await pool.end()
  }
}

runBackup().catch(err => {
  console.error('❌ Backup failed:', err)
  process.exit(1)
})
