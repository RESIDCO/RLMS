/**
 * Seed ~15 estimates across statuses for OWNER_UI §A Estimates History.
 *
 * Default actionable filter hides Approved/Completed/Queued/VOIDED —
 * seed includes those so Bruce can filter Approved in and verify.
 *
 * Usage:
 *   DATABASE_URL=... npm run repair:seed:estimates-history
 *
 * Idempotent tag: created_by = 'seed:estimates-history'
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { DEFAULT_TENANT_ID, q } from "../db";
import { getStatusByCode } from "../services/status-machine";
import { migrateLocal } from "./migrate-local";
import { centsToDollars } from "../services/money";
import { ensureDemoShop } from "../services/shops";

type SeedRow = {
  mark: string;
  number: string;
  status: string;
  shopMark: string;
  totalCents: number;
  wreck?: boolean;
  reason: string;
  assignment: string;
  leaseType: string;
  /** RLMS railcars.entity source → MAIN / COAL / RPS tag */
  entitySource?: "Main" | "Coal" | "Rail Partners Select";
  yardDaysAgo: number;
  approvalReqDaysAgo?: number;
  outboundTargetDays?: number; // negative = overdue (red)
  attachments?: number;
  issues?: boolean;
  dispo?: boolean;
  resp6DaysAgo?: number | null;
};

function entityCodeFromSource(
  source: SeedRow["entitySource"] | undefined,
): string {
  if (source === "Coal") return "COAL";
  if (source === "Rail Partners Select") return "RPS";
  return "MAIN";
}

