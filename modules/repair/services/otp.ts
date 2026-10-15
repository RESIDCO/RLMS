/**
 * Optional emailed one-time code for sensitive shop steps.
 * Configurable PER SHOP (shops.settings.otpSteps); default off.
 * Steps: invoice_submit (invoice submit only); completed_date (optional, shop link).
 * Store hash only; never log raw codes to console or notifications_log.
 */
import { createHash, randomInt } from "node:crypto";
import { DEFAULT_TENANT_ID, q } from "../db";
import { notify } from "./notifications";

export type OtpStep = "invoice_submit" | "completed_date";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function readSteps(settings: unknown): Record<string, boolean> {
  if (!settings || typeof settings !== "object") return {};
  const steps = (settings as { otpSteps?: unknown }).otpSteps;
  if (!steps || typeof steps !== "object") return {};
  return steps as Record<string, boolean>;
}

/** Resolve shop settings for an event (or direct shopId). */
export async function getShopOtpSteps(opts: {
  shopId?: string | null;
  eventId?: string;
  tenantId?: string;
}): Promise<{ shopId: string | null; steps: Record<string, boolean> }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.shopId) {
    const { rows } = await q(
      `SELECT id, settings FROM repair.shops
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [opts.shopId, tenantId],
    );
    return {
      shopId: rows[0] ? String(rows[0].id) : null,
      steps: readSteps(rows[0]?.settings),
    };
  }
  if (opts.eventId) {
    const { rows } = await q(
      `SELECT s.id, s.settings
       FROM repair.events e
       LEFT JOIN repair.shops s ON s.id = e.shop_id AND s.deleted_at IS NULL
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [opts.eventId, tenantId],
    );
    return {
      shopId: rows[0]?.id ? String(rows[0].id) : null,
      steps: readSteps(rows[0]?.settings),
    };
  }
  return { shopId: null, steps: {} };
}

export async function isOtpRequired(
  step: OtpStep | string,
  opts: { shopId?: string | null; eventId?: string; tenantId?: string } = {},
): Promise<boolean> {
  const { steps } = await getShopOtpSteps(opts);
  return Boolean(steps?.[step]);
}

/** Configure OTP step flag for a shop (source of truth). */
export async function setShopOtpStepFlag(opts: {
  shopId: string;
  step: OtpStep | string;
  enabled: boolean;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.shops
     SET settings = jsonb_set(
       COALESCE(settings, '{}'::jsonb),
       ARRAY['otpSteps', $3],
       to_jsonb($4::boolean),
       true
     )
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id, settings`,
    [opts.shopId, tenantId, opts.step, opts.enabled],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Shop not found" };
  return {
    ok: true as const,
    shopId: String(rows[0].id),
    step: opts.step,
    enabled: opts.enabled,
    steps: readSteps(rows[0].settings),
  };
}

/** @deprecated Prefer setShopOtpStepFlag — tenant-level flag is not used for enforcement. */
export async function setOtpStepFlag(opts: {
  step: string;
  enabled: boolean;
  shopId?: string;
  tenantId?: string;
}) {
  if (opts.shopId) {
    return setShopOtpStepFlag({
      shopId: opts.shopId,
      step: opts.step,
      enabled: opts.enabled,
      tenantId: opts.tenantId,
    });
  }
  // Legacy tenant write (kept for API compatibility; does not gate shop actions)
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await q(
    `UPDATE repair.tenants
     SET settings = jsonb_set(
       COALESCE(settings, '{}'::jsonb),
       ARRAY['otpSteps', $2],
       to_jsonb($3::boolean),
       true
     )
     WHERE id = $1`,
    [tenantId, opts.step, opts.enabled],
  );
  return {
    ok: true as const,
    step: opts.step,
    enabled: opts.enabled,
    note: "Tenant-level flag updated; enforcement uses per-shop settings. Pass shopId.",
  };
}

export async function issueStepOtp(opts: {
  eventId: string;
  step: string;
  email: string;
  tenantId?: string;
  ttlMinutes?: number;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const email = opts.email.trim().toLowerCase();
  if (!email.includes("@")) {
    return { ok: false as const, status: 400, error: "Valid email required" };
  }

  const required = await isOtpRequired(opts.step, { eventId: opts.eventId, tenantId });
  if (!required) {
    return {
      ok: false as const,
      status: 409,
      error: `OTP is not enabled for this shop for step=${opts.step}`,
    };
  }

  const code = String(randomInt(100000, 999999));
  const expires = new Date(Date.now() + (opts.ttlMinutes ?? 15) * 60_000);

  await q(
    `INSERT INTO repair.step_otp_challenges
       (tenant_id, event_id, step, email, code_hash, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$4)`,
    [tenantId, opts.eventId, opts.step, email, hashCode(code), expires.toISOString()],
  );

  await notify({
    tenantId,
    eventId: opts.eventId,
    type: "INVOICE_OTP",
    extraTo: [email],
    subject: `One-time code for ${opts.step}`,
    bodyText: `Your one-time code is ${code}. It expires at ${expires.toISOString()}.`,
    bodyForLog: `OTP issued for step=${opts.step} email=${email} expires=${expires.toISOString()} (code redacted)`,
    actor: email,
  });

  const echo =
    process.env.REPAIR_DEV_OTP_ECHO === "1" ? { devEchoCode: code } : {};

  return {
    ok: true as const,
    expiresAt: expires.toISOString(),
    note: "Code emailed via EmailProvider. Raw code is not stored or logged.",
    ...echo,
  };
}

export async function verifyStepOtp(opts: {
  eventId: string;
  step: string;
  email: string;
  code: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const email = opts.email.trim().toLowerCase();
  const { rows } = await q(
    `SELECT * FROM repair.step_otp_challenges
     WHERE tenant_id = $1 AND event_id = $2 AND step = $3
       AND lower(email) = $4 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, opts.eventId, opts.step, email],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 401, error: "No active one-time code" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "One-time code expired" };
  }
  if (row.code_hash !== hashCode(String(opts.code).trim())) {
    return { ok: false, status: 401, error: "Invalid one-time code" };
  }
  await q(`UPDATE repair.step_otp_challenges SET consumed_at = now() WHERE id = $1`, [
    row.id,
  ]);
  return { ok: true };
}
