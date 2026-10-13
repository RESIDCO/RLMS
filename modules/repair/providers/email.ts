/**
 * EmailProvider — Phase 1 uses a log/DB adapter (no paid send).
 * Go-live: Postmark or SES behind the same interface.
 */

export type OutboundEmail = {
  tenantId: string;
  eventId?: string;
  type: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    /** Storage key or inline base64 — never log raw secrets */
    storageKey?: string;
    size?: number;
  }>;
  /** Tokenized reply-to for lessee email (raw token never stored in logs) */
  replyTo?: string;
};

export type EmailSendResult = {
  providerMessageId: string;
  status: "logged" | "queued" | "sent" | "failed";
};

export interface EmailProvider {
  send(message: OutboundEmail): Promise<EmailSendResult>;
}

/** Dev adapter: writes a structured log line; does not send. */
export class LogEmailProvider implements EmailProvider {
  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Never log reply-to tokens or attachment bytes.
    console.info("[repair/email:dev]", {
      id,
      tenantId: message.tenantId,
      eventId: message.eventId,
      type: message.type,
      toCount: message.to.length,
      ccCount: message.cc?.length ?? 0,
      subject: message.subject,
      attachmentCount: message.attachments?.length ?? 0,
      hasReplyTo: Boolean(message.replyTo),
    });
    return { providerMessageId: id, status: "logged" };
  }
}

let emailProvider: EmailProvider = new LogEmailProvider();

export function getEmailProvider(): EmailProvider {
  return emailProvider;
}

export function setEmailProvider(provider: EmailProvider): void {
  emailProvider = provider;
}
