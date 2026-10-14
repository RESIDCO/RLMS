/**
 * InboundEmailProvider — Phase 1: paste/drop raw .eml or JSON into a dev endpoint.
 * Go-live: Postmark/SES inbound webhook behind the same interface.
 *
 * Never log reply-to tokens or one-time codes in full.
 *
 * Shop 500-byte invoices may arrive as base64 attachments on the JSON body;
 * callers pass them to ingestCrbInvoiceFromInboundEmail after ingest().
 */

export type InboundEmailAttachment = {
  filename: string;
  mime?: string;
  /** Raw bytes when available (dev adapter). */
  bytes?: Buffer;
  /** Base64 content from JSON paste endpoint. */
  contentBase64?: string;
};

export type InboundEmailMessage = {
  messageId?: string;
  from: string;
  to: string;
  subject: string;
  raw: string;
  receivedAt: string;
  /** Optional shop event link token (dev helper / subject parse). */
  eventToken?: string;
  eventId?: string;
  attachments?: InboundEmailAttachment[];
};

export type ParsedInboundDecision = {
  replyTokenHashHint?: string;
  proposedDecision: "APPROVED" | "REJECTED" | "UNKNOWN";
  confidence: number;
  comment?: string;
  /** Detected shop invoice attachment (500-byte / CRB). */
  shopInvoiceAttachment?: {
    filename: string;
    mime: string;
    byteLength: number;
  };
};

export interface InboundEmailProvider {
  /** Accept a raw message from the dev adapter or webhook. */
  ingest(raw: InboundEmailMessage): Promise<{
    id: string;
    parsed: ParsedInboundDecision;
    /** Normalized attachments with bytes (when provided). */
    attachments: Array<{
      filename: string;
      mime: string;
      bytes: Buffer;
    }>;
    eventToken?: string;
    eventId?: string;
  }>;
}

function cheapParse(raw: InboundEmailMessage): ParsedInboundDecision {
  const body = `${raw.subject}\n${raw.raw}`.toLowerCase();
  let proposedDecision: ParsedInboundDecision["proposedDecision"] = "UNKNOWN";
  let confidence = 0.2;
  if (/\b(approve|approved|ok|lgtm)\b/.test(body)) {
    proposedDecision = "APPROVED";
    confidence = 0.55;
  } else if (/\b(reject|rejected|deny|denied)\b/.test(body)) {
    proposedDecision = "REJECTED";
    confidence = 0.55;
  }
  return { proposedDecision, confidence };
}

function normalizeAttachments(raw: InboundEmailMessage) {
  const out: Array<{ filename: string; mime: string; bytes: Buffer }> = [];
  for (const a of raw.attachments ?? []) {
    let bytes: Buffer | undefined = a.bytes;
    if (!bytes && a.contentBase64) {
      bytes = Buffer.from(a.contentBase64, "base64");
    }
    if (!bytes?.length) continue;
    out.push({
      filename: a.filename || "attachment.bin",
      mime: a.mime || "application/octet-stream",
      bytes,
    });
  }
  return out;
}

function looksLike500ByteInvoice(att: { filename: string; bytes: Buffer }): boolean {
  const name = att.filename.toLowerCase();
  if (name.endsWith(".txt") || name.includes("500") || name.includes("crip") || name.includes("aar")) {
    return true;
  }
  // Heuristic: first non-empty line is 500 chars starting with Format 1/6/8/9
  const text = att.bytes.toString("latin1");
  const line = text.split(/\r?\n/).find((l) => l.length > 0);
  return Boolean(line && line.length === 500 && /^[1689]/.test(line));
}

/** Extract event token from to-address like shop-invoice+TOKEN@inbound.dev */
export function extractEventTokenFromTo(to: string): string | undefined {
  const m = to.match(/(?:shop-invoice|invoice|r)\+([^@\s]+)@/i);
  return m?.[1];
}

/** Dev adapter — in-memory ingest; persistence lands with lessee_approvals / inbound_emails tables. */
export class DevInboundEmailProvider implements InboundEmailProvider {
  private store: Array<
    InboundEmailMessage & {
      id: string;
      parsed: ParsedInboundDecision;
      attachments: Array<{ filename: string; mime: string; bytes: Buffer }>;
    }
  > = [];

  async ingest(raw: InboundEmailMessage) {
    const id = `inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parsed = cheapParse(raw);
    const attachments = normalizeAttachments(raw);
    const invoiceAtt = attachments.find(looksLike500ByteInvoice);
    if (invoiceAtt) {
      parsed.shopInvoiceAttachment = {
        filename: invoiceAtt.filename,
        mime: invoiceAtt.mime,
        byteLength: invoiceAtt.bytes.length,
      };
    }
    const eventToken =
      raw.eventToken || extractEventTokenFromTo(raw.to) || undefined;
    this.store.push({ ...raw, id, parsed, attachments });
    console.info("[repair/inbound:dev]", {
      id,
      from: raw.from,
      toHost: raw.to.includes("@") ? raw.to.split("@")[1] : "(opaque)",
      subject: raw.subject,
      proposedDecision: parsed.proposedDecision,
      confidence: parsed.confidence,
      attachmentCount: attachments.length,
      shopInvoice: Boolean(invoiceAtt),
      // Reviewer must confirm lessee decisions before effect (brief §6b).
      needsReviewerConfirmation: !invoiceAtt,
    });
    return {
      id,
      parsed,
      attachments,
      eventToken,
      eventId: raw.eventId,
    };
  }

  list() {
    return [...this.store];
  }
}

let inboundProvider: InboundEmailProvider = new DevInboundEmailProvider();

export function getInboundEmailProvider(): InboundEmailProvider {
  return inboundProvider;
}

export function setInboundEmailProvider(provider: InboundEmailProvider): void {
  inboundProvider = provider;
}
