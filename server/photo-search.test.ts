/* eslint-disable no-console */
/**
 * Run: npx tsx server/photo-search.test.ts
 */
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.PHOTO_API_ORIGIN = "https://portal.test";

import express from "express";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";

const photo = await import("./photo-search");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

type Captured = { url: string; headers: Record<string, string>; body: string };
type MockRes = Response & { statusCode: number; body: unknown };

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as unknown as MockRes;
}

function allowUser(_req: Request, _res: Response) {
  return Promise.resolve({ id: "user-1", email: "analyst@residco.com" });
}

function jsonResponse(status: number, payload: unknown): globalThis.Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const capped = photo.normalizeIdentityIds([1, 1, 0, -3, "x", ...Array.from({ length: 2000 }, (_, i) => i + 1)]);
ok(capped.requested === 2000, "identity cap counts unique positive ids");
ok(capped.ids.length === 500 && capped.ids[0] === 1 && capped.ids[499] === 500, "identity cap keeps the first 500");
ok(capped.cap === 500, "identity cap is 500");

{
  photo.resetPhotoSearchWarningsForTests();
  process.env.PHOTO_API_KEY = "test-photo-key";
  const calls: Captured[] = [];
  const res = mockRes();
  await photo.handlePhotoFind(
    { body: { cars: [{ mark: "SOO", number: "600612" }, { mark: "BNSF", number: "1" }], fetch_images: true } } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
        });
        return jsonResponse(200, { cars: [{ mark: "SOO", number: "600612", images: [], tier: "verified" }] });
      },
    },
  );
  ok(calls.length === 1, "find forwards once");
  ok(calls[0]?.url === "https://portal.test/api/find-photos", "find uses PHOTO_API_ORIGIN");
  ok(calls[0]?.headers["x-photo-key"] === "test-photo-key", "find sends x-photo-key when the key is set");
  const forwarded = JSON.parse(calls[0]?.body || "{}") as { cars?: unknown[] };
  ok(Array.isArray(forwarded.cars) && forwarded.cars.length === 1, "find forwards one car");
  ok(res.statusCode === 200, "find passes a portal 200 through");
}

{
  photo.resetPhotoSearchWarningsForTests();
  delete process.env.PHOTO_API_KEY;
  const calls: Captured[] = [];
  const res = mockRes();
  await photo.handlePhotoFind(
    { body: { cars: [{ mark: "SOO", number: "600612" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
        });
        return jsonResponse(200, { cars: [] });
      },
    },
  );
  ok(calls.length === 1 && !("x-photo-key" in (calls[0]?.headers || {})), "find omits x-photo-key when unset");
  ok(!photo.photoKeyHeaders()["x-photo-key"], "header helper stays empty when unset");
}

{
  const calls: string[] = [];
  const res = mockRes();
  await photo.handlePhotoFind(
    { body: { cars: [{ mark: "ZZZX", number: "1" }] } } as Request,
    res,
    {
      requireUser: async (_req, response) => {
        response.status(401).json({ error: "Unauthorized" });
        return null;
      },
      lookupIdentities: async () => [],
      fetchImpl: async (url) => {
        calls.push(String(url));
        return jsonResponse(200, {});
      },
    },
  );
  ok(res.statusCode === 401, "find rejects without a session");
  ok(calls.length === 0, "find does not call the portal without a session");
}

{
  let looked: number[] = [];
  const res = mockRes();
  const ids = Array.from({ length: 2000 }, (_, i) => i + 1);
  await photo.handleRailcarIdentities(
    { body: { ids } } as Request,
    res,
    {
      requireUser: allowUser,
      fetchImpl: async () => jsonResponse(500, {}),
      lookupIdentities: async (query) => {
        looked = query.ids;
        return query.ids.map((id) => ({ id, reporting_marks: "SOO", car_number: String(id).padStart(6, "0") }));
      },
    },
  );
  const body = res.body as { requested?: number; returned?: number; cap?: number; truncated?: boolean; cars?: Array<{ id: number }> };
  ok(looked.length === 500 && looked[0] === 1 && looked[499] === 500, "identities lookup receives 500 ids");
  ok(body.requested === 2000 && body.returned === 500 && body.cap === 500 && body.truncated === true, "identities response reports the cap");
  ok(body.cars?.[0]?.id === 1 && body.cars?.[499]?.id === 500, "identities keeps request order");
}

