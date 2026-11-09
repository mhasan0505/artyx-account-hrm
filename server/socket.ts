import http from 'http'
import { Server, Socket } from 'socket.io'
import { prisma } from '../lib/db'

export const SOCKET_PORT = process.env.SOCKET_PORT
  ? parseInt(process.env.SOCKET_PORT, 10)
  : 3001

const globalForSocket = globalThis as unknown as {
  __artyxSocketIo?: Server
  __artyxSocketHttp?: http.Server
  __onlineUsers?: Map<string, Set<string>>
}

// Track active online user sessions
const onlineUsers =
  globalForSocket.__onlineUsers ?? new Map<string, Set<string>>()
globalForSocket.__onlineUsers = onlineUsers

function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys())
}

export function initSocketServer(): Server | null {
  if (globalForSocket.__artyxSocketIo) {
    return globalForSocket.__artyxSocketIo
  }

  const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'Artyx Team Chat Socket.io Server',
          port: SOCKET_PORT,
          onlineCount: onlineUsers.size,
          timestamp: new Date().toISOString(),
        })
      )
      return
    }

    res.writeHead(404)
    res.end()
  })

  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: false,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  })

  io.on('connection', (socket: Socket) => {
    let currentUserId: string | null = null

    // Register user presence
    socket.on('user_connected', (user: { id: string; name: string }) => {
      if (!user?.id) return
      currentUserId = user.id

      if (!onlineUsers.has(user.id)) {
        onlineUsers.set(user.id, new Set())
      }
      onlineUsers.get(user.id)!.add(socket.id)

      // Join individual personal room for private notifications / DMs
      socket.join(`user:${user.id}`)

      // Broadcast updated online users
      io.emit('online_users', getOnlineUserIds())
    })

    // Join channel room
    socket.on('join_channel', (channelId: string) => {
      if (!channelId) return
      socket.join(`channel:${channelId}`)
    })

    // Leave channel room
    socket.on('leave_channel', (channelId: string) => {
      if (!channelId) return
      socket.leave(`channel:${channelId}`)
    })

    // Typing indicators
    socket.on(
      'typing',
      (data: {
        channelId: string
        userId: string
        userName: string
        isTyping: boolean
      }) => {
        if (!data?.channelId) return
        socket.to(`channel:${data.channelId}`).emit('user_typing', data)
      }
    )

    // Send and persist message
    socket.on(
      'send_message',
      async (
        payload: {
          channelId: string
          userId: string
          content?: string
          attachmentUrl?: string
          attachmentName?: string
          attachmentType?: string
          attachmentSize?: number
        },
        callback?: (res: {
          success: boolean
          message?: any
          error?: string
        }) => void
      ) => {
        try {
          const content = payload.content?.trim() || ''
          if (
            !payload.channelId ||
            !payload.userId ||
            (!content && !payload.attachmentUrl)
          ) {
            callback?.({
              success: false,
              error: 'Channel ID, User ID, and content or attachment are required',
            })
            return
          }

          // Persist to database
          const savedMessage = await prisma.teamChatMessage.create({
            data: {
              channelId: payload.channelId,
              userId: payload.userId,
              content: content || 'Sent an attachment',
              attachmentUrl: payload.attachmentUrl || null,
              attachmentName: payload.attachmentName || null,
              attachmentType: payload.attachmentType || null,
              attachmentSize: payload.attachmentSize ? Math.round(payload.attachmentSize) : null,
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

          const formattedMessage = {
            id: savedMessage.id,
            channelId: savedMessage.channelId,
            content: savedMessage.content,
            attachmentUrl: savedMessage.attachmentUrl,
            attachmentName: savedMessage.attachmentName,
            attachmentType: savedMessage.attachmentType,
            attachmentSize: savedMessage.attachmentSize,
            createdAt: savedMessage.createdAt.toISOString(),
            user: {
              id: savedMessage.user.id,
              name: savedMessage.user.name,
              image: savedMessage.user.image,
              role: savedMessage.user.role,
            },
          }

          // Broadcast to everyone in channel (including sender)
          io.to(`channel:${payload.channelId}`).emit(
            'new_message',
            formattedMessage
          )

          callback?.({ success: true, message: formattedMessage })
        } catch (err: unknown) {
          const errorMsg =
            err instanceof Error ? err.message : 'Failed to send message'
          console.error('[Socket.io] send_message error:', err)
          callback?.({ success: false, error: errorMsg })
        }
      }
    )

    // Disconnect cleanup
    socket.on('disconnect', () => {
      if (currentUserId && onlineUsers.has(currentUserId)) {
        const socketSet = onlineUsers.get(currentUserId)!
        socketSet.delete(socket.id)
        if (socketSet.size === 0) {
          onlineUsers.delete(currentUserId)
        }
        io.emit('online_users', getOnlineUserIds())
      }
    })
  })

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[Socket.io] Port ${SOCKET_PORT} is already in use. Reusing existing server instance.`
      )
    } else {
      console.error('[Socket.io] Server error:', err)
    }
  })

  server.listen(SOCKET_PORT, () => {
    console.log(
      `[Socket.io] Real-time Team Chat server listening on port ${SOCKET_PORT}`
    )
  })

  globalForSocket.__artyxSocketHttp = server
  globalForSocket.__artyxSocketIo = io

  return io
}

export function getSocketIo(): Server | null {
  return globalForSocket.__artyxSocketIo || null
}

// Auto-run if executed directly via `tsx server/socket.ts`
if (
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  /server[\\/]socket\.(ts|js)$/.test(process.argv[1])
) {
  initSocketServer()
}
