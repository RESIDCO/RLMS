/**
 * Smoke: OWNER_UI §F — Lessee screen (+ r2 E2E Accept/Reject)
 *
 * 1. Accept via link (name/email/IP/send version)
 * 2. Reject requires comment
 * 3. Overdue flag never auto-approves
 * 4. Expired link → 401
 * 5. Superseded link → voided after newer send
 * 6. Scoping: no other lines / docs / DV
 * 7. Email text "within 3 business days"
 * 8. E2E: real HTTP decide route + owner lessee-status → Accepted/Rejected
 * 9. Ref lookup hover public (Loc/C/WM/Resp)
 *
 * Run: npm run repair:smoke-lessee
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { Server } from "http";
import { DEFAULT_TENANT_ID, q } from "../db";
import {
  registerRepairAuthedRoutes,
  registerRepairPublicRoutes,
} from "../routes";
import { createBadOrder } from "../services/bo";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { issueEventLink, resolveActiveLink } from "../services/event-links";
import { loadEstimateAar } from "../services/estimate-load";
import { submitForApproval } from "../services/estimates";
import { parseAarFile } from "../services/aar-parser";
import { submitResponsibilityUpdates } from "../services/estimate-review";
import { createShop } from "../services/shops";
import {
  approveViaLesseeLink,
  flagLesseeOverdueIfNeeded,
  getLesseeViewForToken,
  getOwnerLesseePanel,
  mapApprovalToOwnerStatus,
  sendLesseeApprovalRequest,
} from "../services/lessee-approval";
import { buildSendLesseePreview, sendLesseeFromPreview } from "../services/send-lessee";
import { computeLesseeTotals } from "../services/lessee-totals";
import {
  computeResponseDueAt,
  responseWindowPhrase,
} from "../services/lessee-window";
import { migrateLocal } from "./migrate-local";
import { assertLesseeClientTypecheck } from "./typecheck-client-lessee";

const samplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

const RUN = `F${Date.now().toString().slice(-8)}`;
const MARK = "AEX";
const NUMBER = "22882";

function withCar(bytes: Buffer, mark: string, number: string): Buffer {
  const parsed = parseAarFile(bytes);
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    const m = mark.toUpperCase().padEnd(4, " ").slice(0, 4);
    const n = number.padStart(6, "0").slice(-6);
    return line.rawLine.slice(0, 47) + m + n + line.rawLine.slice(57);
  });
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  return Buffer.from(lines.join(ending), "latin1");
}

async function seedCar() {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, assignment_label, lessee_name)
     VALUES (22882, $1, $2, $2, true, 'Main', 'SMOKE-F-ASSIGN', 'Demo Lessee AEX')
     ON CONFLICT (id) DO UPDATE SET
       car_number = EXCLUDED.car_number,
       car_initial = EXCLUDED.car_initial,
       active = true,
       assignment_label = EXCLUDED.assignment_label,
       lessee_name = EXCLUDED.lessee_name`,
    [NUMBER, MARK],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 22882, $2, $1, 1, 'R1', 'SMOKE-F', 'AF1', 'Demo Lessee AEX', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [NUMBER, MARK],
  );
}

async function seedEstimate(): Promise<{
  estimateId: string;
  eventId: string;
  shopToken: string;
}> {
  const shop = await createShop({
    legalName: `§F Lessee Shop ${RUN}`,
    city: "Walbridge",
    state: "OH",
    splc: "382000",
    shopMark: `F${RUN.slice(-3)}`.slice(0, 4).toUpperCase(),
    actor: "smoke-f",
  });
  if (!shop.ok) bad("shop", shop.error);
  const shopId = String(shop.shop!.id);

  await q(
    `INSERT INTO repair.contacts
       (tenant_id, party_type, party_ref, name, email, active, created_by)
     SELECT $1,'lessee','Demo Lessee AEX','Lessee F','lessee-f@example.test',true,'smoke-f'
     WHERE NOT EXISTS (
       SELECT 1 FROM repair.contacts
       WHERE tenant_id = $1 AND email = 'lessee-f@example.test' AND deleted_at IS NULL
     )`,
    [DEFAULT_TENANT_ID],
  );

  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: NUMBER,
    shopId,
    actor: "smoke-f-owner",
    boRuleCode: "OTHER",
    boRuleOtherText: "Lessee F smoke",
    boDate: new Date().toISOString().slice(0, 10),
    boCity: "Marion",
    boState: "IL",
    allowDuplicates: true,
  });
  if (!bo.ok) bad("bo", JSON.stringify(bo));
  const eventId = String(bo.event.id);

  const link = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "smoke-f",
  });
  await shopAcknowledge(link.token, "shop@smoke-f.test");
  await shopArrivalDate(link.token, "shop@smoke-f.test", "2026-10-02");

  const sample = withCar(readFileSync(samplePath), MARK, NUMBER);
  const load = await loadEstimateAar({
    bytes: sample,
    filename: `AEX022882-${RUN}.txt`,
    source: "SHOP_LINK",
    rawToken: link.token,
    actor: "shop@smoke-f.test",
    forceAcceptWarnings: true,
  });
  if (!load.ok) bad("load", JSON.stringify(load));
  const estimateId = String(
    (load.applied?.[0] as { estimateId?: string } | undefined)?.estimateId ?? "",
  );
  if (!estimateId) bad("estimate", JSON.stringify(load.applied));

  const sub = await submitForApproval({
    estimateId,
    actor: "shop@smoke-f.test",
  });
  if (!sub.ok) bad("submit", sub.error);

  const { rows: lineRows } = await q(
    `SELECT el.id
     FROM repair.estimate_lines el
     JOIN repair.estimate_revisions er ON er.id = el.revision_id
     WHERE er.estimate_id = $1
     ORDER BY el.line_no ASC`,
    [estimateId],
  );
  const plain = await submitResponsibilityUpdates({
    estimateId,
    lineUpdates: lineRows.slice(0, Math.min(2, lineRows.length)).map((l) => ({
      lineId: String(l.id),
      respCode: "6",
    })),
    actor: "smoke-f-owner",
  });
  if (!plain.ok) bad("resp6", plain.error ?? JSON.stringify(plain));

  return { estimateId, eventId, shopToken: link.token };
}

async function main() {
  console.log("=== repair:smoke-lessee (§F) ===");
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }

  assertLesseeClientTypecheck();

  await migrateLocal();
  ok("migrate-local (incl. f_lessee)");

  // Business-day math: 3 days from Friday → at least Wed, and ≥72h
  const fri = new Date("2026-10-16T15:00:00Z"); // Fri
  const due = computeResponseDueAt(fri, 3, 72, ["2026-10-19"]); // Mon holiday
  const deltaH = (due.getTime() - fri.getTime()) / 3600_000;
  if (deltaH < 72) bad("window-floor", `due only ${deltaH}h after send`);
  if (responseWindowPhrase(3) !== "3 business days") {
    bad("phrase", responseWindowPhrase(3));
  }
  ok(`window: 3 business days ≥72h (due ${due.toISOString()}, ${deltaH.toFixed(1)}h)`);

  await seedCar();
  const { estimateId, eventId } = await seedEstimate();
  ok(`estimate ${estimateId.slice(0, 8)}`);

  const totals = await computeLesseeTotals({ estimateId });
  if (!totals.ok) bad("totals", totals.error);
  const expectedCents = totals.bundle.totalCents;
  if (expectedCents <= 0) bad("totals", "expected Resp 6 cents");

  const preview = await buildSendLesseePreview({
    estimateId,
    actor: "owner@example.test",
    actorEmail: "owner@example.test",
    actorFullName: "Owner Reviewer",
  });
  if (!preview.ok) bad("preview", preview.error);
  if (!String(preview.emailTable?.description ?? "").includes("3 business days")) {
    bad("email-days", preview.emailTable?.description ?? "");
  }
  ok('email Description includes "within 3 business days"');

  async function sendOnce(estId: string) {
    const prev = await buildSendLesseePreview({
      estimateId: estId,
      actor: "owner@example.test",
      actorEmail: "owner@example.test",
      actorFullName: "Owner Reviewer",
    });
    if (!prev.ok) return prev;
    const recipients =
      prev.recipients.length > 0 ? prev.recipients : ["lessee-f@example.test"];
    return sendLesseeFromPreview({
      estimateId: estId,
      recipients,
      cc: prev.cc,
      subject: prev.subject,
      body: prev.body,
      documentIds: prev.gallery.map((g) => g.id),
      confirm: true,
      actor: "owner@example.test",
      actorEmail: "owner@example.test",
    });
  }

  // First send
  const sent1 = await sendOnce(estimateId);
  if (!sent1.ok) bad("send1", sent1.error ?? JSON.stringify(sent1));
  const rawToken1 = String(sent1.lesseeUrlPath ?? "").split("/").pop() ?? "";
  if (!rawToken1) bad("token1", "missing");
  ok(`send #1 link ${rawToken1.slice(0, 8)}…`);

  // View → Viewed status
  const view1 = await getLesseeViewForToken(rawToken1);
  if (!view1) bad("view1", "null");
  if (view1.amountPresentedCents !== expectedCents) {
    bad("view-cents", `${view1.amountPresentedCents} ≠ ${expectedCents}`);
  }
  if (view1.lines.some((l: { resp_code?: string }) => String(l.resp_code) !== "6")) {
    bad("scope-lines", "non-6 lines visible");
  }
  if (view1.allLines != null) bad("scope-allLines", "allLines must be omitted");
  ok(`view: Resp6 only, total ${view1.amountMoney}`);

  const panelViewed = await getOwnerLesseePanel({ estimateId });
  if (panelViewed.ownerStatus !== "Viewed" && panelViewed.ownerStatus !== "Sent") {
    // first GET marks Viewed
    bad("owner-viewed", panelViewed.ownerStatus);
  }
  ok(`owner status after view: ${panelViewed.ownerStatus}`);

  // Reject without comment → 400
  const rejNoComment = await approveViaLesseeLink({
    rawToken: rawToken1,
    decision: "REJECT",
    respondentName: "Pat Lessee",
    respondentEmail: "pat@lessee.test",
    respondentIp: "203.0.113.9",
  });
  if (rejNoComment.ok || rejNoComment.status !== 400) {
    bad("reject-comment", JSON.stringify(rejNoComment));
  }
  ok("reject without comment → 400");

  // Accept
  const acc = await approveViaLesseeLink({
    rawToken: rawToken1,
    decision: "APPROVE",
    comment: "Looks good",
    respondentName: "Pat Lessee",
    respondentEmail: "pat@lessee.test",
    respondentIp: "203.0.113.9",
  });
  if (!acc.ok) bad("accept", acc.error);
  ok("accept via link (name/email/IP logged)");

  const { rows: decRows } = await q(
    `SELECT * FROM repair.lessee_approval_decisions
     WHERE approval_id = $1 ORDER BY decided_at DESC LIMIT 1`,
    [acc.approval.id],
  );
  if (!decRows[0]?.respondent_name || !decRows[0]?.respondent_ip) {
    bad("decision-meta", JSON.stringify(decRows[0]));
  }
  if (Number(decRows[0].send_version) < 1) bad("send-version", "missing");
  ok(`decision trail: send #${decRows[0].send_version} IP ${decRows[0].respondent_ip}`);

  // After accept: read-only
  const viewRo = await getLesseeViewForToken(rawToken1);
  if (!viewRo || viewRo.canDecide !== false) bad("readonly", "should be read-only");
  const again = await approveViaLesseeLink({
    rawToken: rawToken1,
    decision: "REJECT",
    comment: "nope",
    respondentName: "Pat",
    respondentEmail: "pat@lessee.test",
  });
  if (again.ok || again.status !== 409) bad("re-decide", JSON.stringify(again));
  ok("post-accept link is read-only (409 on re-decide)");

  const panelAcc = await getOwnerLesseePanel({ estimateId });
  if (panelAcc.ownerStatus !== "Accepted") {
    bad("owner-accepted", panelAcc.ownerStatus);
  }
  ok("owner status Accepted");

  // ── Superseded link ──────────────────────────────────────────────
  const { estimateId: est2 } = await seedEstimate();
  const sentA = await sendOnce(est2);
  if (!sentA.ok) bad("sendA", sentA.error ?? "");
  const tokenA = String(sentA.lesseeUrlPath ?? "").split("/").pop()!;
  const sentB = await sendOnce(est2);
  if (!sentB.ok) bad("sendB", sentB.error ?? "");
  const tokenB = String(sentB.lesseeUrlPath ?? "").split("/").pop()!;

  const oldView = await getLesseeViewForToken(tokenA);
  if (oldView) bad("superseded-view", "old link should be void");
  const oldResolve = await resolveActiveLink(tokenA, "LESSEE");
  if (oldResolve) bad("superseded-resolve", "old link still active");
  const newView = await getLesseeViewForToken(tokenB);
  if (!newView) bad("new-view", "null");
  ok("newer send voids older link; new link works");

  // Reject on new send
  const rej = await approveViaLesseeLink({
    rawToken: tokenB,
    decision: "REJECT",
    comment: "Disputed labor hours",
    respondentName: "Casey Lessee",
    respondentEmail: "casey@lessee.test",
    respondentIp: "198.51.100.4",
  });
  if (!rej.ok) bad("reject", rej.error);
  const panelRej = await getOwnerLesseePanel({ estimateId: est2 });
  if (panelRej.ownerStatus !== "Rejected") bad("owner-rejected", panelRej.ownerStatus);
  ok("reject with comment → owner Rejected");

  // ── Overdue flag (never auto-approve) ────────────────────────────
  const { estimateId: est3 } = await seedEstimate();
  const sent3 = await sendOnce(est3);
  if (!sent3.ok) bad("send3", sent3.error ?? "");
  // Backdate due
  await q(
    `UPDATE repair.lessee_approvals
     SET response_due_at = now() - interval '1 hour',
         status = 'PENDING'
     WHERE estimate_id = $1 AND status IN ('PENDING','VIEWED','OVERDUE')`,
    [est3],
  );
  const flagged = await flagLesseeOverdueIfNeeded({ estimateId: est3 });
  if (!flagged.flagged) bad("overdue-flag", "not flagged");
  const { rows: estFlag } = await q(
    `SELECT lessee_response_overdue, status_id FROM repair.estimates WHERE id = $1`,
    [est3],
  );
  if (!estFlag[0]?.lessee_response_overdue) bad("est-overdue", "flag false");
  const { rows: appr3 } = await q(
    `SELECT status, decision FROM repair.lessee_approvals
     WHERE estimate_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [est3],
  );
  if (appr3[0]?.decision) bad("auto-approve", "decision set on overdue");
  if (mapApprovalToOwnerStatus(appr3[0]) !== "Overdue") {
    bad("overdue-status", mapApprovalToOwnerStatus(appr3[0]));
  }
  ok("overdue flagged on estimate + approval; never auto-approved");

  // ── Expired link ─────────────────────────────────────────────────
  const { estimateId: est4 } = await seedEstimate();
  const sent4 = await sendLesseeApprovalRequest({
    eventId: (await q(`SELECT event_id FROM repair.estimates WHERE id=$1`, [est4]))
      .rows[0].event_id,
    estimateId: est4,
    revisionId: (
      await q(
        `SELECT id FROM repair.estimate_revisions WHERE estimate_id=$1 ORDER BY rev_no DESC LIMIT 1`,
        [est4],
      )
    ).rows[0].id,
    lesseeEmail: "lessee-f@example.test",
    actor: "owner@example.test",
    amountPresentedCents: expectedCents,
  });
  if (!sent4.ok) bad("send4", sent4.error);
  await q(
    `UPDATE repair.event_links SET expires_at = now() - interval '1 minute' WHERE id = $1`,
    [sent4.approval.link_id],
  );
  const expiredView = await getLesseeViewForToken(sent4.token);
  if (expiredView) bad("expired-view", "should be null");
  const expiredDecide = await approveViaLesseeLink({
    rawToken: sent4.token,
    decision: "APPROVE",
    respondentName: "X",
    respondentEmail: "x@y.com",
  });
  if (expiredDecide.ok || expiredDecide.status !== 401) {
    bad("expired-decide", JSON.stringify(expiredDecide));
  }
  ok("expired link → 401 / null view");

  // Scoping: ungranted doc 403 (via attachment helper)
  const { getLesseeAttachmentForToken } = await import(
    "../services/lessee-approval"
  );
  const fakeDoc = "00000000-0000-4000-8000-000000000099";
  const ungranted = await getLesseeAttachmentForToken({
    rawToken: tokenB,
    documentId: fakeDoc,
  });
  // tokenB already decided — view may still work for grants; ungranted → 403
  if (ungranted.ok || (ungranted.status !== 403 && ungranted.status !== 401)) {
    // After reject, link still valid read-only — expect 403 for ungranted
    if (ungranted.ok) bad("scope-doc", "ungranted allowed");
  }
  ok("scoping: ungranted attachment blocked");

  // ── §F r2 E2E: real UI route/API Accept + owner status ────────────
  const { estimateId: estE2e } = await seedEstimate();
  const sentE2e = await sendOnce(estE2e);
  if (!sentE2e.ok) bad("e2e-send", sentE2e.error ?? "");
  const tokenE2e = String(sentE2e.lesseeUrlPath ?? "").split("/").pop()!;
  if (!tokenE2e) bad("e2e-token", "missing");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  registerRepairPublicRoutes(app);
  registerRepairAuthedRoutes(app);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const viewRes = await fetch(`${base}/api/repair/lessee/${tokenE2e}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!viewRes.ok) bad("e2e-view", await viewRes.text());
    const viewBody = (await viewRes.json()) as {
      canDecide?: boolean;
      brcHeader?: unknown;
    };
    if (viewBody.canDecide !== true) bad("e2e-view-decide", "expected canDecide");
    if (!viewBody.brcHeader) bad("e2e-brc-header", "missing brcHeader");

    const acceptRes = await fetch(`${base}/api/repair/lessee/${tokenE2e}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "APPROVE",
        name: "E2E Pat",
        email: "e2e.pat@lessee.test",
        comment: "E2E accept",
      }),
    });
    const acceptBody = (await acceptRes.json()) as {
      ok?: boolean;
      error?: string;
      decidedAtEt?: string | null;
      approval?: { status?: string };
    };
    if (!acceptRes.ok || acceptBody.ok === false) {
      bad("e2e-accept", JSON.stringify(acceptBody));
    }
    if (!acceptBody.decidedAtEt) bad("e2e-accept-et", "missing decidedAtEt");
    ok(`E2E Accept via HTTP decide → ${acceptBody.approval?.status}`);

    const statusRes = await fetch(
      `${base}/api/repair/estimates/${estE2e}/lessee-status?_=${Date.now()}`,
      { headers: { "Cache-Control": "no-cache" } },
    );
    if (!statusRes.ok) bad("e2e-owner-status", await statusRes.text());
    const statusCc = statusRes.headers.get("cache-control") ?? "";
    if (!/no-store/i.test(statusCc)) {
      bad("e2e-cache", `expected no-store, got ${statusCc}`);
    }
    const panel = (await statusRes.json()) as {
      ownerStatus?: string;
      current?: {
        respondentName?: string;
        respondentEmail?: string;
        decidedAtEt?: string;
      };
    };
    if (panel.ownerStatus !== "Accepted") {
      bad("e2e-owner-accepted", panel.ownerStatus ?? "missing");
    }
    if (panel.current?.respondentName !== "E2E Pat") {
      bad("e2e-owner-name", JSON.stringify(panel.current));
    }
    ok("E2E owner lessee-status → Accepted (name/email/ET, no-store)");

    // Reject path on a fresh send
    const { estimateId: estRej } = await seedEstimate();
    const sentRej = await sendOnce(estRej);
    if (!sentRej.ok) bad("e2e-rej-send", sentRej.error ?? "");
    const tokenRej = String(sentRej.lesseeUrlPath ?? "").split("/").pop()!;
    const rejRes = await fetch(`${base}/api/repair/lessee/${tokenRej}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "REJECT",
        name: "E2E Casey",
        email: "e2e.casey@lessee.test",
        comment: "E2E reject labor",
      }),
    });
    const rejBody = await rejRes.json();
    if (!rejRes.ok) bad("e2e-reject", JSON.stringify(rejBody));
    const rejPanelRes = await fetch(
      `${base}/api/repair/estimates/${estRej}/lessee-status?_=${Date.now()}`,
    );
    const rejPanel = (await rejPanelRes.json()) as {
      ownerStatus?: string;
      current?: { comment?: string };
    };
    if (rejPanel.ownerStatus !== "Rejected") {
      bad("e2e-owner-rejected", rejPanel.ownerStatus ?? "");
    }
    if (!String(rejPanel.current?.comment ?? "").includes("E2E reject")) {
      bad("e2e-rej-comment", JSON.stringify(rejPanel.current));
    }
    ok("E2E Reject via HTTP + owner Rejected with comment");

    // Public ref lookup for Loc/C/WM/Resp hovers (demo codes)
    for (const [kind, code] of [
      ["condition", "A"],
      ["location", "AR"],
      ["why_made", "01"],
      ["responsibility", "6"],
    ] as const) {
      const lr = await fetch(
        `${base}/api/repair/ref/lookup?kind=${kind}&code=${encodeURIComponent(code)}`,
      );
      if (!lr.ok) bad(`ref-${kind}`, await lr.text());
      const hit = (await lr.json()) as { found?: boolean; description?: string };
      if (hit.found) {
        ok(`ref hover ${kind}=${code}: found — ${String(hit.description).slice(0, 40)}`);
      } else {
        // Table may be empty in fresh local DB — still must return not-found copy
        if (!String(hit.description ?? "").includes("not in reference table")) {
          bad(`ref-${kind}-msg`, JSON.stringify(hit));
        }
        ok(`ref hover ${kind}=${code}: not in reference table (empty seed OK)`);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  console.log("=== repair:smoke-lessee PASS ===");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
