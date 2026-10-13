import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type LinkScope = "SHOP" | "LESSEE";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function mintRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueEventLink(opts: {
  tenantId?: string;
  eventId: string;
  scope: LinkScope;
  partyRef?: string;
  actor?: string;
  expiresAt?: string | null;
  reissuedFrom?: string | null;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const raw = mintRawToken();
  const tokenHash = hashToken(raw);

  const { rows } = await q(
    `INSERT INTO repair.event_links
       (tenant_id, event_id, scope, party_ref, token_hash, expires_at, reissued_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, event_id, scope, party_ref, issued_at, expires_at, revoked_at`,
    [
      tenantId,
      opts.eventId,
      opts.scope,
      opts.partyRef ?? null,
      tokenHash,
      opts.expiresAt ?? null,
      opts.reissuedFrom ?? null,
      opts.actor ?? "system",
    ],
  );

  await writeAudit({
    tenantId,
    entity: "event_link",
    entityId: rows[0].id,
    action: "LINK_ISSUED",
    after: { scope: opts.scope, eventId: opts.eventId },
    actor: opts.actor ?? "system",
    via: "UI",
  });

  // Return raw token ONCE — never stored.
  return { link: rows[0], token: raw };
}

export async function revokeEventLink(opts: {
  linkId: string;
  actor?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.event_links
     SET revoked_at = now(), revoked_by = $2
     WHERE id = $1 AND tenant_id = $3 AND revoked_at IS NULL
     RETURNING *`,
    [opts.linkId, opts.actor ?? "system", tenantId],
  );
  if (!rows[0]) return null;
  await writeAudit({
    tenantId,
    entity: "event_link",
    entityId: opts.linkId,
    action: "LINK_REVOKED",
    after: { revoked_at: rows[0].revoked_at },
    actor: opts.actor ?? "system",
    via: "UI",
  });
  return rows[0];
}

export async function reissueEventLink(opts: {
  linkId: string;
  actor?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.event_links WHERE id = $1 AND tenant_id = $2`,
    [opts.linkId, tenantId],
  );
  const old = rows[0];
  if (!old) return null;
  if (!old.revoked_at) {
    await revokeEventLink({ linkId: opts.linkId, actor: opts.actor, tenantId });
  }
  return issueEventLink({
    tenantId,
    eventId: old.event_id,
    scope: old.scope,
    partyRef: old.party_ref,
    actor: opts.actor,
    expiresAt: old.expires_at,
    reissuedFrom: old.id,
  });
}

export type ResolvedLink = {
  link: Record<string, unknown>;
  event: Record<string, unknown>;
};

export async function resolveActiveLink(
  rawToken: string,
  scope?: LinkScope,
): Promise<ResolvedLink | null> {
  const tokenHash = hashToken(rawToken);
  const { rows } = await q(
    `SELECT l.*, e.car_mark, e.car_number, e.rule, e.origin, e.is_wreck,
            e.status_id AS event_status_id, e.shop_id, e.tenant_id AS event_tenant_id,
            s.code AS event_status_code, s.display_name AS event_status_name
     FROM repair.event_links l
     JOIN repair.events e ON e.id = l.event_id
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE l.token_hash = $1
       AND l.revoked_at IS NULL
       AND (l.expires_at IS NULL OR l.expires_at > now())
       AND e.deleted_at IS NULL
       AND ($2::text IS NULL OR l.scope = $2)
     LIMIT 1`,
    [tokenHash, scope ?? null],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    link: {
      id: row.id,
      event_id: row.event_id,
      scope: row.scope,
      party_ref: row.party_ref,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
    },
    event: {
      id: row.event_id,
      tenant_id: row.event_tenant_id,
      car_mark: row.car_mark,
      car_number: row.car_number,
      rule: row.rule,
      origin: row.origin,
      is_wreck: row.is_wreck,
      status_id: row.event_status_id,
      status_code: row.event_status_code,
      status_name: row.event_status_name,
      shop_id: row.shop_id,
    },
  };
}
