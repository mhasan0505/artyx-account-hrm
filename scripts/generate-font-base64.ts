import fs from 'fs'
import path from 'path'

const fontsDir = path.join(process.cwd(), 'lib', 'pdf', 'fonts')
const regularFile = path.join(fontsDir, 'cambria-regular.ttf')
const boldFile = path.join(fontsDir, 'cambria-bold.ttf')
const outputFile = path.join(fontsDir, 'cambria-base64.ts')

let regularBase64: string | null = null
let boldBase64: string | null = null

if (fs.existsSync(regularFile)) {
  regularBase64 = fs.readFileSync(regularFile).toString('base64')
  console.log('✓ Found cambria-regular.ttf')
} else {
  console.log('⚠ cambria-regular.ttf not found in lib/pdf/fonts/')
}

if (fs.existsSync(boldFile)) {
  boldBase64 = fs.readFileSync(boldFile).toString('base64')
  console.log('✓ Found cambria-bold.ttf')
} else {
  console.log('⚠ cambria-bold.ttf not found in lib/pdf/fonts/')
}

const content = `// Generated base64 font module (non-public, loaded dynamically)
export const cambriaRegularBase64: string | null = ${regularBase64 ? JSON.stringify(regularBase64) : 'null'}
export const cambriaBoldBase64: string | null = ${boldBase64 ? JSON.stringify(boldBase64) : 'null'}
`

fs.writeFileSync(outputFile, content, 'utf-8')
console.log(`✓ Wrote ${outputFile}`)
