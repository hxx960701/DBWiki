import dotenv from 'dotenv';
import express from 'express';
import https from 'https';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeDatabase } from './database/connection.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware — minimal security headers for intranet HTTP deployment.
// Cross-Origin isolation headers (COOP/COEP) are disabled because they require
// HTTPS or localhost; on IP-based intranet access they would cause browsers to
// spuriously upgrade subresource requests to HTTPS.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'self'"],
    },
  },
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  originAgentCluster: false,
  frameguard: { action: 'sameorigin' },
}));
app.use(cors({
  origin: process.env.CLIENT_URL || true,  // true = reflect request origin, works behind nginx
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

// Start server
async function start() {
  try {
    await initializeDatabase();

    // Try to load self-signed certificate (generated in Dockerfile).
    // When present we serve HTTPS — required when Chrome enterprise policy
    // forces HTTPS-upgrades on intranet IP addresses.
    const certDir = path.join(__dirname, '../../certs');
    const keyPath = path.join(certDir, 'server.key');
    const certPath = path.join(certDir, 'server.crt');
    const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

    if (useHttps) {
      const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`[Server] DBwiki running on https://0.0.0.0:${PORT}`);
      });
    } else {
      app.listen(PORT, () => {
        console.log(`[Server] DBwiki running on http://localhost:${PORT}`);
      });
    }
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

start();
