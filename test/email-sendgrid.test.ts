import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMailPayload, SendgridEmailSender, SENDGRID_URL } from '../src/email-sendgrid.ts';

test('buildMailPayload: shapes a valid SendGrid v3 mail/send body', () => {
  const body = JSON.parse(buildMailPayload({
    to: 'user@example.com',
    from: 'no-reply@themultiverse.school',
    link: 'https://presentations.themultiverse.school/api/auth/verify?token=abc',
  }));
  assert.equal(body.personalizations[0].to[0].email, 'user@example.com');
  assert.equal(body.from.email, 'no-reply@themultiverse.school');
  assert.equal(typeof body.subject, 'string');
  const types = body.content.map((c: { type: string }) => c.type);
  assert.deepEqual(types, ['text/plain', 'text/html']);
  // The link appears in both parts.
  assert.ok(body.content[0].value.includes('token=abc'));
  assert.ok(body.content[1].value.includes('token=abc'));
});

test('buildMailPayload: escapes HTML metacharacters in the link (no markup injection)', () => {
  const body = JSON.parse(buildMailPayload({
    to: 'a@b.com',
    from: 'f@b.com',
    link: 'https://x/verify?t="><script>alert(1)</script>',
  }));
  const html = body.content[1].value;
  assert.ok(!html.includes('<script>'), 'raw <script> must not survive into HTML part');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;'));
});

test('SendgridEmailSender: posts to the SendGrid endpoint with Bearer auth', async () => {
  const calls: { url: string; apiKey: string; payload: string }[] = [];
  const sender = new SendgridEmailSender({
    apiKey: 'SG.test-key',
    from: 'no-reply@themultiverse.school',
    post: async (args) => { calls.push(args); },
  });
  await sender.sendMagicLink('user@example.com', 'https://presentations.themultiverse.school/verify?token=z');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SENDGRID_URL);
  assert.equal(calls[0].apiKey, 'SG.test-key');
  assert.ok(calls[0].payload.includes('user@example.com'));
});

test('SendgridEmailSender: requires apiKey and from', () => {
  assert.throws(() => new SendgridEmailSender({ apiKey: '', from: 'f@b.com' }));
  assert.throws(() => new SendgridEmailSender({ apiKey: 'k', from: '' }));
});
