import { Providers } from '@/components/providers'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'
import './globals.css'

import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'

export const metadata: Metadata = {
  title: 'Artyx Digital || Agency Accounting & ERP',
  description:
    'Internal accounting, client management, real-time profitability, HR, and partner equity management platform for Artyx Digital.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        'h-full',
        'antialiased',
        'font-sans',
        GeistSans.variable,
        GeistMono.variable
      )}
    >
      <head></head>
      <body className="min-h-full flex flex-col overflow-x-hidden max-w-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
