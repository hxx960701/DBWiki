/**
 * PM2 production configuration.
 *
 * The project is ESM ("type": "module" in package.json), so PM2's config file
 * must use CommonJS — hence the .cjs extension. PM2 will read this file with
 * the regular Node CJS loader.
 *
 * Run from the project root:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 *
 * See DEPLOY.md for the full Baota + PM2 + Nginx deployment guide.
 */
module.exports = {
  apps: [
    {
      name: 'dbwiki',
      script: './server/dist/index.js',
      cwd: __dirname,
      instances: 1,                 // SQLite = single writer
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      max_restarts: 10,
      min_uptime: '10s',

      // env vars merged onto process.env when started without `--env`
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Reads ./.env relative to cwd and injects into process.env
      env_file: '.env',

      // Logging
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Hard kill after 8s if SIGTERM is ignored
      kill_timeout: 8000,
    },
  ],
};
