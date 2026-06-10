import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import type { App } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import type { EmailSender } from '../src/email.ts';
import type { WorkerOptions } from '../src/worker.ts';
import { createSchoolSso } from '../src/school-sso.ts';

// In-memory capturing email sender (no console noise during tests).
export class CaptureEmail implements EmailSender {
  sent: { email: string; link: string }[] = [];
  async sendMagicLink(email: string, link: string): Promise<void> {
    this.sent.push({ email, link });
  }
}

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

export interface RequestOptions {
  host?: string;
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean; // attach X-Requested-With for non-GET (default true)
}

// A client with a one-cookie jar and full control over the Host header (fetch forbids setting it).
export function makeClient(port: number) {
  const jar: { cookie?: string } = {};
  function request(method: string, path: string, opts: RequestOptions = {}): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : null;
      const headers: Record<string, string | number> = { ...(opts.headers ?? {}) };
      if (opts.host) headers.host = opts.host;
      const isWrite = method !== 'GET' && method !== 'HEAD';
      if (isWrite && opts.csrf !== false && headers['x-requested-with'] === undefined) {
        headers['x-requested-with'] = 'fetch';
      }
      if (data != null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(data);
      }
      if (jar.cookie) headers.cookie = jar.cookie;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          const sc = res.headers['set-cookie'];
          if (sc) jar.cookie = sc.map((c) => c.split(';')[0]).join('; ');
          let json: any;
          try { json = JSON.parse(buf); } catch { json = undefined; }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: buf, json });
        });
      });
      req.on('error', reject);
      if (data != null) req.write(data);
      req.end();
    });
  }
  return { request, jar };
}

export interface TestApp {
  app: App;
  port: number;
  email: CaptureEmail;
  dataDir: string;
  client: ReturnType<typeof makeClient>;
  // sid -> raw School session blob (JSON). signIn() registers entries; the injected mock SSO
  // resolver reads from here instead of a real Redis.
  schoolSessions: Map<string, string>;
}

export async function bootTestApp(worker: WorkerOptions = { pollMs: 1e9 }): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'prezi-test-'));
  const config = loadConfig({
    DB_PATH: ':memory:',
    DATA_DIR: dataDir,
    BASE_DOMAIN: 'themultiverse.school',
    COOKIE_SECURE: 'false',
    DEV_MODE: 'true',
    PUBLIC_DIR: 'public',
    PORT: '0',
  });
  const email = new CaptureEmail();
  // Mock School SSO: the real resolver logic (cache, blob parse, user upsert) over an in-memory
  // "Redis". cacheTtlMs 0 → every request re-resolves, so tests are deterministic.
  const schoolSessions = new Map<string, string>();
  const schoolSso = createSchoolSso({
    target: { host: 'mock', port: 0 },
    cacheTtlMs: 0,
    redisGet: async (_t, key) => schoolSessions.get(key.slice('school:session:'.length)) ?? null,
  });
  const app = createApp({ config, email, worker, schoolSso });
  const port = await app.listen(0);
  return { app, port, email, dataDir, client: makeClient(port), schoolSessions };
}

// "Sign in" a user: register a valid School session blob and return a client whose cookie jar
// carries the matching `session=<sid>` cookie, so every request authenticates as that user.
export function signIn(t: TestApp, emailAddr: string, opts: { sid?: string; expiresSec?: number } = {}) {
  const sid = opts.sid ?? `sid-${emailAddr.replace(/[^a-z0-9]/gi, '')}`;
  const expires = opts.expiresSec ?? Math.floor(Date.now() / 1000) + 3600;
  t.schoolSessions.set(sid, JSON.stringify({ expires, data: { email: emailAddr } }));
  const client = makeClient(t.port);
  client.jar.cookie = `session=${sid}`;
  return client;
}