const SEED: SeedRow[] = [
  // Actionable (default filter)
  {
    mark: "OFAX",
    number: "65011",
    status: "AWAITING_APPROVAL",
    shopMark: "APA",
    totalCents: 495523,
    reason: "Door - bent",
    assignment: "Geneus LLC dba Savatran LLC - OL1517",
    leaseType: "MODIFIED",
    entitySource: "Main",
    yardDaysAgo: 12,
    approvalReqDaysAgo: 10,
    outboundTargetDays: -1,
    attachments: 2,
    resp6DaysAgo: 9,
  },
  {
    mark: "TFOX",
    number: "101882",
    status: "AWAITING_APPROVAL",
    shopMark: "DEMO",
    totalCents: 1284500,
    reason: "Body Damage",
    assignment: "Demo Fleet - OL2201",
    leaseType: "FULL SERVICE",
    entitySource: "Coal",
    yardDaysAgo: 20,
    approvalReqDaysAgo: 18,
    outboundTargetDays: 5,
    attachments: 1,
    resp6DaysAgo: 17,
  },
  {
    mark: "OFOX",
    number: "528313",
    status: "AWAITING_APPROVAL",
    shopMark: "APA",
    totalCents: 3673204,
    reason: "Lease Preparation",
    assignment: "RESIDCO Demo - R-OFOX",
    leaseType: "FULL SERVICE",
    entitySource: "Rail Partners Select",
    yardDaysAgo: 30,
    approvalReqDaysAgo: 25,
    outboundTargetDays: 2,
    attachments: 3,
    issues: true,
    resp6DaysAgo: 24,
  },
  {
    mark: "ARSX",
    number: "100001",
    status: "AWAITING_APPROVAL",
    shopMark: "DEMO",
    totalCents: 812250,
    reason: "Wheel set",
    assignment: "DEMO-ASSIGN",
    leaseType: "UNDEFINED",
    yardDaysAgo: 8,
    approvalReqDaysAgo: 7,
    outboundTargetDays: 10,
    attachments: 0,
  },
  {
    mark: "GATX",
    number: "77821",
    status: "REVISION_REQUESTED",
    shopMark: "APA",
    totalCents: 2450000,
    reason: "Brake gear",
    assignment: "GATX Lease - OL440",
    leaseType: "MODIFIED",
    yardDaysAgo: 40,
    approvalReqDaysAgo: 35,
    outboundTargetDays: -3,
    attachments: 1,
    issues: true,
  },
  {
    mark: "UTLX",
    number: "912004",
    status: "REVISION_REQUESTED",
    shopMark: "DEMO",
    totalCents: 1567800,
    reason: "Valve repair",
    assignment: "UTLX Pool - OL88",
    leaseType: "FULL SERVICE",
    yardDaysAgo: 15,
    approvalReqDaysAgo: 14,
    outboundTargetDays: 7,
    attachments: 2,
    wreck: false,
  },
  {
    mark: "NATX",
    number: "33010",
    status: "REVISION_REQUESTED",
    shopMark: "APA",
    totalCents: 990000,
    reason: "Coupler",
    assignment: "NATX - OL12",
    leaseType: "UNDEFINED",
    yardDaysAgo: 22,
    approvalReqDaysAgo: 20,
    outboundTargetDays: 1,
  },
  {
    mark: "TILX",
    number: "55021",
    status: "ADJUSTMENT_FOR_APPROVAL",
    shopMark: "DEMO",
    totalCents: 4210000,
    reason: "Side sill",
    assignment: "Trinity - OL901",
    leaseType: "MODIFIED",
    yardDaysAgo: 60,
    approvalReqDaysAgo: 50,
    outboundTargetDays: -5,
    attachments: 4,
    issues: true,
    dispo: true,
  },
  {
    mark: "CRDX",
    number: "2044",
    status: "ADJUSTMENT_FOR_APPROVAL",
    shopMark: "APA",
    totalCents: 1876500,
    reason: "Door - bent",
    assignment: "CRDX Fleet - OL77",
    leaseType: "FULL SERVICE",
    yardDaysAgo: 45,
    approvalReqDaysAgo: 40,
    outboundTargetDays: 3,
    attachments: 1,
  },
  {
    mark: "PROX",
    number: "88112",
    status: "AWAITING_TERMINATE",
    shopMark: "DEMO",
    totalCents: 320000,
    reason: "Cancel — wrong shop",
    assignment: "PROX - OL3",
    leaseType: "UNDEFINED",
    yardDaysAgo: 5,
    approvalReqDaysAgo: 4,
    outboundTargetDays: 14,
  },
  {
    mark: "DOWX",
    number: "44190",
    status: "AWAITING_TERMINATE",
    shopMark: "APA",
    totalCents: 675400,
    reason: "Duplicate BO",
    assignment: "Dow - OL210",
    leaseType: "MODIFIED",
    yardDaysAgo: 9,
    approvalReqDaysAgo: 8,
    outboundTargetDays: 12,
    wreck: true,
  },
  // Filter-in statuses (not in default actionable set)
  {
    mark: "SHPX",
    number: "20991",
    status: "APPROVED",
    shopMark: "DEMO",
    totalCents: 2100450,
    reason: "Paint / stencil",
    assignment: "SHPX - OL55",
    leaseType: "FULL SERVICE",
    yardDaysAgo: 70,
    approvalReqDaysAgo: 65,
    outboundTargetDays: 20,
    attachments: 2,
    dispo: true,
    resp6DaysAgo: 60,
  },
  {
    mark: "NAHX",
    number: "118800",
    status: "APPROVED",
    shopMark: "APA",
    totalCents: 543210,
    reason: "Hatch cover",
    assignment: "NAHX - OL19",
    leaseType: "MODIFIED",
    yardDaysAgo: 55,
    approvalReqDaysAgo: 50,
    outboundTargetDays: 15,
    attachments: 1,
  },
  {
    mark: "CBTX",
    number: "7001",
    status: "COMPLETED",
    shopMark: "DEMO",
    totalCents: 3890000,
    reason: "General repairs",
    assignment: "CBTX - OL401",
    leaseType: "FULL SERVICE",
    yardDaysAgo: 90,
    approvalReqDaysAgo: 85,
    outboundTargetDays: -20,
    attachments: 5,
    dispo: true,
  },
  {
    mark: "FBOX",
    number: "302211",
    status: "QUEUED",
    shopMark: "APA",
    totalCents: 111100,
    reason: "Draft — shop only",
    assignment: "FBOX - OL1",
    leaseType: "UNDEFINED",
    yardDaysAgo: 2,
    outboundTargetDays: 30,
  },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

async function ensureCar(row: SeedRow) {
  const entitySource = row.entitySource ?? "Main";
  // Keep identity sequence ahead of existing stub rows (id 1, 2, …).
  await q(
    `SELECT setval(
       pg_get_serial_sequence('public.railcars', 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM public.railcars), 1), 1)
     )`,
  );
  await q(
    `INSERT INTO public.railcars
       (car_number, car_initial, reporting_marks, active, assignment_label, lessee_name, managed_category, entity)
     SELECT $1, $2, $2, true, $3, $4, $5, $6
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars
       WHERE car_number = $1 AND COALESCE(car_initial,'') = $2
     )`,
    [row.number, row.mark, row.assignment, "Demo Lessee", row.leaseType, entitySource],
  );
  await q(
    `UPDATE public.railcars
     SET assignment_label = COALESCE(assignment_label, $3),
         managed_category = COALESCE(managed_category, $5),
         lessee_name = COALESCE(lessee_name, $4),
         entity = $6
     WHERE car_number = $1 AND COALESCE(car_initial,'') = $2`,
    [row.number, row.mark, row.assignment, "Demo Lessee", row.leaseType, entitySource],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, lessee)
     SELECT 1, abs(hashtext($2 || $1)) % 1000000, $2, $1, 1, 'R-SEED', $3, 'Demo Lessee'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [row.number, row.mark, row.assignment],
  );
}

