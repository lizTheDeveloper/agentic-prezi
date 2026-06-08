// Runtime configuration, driven entirely by env vars so nothing secret lives in source.
// Sensible dev defaults let `node src/server.ts` run with no setup; production overrides
// (cookie secret, base domain, real-email creds) come from the environment / runtime store.

export interface Config {
  port: number;
  baseDomain: string;        // e.g. themultiverse.school
  appHosts: Set<string>;     // hosts routed to the app origin (SPA + /api/*)
  cookieSecure: boolean;     // Secure flag — off for local http dev, on in production
  dataDir: string;           // published artifacts live under <dataDir>/presentations/<id>/
  dbPath: string;
  publicDir: string;         // the vanilla SPA static files
  devMode: boolean;          // log magic links to the console instead of emailing
  devAuthBypass: boolean;    // DEV ONLY: enable /api/dev/login (instant session, no email)
  magicTokenTtlMs: number;
  sessionTtlMs: number;
  maxBodyBytes: number;
  maxTitleLen: number;
  maxWriteupLen: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v == null) return dflt;
  return v === '1' || v.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseDomain = env.BASE_DOMAIN ?? 'themultiverse.school';
  const devMode = bool(env.DEV_MODE, env.NODE_ENV !== 'production');

  // Hard refusal: the dev auth bypass must NEVER be enabled in production. Fail loudly at
  // startup rather than silently ignore a dangerous misconfiguration.
  if (env.NODE_ENV === 'production' && bool(env.DEV_AUTH_BYPASS, false)) {
    throw new Error('DEV_AUTH_BYPASS must never be enabled in production');
  }
  return {
    port: Number(env.PORT ?? 8787),
    baseDomain,
    appHosts: new Set([
      baseDomain,
      `app.${baseDomain}`,
      'localhost',
      '127.0.0.1',
    ]),
    // Sessions are opaque high-entropy random tokens stored hashed-at-rest in the `sessions`
    // table, so no cookie-signing secret is needed (the server-side store is the authority).
    cookieSecure: bool(env.COOKIE_SECURE, !devMode),
    dataDir: env.DATA_DIR ?? 'data',
    dbPath: env.DB_PATH ?? 'data/app.db',
    publicDir: env.PUBLIC_DIR ?? 'public',
    devMode,
    // Only honored in dev (and never in prod, per the guard above). Default off.
    devAuthBypass: devMode && bool(env.DEV_AUTH_BYPASS, false),
    magicTokenTtlMs: Number(env.MAGIC_TOKEN_TTL_MS ?? 15 * 60_000),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 30 * 24 * 60 * 60_000),
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 256 * 1024),
    maxTitleLen: Number(env.MAX_TITLE_LEN ?? 200),
    maxWriteupLen: Number(env.MAX_WRITEUP_LEN ?? 50_000),
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60 * 60_000),
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? 5),
  };
}
