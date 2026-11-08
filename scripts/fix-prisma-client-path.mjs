import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

function ensurePrismaClientPath() {
  const packageJsonPath = require.resolve('@prisma/client/package.json')
  const clientDir = path.dirname(packageJsonPath)

  const expectedPrismaDir = path.join(clientDir, '.prisma')
  const siblingGeneratedPrismaDir = path.resolve(
    clientDir,
    '..',
    '..',
    '.prisma'
  )

  if (!fs.existsSync(siblingGeneratedPrismaDir)) {
    console.log('[prisma-fix] No generated sibling .prisma directory found.')
    return
  }

  fs.cpSync(siblingGeneratedPrismaDir, expectedPrismaDir, {
    recursive: true,
    force: true,
  })

  console.log(
    '[prisma-fix] Synced sibling .prisma into @prisma/client/.prisma.'
  )
}

try {
  ensurePrismaClientPath()
} catch (error) {
  console.error('[prisma-fix] Failed to repair Prisma client path.')
  console.error(error)
  process.exitCode = 1
}
