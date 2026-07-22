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
        NODE_ENV: 'production'
      }
    }
  ]
};
