import { auth } from '@/auth'
import fs from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 15MB limit' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Sanitize filename
    const origName = file.name || 'attachment'
    const ext = path.extname(origName) || ''
    const baseName = path
      .basename(origName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50)
    const uniqueFilename = `chat-${Date.now()}-${baseName}${ext}`

    let fileUrl = ''

    // Attempt to save to public/uploads/chat/
    try {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'chat')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }
      const filePath = path.join(uploadDir, uniqueFilename)
      fs.writeFileSync(filePath, buffer)
      fileUrl = `/uploads/chat/${uniqueFilename}`
    } catch {
      // In read-only serverless environments, fallback to Base64 Data URL
      const mimeType = file.type || 'application/octet-stream'
      fileUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    }

    return NextResponse.json({
      success: true,
      url: fileUrl,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Upload failed'
    console.error('[API /api/chat/upload] error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
