// Production magic-link delivery via SendGrid's v3 Mail Send API. Zero npm deps (per #0):
// a direct node:https POST — no @sendgrid/mail SDK and its dependency tree. Mirrors the
// pure-core / thin-I/O split used by src/research/providers/nous.mjs:
//   - buildMailPayload is PURE and unit-tested offline.
//   - post is the injectable I/O layer (network); the default hits api.sendgrid.com.
//
// The API key (SENDGRID_API_KEY) comes from the runtime secret store, never the repo/image.

import { request } from 'node:https';
import type { EmailSender } from './email.ts';

export const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

export interface SendgridOptions {
  apiKey: string;
  from: string;              // verified sender, e.g. no-reply@themultiverse.school
  fromName?: string;
  subject?: string;
  post?: (args: { url: string; apiKey: string; payload: string }) => Promise<void>;
}

/**
 * Build the SendGrid v3 mail/send request body for a magic-link email. Pure — no I/O.
 * Plain-text part is the source of truth; a minimal HTML part makes the link clickable.
 * The link is the only dynamic value and is placed as data (never interpolated into markup
 * attributes beyond the href), and emails are non-secret transactional messages.
 */
export function buildMailPayload({
  to,
  from,
  link,
  fromName = 'Agentic Prezi',
  subject = 'Your Agentic Prezi sign-in link',
}: {
  to: string;
  from: string;
  link: string;
  fromName?: string;
  subject?: string;
}): string {
  const text = `Sign in to Agentic Prezi by opening this link:\n\n${link}\n\nThis link expires shortly and can be used once. If you didn't request it, ignore this email.`;
  const htmlHref = escapeHtmlAttr(link);
  const htmlText = escapeHtml(link);
  const html = `<p>Sign in to Agentic Prezi by opening this link:</p><p><a href="${htmlHref}">${htmlText}</a></p><p>This link expires shortly and can be used once. If you didn't request it, ignore this email.</p>`;
  return JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: fromName },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** I/O layer: POST the payload to SendGrid. Resolves on 2xx; throws (with a truncated,
 *  secret-free body) otherwise so the caller's error path logs/reports it. */
function defaultPost({ url, apiKey, payload }: { url: string; apiKey: string; payload: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        authorization: `Bearer ${apiKey}`,
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (status >= 200 && status < 300) return resolve();
        reject(new Error(`sendgrid: HTTP ${status}: ${raw.slice(0, 300)}`));
      });
    });
    req.setTimeout(20_000, () => req.destroy(new Error('sendgrid: request timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export class SendgridEmailSender implements EmailSender {
  #opts: Required<Pick<SendgridOptions, 'apiKey' | 'from'>> & SendgridOptions;
  constructor(opts: SendgridOptions) {
    if (!opts.apiKey) throw new Error('SendgridEmailSender: apiKey required');
    if (!opts.from) throw new Error('SendgridEmailSender: from address required');
    this.#opts = { ...opts };
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    const { apiKey, from, fromName, subject, post = defaultPost } = this.#opts;
    const payload = buildMailPayload({ to: email, from, link, fromName, subject });
    await post({ url: SENDGRID_URL, apiKey, payload });
  }
}
