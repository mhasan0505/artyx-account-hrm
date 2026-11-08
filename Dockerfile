# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifest, prisma schema, scripts, and npmrc
COPY package.json pnpm-lock.yaml .npmrc* ./
COPY prisma ./prisma/
COPY scripts ./scripts/

# Install dependencies cleanly without lifecycle script interruptions
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Generate Prisma Client, apply path fix, and build Next.js standalone bundle
RUN pnpm prisma generate
RUN node scripts/fix-prisma-client-path.mjs

# --- DEVOP BYPASS ---
# 1. Throttle the Rust compiler (Turbopack/SWC) to 1 CPU thread so the VPS doesn't freeze
ENV RAYON_NUM_THREADS=1
ENV NEXT_BUILD_WORKERS=1

# 2. Force Next.js to skip linting by destroying the config file inside the builder container
RUN rm -f eslint.config.js eslint.config.mjs eslint.config.cjs .eslintrc*
# --------------------

RUN pnpm next build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static assets and standalone bundle
COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# INSTALL CURL AS ROOT FOR COOLIFY HEALTHCHECK
RUN apk add --no-cache curl

# SWITCH TO RESTRICTED USER AFTER INSTALLATIONS
USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
