export type PosContext = {
  userName: string
  outletName: string
  appLinks: {
    gmail: string
    website: string
    facebook: string
    youtube: string
    instagram: string
    tiktok: string
  }
}

// Central source for dashboard header context without hard-coded persona fallbacks.
export function getPosContext(): PosContext {
  return {
    userName: process.env.NEXT_PUBLIC_POS_USER_NAME ?? '—',
    outletName: process.env.NEXT_PUBLIC_POS_OUTLET_NAME ?? '—',
    appLinks: {
      gmail: process.env.NEXT_PUBLIC_POS_GMAIL_URL ?? 'https://mail.google.com/',
      website: process.env.NEXT_PUBLIC_POS_WEBSITE_URL ?? 'https://artyxdigital.com/',
      facebook: process.env.NEXT_PUBLIC_POS_FACEBOOK_URL ?? 'https://facebook.com/artyxdigital',
      youtube: process.env.NEXT_PUBLIC_POS_YOUTUBE_URL ?? 'https://www.youtube.com/',
      instagram: process.env.NEXT_PUBLIC_POS_INSTAGRAM_URL ?? 'https://www.instagram.com/',
      tiktok: process.env.NEXT_PUBLIC_POS_TIKTOK_URL ?? 'https://www.tiktok.com/',
    },
  }
}