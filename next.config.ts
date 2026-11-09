import type { NextConfig } from 'next'

// Polyfill for Node v27 alpha null-prototype headers compatibility with Next.js internal checks
try {
  const http = require('http')
  if (http?.IncomingMessage?.prototype) {
    const origAddLines = http.IncomingMessage.prototype._addHeaderLines
    if (origAddLines) {
      http.IncomingMessage.prototype._addHeaderLines = function (headers: any, n: any) {
        origAddLines.call(this, headers, n)
        if (this.headers && !this.headers.hasOwnProperty) {
          this.headers.hasOwnProperty = Object.prototype.hasOwnProperty
        }
      }
    }
    const origAddLine = http.IncomingMessage.prototype._addHeaderLine
    if (origAddLine) {
      http.IncomingMessage.prototype._addHeaderLine = function (field: any, val: any, dest: any) {
        const res = origAddLine.call(this, field, val, dest)
        if (dest && typeof dest === 'object' && !dest.hasOwnProperty) {
          dest.hasOwnProperty = Object.prototype.hasOwnProperty
        }
        return res
      }
    }
  }
} catch {}

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '192.168.0.199',
    '192.168.0.199:3000',
    '192.168.*.*',
    '192.168.*.*:3000',
  ],
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      'recharts',
      'date-fns',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-switch',
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  async rewrites() {
    return [
      {
        source: '/products/:path*.:ext(png|jpg|jpeg|webp|gif|svg)',
        destination: '/images/products/:path*.:ext',
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig
