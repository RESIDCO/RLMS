import type pg from "pg";
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { requireVcfCar } from "./vcf";
import { getStatusByCode } from "./status-machine";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { resolveBoRuleSelection } from "./bo-rules";
import { activeDistributionEmails } from "./distribution-list";
import { resolveEntitySnapshot } from "./entity";
import { findOpenBadOrdersForCar } from "./bo-grid";
import {
  formatShopLabel,
  listShopsForDropdown,
  type ShopListRow,
} from "./shops";

export type { ShopListRow };
export { formatShopLabel };

export type CreateBadOrderInput = {
  tenantId?: string;
  carMark: string;
  carNumber: string;
  /** @deprecated Prefer boRuleCode from repair.bo_rules */
  rule?: "RULE_1" | "RULE_107";
  boRuleCode?: string;
  boRuleOtherText?: string;
  source?: "DDCT" | "EMAIL_DOC" | "INTERNAL";
  shoppingReason?: string;
  damagingRoad?: string;
  /** Billing road — defaults from shop.billing_road; override requires reason */
  billingRoad?: string;
  billingRoadOverrideReason?: string;
  /** DDCT Event ID (not Estimate ID). */
  ddctEventId?: string;
  ddctIncidentId?: string;
  shopId?: string;
  isWreck?: boolean;
  wreckEstimate?: boolean;
  actor?: string;
  /** Manual_Gap #6 required B/O fields */
  boDate?: string;
  boCity?: string;
  boState?: string;
  destCity?: string;
  destState?: string;
  isTankCar?: boolean;
  reportingRoad?: string;
  dcRoad?: string;
  stcc?: string;
  routing?: string;
  lastContents?: string;
  carLoad?: "EMPTY" | "LOADED";
  cleaned?: boolean;
  travelOnOwnWheels?: boolean;
  incidentDate?: string;
  comments?: string;
  arrivalDate?: string;
  /** When false (default), block second open BO on same car. */
  allowDuplicates?: boolean;
  /** Shared across multi-car creates. */
  multiCarGroupId?: string;
};

