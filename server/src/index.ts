import dotenv from 'dotenv';
import express from 'express';
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

// Middleware
app.use(helmet({
  // Relax CSP for SPA — allows inline scripts/styles, fonts, and images from any source.
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
  // Disable HSTS — internal deployment over HTTP (no TLS)
  strictTransportSecurity: false,
  // Disable COOP/COEP — they require HTTPS or localhost, break on IP-based HTTP access
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Allow the page to be embedded in iframes from same origin
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
    app.listen(PORT, () => {
      console.log(`[Server] DBwiki running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

start();
