import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authConfig } from './auth.config'
import { authorizeUser } from '@/lib/auth/authorize'
import { prisma } from '@/lib/db'

export { authorizeUser }

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  basePath: '/api/auth',
  providers: [
    Credentials({
      authorize: authorizeUser,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      // Auto-heal missing outlet on active session tokens
      if (token.id && !token.outletId) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              outletId: true,
              role: true,
              outlet: { select: { id: true, name: true, code: true } },
            },
          })
          if (dbUser?.outlet) {
            token.outletId = dbUser.outlet.id
            token.outletName = dbUser.outlet.name
            token.outletCode = dbUser.outlet.code
          } else if (dbUser?.role === 'SUPER_ADMIN' || dbUser?.role === 'ADMIN') {
            const firstOutlet = await prisma.outlet.findFirst({
              where: { isActive: true },
              select: { id: true, name: true, code: true },
            })
            if (firstOutlet) {
              token.outletId = firstOutlet.id
              token.outletName = firstOutlet.name
              token.outletCode = firstOutlet.code
            }
          }
        } catch (err) {
          console.warn('[auth.jwt] auto-heal outlet failed:', err)
        }
      }
      return token
    },
    async session(params: any) {
      const session = await (authConfig.callbacks.session as any)(params)
      const token = params.token
      if (session?.user && token) {
        session.user.outletId = (token.outletId as string) || session.user.outletId
        session.user.outletName = (token.outletName as string) || session.user.outletName
        session.user.outletCode = (token.outletCode as string) || session.user.outletCode
      }
      return session
    },
  },
})
