/**
 * Optional emailed one-time code for sensitive shop steps (e.g. invoice submit).
 * Per-step flag on tenant.settings.otpSteps; default off (open Q3).
 * Store hash only; never log raw codes to console or notifications_log.
 */
import { createHash, randomInt } from "node:crypto";
import { DEFAULT_TENANT_ID, q } from "../db";
import { notify } from "./notifications";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function isOtpRequired(
  step: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<boolean> {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [tenantId]);
  const steps = rows[0]?.settings?.otpSteps ?? {};
  return Boolean(steps?.[step]);
}

export async function setOtpStepFlag(opts: {
  step: string;
  enabled: boolean;
  tenantId?: string;
}) {
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
  return { ok: true as const, step: opts.step, enabled: opts.enabled };
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

  const code = String(randomInt(100000, 999999));
  const expires = new Date(Date.now() + (opts.ttlMinutes ?? 15) * 60_000);

  await q(
    `INSERT INTO repair.step_otp_challenges
       (tenant_id, event_id, step, email, code_hash, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$4)`,
    [tenantId, opts.eventId, opts.step, email, hashCode(code), expires.toISOString()],
  );

  // Provider receives the code in bodyText; notifications_log uses redacted bodyForLog.
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
    process.env.REPAIR_DEV_OTP_ECHO === "1"
      ? { devEchoCode: code }
      : {};

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
