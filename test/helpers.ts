import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import type { App } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import type { EmailSender } from '../src/email.ts';
import type { WorkerOptions } from '../src/worker.ts';
import { generateStub } from '../src/generator.ts';

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
}

export async function bootTestApp(worker: WorkerOptions = { pollMs: 1e9 }): Promise<TestApp> {
  // Hermetic by default: pin the #1 stub generator unless a test injects its own, so the suite
  // never depends on ambient secrets (NOUS_RESEARCH_API_KEY) or makes live research/LLM calls.
  if (!worker.generator) worker = { ...worker, generator: generateStub };
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
  const app = createApp({ config, email, worker });
  const port = await app.listen(0);
  return { app, port, email, dataDir, client: makeClient(port) };
}

// Sign in a fresh user end-to-end, returning a client with the session cookie set.
export async function signIn(t: TestApp, emailAddr: string) {
  const client = makeClient(t.port);
  await client.request('POST', '/api/auth/request', { body: { email: emailAddr } });
  const link = t.email.sent[t.email.sent.length - 1].link;
  const token = new URL(link).searchParams.get('token')!;
  await client.request('POST', '/api/auth/verify', { body: { token } });
  return client;
}

export function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get('token')!;
}
