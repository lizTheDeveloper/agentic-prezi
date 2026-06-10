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
import { createSchoolSso, parseRedisUrl } from './school-sso.ts';
import type { SchoolSso } from './school-sso.ts';
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

// Email is currently used only for optional notifications (auth is School SSO), so a missing
// provider is no longer fatal — default to the console sender, upgrade to SendGrid when configured.
function selectEmailSender(config: Config): EmailSender {
  if (config.emailApiKey && config.emailFrom) {
    return new SendgridEmailSender({
      apiKey: config.emailApiKey,
      from: config.emailFrom,
      fromName: config.emailFromName,
    });
  }
  return new ConsoleEmailSender();
}

// Build the School-SSO resolver from config. The prod guard in loadConfig already ensures the
// Redis URL is present in production; in dev without one, SSO simply resolves nobody.
function buildSchoolSso(config: Config): SchoolSso {
  return createSchoolSso({
    target: config.schoolRedisUrl
      ? parseRedisUrl(config.schoolRedisUrl)
      : { host: '127.0.0.1', port: 0 }, // unreachable placeholder → resolve() fails closed in dev
    cookieName: config.schoolSessionCookieName,
    keyPrefix: config.schoolSessionKeyPrefix,
  });
}

export function createApp(opts: { config?: Config; email?: EmailSender; worker?: WorkerOptions; schoolSso?: SchoolSso } = {}): App {
  const config = opts.config ?? loadConfig();
  const db = openDb(config.dbPath);
  const queue = new JobQueue(db);
  const email = opts.email ?? selectEmailSender(config);
  const schoolSso = opts.schoolSso ?? buildSchoolSso(config);
  const ctx: Ctx = { db, config, queue, email, schoolSso };
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
    console.log(`  app origin:       http://localhost:${port}  (Host: ${app.ctx.config.appHost})`);
    console.log(`  published origin: https://${app.ctx.config.publishedHost}/p/<slug>`);
    console.log(`  auth: School SSO via ${app.ctx.config.schoolLoginUrl}` +
      (app.ctx.config.schoolRedisUrl ? '' : '  (SCHOOL_SESSION_REDIS_URL unset — dev: nobody resolves)'));
  });
}
