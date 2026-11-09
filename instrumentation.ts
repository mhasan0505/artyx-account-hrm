// Polyfill for Node v27 alpha null-prototype headers compatibility with Next.js internal checks
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const http = require('http')
      if (http?.IncomingMessage?.prototype) {
        const origAddLines = http.IncomingMessage.prototype._addHeaderLines
        if (origAddLines) {
          http.IncomingMessage.prototype._addHeaderLines = function (
            headers: any,
            n: any
          ) {
            origAddLines.call(this, headers, n)
            if (this.headers && !this.headers.hasOwnProperty) {
              this.headers.hasOwnProperty = Object.prototype.hasOwnProperty
            }
          }
        }
        const origAddLine = http.IncomingMessage.prototype._addHeaderLine
        if (origAddLine) {
          http.IncomingMessage.prototype._addHeaderLine = function (
            field: any,
            val: any,
            dest: any
          ) {
            const res = origAddLine.call(this, field, val, dest)
            if (dest && typeof dest === 'object' && !dest.hasOwnProperty) {
              dest.hasOwnProperty = Object.prototype.hasOwnProperty
            }
            return res
          }
        }
      }
    } catch {}

    // Initialize Real-Time Socket.io Server for Team Chat
    try {
      const { initSocketServer } = await import('./server/socket')
      initSocketServer()
    } catch (err) {
      console.warn('[instrumentation] Socket.io server init warning:', err)
    }
  }
}
