import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db.ts';
import { slugify, makeSlug, mintUniqueSlug } from '../src/slug.ts';
import { generateStub, renderSvg } from '../src/generator.ts';
import { escapeXml } from '../src/validate.ts';
import { checkRateLimit } from '../src/rate-limit.ts';
import { JobQueue } from '../src/queue.ts';
import { safeEqualHex } from '../src/crypto.ts';

function memDb() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

test('slugify produces url-safe slugs and a fallback', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  assert.equal(slugify('***'), 'presentation');
  assert.match(makeSlug('My Talk'), /^my-talk-[0-9A-Za-z]{4}$/);
});

test('mintUniqueSlug avoids collisions with existing slugs', () => {
  const db = memDb();
  db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)').run('u@e.com', Date.now());
  // Insert a presentation occupying a slug, then ensure minting never returns it.
  const slug = makeSlug('Taken');
  db.prepare(
    `INSERT INTO presentations (user_id, title, status, slug, created_at, updated_at) VALUES (1,'Taken','published',?,0,0)`,
  ).run(slug);
  for (let i = 0; i < 20; i++) assert.notEqual(mintUniqueSlug(db, 'Taken'), slug);
});

test('escapeXml neutralizes markup characters', () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
});

test('renderSvg embeds escaped user text', () => {
  const svg = renderSvg('Title <b>', 'body & <script>');
  assert.match(svg, /Title &lt;b&gt;/);
  assert.match(svg, /body &amp; &lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
});

test('generateStub writes the contracted artifacts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-'));
  const manifest = await generateStub({ id: 7, title: 'T', sourceWriteup: 'W', slug: 't-abcd' }, dir);
  assert.equal(manifest.presentationId, 7);
  assert.equal(manifest.slug, 't-abcd');
  const onDisk = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
});

test('rate limit allows up to max per window, then blocks; resets after window', () => {
  const db = memDb();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(checkRateLimit(db, 'b', 3, 1000, now + i), true);
  assert.equal(checkRateLimit(db, 'b', 3, 1000, now + 4), false); // over limit, same window
  assert.equal(checkRateLimit(db, 'b', 3, 1000, now + 2000), true); // new window
});

test('job queue: enqueue, claim, complete', () => {
  const db = memDb();
  db.prepare('INSERT INTO users (email, created_at) VALUES (?,?)').run('u@e.com', 0);
  db.prepare(`INSERT INTO presentations (user_id,title,status,created_at,updated_at) VALUES (1,'t','queued',0,0)`).run();
  const q = new JobQueue(db);
  const jobId = q.enqueue(1, 'generate', { a: 1 }, 0);
  const job = q.claim(0)!;
  assert.equal(job.id, jobId);
  assert.equal(job.status, 'running');
  assert.equal(job.attempts, 1);
  assert.deepEqual(job.payload, { a: 1 });
  assert.equal(q.claim(0), null); // nothing left runnable
  q.complete(jobId, { ok: true });
  assert.equal(q.get(jobId)!.status, 'done');
});

test('job queue: fail requeues with backoff until attempts exhausted', () => {
  const db = memDb();
  db.prepare('INSERT INTO users (email, created_at) VALUES (?,?)').run('u@e.com', 0);
  db.prepare(`INSERT INTO presentations (user_id,title,status,created_at,updated_at) VALUES (1,'t','queued',0,0)`).run();
  const q = new JobQueue(db);
  const id = q.enqueue(1, 'generate', null, 0);
  const policy = { maxAttempts: 2, backoffMs: 100 };

  q.claim(0); // attempts -> 1
  assert.equal(q.fail(id, 'err', policy, 0), true); // requeued
  assert.equal(q.claim(0), null); // blocked by backoff (run_after = 100)
  q.claim(150); // attempts -> 2
  assert.equal(q.fail(id, 'err', policy, 150), false); // exhausted -> failed
  assert.equal(q.get(id)!.status, 'failed');
});

test('safeEqualHex compares constant-length hex safely', () => {
  assert.equal(safeEqualHex('abcd', 'abcd'), true);
  assert.equal(safeEqualHex('abcd', 'abce'), false);
  assert.equal(safeEqualHex('ab', 'abcd'), false);
  assert.equal(safeEqualHex('', ''), false);
});
