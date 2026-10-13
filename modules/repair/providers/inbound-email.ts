/**
 * InboundEmailProvider — Phase 1: paste/drop raw .eml or JSON into a dev endpoint.
 * Go-live: Postmark/SES inbound webhook behind the same interface.
 *
 * Never log reply-to tokens or one-time codes in full.
 */

export type InboundEmailMessage = {
  messageId?: string;
  from: string;
  to: string;
  subject: string;
  raw: string;
  receivedAt: string;
};

export type ParsedInboundDecision = {
  replyTokenHashHint?: string;
  proposedDecision: "APPROVED" | "REJECTED" | "UNKNOWN";
  confidence: number;
  comment?: string;
};

export interface InboundEmailProvider {
  /** Accept a raw message from the dev adapter or webhook. */
  ingest(raw: InboundEmailMessage): Promise<{
    id: string;
    parsed: ParsedInboundDecision;
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

/** Dev adapter — in-memory ingest; persistence lands with lessee_approvals / inbound_emails tables. */
export class DevInboundEmailProvider implements InboundEmailProvider {
  private store: Array<InboundEmailMessage & { id: string; parsed: ParsedInboundDecision }> =
    [];

  async ingest(raw: InboundEmailMessage) {
    const id = `inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parsed = cheapParse(raw);
    this.store.push({ ...raw, id, parsed });
    console.info("[repair/inbound:dev]", {
      id,
      from: raw.from,
      toHost: raw.to.includes("@") ? raw.to.split("@")[1] : "(opaque)",
      subject: raw.subject,
      proposedDecision: parsed.proposedDecision,
      confidence: parsed.confidence,
      // Reviewer must confirm before effect (brief §6b).
      needsReviewerConfirmation: true,
    });
    return { id, parsed };
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
