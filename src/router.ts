import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';

// Minimal method+path router with `:param` capture. Path matching is exact on segment count.

export type Params = Record<string, string>;
export type Handler = (req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, parts: split(path), handler });
  }
  get(path: string, handler: Handler): void { this.add('GET', path, handler); }
  post(path: string, handler: Handler): void { this.add('POST', path, handler); }
  patch(path: string, handler: Handler): void { this.add('PATCH', path, handler); }
  delete(path: string, handler: Handler): void { this.add('DELETE', path, handler); }

  match(method: string, path: string): { handler: Handler; params: Params } | null {
    const segs = split(path);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.parts.length !== segs.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const rp = r.parts[i];
        if (rp.startsWith(':')) {
          params[rp.slice(1)] = decodeURIComponent(segs[i]);
        } else if (rp !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}
