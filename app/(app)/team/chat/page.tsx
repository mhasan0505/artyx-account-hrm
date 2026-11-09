import { TeamChatView } from '@/components/chat/team-chat-view'
import { getChatChannels, getTeamMembersForChat } from '@/lib/actions/team-chat'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Team Chat | Artyx Digital',
  description: 'Real-time internal team communication powered by Socket.io',
}

export default async function TeamChatPage() {
  const [channels, teamUsers] = await Promise.all([
    getChatChannels(),
    getTeamMembersForChat(),
  ])

  return (
    <div className="w-full h-full p-2 sm:p-4 min-w-0">
      <TeamChatView initialChannels={channels} teamUsers={teamUsers} />
    </div>
  )
}
