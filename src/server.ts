import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { JobQueue } from './queue.ts';
import { ConsoleEmailSender } from './email.ts';
import { SendgridEmailSender } from './email-sendgrid.ts';
import type { EmailSender } from './email.ts';
import type { Ctx } from './context.ts';
import { getHostname } from './http.ts';
import { handleApp } from './app.ts';
import { handlePublished, handlePublishedPath } from './published.ts';
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

// Pick the magic-link delivery channel from config. A real provider (SendGrid key + verified
// sender) wins. In dev we fall back to the console sender. In PRODUCTION with no provider, we
// fail loud at boot: magic-link is the only prod auth, so a console-only deploy is a dead login
// that would silently lock every user out — better to refuse to start than to look healthy.
function selectEmailSender(config: Config): EmailSender {
  if (config.emailApiKey && config.emailFrom) {
    return new SendgridEmailSender({
      apiKey: config.emailApiKey,
      from: config.emailFrom,
      fromName: config.emailFromName,
    });
  }
  if (!config.devMode) {
    throw new Error(
      'No email provider configured in production (set SENDGRID_API_KEY + EMAIL_FROM). ' +
      'Magic-link is the only production login; refusing to start a dead-login deploy.',
    );
  }
  return new ConsoleEmailSender();
}

export function createApp(opts: { config?: Config; email?: EmailSender; worker?: WorkerOptions } = {}): App {
  const config = opts.config ?? loadConfig();
  const db = openDb(config.dbPath);
  const queue = new JobQueue(db);
  const email = opts.email ?? selectEmailSender(config);
  const ctx: Ctx = { db, config, queue, email };
  const worker = new Worker(ctx, opts.worker);

  const server = createServer((req, res) => {
    const hostname = getHostname(req);
    const dispatch =
      hostname === config.publishedHost
        ? handlePublishedPath(req, res, ctx)
        : config.appHosts.has(hostname) || !hostname.endsWith('.' + config.baseDomain)
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
    console.log(`  published origin: https://${app.ctx.config.publishedHost}/p/<slug>`);
    if (app.ctx.config.devMode) console.log('  dev mode: magic links are logged to this console.');
    if (app.ctx.config.devAuthBypass) {
      console.log('  ⚠ DEV AUTH BYPASS ENABLED — GET/POST /api/dev/login mints a session with no email. DEV ONLY.');
    }
  });
}
