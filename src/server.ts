import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { JobQueue } from './queue.ts';
import { ConsoleEmailSender } from './email.ts';
import type { EmailSender } from './email.ts';
import type { Ctx } from './context.ts';
import { getHostname } from './http.ts';
import { handleApp } from './app.ts';
import { handlePublished } from './published.ts';
import { Worker } from './worker.ts';
import type { WorkerOptions } from './worker.ts';

// Wires the pieces together and dispatches by Host header: app origin vs <slug> origin.
// Exported as a factory so tests can boot a real server on an ephemeral port with injected deps.

export interface App {
  ctx: Ctx;
  worker: Worker;
  server: Server;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createApp(opts: { config?: Config; email?: EmailSender; worker?: WorkerOptions } = {}): App {
  const config = opts.config ?? loadConfig();
  const db = openDb(config.dbPath);
  const queue = new JobQueue(db);
  const email = opts.email ?? new ConsoleEmailSender();
  const ctx: Ctx = { db, config, queue, email };
  const worker = new Worker(ctx, opts.worker);

  const server = createServer((req, res) => {
    const hostname = getHostname(req);
    const dispatch =
      config.appHosts.has(hostname) || !hostname.endsWith('.' + config.baseDomain)
        ? handleApp(req, res, ctx)
        : handlePublished(req, res, ctx, hostname);
    Promise.resolve(dispatch).catch((err) => {
      console.error('unhandled request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      }
    });
  });

  return {
    ctx,
    worker,
    server,
    listen(port = config.port): Promise<number> {
      return new Promise((resolve) => {
        server.listen(port, () => {
          worker.start();
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    close(): Promise<void> {
      worker.stop();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        db.close();
      });
    },
  };
}

// Entry point: `node src/server.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen().then((port) => {
    console.log(`agentic-prezi listening on http://localhost:${port}`);
    console.log(`  app origin:       http://localhost:${port}  (Host: app.${app.ctx.config.baseDomain})`);
    console.log(`  published origin: Host: <slug>.${app.ctx.config.baseDomain}`);
    if (app.ctx.config.devMode) console.log('  dev mode: magic links are logged to this console.');
  });
}
