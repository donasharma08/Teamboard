import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import crypto from 'node:crypto';
import fs from 'node:fs';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { ROOT, type Db } from './db.js';
import { requireAuth } from './lib/auth.js';
import { errorHandler } from './lib/http.js';
import { log } from './lib/log.js';
import { orgScope } from './lib/scope.js';
import { authRoutes } from './routes/auth.js';
import { orgRoutes } from './routes/orgs.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { reportRoutes } from './routes/reports.js';

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"] },
    },
  }));
  // Every request gets an id; it appears in error logs and in the error message shown to the user.
  app.use((_req, res, next) => { res.setHeader('X-Request-Id', crypto.randomUUID().slice(0, 8)); next(); });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, db: db.kind });
  });

  app.use('/api/auth', authRoutes(db));

  // Browser errors are reported here so they show up in the same log as server errors.
  app.post('/api/client-errors', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: false, legacyHeaders: false }), (req, res) => {
    const b = req.body ?? {};
    log('warn', 'browser error', {
      message: String(b.message ?? '').slice(0, 500), source: String(b.source ?? '').slice(0, 300),
      stack: String(b.stack ?? '').slice(0, 1500), page: String(b.page ?? '').slice(0, 300),
    });
    res.status(204).end();
  });

  // Everything under /api/orgs/:orgId is signed-in AND scoped to one organisation.
  const scoped = express.Router({ mergeParams: true });
  scoped.use(requireAuth(db), orgScope(db));
  scoped.use('/projects', projectRoutes(db));
  scoped.use('/tasks', taskRoutes(db));
  scoped.use('/reports', reportRoutes(db));
  scoped.use('/', orgRoutes(db));
  app.use('/api/orgs/:orgId', scoped);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

  // In production the built React app is served from the same origin (one deploy, no CORS).
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
