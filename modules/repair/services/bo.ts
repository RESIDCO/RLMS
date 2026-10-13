import type pg from "pg";
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { requireVcfCar } from "./vcf";
import { getStatusByCode } from "./status-machine";
import { writeAudit } from "./audit";

export type CreateBadOrderInput = {
  tenantId?: string;
  carMark: string;
  carNumber: string;
  rule?: "RULE_1" | "RULE_107";
  source?: "DDCT" | "EMAIL_DOC" | "INTERNAL";
  shoppingReason?: string;
  damagingRoad?: string;
  ddctEventId?: string;
  ddctIncidentId?: string;
  shopId?: string;
  isWreck?: boolean;
  actor?: string;
};

export async function createBadOrder(input: CreateBadOrderInput) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const rule = input.rule ?? "RULE_1";
  const source = input.source ?? "INTERNAL";

  const vcf = await requireVcfCar(input.carMark, input.carNumber);
  if (!vcf.ok) {
    return { ok: false as const, status: 422, error: vcf.reason };
  }

  const boStatus = await getStatusByCode(tenantId, "EVENT", "BO_CREATED");
  const shopStatus = await getStatusByCode(tenantId, "EVENT", "SHOP_ASSIGNED");
  if (!boStatus || !shopStatus) {
    return {
      ok: false as const,
      status: 500,
      error: "Event statuses not seeded",
    };
  }

  const statusId = input.shopId ? shopStatus.id : boStatus.id;

  const result = await withTransaction(async (client) => {
    const event = await client.query(
      `INSERT INTO repair.events
         (tenant_id, car_mark, car_number, rlms_railcar_id, shop_id, rule,
          damaging_road, ddct_event_id, ddct_incident_id, origin, status_id, is_wreck, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BO',$10,$11,$12)
       RETURNING *`,
      [
        tenantId,
        vcf.car.car_mark,
        vcf.car.car_number,
        vcf.car.rlms_railcar_id,
        input.shopId ?? null,
        rule,
        input.damagingRoad ?? null,
        input.ddctEventId ?? null,
        input.ddctIncidentId ?? null,
        statusId,
        Boolean(input.isWreck || input.shoppingReason === "WRECK"),
        input.actor ?? "system",
      ],
    );
    const ev = event.rows[0];

    const bo = await client.query(
      `INSERT INTO repair.bad_orders
         (tenant_id, event_id, source, shopping_reason, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        tenantId,
        ev.id,
        source,
        input.shoppingReason ?? null,
        input.actor ?? "system",
      ],
    );

    // Rule 107 → two tracks
    if (rule === "RULE_107") {
      await insertTrack(client, tenantId, ev.id, "OWNER_CONTRACT", input.actor);
      await insertTrack(client, tenantId, ev.id, "R107_RESP3", input.actor);
    } else {
      await insertTrack(client, tenantId, ev.id, "OWNER_CONTRACT", input.actor);
    }

    return { event: ev, badOrder: bo.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: result.event.id,
    action: "BO_CREATED",
    after: result,
    actor: input.actor ?? "system",
    via: "UI",
  });

  return { ok: true as const, ...result };
}

async function insertTrack(
  client: pg.PoolClient,
  tenantId: string,
  eventId: string,
  trackType: "OWNER_CONTRACT" | "R107_RESP3",
  actor?: string,
) {
  await client.query(
    `INSERT INTO repair.event_tracks (tenant_id, event_id, track_type, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id, track_type) DO NOTHING`,
    [tenantId, eventId, trackType, actor ?? "system"],
  );
}

export async function getEvent(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code, s.display_name AS status_name,
            sh.reporting_mark AS shop_mark, sh.name AS shop_name
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     LEFT JOIN repair.shops sh ON sh.id = e.shop_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [eventId, tenantId],
  );
  if (!rows[0]) return null;
  const tracks = await q(
    `SELECT * FROM repair.event_tracks WHERE event_id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  const bos = await q(
    `SELECT * FROM repair.bad_orders WHERE event_id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  return { ...rows[0], tracks: tracks.rows, badOrders: bos.rows };
}

export async function listDemoShop(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT id, reporting_mark, name, default_inbox
     FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY reporting_mark`,
    [tenantId],
  );
  return rows;
}
