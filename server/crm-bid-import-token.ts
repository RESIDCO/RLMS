import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const BID_IMPORT_TOKEN_TTL_MS = 30 * 60 * 1000;

export type BidImportTokenPayload = {
  opportunity_id: number;
  file_sha256: string;
  file_name: string;
  size: number;
  actor: string;
  iat: number;
  stated_car_total: number | null;
  header_signature: string;
};

export function bidImportMacKey(serviceRoleKey: string): Buffer {
  return createHmac("sha256", serviceRoleKey).update("rlms-bid-import-v1").digest();
}

export function fileSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function signBidImportToken(payload: BidImportTokenPayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyBidImportToken(
  token: string,
  key: Buffer,
  now = Date.now(),
): { ok: true; payload: BidImportTokenPayload } | { ok: false; error: string } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "Import token is not valid" };
  const expected = createHmac("sha256", key).update(parts[0]).digest("base64url");
  const got = Buffer.from(parts[1]);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, error: "Import token is not valid" };
  let payload: BidImportTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as BidImportTokenPayload;
  } catch {
    return { ok: false, error: "Import token is not valid" };
  }
  if (!payload || typeof payload.iat !== "number" || typeof payload.opportunity_id !== "number") {
    return { ok: false, error: "Import token is not valid" };
  }
  if (now - payload.iat > BID_IMPORT_TOKEN_TTL_MS || payload.iat - now > 60_000) {
    return { ok: false, error: "Import token has expired" };
  }
  return { ok: true, payload };
}