export async function createBadOrder(input: CreateBadOrderInput) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const source = input.source ?? "INTERNAL";

  const resolvedRule = await resolveBoRuleSelection({
    boRuleCode: input.boRuleCode,
    otherText: input.boRuleOtherText,
    legacyRule: input.rule,
    tenantId,
  });
  if (!resolvedRule.ok) {
    return { ok: false as const, status: resolvedRule.status, error: resolvedRule.error };
  }
  const rule = resolvedRule.eventRule;

  const vcf = await requireVcfCar(input.carMark, input.carNumber);
  if (!vcf.ok) {
    return { ok: false as const, status: 422, error: vcf.reason };
  }

  let shopBillingRoad: string | null = null;
  let shopCity: string | null = null;
  let shopState: string | null = null;
  if (input.shopId) {
    const { rows: shops } = await q(
      `SELECT id, billing_road, reporting_mark, city, state, name
       FROM repair.shops
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [input.shopId, tenantId],
    );
    if (!shops[0]) {
      return { ok: false as const, status: 400, error: "Shop not found" };
    }
    shopBillingRoad = String(shops[0].billing_road || shops[0].reporting_mark || "");
    shopCity = shops[0].city != null ? String(shops[0].city) : null;
    shopState = shops[0].state != null ? String(shops[0].state) : null;
  }

  // Billing road comes from the shop record on BO create.
  // Corrections belong on the estimate header (pencil), not the BO form.
  const defaultBilling = (shopBillingRoad ?? "").trim().toUpperCase() || null;
  const requestedBilling = (input.billingRoad ?? "").trim().toUpperCase() || null;
  let billingRoad = defaultBilling ?? requestedBilling;
  let overrideReason: string | null = null;
  if (
    requestedBilling &&
    defaultBilling &&
    requestedBilling !== defaultBilling
  ) {
    // Legacy API callers may still send an override + reason; owner UI no longer does.
    overrideReason = (input.billingRoadOverrideReason ?? "").trim();
    if (!overrideReason) {
      billingRoad = defaultBilling;
    } else {
      billingRoad = requestedBilling;
    }
  } else if (requestedBilling && !defaultBilling) {
    billingRoad = requestedBilling;
  }

  const shoppingReason =
    input.shoppingReason?.trim() ||
    (resolvedRule.otherText
      ? `${resolvedRule.description}: ${resolvedRule.otherText}`
      : resolvedRule.description);

  // Allow Duplicates: UI sends false by default (block). Undefined skips for
  // legacy smoke/demo callers that create multiple open BOs on the same car.
  if (input.allowDuplicates === false) {
    const open = await findOpenBadOrdersForCar({
      carMark: vcf.car.car_mark,
      carNumber: vcf.car.car_number,
      tenantId,
    });
    if (open.length) {
      return {
        ok: false as const,
        status: 409,
        error: `Open Bad Order already exists for ${vcf.car.car_mark} ${vcf.car.car_number}. Check Allow Duplicates to create another.`,
        openBadOrders: open,
      };
    }
  }

  // B/O City/State required (RS #6). Empty string treated as missing → shop city/ST.
  // Last-resort placeholders keep legacy smoke paths working; owner UI validates required.
  const boCity = (input.boCity?.trim() || shopCity || "Pending").trim();
  const boState = (input.boState?.trim() || shopState || "XX").trim().toUpperCase();

  const carLoad =
    input.carLoad === "LOADED" || input.carLoad === "EMPTY"
      ? input.carLoad
      : null;

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

  // Snapshot entity tag (MAIN/COAL/RPS) from railcars.entity at BO create
  const entitySnap = await resolveEntitySnapshot({
    carMark: vcf.car.car_mark,
    carNumber: vcf.car.car_number,
    tenantId,
  });

  const multiCarGroupId = input.multiCarGroupId ?? null;
  const reportingRoad =
    (input.reportingRoad ?? input.damagingRoad ?? "").trim().toUpperCase() ||
    null;

  const result = await withTransaction(async (client) => {
    const event = await client.query(
      `INSERT INTO repair.events
         (tenant_id, car_mark, car_number, rlms_railcar_id, shop_id, rule,
          damaging_road, ddct_event_id, ddct_incident_id, origin, status_id,
          is_wreck, is_tank_car, created_by,
          bo_rule_code, bo_rule_other_text, billing_road, billing_road_override_reason,
          entity_code, entity_source_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BO',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        tenantId,
        vcf.car.car_mark,
        vcf.car.car_number,
        vcf.car.rlms_railcar_id,
        input.shopId ?? null,
        rule,
        reportingRoad,
        input.ddctEventId ?? null,
        input.ddctIncidentId ?? null,
        statusId,
        Boolean(input.isWreck || input.shoppingReason === "WRECK"),
        Boolean(input.isTankCar),
        input.actor ?? "system",
        resolvedRule.code,
        resolvedRule.otherText,
        billingRoad,
        overrideReason,
        entitySnap.code,
        entitySnap.sourceValue,
      ],
    );
    const ev = event.rows[0];

    const bo = await client.query(
      `INSERT INTO repair.bad_orders
         (tenant_id, event_id, source, shopping_reason, bo_date, bo_city, bo_state,
          dest_city, dest_state, lifecycle_status, status, status_changed_at,
          status_changed_by, created_by,
          bo_rule_code, bo_rule_other_text,
          reporting_road, dc_road, stcc, routing, last_contents, car_load,
          cleaned, travel_on_own_wheels, incident_date, comments,
          wreck_estimate, multi_car_group_id, arrival_date)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8,$9,'QUEUED',
               'ASSIGNED', now(), $10, $10, $11,$12,
               $13,$14,$15,$16,$17,$18,$19,$20,$21::date,$22,$23,$24,$25::date)
       RETURNING *`,
      [
        tenantId,
        ev.id,
        source,
        shoppingReason,
        input.boDate ?? null,
        boCity,
        boState,
        input.destCity?.trim() || null,
        input.destState?.trim().toUpperCase() || null,
        input.actor ?? "system",
        resolvedRule.code,
        resolvedRule.otherText,
        reportingRoad,
        input.dcRoad?.trim().toUpperCase() || null,
        input.stcc?.trim() || null,
        input.routing?.trim() || null,
        input.lastContents?.trim() || null,
        carLoad,
        Boolean(input.cleaned),
        input.travelOnOwnWheels !== false,
        input.incidentDate ?? null,
        input.comments?.trim() || null,
        Boolean(input.wreckEstimate),
        multiCarGroupId,
        input.arrivalDate ?? null,
      ],
    );

    // Rule 107 → two tracks
    if (rule === "RULE_107") {
      await insertTrack(client, tenantId, ev.id, "OWNER_CONTRACT", input.actor);
      await insertTrack(client, tenantId, ev.id, "R107_RESP3", input.actor);
    } else {
      await insertTrack(client, tenantId, ev.id, "OWNER_CONTRACT", input.actor);
    }

    return { event: ev, badOrder: bo.rows[0], entity: entitySnap };
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

  // BO notifications → plain distribution list (not Resp 6 / lessee contact fields)
  const dist = await activeDistributionEmails(tenantId);
  await notify({
    tenantId,
    eventId: String(result.event.id),
    type: "BO_CREATED",
    bodyText: `Bad order created for ${input.carMark} ${input.carNumber}. Rule: ${resolvedRule.code}. Reason: ${shoppingReason}.`,
    actor: input.actor ?? "system",
    extraTo: dist.length ? dist : undefined,
  }).catch(() => undefined);

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
            sh.reporting_mark AS shop_mark, sh.name AS shop_name,
            sh.city AS shop_city, sh.state AS shop_state,
            sh.billing_road AS shop_billing_road
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

/**
 * Owner shop dropdown — EMPTY until at least one shop is created.
 * Does not include billing-road / payee-list seeds (retired from shop master).
 */
export async function listDemoShop(
  tenantId = DEFAULT_TENANT_ID,
): Promise<ShopListRow[]> {
  return listShopsForDropdown(tenantId);
}
