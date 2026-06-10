import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import type { JobQueue } from './queue.ts';
import type { EmailSender } from './email.ts';
import type { SchoolSso } from './school-sso.ts';

// The shared request/worker context. Dependencies are injected so tests can supply an in-memory
// DB, a capturing email sender, a throwing generator, or a mock SSO resolver.
export interface Ctx {
  db: DatabaseSync;
  config: Config;
  queue: JobQueue;
  email: EmailSender;
  schoolSso: SchoolSso;
}
