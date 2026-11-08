#!/bin/bash
set -e

# POS Tech Drive - Deployment Script for Hostinger VPS
# Run this on your VPS after initial setup

echo "🚀 Starting deployment..."

APP_DIR="/var/www/pos-tech-drive"
LOG_DIR="/var/log/pm2"

# Create log directory
sudo mkdir -p $LOG_DIR
sudo chown -R $USER:$USER $LOG_DIR

# Navigate to app directory
cd $APP_DIR

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

echo "🔄 Generating Prisma client..."
pnpm db:generate

echo "🏗️ Building application..."
pnpm build

echo "🗄️ Running database migrations..."
pnpm db:migrate:deploy

echo "🔄 Restarting PM2 process..."
pm2 restart ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production

echo "💾 Saving PM2 process list..."
pm2 save

echo "✅ Deployment complete!"
echo ""
echo "Check status with: pm2 status"
echo "View logs with: pm2 logs pos-tech-drive"
echo "Check health: curl https://your-domain.com/api/health/db"