async function shopIdFor(mark: string): Promise<string> {
  if (mark === "APA") {
    return ensureDemoShop({
      mark: "APA",
      legalName: "Apache Railway Shop",
      city: "Snowflake",
      state: "AZ",
      splc: "859370",
      actor: "seed:estimates-history",
    });
  }
  if (mark === "DEMO") {
    return ensureDemoShop({
      mark: "DEMO",
      legalName: "Demo Repair Shop",
      city: "Demo City",
      state: "TX",
      splc: "750001",
      actor: "seed:estimates-history",
    });
  }
  return ensureDemoShop({
    mark,
    legalName: `${mark} Shop`,
    city: "Local",
    state: "IL",
    splc: "000000",
    actor: "seed:estimates-history",
  });
}

async function clearPriorSeed() {
  // Local re-seed only: hard-delete seed-tagged rows (never used in prod).
  await q(
    `DELETE FROM repair.lessee_approvals WHERE created_by = 'seed:estimates-history'`,
  );
  // estimate_load_findings is append-only (reject_mutation) — leave orphans in local DB.
  await q(
    `DELETE FROM repair.estimate_load_cars WHERE created_by = 'seed:estimates-history'`,
  ).catch(() => undefined);
  await q(
    `DELETE FROM repair.estimate_lines
     WHERE revision_id IN (
       SELECT id FROM repair.estimate_revisions WHERE created_by = 'seed:estimates-history'
     )`,
  );
  await q(
    `DELETE FROM repair.estimate_revisions WHERE created_by = 'seed:estimates-history'`,
  );
  await q(
    `DELETE FROM repair.documents WHERE created_by = 'seed:estimates-history'`,
  );
  await q(
    `DELETE FROM repair.bad_orders WHERE created_by = 'seed:estimates-history'`,
  );
  await q(
    `DELETE FROM repair.estimates WHERE created_by = 'seed:estimates-history'`,
  );
  await q(
    `DELETE FROM repair.events WHERE created_by = 'seed:estimates-history'`,
  );
}

