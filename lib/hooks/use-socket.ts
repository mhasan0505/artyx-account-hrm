'use client'

import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export type ChatAttachment = {
  url: string
  name?: string | null
  type?: string | null
  size?: number | null
}

export type ChatMessage = {
  id: string
  channelId: string
  content: string
  attachmentUrl?: string | null
  attachmentName?: string | null
  attachmentType?: string | null
  attachmentSize?: number | null
  createdAt: string
  user: {
    id: string
    name: string
    image?: string | null
    role?: string
  }
}

export type TypingIndicator = {
  channelId: string
  userId: string
  userName: string
  isTyping: boolean
}

export function useSocketChat(currentChannelId?: string) {
  const { data: session } = useSession()
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([])
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({}) // userId -> userName
  const [incomingMessage, setIncomingMessage] = useState<ChatMessage | null>(
    null
  )

  // Get socket URL
  const getSocketUrl = useCallback(() => {
    if (process.env.NEXT_PUBLIC_SOCKET_URL) {
      return process.env.NEXT_PUBLIC_SOCKET_URL
    }
    if (typeof window !== 'undefined') {
      const protocol =
        window.location.protocol === 'https:' ? 'https:' : 'http:'
      const hostname = window.location.hostname
      return `${protocol}//${hostname}:3001`
    }
    return 'http://localhost:3001'
  }, [])

  // Initialize socket
  useEffect(() => {
    const url = getSocketUrl()
    const socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      timeout: 10000,
      autoConnect: true,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setIsConnected(true)
      if (session?.user?.id) {
        socket.emit('user_connected', {
          id: session.user.id,
          name: session.user.name || 'Team Member',
        })
      }
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    socket.on('connect_error', () => {
      setIsConnected(false)
    })

    socket.on('online_users', (users: string[]) => {
      setOnlineUserIds(users || [])
    })

    socket.on('new_message', (message: ChatMessage) => {
      setIncomingMessage(message)
    })

    socket.on('user_typing', (data: TypingIndicator) => {
      if (data.channelId === currentChannelId) {
        setTypingUsers(prev => {
          const next = { ...prev }
          if (data.isTyping) {
            next[data.userId] = data.userName
          } else {
            delete next[data.userId]
          }
          return next
        })
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [getSocketUrl, session?.user?.id, session?.user?.name, currentChannelId])

  // Channel room join/leave
  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !currentChannelId || !isConnected) return

    socket.emit('join_channel', currentChannelId)

    return () => {
      socket.emit('leave_channel', currentChannelId)
    }
  }, [currentChannelId, isConnected])

  // Emit typing indicator with auto-timeout
  const emitTyping = useCallback(
    (isTyping: boolean) => {
      const socket = socketRef.current
      if (!socket || !currentChannelId || !session?.user?.id) return

      socket.emit('typing', {
        channelId: currentChannelId,
        userId: session.user.id,
        userName: session.user.name || 'Team Member',
        isTyping,
      })
    },
    [currentChannelId, session?.user?.id, session?.user?.name]
  )

  // Send message via socket with server acknowledgement
  const sendMessage = useCallback(
    (
      content: string,
      attachment?: ChatAttachment | string | null
    ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> => {
      return new Promise(resolve => {
        const socket = socketRef.current
        if (!socket || !currentChannelId || !session?.user?.id) {
          resolve({ success: false, error: 'Socket not connected' })
          return
        }

        const payload =
          typeof attachment === 'string'
            ? {
                channelId: currentChannelId,
                userId: session.user.id,
                content,
                attachmentUrl: attachment,
              }
            : {
                channelId: currentChannelId,
                userId: session.user.id,
                content,
                attachmentUrl: attachment?.url,
                attachmentName: attachment?.name,
                attachmentType: attachment?.type,
                attachmentSize: attachment?.size,
              }

        socket.emit(
          'send_message',
          payload,
          (res: {
            success: boolean
            message?: ChatMessage
            error?: string
          }) => {
            resolve(res)
          }
        )
      })
    },
    [currentChannelId, session?.user?.id]
  )

  return {
    socket: socketRef.current,
    isConnected,
    onlineUserIds,
    typingUsers: Object.values(typingUsers),
    incomingMessage,
    emitTyping,
    sendMessage,
  }
}
