import { join } from 'node:path';
import type { Ctx } from './context.ts';
import type { Job, RetryPolicy } from './queue.ts';
import type { Generator } from './generator.ts';
import { generateStub } from './generator.ts';
import { mintUniqueSlug } from './slug.ts';
// #2/#3 engine modules are vanilla .mjs (untyped here; no build step — Node runs TS+ESM directly).
import { makeNousLlm } from './research/providers/nous.mjs';
import { makeLocalScorer } from './research/scan.mjs';
import { makePreziGenerator } from './prezi/generate.mjs';

// In-process job worker. Polls the queue and runs typed handlers. The `generate` handler ties the
// publish loop together: presentation → generating → mint slug → run generator → published. The
// generator is injected so tests can force the failure path.

export type JobHandler = (job: Job, ctx: Ctx) => Promise<unknown>;

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, backoffMs: 5_000 };

export interface WorkerOptions {
  generator?: Generator;
  retry?: RetryPolicy;
  pollMs?: number;
}

/**
 * Choose the worker's generator (the #2→#3→#1 seam). When an LLM is configured
 * (NOUS_RESEARCH_API_KEY) the full prezi pipeline runs — research (#2, with the §7.1 injection scan
 * when PROMPT_GUARD_URL is set) → generate (#3) → publish (#1). Without an LLM the #1 stub is used so
 * dev/offline still produces a (degenerate) presentation rather than failing the job.
 */
export function selectGenerator(): Generator {
  const llm = makeNousLlm();
  if (!llm) return generateStub;
  const scorer = makeLocalScorer();
  return makePreziGenerator({ llm, ...(scorer ? { scan: { scorer } } : {}) }) as Generator;
}

export function makeGenerateHandler(generator: Generator): JobHandler {
  return async (job, ctx) => {
    const pres = ctx.db
      .prepare('SELECT id, title, source_writeup FROM presentations WHERE id = ?')
      .get(job.presentation_id) as { id: number; title: string; source_writeup: string } | undefined;
    if (!pres) throw new Error(`presentation ${job.presentation_id} not found`);

    const now = Date.now();
    ctx.db.prepare(`UPDATE presentations SET status = 'generating', updated_at = ? WHERE id = ?`).run(now, pres.id);

    const slug = mintUniqueSlug(ctx.db, pres.title);
    const outDir = join(ctx.config.dataDir, 'presentations', String(pres.id));
    const manifest = await generator({ id: pres.id, title: pres.title, sourceWriteup: pres.source_writeup, slug }, outDir);

    ctx.db
      .prepare(`UPDATE presentations SET status = 'published', slug = ?, updated_at = ? WHERE id = ?`)
      .run(slug, Date.now(), pres.id);

    return { slug, artifacts: manifest.artifacts };
  };
}

export class Worker {
  private ctx: Ctx;
  private handlers: Record<string, JobHandler>;
  private retry: RetryPolicy;
  private pollMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(ctx: Ctx, opts: WorkerOptions = {}) {
    this.ctx = ctx;
    this.retry = opts.retry ?? DEFAULT_RETRY;
    this.pollMs = opts.pollMs ?? 500;
    this.handlers = { generate: makeGenerateHandler(opts.generator ?? generateStub) };
  }

  // Process at most one job. Returns true if a job was claimed.
  async tick(): Promise<boolean> {
    const job = this.ctx.queue.claim();
    if (!job) return false;
    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type "${job.type}"`);
      const result = await handler(job, this.ctx);
      this.ctx.queue.complete(job.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const requeued = this.ctx.queue.fail(job.id, message, this.retry);
      if (!requeued) {
        this.ctx.db
          .prepare(`UPDATE presentations SET status = 'failed', updated_at = ? WHERE id = ?`)
          .run(Date.now(), job.presentation_id);
      }
    }
    return true;
  }

  // Drain all currently-runnable jobs (used in tests and on startup).
  async drain(): Promise<void> {
    // eslint-disable-next-line no-await-in-loop
    while (await this.tick()) {
      /* keep going */
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick()
        .catch((e) => console.error('worker tick error:', e))
        .finally(() => {
          this.running = false;
        });
    }, this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
