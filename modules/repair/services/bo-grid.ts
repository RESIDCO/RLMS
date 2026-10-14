/**
 * OWNER_UI §C — Bad Order History grid (list / filter / export).
 * Parity with estimates grid: statuses, shop, car, date field, sort, paging.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { formatShopLabel } from "./shops";

export const DEFAULT_BO_STATUSES = [
  "QUEUED",
  "ACCEPTED_PENDING",
  "ACCEPTED_WORKING",
] as const;

export type BoGridDateField =
  | "ignore"
  | "bo_date"
  | "arrival"
  | "incident"
  | "yard_arrival"
  | "created";

export type BoGridFilters = {
  tenantId?: string;
  statusCodes?: string[];
  shopIds?: string[];
  carMark?: string;
  carNumber?: string;
  fromDate?: string;
  toDate?: string;
  dateField?: BoGridDateField;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

const SORT_COLUMNS: Record<string, string> = {
  bo_date: "bo.bo_date",
  status: "bo.lifecycle_status",
  shop: "sh.name",
  car_mark: "ev.car_mark",
  car_number: "ev.car_number",
  reason: "bo.shopping_reason",
  dest_city: "bo.dest_city",
  yard: "ev.yard_arrived_at",
  incident: "bo.incident_date",
  stcc: "bo.stcc",
  created: "bo.created_at",
};

function dateExpr(field: BoGridDateField | undefined): string | null {
  switch (field) {
    case "bo_date":
      return "bo.bo_date";
    case "arrival":
      return "bo.arrival_date";
    case "incident":
      return "bo.incident_date";
    case "yard_arrival":
      return "ev.yard_arrived_at::date";
    case "created":
      return "bo.created_at::date";
    default:
      return null;
  }
}

export function displayLifecycleStatus(code: string): string {
  switch (code) {
    case "QUEUED":
      return "Queued";
    case "ACCEPTED_PENDING":
      return "Accepted-Pending";
    case "ACCEPTED_WORKING":
      return "Accepted-Working";
    case "CLOSED":
      return "Closed";
    case "DECLINED":
      return "Declined";
    default:
      return code;
  }
}

export async function queryBadOrderGrid(filters: BoGridFilters = {}) {
  const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 5000);
  const offset = Math.max(filters.offset ?? 0, 0);
  const statusCodes = filters.statusCodes?.length
    ? filters.statusCodes.map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_BO_STATUSES];
  const shopIds = filters.shopIds?.length
    ? filters.shopIds.filter(Boolean)
    : null;
  const dateCol = dateExpr(filters.dateField ?? "ignore");
  const useDateRange =
    dateCol != null && (Boolean(filters.fromDate) || Boolean(filters.toDate));
  const sortCol =
    (filters.sortBy && SORT_COLUMNS[filters.sortBy]) || "bo.bo_date";
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";

  const { rows } = await q(
    `SELECT bo.id AS bad_order_id,
            bo.event_id,
            bo.bo_date,
            bo.bo_city,
            bo.bo_state,
            bo.dest_city,
            bo.dest_state,
            bo.shopping_reason AS bad_order_reason,
            bo.bo_rule_code,
            bo.bo_rule_other_text,
            bo.lifecycle_status,
            bo.stcc,
            bo.reporting_road,
            bo.dc_road,
            bo.routing,
            bo.last_contents,
            bo.car_load,
            bo.cleaned,
            bo.travel_on_own_wheels,
            bo.incident_date,
            bo.comments,
            bo.wreck_estimate,
            bo.arrival_date,
            bo.multi_car_group_id,
            bo.created_at,
            ev.car_mark,
            ev.car_number,
            ev.shop_id,
            ev.is_wreck,
            ev.yard_arrived_at,
            ev.ddct_event_id,
            ev.ddct_incident_id,
            ev.billing_road,
            ev.entity_code,
            ev.entity_source_value,
            sh.name AS shop_name,
            sh.city AS shop_city,
            sh.state AS shop_state,
            sh.shop_mark,
            sh.reporting_mark AS shop_reporting_mark,
            (SELECT COUNT(*)::int FROM repair.documents d
             WHERE d.event_id = bo.event_id AND d.deleted_at IS NULL
               AND COALESCE(d.lifecycle_status, 'ACTIVE') <> 'VOIDED') AS attachment_count,
            est.id AS estimate_id,
            est.current_revision AS estimate_rev,
            est_s.code AS estimate_status,
            cr.current_assignment AS assignment,
            cr.lessee_name,
            cr.managed_category AS lease_type
     FROM repair.bad_orders bo
     JOIN repair.events ev ON ev.id = bo.event_id
     LEFT JOIN repair.shops sh ON sh.id = ev.shop_id
     LEFT JOIN LATERAL (
       SELECT e.id, e.current_revision, e.status_id
       FROM repair.estimates e
       WHERE e.event_id = bo.event_id AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC
       LIMIT 1
     ) est ON true
     LEFT JOIN repair.statuses est_s ON est_s.id = est.status_id
     LEFT JOIN repair.cars_ref cr
       ON upper(cr.car_mark) = upper(ev.car_mark) AND cr.car_number = ev.car_number
     WHERE bo.tenant_id = $1
       AND bo.deleted_at IS NULL
       AND ev.deleted_at IS NULL
       AND ($2::text[] IS NULL OR bo.lifecycle_status = ANY($2))
       AND ($3::uuid[] IS NULL OR ev.shop_id = ANY($3))
       AND ($4::text IS NULL OR upper(ev.car_mark) = upper($4))
       AND ($5::text IS NULL OR ev.car_number = $5)
       AND (
         $8::boolean = false
         OR (
           ($6::date IS NULL OR ${dateCol ?? "bo.bo_date"} >= $6::date)
           AND ($7::date IS NULL OR ${dateCol ?? "bo.bo_date"} <= $7::date)
         )
       )
     ORDER BY ${sortCol} ${sortDir} NULLS LAST, bo.created_at DESC
     LIMIT $9 OFFSET $10`,
    [
      tenantId,
      statusCodes,
      shopIds,
      filters.carMark?.trim() || null,
      filters.carNumber?.trim() || null,
      filters.fromDate || null,
      filters.toDate || null,
      useDateRange,
      limit,
      offset,
    ],
  );

  const countRes = await q(
    `SELECT COUNT(*)::int AS n
     FROM repair.bad_orders bo
     JOIN repair.events ev ON ev.id = bo.event_id
     WHERE bo.tenant_id = $1
       AND bo.deleted_at IS NULL
       AND ev.deleted_at IS NULL
       AND ($2::text[] IS NULL OR bo.lifecycle_status = ANY($2))
       AND ($3::uuid[] IS NULL OR ev.shop_id = ANY($3))
       AND ($4::text IS NULL OR upper(ev.car_mark) = upper($4))
       AND ($5::text IS NULL OR ev.car_number = $5)
       AND (
         $8::boolean = false
         OR (
           ($6::date IS NULL OR ${dateCol ?? "bo.bo_date"} >= $6::date)
           AND ($7::date IS NULL OR ${dateCol ?? "bo.bo_date"} <= $7::date)
         )
       )`,
    [
      tenantId,
      statusCodes,
      shopIds,
      filters.carMark?.trim() || null,
      filters.carNumber?.trim() || null,
      filters.fromDate || null,
      filters.toDate || null,
      useDateRange,
    ],
  );

  const mapped = rows.map((r) => {
    const shop_display = formatShopLabel({
      name: r.shop_name,
      city: r.shop_city,
      state: r.shop_state,
      reporting_mark: r.shop_reporting_mark,
      shop_mark: r.shop_mark,
    });
    const assignment =
      r.assignment != null
        ? String(r.assignment)
        : r.lessee_name
          ? `${r.lessee_name}${r.lease_type ? ` – ${r.lease_type}` : ""}`
          : null;
    return {
      bad_order_id: String(r.bad_order_id),
      event_id: String(r.event_id),
      shop_display: shop_display || null,
      car_mark: String(r.car_mark ?? ""),
      car_number: String(r.car_number ?? ""),
      attachment_count: Number(r.attachment_count ?? 0),
      bo_date: r.bo_date,
      bad_order_reason: r.bad_order_reason,
      dest_city: r.dest_city,
      dest_state: r.dest_state,
      lifecycle_status: String(r.lifecycle_status),
      status_display: displayLifecycleStatus(String(r.lifecycle_status)),
      yard_arrived_at: r.yard_arrived_at,
      arrival_date: r.arrival_date,
      estimate_id: r.estimate_id != null ? String(r.estimate_id) : null,
      estimate_label: r.estimate_id
        ? `${r.car_mark} ${r.car_number}`.trim()
        : null,
      wreck_estimate: Boolean(r.wreck_estimate),
      is_wreck: Boolean(r.is_wreck),
      travel_on_own_wheels: Boolean(r.travel_on_own_wheels),
      stcc: r.stcc,
      incident_date: r.incident_date,
      assignment,
      entity_code: r.entity_code != null ? String(r.entity_code) : null,
      ddct_event_id: r.ddct_event_id,
      ddct_incident_id: r.ddct_incident_id,
      billing_road: r.billing_road,
      reporting_road: r.reporting_road,
      dc_road: r.dc_road,
      routing: r.routing,
      last_contents: r.last_contents,
      car_load: r.car_load,
      cleaned: Boolean(r.cleaned),
      comments: r.comments,
      multi_car_group_id:
        r.multi_car_group_id != null ? String(r.multi_car_group_id) : null,
    };
  });

  return {
    rows: mapped,
    total: Number(countRes.rows[0]?.n ?? mapped.length),
    defaultStatuses: [...DEFAULT_BO_STATUSES],
    limit,
    offset,
  };
}

export async function exportBadOrderGridCsv(filters: BoGridFilters = {}) {
  const grid = await queryBadOrderGrid({ ...filters, limit: 5000, offset: 0 });
  const header = [
    "Shop",
    "Car Initials",
    "Car Number",
    "Attachments",
    "Bad Order Date",
    "Bad Order Reason",
    "Destination City",
    "State",
    "Status",
    "Yard Arrival",
    "Estimate",
    "Wreck Est",
    "Is Wreck?",
    "Wheel Travel",
    "STCC",
    "Incident Date",
    "Assignment",
    "Entity",
    "DDCT Event ID",
    "bad_order_id",
    "event_id",
  ];
  const lines = [header.join(",")];
  for (const r of grid.rows) {
    lines.push(
      [
        r.shop_display ?? "",
        r.car_mark,
        r.car_number,
        r.attachment_count,
        r.bo_date ?? "",
        r.bad_order_reason ?? "",
        r.dest_city ?? "",
        r.dest_state ?? "",
        r.status_display,
        r.yard_arrived_at ?? "",
        r.estimate_id ?? "",
        r.wreck_estimate ? "Y" : "N",
        r.is_wreck ? "Y" : "N",
        r.travel_on_own_wheels ? "Y" : "N",
        r.stcc ?? "",
        r.incident_date ?? "",
        r.assignment ?? "",
        r.entity_code ?? "",
        r.ddct_event_id ?? "",
        r.bad_order_id,
        r.event_id,
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return { csv: lines.join("\n"), total: grid.total };
}

/** List active STCC codes for dropdown. */
export async function listStccCodes(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
}) {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const activeOnly = opts?.activeOnly !== false;
  const { rows } = await q(
    `SELECT id, code, description, active, sort_order
     FROM repair.stcc_codes
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean IS FALSE OR active)
     ORDER BY sort_order, code`,
    [tenantId, activeOnly],
  );
  return rows;
}

/** Find open BOs on the same car (for Allow Duplicates guard). */
export async function findOpenBadOrdersForCar(opts: {
  carMark: string;
  carNumber: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT bo.id, bo.lifecycle_status, bo.bo_date, ev.car_mark, ev.car_number
     FROM repair.bad_orders bo
     JOIN repair.events ev ON ev.id = bo.event_id
     WHERE bo.tenant_id = $1
       AND bo.deleted_at IS NULL
       AND ev.deleted_at IS NULL
       AND upper(ev.car_mark) = upper($2)
       AND ev.car_number = $3
       AND bo.lifecycle_status IN ('QUEUED','ACCEPTED_PENDING','ACCEPTED_WORKING')
     ORDER BY bo.created_at DESC`,
    [tenantId, opts.carMark.trim(), opts.carNumber.trim()],
  );
  return rows;
}
