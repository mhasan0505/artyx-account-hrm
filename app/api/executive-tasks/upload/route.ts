import { getCurrentExecutiveUser } from '@/lib/auth/executive-server'
import fs from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export async function POST(req: NextRequest) {
  try {
    // Strictly ONLY Super Admin, CEO, COO, and CMO
    const execUser = await getCurrentExecutiveUser()
    if (!execUser) {
      return NextResponse.json(
        { error: 'Unauthorized: Executive access required.' },
        { status: 403 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File exceeds the 20MB maximum size limit.' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const origName = file.name || 'attachment'
    const ext = path.extname(origName).slice(0, 12)
    const baseName = path
      .basename(origName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50)
    const uniqueFilename = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${baseName}${ext}`

    let fileUrl = ''
    try {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'executive-tasks')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }
      const filePath = path.join(uploadDir, uniqueFilename)
      fs.writeFileSync(filePath, buffer)
      fileUrl = `/uploads/executive-tasks/${uniqueFilename}`
    } catch {
      const mimeType = file.type || 'application/octet-stream'
      fileUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    }

    return NextResponse.json({
      success: true,
      attachment: {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: fileUrl,
        name: origName,
        type: file.type || 'application/octet-stream',
        size: file.size,
        uploadedByName: execUser.name,
        uploadedAt: new Date().toISOString(),
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'File upload failed.'
    console.error('[API /api/executive-tasks/upload] error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
