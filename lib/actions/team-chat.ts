'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { getSocketIo } from '@/server/socket'

const DEFAULT_CHANNELS = [
  {
    name: 'general',
    slug: 'general',
    description: 'Agency-wide discussions, announcements and daily updates.',
  },
  {
    name: 'dev-team',
    slug: 'dev-team',
    description: 'Full-stack software engineering, Next.js, APIs & bug triage.',
  },
  {
    name: 'marketing-leads',
    slug: 'marketing-leads',
    description: 'Performance marketing, ad campaigns & client leads.',
  },
  {
    name: 'design-review',
    slug: 'design-review',
    description: 'UI/UX designs, Figma layouts, brand assets and reviews.',
  },
  {
    name: 'watercooler',
    slug: 'watercooler',
    description: 'Casual chat, team celebrations, memes & banter 🎉',
  },
]

export async function getChatChannels() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  let channels = await prisma.teamChatChannel.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: { messages: true },
      },
    },
  })

  // Auto-seed default agency channels if none exist yet
  if (channels.length === 0) {
    for (const c of DEFAULT_CHANNELS) {
      await prisma.teamChatChannel.create({
        data: c,
      })
    }
    channels = await prisma.teamChatChannel.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    })
  }

  return channels
}

export async function getChannelMessages(channelId: string, limit = 50) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const messages = await prisma.teamChatMessage.findMany({
    where: { channelId },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          role: true,
        },
      },
    },
  })

  // Return in chronological order
  return messages.reverse().map(m => ({
    id: m.id,
    channelId: m.channelId,
    content: m.content,
    attachmentUrl: m.attachmentUrl,
    attachmentName: m.attachmentName,
    attachmentType: m.attachmentType,
    attachmentSize: m.attachmentSize,
    createdAt: m.createdAt.toISOString(),
    user: {
      id: m.user.id,
      name: m.user.name,
      image: m.user.image,
      role: m.user.role,
    },
  }))
}

export async function sendChatMessage(data: {
  channelId: string
  content?: string
  attachmentUrl?: string
  attachmentName?: string
  attachmentType?: string
  attachmentSize?: number
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const content = data.content?.trim() || ''
  if (!content && !data.attachmentUrl) {
    throw new Error('Message content or attachment is required')
  }

  const message = await prisma.teamChatMessage.create({
    data: {
      channelId: data.channelId,
      userId: session.user.id,
      content: content || 'Sent an attachment',
      attachmentUrl: data.attachmentUrl || null,
      attachmentName: data.attachmentName || null,
      attachmentType: data.attachmentType || null,
      attachmentSize: data.attachmentSize ? Math.round(data.attachmentSize) : null,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          role: true,
        },
      },
    },
  })

  const formatted = {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    attachmentUrl: message.attachmentUrl,
    attachmentName: message.attachmentName,
    attachmentType: message.attachmentType,
    attachmentSize: message.attachmentSize,
    createdAt: message.createdAt.toISOString(),
    user: {
      id: message.user.id,
      name: message.user.name,
      image: message.user.image,
      role: message.user.role,
    },
  }

  // Attempt to broadcast via local Socket.io instance if running
  try {
    const io = getSocketIo()
    if (io) {
      io.to(`channel:${data.channelId}`).emit('new_message', formatted)
    }
  } catch {}

  revalidatePath('/team/chat')
  return formatted
}

export async function createChatChannel(data: { name: string; description?: string }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const name = data.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  if (!name) throw new Error('Channel name is required')

  const existing = await prisma.teamChatChannel.findUnique({
    where: { slug: name },
  })
  if (existing) throw new Error('Channel already exists')

  const channel = await prisma.teamChatChannel.create({
    data: {
      name,
      slug: name,
      description: data.description?.trim() || null,
    },
  })

  revalidatePath('/team/chat')
  return channel
}

export async function getTeamMembersForChat() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      image: true,
    },
    orderBy: { name: 'asc' },
  })
}
