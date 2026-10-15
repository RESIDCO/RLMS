/**
 * Customary RepairSMART lessee responsibility email.
 * Subject / To / CC / body table / attachments / local .eml outbox.
 *
 * To  = lessee contacts (shop never in To)
 * CC  = owner reviewer (sender) + shop contact
 * From = system address; Reply-To = owner reviewer
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TENANT_ID, q } from "../db";
import {
  brcAttachmentBaseName,
  displayCarNumber,
} from "./brc-pdf";
import { formatCentsWithCommas } from "./money";
import { workspaceTitle } from "./entity";
import {
  loadLesseeWindowConfig,
  responseWindowPhrase,
} from "./lessee-window";

export type LesseeEmailDraft = {
  subject: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  replyTo: string | null;
  bodyText: string;
  bodyHtml: string;
  table: {
    category: string;
    equipment: string;
    dollarAmount: string;
    dollarAmountCents: number;
    client: string;
    user: string;
    description: string;
  };
  attachmentNames: {
    pdf: string;
    data500: string;
  };
  /** @deprecated Prefer responseBusinessDays — kept for preview compatibility */
  responseHours: number;
  responseBusinessDays: number;
  responseWindowPhrase: string;
  approveUrlPath: string | null;
  carLabel: string;
  shopDisplay: string;
};

export async function loadLesseeEmailSettings(
  tenantId = DEFAULT_TENANT_ID,
  entityCode?: string | null,
) {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [
    tenantId,
  ]);
  const settings = (rows[0]?.settings as Record<string, unknown>) ?? {};
  const window = await loadLesseeWindowConfig({ tenantId, entityCode });
  const from =
    String(settings.systemFromEmail ?? "noreply@repair.local").trim() ||
    "noreply@repair.local";
  const fromName =
    String(settings.systemFromName ?? "Contract Shop System").trim() ||
    "Contract Shop System";
  const outboxDir =
    String(settings.emailOutboxDir ?? "modules/repair/dev/email-outbox").trim() ||
    "modules/repair/dev/email-outbox";
  return {
    responseHours: window.minHours, // legacy field — no longer used in Description
    responseBusinessDays: window.businessDays,
    responseWindowPhrase: responseWindowPhrase(window.businessDays),
    window,
    from,
    fromName,
    outboxDir,
    settings,
  };
}

