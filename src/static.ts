import type { ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';

// Traversal-safe static file server with injectable response headers (used for both the app SPA
// and the locked-down published origin). Returns false if the path resolves outside the base dir
// or the file does not exist, so callers can fall back (SPA index) or 404.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// Resolve a URL path under baseDir, refusing anything that escapes the directory.
export function resolveWithin(baseDir: string, urlPath: string): string | null {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const full = join(baseDir, clean);
  const baseResolved = normalize(baseDir + sep);
  if (full !== normalize(baseDir) && !normalize(full + sep).startsWith(baseResolved)) return null;
  return full;
}

export async function serveFile(
  res: ServerResponse,
  filePath: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType(filePath),
      'content-length': body.length,
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// Serve <baseDir><urlPath>; if missing and the path has no file extension, optionally serve
// <baseDir>/index.html (SPA client-side routing fallback).
export async function serveStatic(
  res: ServerResponse,
  baseDir: string,
  urlPath: string,
  opts: { headers?: Record<string, string>; spaFallback?: boolean } = {},
): Promise<boolean> {
  const headers = opts.headers ?? {};
  let path = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
  let full = resolveWithin(baseDir, path);
  if (full && (await serveFile(res, full, headers))) return true;
  if (opts.spaFallback && extname(path) === '') {
    const index = resolveWithin(baseDir, '/index.html');
    if (index && (await serveFile(res, index, headers))) return true;
  }
  return false;
}
