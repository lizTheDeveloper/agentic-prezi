// Magic-link delivery. Phase 1b ships a dev-mode console sender; the real transactional provider
// (over node:https) is wired in phase 1e once one is picked + vetted through the #0 gate.
// The interface is the seam so swapping providers touches nothing else.

export interface EmailSender {
  sendMagicLink(email: string, link: string): Promise<void>;
}

// Logs the link to the console so local dev needs no email provider or secrets.
export class ConsoleEmailSender implements EmailSender {
  // Captured for assertions in tests; the console output is the dev affordance.
  sent: { email: string; link: string }[] = [];

  async sendMagicLink(email: string, link: string): Promise<void> {
    this.sent.push({ email, link });
    console.log(`\n[dev email] magic link for ${email}:\n  ${link}\n`);
  }
}