/** Resolve To (lessee) + CC (owner sender + shop) for customary RESP6 email. */
export async function resolveLesseeEmailParties(opts: {
  eventId: string;
  actor: string;
  actorEmail?: string;
  tenantId?: string;
  extraTo?: string[];
}): Promise<{
  to: string[];
  cc: string[];
  replyTo: string | null;
  shopEmails: string[];
  ownerEmails: string[];
}> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;

  const { rows: lesseeRows } = await q(
    `SELECT email FROM repair.contacts
     WHERE tenant_id = $1 AND party_type = 'lessee'
       AND active AND deleted_at IS NULL AND email IS NOT NULL
     UNION
     SELECT email FROM repair.event_adhoc_emails
     WHERE event_id = $2 AND tenant_id = $1 AND deleted_at IS NULL
       AND (notification_type IS NULL OR notification_type = 'RESP6_LESSEE_EMAIL')`,
    [tenantId, opts.eventId],
  );
  const to = new Set<string>();
  for (const r of lesseeRows) {
    const e = String(r.email ?? "")
      .trim()
      .toLowerCase();
    if (e.includes("@")) to.add(e);
  }
  for (const e of opts.extraTo ?? []) {
    const t = e.trim().toLowerCase();
    if (t.includes("@")) to.add(t);
  }

  const { rows: shopRows } = await q(
    `SELECT COALESCE(s.default_inbox, c.email) AS email
     FROM repair.events e
     LEFT JOIN repair.shops s ON s.id = e.shop_id AND s.deleted_at IS NULL
     LEFT JOIN repair.contacts c
       ON c.tenant_id = e.tenant_id
      AND c.party_type = 'shop'
      AND c.active AND c.deleted_at IS NULL
      AND (c.party_ref = s.reporting_mark OR c.party_ref = s.id::text OR c.party_ref = s.shop_mark)
     WHERE e.id = $1`,
    [opts.eventId],
  );
  const shopEmails = [
    ...new Set(
      shopRows
        .map((r) =>
          String(r.email ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter((e) => e.includes("@")),
    ),
  ];

  const actorEmail =
    (opts.actorEmail ?? "").trim().toLowerCase() ||
    (opts.actor.includes("@") ? opts.actor.trim().toLowerCase() : "");
  const { rows: ownerRows } = await q(
    `SELECT u.email
     FROM repair.users u
     JOIN repair.user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
     WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
       AND ur.role = ANY($2::text[])`,
    [
      tenantId,
      ["admin", "car_owner", "mech_manager", "reviewer", "fleet_manager"],
    ],
  );
  const ownerEmails = [
    ...new Set(
      ownerRows
        .map((r) =>
          String(r.email ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter((e) => e.includes("@")),
    ),
  ];
  if (actorEmail.includes("@")) ownerEmails.unshift(actorEmail);

  const cc = new Set<string>();
  for (const e of ownerEmails) cc.add(e);
  for (const e of shopEmails) cc.add(e);
  // Never put To recipients on CC
  for (const e of to) cc.delete(e);

  const replyTo =
    (actorEmail.includes("@") ? actorEmail : null) ||
    ownerEmails[0] ||
    null;

  return {
    to: [...to],
    cc: [...cc],
    replyTo,
    shopEmails,
    ownerEmails,
  };
}

export async function buildLesseeResponsibilityEmail(opts: {
  estimateId: string;
  eventId: string;
  carInitial: string;
  carNumber: string;
  shopName: string;
  shopCityState: string;
  amountCents: number;
  actor: string;
  actorFullName?: string;
  actorEmail?: string;
  actorLogin?: string;
  entityCode?: string | null;
  estimateNo: string;
  approveUrlPath?: string | null;
  /** @deprecated Ignored — Description uses business days */
  responseHours?: number;
  responseBusinessDays?: number;
  extraTo?: string[];
  tenantId?: string;
}): Promise<LesseeEmailDraft> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const settings = await loadLesseeEmailSettings(tenantId, opts.entityCode);
  const businessDays =
    opts.responseBusinessDays ?? settings.responseBusinessDays;
  const windowPhrase = responseWindowPhrase(businessDays);
  const parties = await resolveLesseeEmailParties({
    eventId: opts.eventId,
    actor: opts.actor,
    actorEmail: opts.actorEmail,
    tenantId,
    extraTo: opts.extraTo,
  });

  const carNumDisplay = displayCarNumber(opts.carNumber);
  const carLabel = `${opts.carInitial} ${carNumDisplay}`.trim();
  const carLabelFull = `${opts.carInitial} ${opts.carNumber}`.trim();
  const subject = `Responsibility Items ${opts.carInitial} ${carNumDisplay}`.trim();

  const client =
    opts.entityCode?.trim() ||
    (await workspaceTitle(tenantId));
  const login = opts.actorLogin || opts.actorEmail || opts.actor;
  const fullName = opts.actorFullName || opts.actor;
  const user = `${login} (${fullName})`;

  const shopLoc = [opts.shopName, opts.shopCityState].filter(Boolean).join(" – ");
  const description =
    `${carLabelFull} is currently at ${shopLoc || "the repair shop"} for repairs. ` +
    `The attached items have been identified as lessee responsibility items per the terms of the contract. ` +
    `Please review and advise your approval at your earliest convenience. ` +
    `${client} requests a response within ${windowPhrase} of receipt of this notification. Thank you`;

  const dollarAmount = formatCentsWithCommas(opts.amountCents);
  const base = brcAttachmentBaseName(
    opts.carInitial,
    opts.carNumber,
    opts.estimateNo,
  );
  const attachmentNames = {
    pdf: `${base}_Resp6.pdf`,
    data500: `${base}_Resp6Byte500.txt`,
  };

  const approvePath = opts.approveUrlPath ?? null;
  const table = {
    category: "Responsibility Items BRC",
    equipment: carLabelFull,
    dollarAmount,
    dollarAmountCents: opts.amountCents,
    client,
    user,
    description,
  };

  const bodyText = [
    "Contract Shop System Message",
    "",
    `Category: ${table.category}`,
    `Equipment: ${table.equipment}`,
    `Dollar Amount: $${table.dollarAmount}`,
    `Client: ${table.client}`,
    `User: ${table.user}`,
    `Description: ${table.description}`,
    approvePath ? `\nReview / Approve: ${approvePath}` : "",
    "",
    `Attachments: ${attachmentNames.pdf}, ${attachmentNames.data500}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const bodyHtml = `<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#222;">
  <div style="margin-bottom:12px;">
    <div style="font-size:18px;font-weight:bold;letter-spacing:0.02em;">${escapeHtml(client)}</div>
    <div style="background:#1a3a5c;color:#fff;padding:8px 12px;margin-top:8px;font-weight:bold;">
      Contract Shop System Message
    </div>
  </div>
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#ccc;width:100%;max-width:640px;">
    <tr><td style="width:160px;font-weight:bold;background:#f5f5f5;">Category</td><td>${escapeHtml(table.category)}</td></tr>
    <tr><td style="font-weight:bold;background:#f5f5f5;">Equipment</td><td>${escapeHtml(table.equipment)}</td></tr>
    <tr><td style="font-weight:bold;background:#f5f5f5;">Dollar Amount</td><td>$${escapeHtml(table.dollarAmount)}</td></tr>
    <tr><td style="font-weight:bold;background:#f5f5f5;">Client</td><td>${escapeHtml(table.client)}</td></tr>
    <tr><td style="font-weight:bold;background:#f5f5f5;">User</td><td>${escapeHtml(table.user)}</td></tr>
    <tr><td style="font-weight:bold;background:#f5f5f5;">Description</td><td>${escapeHtml(table.description)}</td></tr>
  </table>
  ${
    approvePath
      ? `<p style="margin-top:16px;"><a href="${escapeHtml(approvePath)}" style="display:inline-block;background:#1a3a5c;color:#fff;padding:10px 18px;text-decoration:none;border-radius:3px;font-weight:bold;">Review / Approve</a></p>`
      : ""
  }
  <p style="margin-top:16px;color:#555;font-size:12px;">Attachments: ${escapeHtml(attachmentNames.pdf)}, ${escapeHtml(attachmentNames.data500)}</p>
</body></html>`;

  return {
    subject,
    from: settings.from,
    fromName: settings.fromName,
    to: parties.to,
    cc: parties.cc,
    replyTo: parties.replyTo,
    bodyText,
    bodyHtml,
    table,
    attachmentNames,
    responseHours: settings.responseHours,
    responseBusinessDays: businessDays,
    responseWindowPhrase: windowPhrase,
    approveUrlPath: approvePath,
    carLabel: carLabelFull,
    shopDisplay: shopLoc,
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeHeader(value: string): string {
  // RFC 2047-ish for non-ascii; keep simple for ASCII customary content
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Write a multipart .eml to the local outbox folder. Never sends.
 * Returns relative path from repo root when possible.
 */
export async function writeLesseeEmailEml(opts: {
  draft: LesseeEmailDraft;
  attachments: Array<{
    filename: string;
    contentType: string;
    bytes: Buffer;
  }>;
  outboxDir?: string;
  tenantId?: string;
}): Promise<{ absPath: string; relPath: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const settings = await loadLesseeEmailSettings(tenantId);
  const outDir = path.resolve(
    process.cwd(),
    opts.outboxDir || settings.outboxDir,
  );
  await mkdir(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeSubj = opts.draft.subject.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  const filename = `${stamp}_${safeSubj}.eml`;
  const absPath = path.join(outDir, filename);

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mixBoundary = `----=_Mix_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `From: ${encodeHeader(opts.draft.fromName)} <${opts.draft.from}>`,
    `To: ${opts.draft.to.join(", ") || "(none)"}`,
    opts.draft.cc.length ? `Cc: ${opts.draft.cc.join(", ")}` : null,
    opts.draft.replyTo ? `Reply-To: ${opts.draft.replyTo}` : null,
    `Subject: ${encodeHeader(opts.draft.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
    `X-Repair-Local-Mode: 1`,
    `X-Repair-Notification: RESP6_LESSEE_EMAIL`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const parts: string[] = [];
  parts.push(`--${mixBoundary}`);
  parts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  parts.push("");
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/plain; charset=utf-8`);
  parts.push(`Content-Transfer-Encoding: 8bit`);
  parts.push("");
  parts.push(opts.draft.bodyText);
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/html; charset=utf-8`);
  parts.push(`Content-Transfer-Encoding: 8bit`);
  parts.push("");
  parts.push(opts.draft.bodyHtml);
  parts.push(`--${boundary}--`);

  for (const att of opts.attachments) {
    parts.push(`--${mixBoundary}`);
    parts.push(
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
    );
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push(
      `Content-Disposition: attachment; filename="${att.filename}"`,
    );
    parts.push("");
    const b64 = att.bytes.toString("base64");
    for (let i = 0; i < b64.length; i += 76) {
      parts.push(b64.slice(i, i + 76));
    }
  }
  parts.push(`--${mixBoundary}--`);
  parts.push("");

  const eml = `${headers}\r\n\r\n${parts.join("\r\n")}`;
  await writeFile(absPath, eml, "utf8");

  const relPath = path.relative(process.cwd(), absPath);
  return { absPath, relPath };
}
