module.exports = {
  apps: [
    {
      name: 'rentfoxxy-backend-staging',
      cwd: '/var/www/crm_rentfoxxy_staging/backend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 5002,
      },
    },
  ],
};  
