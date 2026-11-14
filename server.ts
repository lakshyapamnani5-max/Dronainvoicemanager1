import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { initializeDatabase } from './server/db.ts';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`DRONA Invoice Manager server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start DRONA server:', err);
  process.exit(1);
});
