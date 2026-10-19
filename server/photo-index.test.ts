/* eslint-disable no-console */
/**
 * Run: npx tsx server/photo-index.test.ts
 */
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.PHOTO_API_ORIGIN = "https://portal.test";
process.env.PHOTO_API_KEY = "test-photo-key";

import express from "express";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";

const photo = await import("./photo-index");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

type Captured = { url: string; headers: Record<string, string>; body: string; timeoutMs: number | null };
type MockRes = Response & { statusCode: number; body: unknown };

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res as unknown as MockRes;
}

function allowUser(_req: Request, _res: Response) {
  return Promise.resolve("user-1");
}

function allowAdmin(_req: Request, _res: Response) {
  return Promise.resolve("admin-1");
}

function deny(_req: Request, res: Response) {
  res.status(401).json({ error: "Unauthorized" });
  return Promise.resolve(null);
}

function jsonResponse(status: number, payload: unknown): globalThis.Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cars(count: number) {
  return Array.from({ length: count }, (_, i) => ({ mark: "SOO", number: String(i + 1) }));
}

{
  photo.resetPhotoIndexWarningsForTests();
  const calls: Captured[] = [];
  const timeouts: number[] = [];
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: cars(501) } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: (ms) => {
        timeouts.push(ms);
        return new AbortController().signal;
      },
      fetchImpl: async (url, init) => {
        const body = String(init?.body || "");
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body,
          timeoutMs: timeouts[timeouts.length - 1] ?? null,
        });
        const parsed = JSON.parse(body) as { cars: Array<{ mark: string; number: string }> };
        return jsonResponse(200, {
          cars: parsed.cars.map((car) => ({ ...car, state: "no_album", photos: [], albums: [] })),
        });
      },
    },
  );
  ok(calls.length === 2, "lookup chunks 501 cars into two calls");
  const first = JSON.parse(calls[0]?.body || "{}") as { cars?: unknown[] };
  const second = JSON.parse(calls[1]?.body || "{}") as { cars?: unknown[] };
  ok(first.cars?.length === 500 && second.cars?.length === 1, "lookup chunks are 500 then 1");
  ok(calls[0]?.url === "https://portal.test/api/photo-index?action=lookup", "lookup uses the portal photo-index action");
  ok(calls[0]?.headers["x-photo-key"] === "test-photo-key", "lookup sends x-photo-key");
  ok(timeouts[0] === 8000 && timeouts[1] === 8000, "lookup timeout is 8 seconds");
  const body = res.body as { cars?: unknown[]; fallback?: boolean };
  ok(res.statusCode === 200 && !body.fallback && body.cars?.length === 501, "lookup merges both chunks");
}

{
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: [{ mark: "SOO", number: "0600612" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async () => jsonResponse(200, {
        cars: [{
          mark: "SOO",
          number: "0600612",
          state: "photos",
          photos: [{
            picture_id: 2841059,
            thumb_url: "https://www.rrpicturearchives.net/picturefiles/12/thumbnails/a.jpg",
            image_url: "https://www.rrpicturearchives.net/picturefiles/12/a.jpg",
            picture_url: "https://www.rrpicturearchives.net/showPicture.aspx?id=2841059",
            photographer: "Andrew Goblirsch",
            photo_date: "2016-04-23",
          }],
          albums: [],
        }],
      }),
    },
  );
  const body = res.body as { cars?: Array<{ number?: string; photos?: Array<{ thumb_url?: string; photographer?: string; picture_id?: string }> }> };
  ok(body.cars?.[0]?.number === "600612", "lookup normalizes the car number");
  ok(body.cars?.[0]?.photos?.[0]?.thumb_url?.includes("/thumbnails/"), "lookup keeps the RRPA thumb url");
  ok(body.cars?.[0]?.photos?.[0]?.photographer === "Andrew Goblirsch", "lookup keeps the photographer");
  ok(body.cars?.[0]?.photos?.[0]?.picture_id === "2841059", "lookup keeps the picture id");
}

{
  const calls: string[] = [];
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: [{ mark: "SOO", number: "1" }] } } as Request,
    res,
    {
      requireUser: deny,
      requireAdmin: deny,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return jsonResponse(200, { cars: [] });
      },
    },
  );
  ok(res.statusCode === 401, "lookup rejects a request with no session");
  ok(calls.length === 0, "lookup does not call the portal without a session");
}

{
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: [{ mark: "SOO", number: "600612" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async () => jsonResponse(404, { message: "missing" }),
    },
  );
  const body = res.body as { fallback?: boolean };
  ok(res.statusCode === 200 && body.fallback === true, "portal failure returns fallback");
}

