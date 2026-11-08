module.exports = {
  apps: [
    {
      name: 'pos-tech-drive',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/var/www/pos-tech-drive',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      // Auto-restart on failure
      autorestart: true,
      // Restart max 10 times in 60 seconds
      max_restarts: 10,
      min_uptime: '10s',
      // Logging
      log_file: '/var/log/pm2/pos-tech-drive.log',
      out_file: '/var/log/pm2/pos-tech-drive-out.log',
      error_file: '/var/log/pm2/pos-tech-drive-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Memory limit
      max_memory_restart: '1G',
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
}
