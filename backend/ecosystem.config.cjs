/**
 * PM2 process definition for production VPS.
 * Usage (from backend/): pm2 start ecosystem.config.cjs --only crm-backend
 */
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      cwd: __dirname,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'production',
        PUPPETEER_CACHE_DIR: '/var/www/crm_rentfoxxy/backend/.cache/puppeteer',
        PUPPETEER_EXECUTABLE_PATH:
          '/var/www/crm_rentfoxxy/backend/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
      },
    }
  ]
};