async function seedOne(row: SeedRow, shopId: string) {
  // Rotate entities across seed cars when not explicitly set (MAIN / COAL / RPS)
  const rotate: Array<SeedRow["entitySource"]> = [
    "Main",
    "Coal",
    "Rail Partners Select",
  ];
  const entitySource =
    row.entitySource ??
    rotate[Math.abs(Number(row.number.replace(/\D/g, "")) || 0) % 3];
  const entityCode = entityCodeFromSource(entitySource);
  const rowWithEntity: SeedRow = { ...row, entitySource };

  await ensureCar(rowWithEntity);
  const eventStatus = await getStatusByCode(DEFAULT_TENANT_ID, "EVENT", "ON_HAND");
  const estStatus = await getStatusByCode(DEFAULT_TENANT_ID, "ESTIMATE", row.status);
  if (!eventStatus || !estStatus) {
    throw new Error(`Missing status EVENT/ON_HAND or ESTIMATE/${row.status}`);
  }

  const yard = daysAgo(row.yardDaysAgo);
  const target =
    row.outboundTargetDays != null ? daysFromNow(row.outboundTargetDays) : null;

  const { rows: ev } = await q(
    `INSERT INTO repair.events
       (tenant_id, car_mark, car_number, shop_id, rule, origin, status_id,
        is_wreck, yard_arrived_at, target_outbound_at, billing_road, created_by,
        dispo_requested_at, entity_code, entity_source_value)
     VALUES ($1,$2,$3,$4,'RULE_1','BO',$5,$6,$7,$8,
             (SELECT billing_road FROM repair.shops WHERE id = $4),
             'seed:estimates-history', $9, $10, $11)
     RETURNING id`,
    [
      DEFAULT_TENANT_ID,
      row.mark,
      row.number,
      shopId,
      eventStatus.id,
      row.wreck ?? false,
      yard.toISOString(),
      target ? target.toISOString().slice(0, 10) : null,
      row.dispo ? new Date().toISOString() : null,
      entityCode,
      entitySource,
    ],
  );
  const eventId = String(ev[0].id);

  await q(
    `INSERT INTO repair.bad_orders
       (tenant_id, event_id, source, shopping_reason, created_by)
     VALUES ($1,$2,'INTERNAL',$3,'seed:estimates-history')`,
    [DEFAULT_TENANT_ID, eventId, row.reason],
  );

  const { rows: est } = await q(
    `INSERT INTO repair.estimates
       (tenant_id, event_id, current_revision, status_id, created_by,
        completed_at, locked, entity_code, entity_source_value)
     VALUES ($1,$2,1,$3,'seed:estimates-history',
             $4, $5, $6, $7)
     RETURNING id`,
    [
      DEFAULT_TENANT_ID,
      eventId,
      estStatus.id,
      row.status === "COMPLETED" ? new Date().toISOString() : null,
      row.status === "COMPLETED",
      entityCode,
      entitySource,
    ],
  );
  const estimateId = String(est[0].id);

  const dollars = centsToDollars(row.totalCents);
  const labor = centsToDollars(Math.round(row.totalCents * 0.4));
  const material = centsToDollars(row.totalCents - Math.round(row.totalCents * 0.4));
  const apprAt =
    row.approvalReqDaysAgo != null
      ? daysAgo(row.approvalReqDaysAgo).toISOString()
      : null;

  // Rev 1: submitted for approval (or queued draft)
  const { rows: rev } = await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, action_at, actor_name, actor_email,
        labor, material, total, new_status, old_status, created_by)
     VALUES ($1,$2,1,'Seed load',$3,'seed','seed@local',
             $4,$5,$6,$7,'QUEUED','seed:estimates-history')
     RETURNING id`,
    [
      DEFAULT_TENANT_ID,
      estimateId,
      apprAt ?? yard.toISOString(),
      labor,
      material,
      dollars,
      row.status === "QUEUED" ? "QUEUED" : "AWAITING_APPROVAL",
    ],
  );
  const revId = String(rev[0].id);

  await q(
    `INSERT INTO repair.estimate_lines
       (tenant_id, revision_id, line_no, aar_job_code, why_made, resp_code,
        labor, material, total, created_by)
     VALUES ($1,$2,1,'4450',$3,'1',$4,$5,$6,'seed:estimates-history')`,
    [DEFAULT_TENANT_ID, revId, row.reason, labor, material, dollars],
  );

  if (row.status === "APPROVED" || row.status === "COMPLETED") {
    await q(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, action_at, actor_name, actor_email,
          labor, material, total, new_status, old_status, created_by)
       VALUES ($1,$2,2,'Approve',$3,'reviewer','reviewer@local',
               $4,$5,$6,'APPROVED','AWAITING_APPROVAL','seed:estimates-history')`,
      [
        DEFAULT_TENANT_ID,
        estimateId,
        daysAgo((row.approvalReqDaysAgo ?? 10) - 2).toISOString(),
        labor,
        material,
        dollars,
      ],
    );
    await q(
      `UPDATE repair.estimates SET current_revision = 2 WHERE id = $1`,
      [estimateId],
    );
  }

  if (row.status === "REVISION_REQUESTED" || row.status === "ADJUSTMENT_FOR_APPROVAL") {
    await q(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, action_at, actor_name, actor_email,
          labor, material, total, new_status, old_status, created_by)
       VALUES ($1,$2,2,$3,now(),'reviewer','reviewer@local',
               $4,$5,$6,$7,'AWAITING_APPROVAL','seed:estimates-history')`,
      [
        DEFAULT_TENANT_ID,
        estimateId,
        row.status === "REVISION_REQUESTED" ? "Request revision" : "Adjustment",
        labor,
        material,
        dollars,
        row.status,
      ],
    );
    await q(
      `UPDATE repair.estimates SET current_revision = 2 WHERE id = $1`,
      [estimateId],
    );
  }

  if (row.status === "AWAITING_TERMINATE") {
    await q(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, action_at, actor_name, actor_email,
          labor, material, total, new_status, old_status, created_by)
       VALUES ($1,$2,2,'Request terminate',now(),'shop','shop@local',
               $3,$4,$5,'AWAITING_TERMINATE','AWAITING_APPROVAL','seed:estimates-history')`,
      [DEFAULT_TENANT_ID, estimateId, labor, material, dollars],
    );
    await q(
      `UPDATE repair.estimates SET current_revision = 2 WHERE id = $1`,
      [estimateId],
    );
  }

  const nDocs = row.attachments ?? 0;
  for (let i = 0; i < nDocs; i++) {
    await q(
      `INSERT INTO repair.documents
         (tenant_id, event_id, kind, storage_key, sha256, size, mime,
          uploaded_by, created_by, original_filename, category_code)
       VALUES ($1,$2,'photo',$3,$4,100,'image/jpeg',
               'seed','seed:estimates-history',$5,'photo')`,
      [
        DEFAULT_TENANT_ID,
        eventId,
        `seed/${eventId}/photo-${i}.jpg`,
        `seedsha${i}${eventId.replace(/-/g, "").slice(0, 24)}`,
        `photo-${i + 1}.jpg`,
      ],
    );
  }

  if (row.issues) {
    try {
      const { rows: run } = await q(
        `INSERT INTO repair.estimate_load_runs
           (tenant_id, source, sha256, original_filename, status, car_count, actor, created_by)
         VALUES ($1,'UI',$2,'seed-issues.txt','PENDING_WARNINGS',1,'seed','seed:estimates-history')
         RETURNING id`,
        [
          DEFAULT_TENANT_ID,
          `seedissues${eventId.replace(/-/g, "").slice(0, 40)}`,
        ],
      );
      if (run[0]) {
        await q(
          `INSERT INTO repair.estimate_load_cars
             (tenant_id, load_run_id, estimate_id, event_id, car_mark, car_number, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'seed:estimates-history')`,
          [DEFAULT_TENANT_ID, run[0].id, estimateId, eventId, row.mark, row.number],
        );
        await q(
          `INSERT INTO repair.estimate_load_findings
             (tenant_id, load_run_id, severity, code, message, car_mark, car_number, created_by)
           VALUES ($1,$2,'WARNING','SEED','Seeded warning for Issues? column',$3,$4,'seed:estimates-history')`,
          [DEFAULT_TENANT_ID, run[0].id, row.mark, row.number],
        );
      }
    } catch (err) {
      console.warn("issues seed skipped:", err instanceof Error ? err.message : err);
    }
  }

  if (row.resp6DaysAgo != null) {
    try {
      await q(
        `INSERT INTO repair.lessee_approvals
           (tenant_id, event_id, estimate_id, revision_id, lessee_email, status,
            created_at, created_by)
         VALUES ($1,$2,$3,$4,'lessee@demo.local','PENDING',$5,'seed:estimates-history')`,
        [
          DEFAULT_TENANT_ID,
          eventId,
          estimateId,
          revId,
          daysAgo(row.resp6DaysAgo).toISOString(),
        ],
      );
    } catch {
      // ignore if revision FK / constraint mismatch
    }
  }

  return { estimateId, eventId, status: row.status, label: `${row.mark} ${row.number}` };
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    console.error("Set DATABASE_URL before repair:seed:estimates-history");
    process.exit(1);
  }
  console.log("repair:seed:estimates-history — migrate (idempotent) + seed ~15");
  await migrateLocal();
  await clearPriorSeed();

  const shops = new Map<string, string>();
  for (const mark of ["APA", "DEMO"]) {
    shops.set(mark, await shopIdFor(mark));
  }

  const created = [];
  for (const row of SEED) {
    const shopId = shops.get(row.shopMark) ?? (await shopIdFor(row.shopMark));
    created.push(await seedOne(row, shopId));
  }

  const byStatus = created.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Seeded ${created.length} estimates:`);
  for (const [k, v] of Object.entries(byStatus)) console.log(`  ${k}: ${v}`);
  console.log(
    "Default /#/repair filter shows actionable only; filter in APPROVED to test.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