{
  process.env.PHOTO_API_KEY = "test-photo-key";
  const calls: Captured[] = [];
  const res = mockRes();
  await photo.handlePhotoFlag(
    {
      body: {
        mark: "soo",
        number: "0600612",
        image_key: "rrpa:1:a.jpg",
        picture_id: "2841059",
        reason: "wrong_car",
        flagged_by: "spoof@example.com",
      },
    } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
        });
        return jsonResponse(201, { ok: true });
      },
    },
  );
  const forwarded = JSON.parse(calls[0]?.body || "{}") as { flagged_by?: string; number?: string; mark?: string };
  ok(calls[0]?.url === "https://portal.test/api/photo-flags", "flag forwards to photo-flags");
  ok(calls[0]?.headers["x-photo-key"] === "test-photo-key", "flag sends the photo key");
  ok(forwarded.flagged_by === "analyst@residco.com", "flagged_by is the RLMS user, not the client value");
  ok(forwarded.mark === "SOO" && forwarded.number === "600612", "flag normalizes mark and number");
  ok(res.statusCode === 201, "flag passes the portal status through");
}

{
  const res = mockRes();
  await photo.handlePhotoFlag(
    { body: { mark: "SOO", number: "1", image_key: "k", reason: "wrong_car" } } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async () => jsonResponse(404, { error: "not_found" }),
    },
  );
  const body = res.body as { error?: string };
  ok(res.statusCode === 503 && body.error === "flags_not_enabled", "missing flag API degrades to flags_not_enabled");
}

{
  const res = mockRes();
  await photo.handlePhotoFind(
    { body: { cars: [{ mark: "SOO", number: "600612" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async () => jsonResponse(404, { message: "missing" }),
    },
  );
  const body = res.body as { error?: string; cars?: Array<{ status?: string; image_error?: string }> };
  ok(res.statusCode === 200 && body.error === "portal_unavailable", "missing find API degrades instead of failing closed");
  ok(body.cars?.[0]?.status === "error" && body.cars?.[0]?.image_error === "portal_unavailable", "degraded car is an error, not a miss");
}

{
  const res = mockRes();
  await photo.handlePhotoFind(
    { body: { cars: [{ mark: "SOO", number: "1" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      lookupIdentities: async () => [],
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  );
  const body = res.body as { error?: string };
  ok(res.statusCode === 200 && body.error === "portal_unavailable", "network failure degrades");
}

ok(photo.isAllowedPhotoImageUrl("https://portal.test/api/proxy-image?url=abc"), "portal proxy image URL is allowed");
ok(photo.isAllowedPhotoImageUrl("https://s3.amazonaws.com/rrpa_photos/12/a.jpg"), "RRPA S3 image is allowed");
ok(photo.isAllowedPhotoImageUrl("https://www.rrpicturearchives.net/pictures/1"), "RRPA picture page is allowed");
ok(!photo.isAllowedPhotoImageUrl("https://s3.amazonaws.com/other/a.jpg"), "other S3 paths are rejected");
ok(!photo.isAllowedPhotoImageUrl("https://evil.example/rrpa_photos/1/a.jpg"), "lookalike hosts are rejected");
ok(!photo.isAllowedPhotoImageUrl("http://s3.amazonaws.com/rrpa_photos/1/a.jpg"), "plain HTTP images are rejected");
ok(!photo.isAllowedPhotoImageUrl("https://user:pass@s3.amazonaws.com/rrpa_photos/1/a.jpg"), "URLs with credentials are rejected");

{
  let fetched = false;
  const app = express();
  app.use(express.json());
  photo.registerPhotoSearchRoutes(app, {
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse(200, {});
    },
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/photo-search/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cars: [{ mark: "SOO", number: "1" }] }),
    });
    ok(res.status === 401, "route rejects a request with no session");
    ok(!fetched, "route does not forward when the session is missing");
    const identities = await fetch(`http://127.0.0.1:${port}/api/railcars/identities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [1] }),
    });
    ok(identities.status === 401, "identities rejects a request with no session");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
