import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

async function fullDatabaseBackup() {
  console.log('📦 Starting Full Database Backup...')
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is not defined in environment')

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()
  console.log('✓ Connected to PostgreSQL database.')

  const backupDir = path.join(process.cwd(), 'backups')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sqlBackupFile = path.join(backupDir, `backup_${timestamp}.sql`)
  const jsonBackupFile = path.join(backupDir, `backup_${timestamp}.json`)

  // 1. Get all tables in public schema
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `)

  const tables = tablesRes.rows.map(r => r.table_name)
  console.log(`Found ${tables.length} tables in public schema.\n`)

  const jsonDump: Record<string, any[]> = {}
  const sqlStatements: string[] = [
    `-- Database Backup Taken: ${new Date().toISOString()}`,
    `-- Database: Neon PostgreSQL`,
    `SET statement_timeout = 0;`,
    `SET lock_timeout = 0;`,
    `SET client_encoding = 'UTF8';`,
    `SET standard_conforming_strings = on;`,
    `\n`
  ]

  let totalRowsDumped = 0

  for (const tableName of tables) {
    const rowsRes = await client.query(`SELECT * FROM "${tableName}";`)
    const rows = rowsRes.rows
    jsonDump[tableName] = rows
    totalRowsDumped += rows.length

    console.log(`  - ${tableName.padEnd(35)} : ${rows.length.toString().padStart(6)} rows`)

    if (rows.length > 0) {
      sqlStatements.push(`-- Table: ${tableName} (${rows.length} rows)`)
      for (const row of rows) {
        const columns = Object.keys(row).map(c => `"${c}"`).join(', ')
        const values = Object.values(row).map(val => {
          if (val === null || val === undefined) return 'NULL'
          if (typeof val === 'number' || typeof val === 'boolean') return String(val)
          if (val instanceof Date) return `'${val.toISOString()}'`
          if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
          return `'${String(val).replace(/'/g, "''")}'`
        }).join(', ')

        sqlStatements.push(`INSERT INTO "${tableName}" (${columns}) VALUES (${values});`)
      }
      sqlStatements.push('')
    }
  }

  // Write SQL and JSON backups
  fs.writeFileSync(sqlBackupFile, sqlStatements.join('\n'), 'utf-8')
  fs.writeFileSync(jsonBackupFile, JSON.stringify(jsonDump, null, 2), 'utf-8')

  const sqlStats = fs.statSync(sqlBackupFile)
  const jsonStats = fs.statSync(jsonBackupFile)

  console.log('\n========================================')
  console.log('✓ Full Database Backup Successfully Completed!')
  console.log(`  - Total Tables: ${tables.length}`)
  console.log(`  - Total Rows:   ${totalRowsDumped}`)
  console.log(`  - SQL File:     ${sqlBackupFile} (${(sqlStats.size / 1024).toFixed(2)} KB)`)
  console.log(`  - JSON File:    ${jsonBackupFile} (${(jsonStats.size / 1024).toFixed(2)} KB)`)
  console.log('========================================\n')

  await client.end()
}

fullDatabaseBackup().catch(err => {
  console.error('Backup failed:', err)
  process.exit(1)
})