{
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: [{ mark: "SOO", number: "1" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async () => {
        throw new Error("TimeoutError");
      },
    },
  );
  const body = res.body as { fallback?: boolean };
  ok(res.statusCode === 200 && body.fallback === true, "timeout returns fallback");
}

{
  photo.resetPhotoIndexWarningsForTests();
  delete process.env.PHOTO_API_KEY;
  const calls: Captured[] = [];
  const res = mockRes();
  await photo.handlePhotoIndexLookup(
    { body: { cars: [{ mark: "SOO", number: "1" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
          timeoutMs: null,
        });
        return jsonResponse(200, { cars: [{ mark: "SOO", number: "1", state: "not_indexed", photos: [], albums: [] }] });
      },
    },
  );
  ok(!("x-photo-key" in (calls[0]?.headers || {})), "lookup omits x-photo-key when unset");
  process.env.PHOTO_API_KEY = "test-photo-key";
}

{
  const calls: Captured[] = [];
  const res = mockRes();
  const statuses = new Map<string, { status: string | null; active: boolean | null }>([
    ["SOO_600612", { status: "Active/In-Service", active: true }],
    ["BNSF_546059", { status: "Off-Lease", active: false }],
    ["NDYX_360129", { status: "Inactive", active: false }],
    ["HLTX_6025", { status: "Active/In-Service", active: false }],
  ]);
  await photo.handlePhotoIndexWarm(
    {
      body: {
        cars: [
          { mark: "SOO", number: "0600612" },
          { mark: "BNSF", number: "546059" },
          { mark: "NDYX", number: "360129" },
          { mark: "HLTX", number: "6025" },
          { mark: "NS", number: "148098" },
        ],
      },
    } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => statuses,
      timeoutSignal: (ms) => {
        ok(ms === 8000, "warm timeout is 8 seconds");
        return new AbortController().signal;
      },
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
          timeoutMs: 8000,
        });
        return jsonResponse(200, { ok: true });
      },
    },
  );
  const forwarded = JSON.parse(calls[0]?.body || "{}") as { cars?: Array<{ mark: string; number: string }> };
  ok(calls.length === 1 && calls[0]?.url.endsWith("?action=warm"), "warm proxies to the warm action");
  ok(forwarded.cars?.length === 1 && forwarded.cars[0]?.mark === "SOO" && forwarded.cars[0]?.number === "600612", "warm forwards only the active car");
  const body = res.body as { ok?: boolean; sent?: number; dropped?: number };
  ok(body.ok === true && body.sent === 1 && body.dropped === 4, "warm reports dropped off-lease and inactive cars");
}

{
  const calls: string[] = [];
  const res = mockRes();
  await photo.handlePhotoIndexWarm(
    { body: { cars: [{ mark: "SOO", number: "1" }] } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: async (_req, response) => {
        response.status(403).json({ error: "Forbidden" });
        return null;
      },
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return jsonResponse(200, {});
      },
    },
  );
  ok(res.statusCode === 403, "warm is admin only");
  ok(calls.length === 0, "warm does not call the portal for a non-admin");
}

{
  const calls: Captured[] = [];
  const res = mockRes();
  await photo.handlePhotoReportBroken(
    { body: { picture_id: "2841059" } } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: (init?.headers || {}) as Record<string, string>,
          body: String(init?.body || ""),
          timeoutMs: null,
        });
        return jsonResponse(200, { ok: true });
      },
    },
  );
  const forwarded = JSON.parse(calls[0]?.body || "{}") as { picture_id?: number };
  ok(calls[0]?.url.endsWith("?action=report-broken"), "report-broken uses the portal action");
  ok(forwarded.picture_id === 2841059, "report-broken forwards picture_id");
  ok((res.body as { ok?: boolean }).ok === true, "report-broken confirms");
}

{
  const res = mockRes();
  await photo.handlePhotoReportBroken(
    { body: {} } as Request,
    res,
    {
      requireUser: allowUser,
      requireAdmin: allowAdmin,
      lookupStatuses: async () => new Map(),
      timeoutSignal: () => new AbortController().signal,
      fetchImpl: async () => jsonResponse(200, {}),
    },
  );
  ok(res.statusCode === 400, "report-broken requires picture_id");
}

{
  let fetched = false;
  const app = express();
  app.use(express.json());
  photo.registerPhotoIndexRoutes(app, {
    requireUser: deny,
    requireAdmin: deny,
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
    const res = await fetch(`http://127.0.0.1:${port}/api/photos/index-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cars: [{ mark: "SOO", number: "1" }] }),
    });
    ok(res.status === 401, "route rejects a request with no session");
    ok(!fetched, "route does not forward when the session is missing");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
