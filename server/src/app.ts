import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { ApiErrorBody } from '@app/shared';
import { createWebRouter } from './channels/web.router.js';
import type { TravelService } from './core/travelService.js';
import { errorHandler } from './http/errorHandler.middleware.js';

interface AppDependencies {
  service: TravelService;
  webDistPath?: string;
}

export function createApp({ service, webDistPath }: AppDependencies): Express {
  const app = express();

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', createWebRouter({ service }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' } satisfies ApiErrorBody);
  });

  if (webDistPath && existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('/{*spaRoute}', (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
