/**
 * Shop map: pins (geocoded or override) + simplified NARN rail overlay.
 * Free/local only — OSM / OpenRailwayMap tiles in the browser; rail GeoJSON bundled.
 */
import { createReadStream, existsSync } from "fs";
import { createGunzip } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { DEFAULT_TENANT_ID, q } from "../db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIL_GZ = join(__dirname, "../data/narn-lines-simplified.geojson.gz");

export type ShopMapPin = {
  id: string;
  name: string;
  shop_mark: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  lat: number;
  lng: number;
  coord_source: "override" | "places";
  delivering_lines: Array<{
    mark: string;
    name: string | null;
    label: string;
  }>;
  capability_ids: string[];
  capability_labels: string[];
  car_type_ids: string[];
  car_type_labels: string[];
  primary_contact: {
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  } | null;
};

function parseOverride(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listShopMapPins(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
  railroadMark?: string;
  capabilityId?: string;
  carTypeId?: string;
}): Promise<{ pins: ShopMapPin[]; ungeocoded: number }> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const params: unknown[] = [tenantId];
  let sql = `
    SELECT s.id, s.name, s.shop_mark, s.city, s.state, s.active,
           s.lat_override, s.lng_override,
           p.lat AS place_lat, p.lng AS place_lng
    FROM repair.shops s
    LEFT JOIN LATERAL (
      SELECT pl.lat, pl.lng
      FROM repair.places pl
      WHERE pl.name_lc = lower(trim(s.city))
        AND pl.state = upper(trim(s.state))
      ORDER BY CASE pl.country WHEN 'US' THEN 0 WHEN 'CA' THEN 1 ELSE 2 END,
               pl.population DESC
      LIMIT 1
    ) p ON true
    WHERE s.tenant_id = $1 AND s.deleted_at IS NULL`;

  if (opts?.activeOnly !== false) {
    sql += ` AND s.active = true`;
  }
  if (opts?.railroadMark?.trim()) {
    params.push(opts.railroadMark.trim().toUpperCase());
    sql += ` AND EXISTS (
      SELECT 1 FROM repair.shop_delivering_lines dl
      WHERE dl.shop_id = s.id AND upper(dl.mark) = $${params.length}
    )`;
  }
  if (opts?.capabilityId?.trim()) {
    params.push(opts.capabilityId.trim());
    sql += ` AND EXISTS (
      SELECT 1 FROM repair.shop_capabilities sc
      WHERE sc.shop_id = s.id AND sc.capability_id::text = $${params.length}
    )`;
  }
  if (opts?.carTypeId?.trim()) {
    params.push(opts.carTypeId.trim());
    sql += ` AND EXISTS (
      SELECT 1 FROM repair.shop_car_types sct
      WHERE sct.shop_id = s.id AND sct.car_type_id::text = $${params.length}
    )`;
  }
  sql += ` ORDER BY s.name, s.city, s.state`;

  const { rows } = await q(sql, params);
  const pins: ShopMapPin[] = [];
  let ungeocoded = 0;

  for (const row of rows) {
    const ovLat = parseOverride(row.lat_override);
    const ovLng = parseOverride(row.lng_override);
    let lat: number | null = null;
    let lng: number | null = null;
    let coord_source: "override" | "places" | null = null;
    if (ovLat != null && ovLng != null) {
      lat = ovLat;
      lng = ovLng;
      coord_source = "override";
    } else if (row.place_lat != null && row.place_lng != null) {
      lat = Number(row.place_lat);
      lng = Number(row.place_lng);
      coord_source = "places";
    }
    if (lat == null || lng == null || !coord_source) {
      ungeocoded += 1;
      continue;
    }

    const shopId = String(row.id);
    const [lines, caps, cars, contacts] = await Promise.all([
      q(
        `SELECT dl.mark, dl.display_name, rr.name AS railroad_name
         FROM repair.shop_delivering_lines dl
         LEFT JOIN repair.railroads rr
           ON rr.tenant_id = $2 AND upper(rr.mark) = upper(dl.mark)
          AND rr.deleted_at IS NULL AND rr.active = true
         WHERE dl.shop_id = $1
         ORDER BY dl.mark`,
        [shopId, tenantId],
      ),
      q(
        `SELECT sc.capability_id::text AS id, cc.display_name
         FROM repair.shop_capabilities sc
         JOIN repair.shop_capability_codes cc ON cc.id = sc.capability_id
         WHERE sc.shop_id = $1
         ORDER BY cc.sort_order, cc.display_name`,
        [shopId],
      ),
      q(
        `SELECT sct.car_type_id::text AS id, ct.display_name
         FROM repair.shop_car_types sct
         JOIN repair.shop_car_type_codes ct ON ct.id = sct.car_type_id
         WHERE sct.shop_id = $1
         ORDER BY ct.sort_order, ct.display_name`,
        [shopId],
      ),
      q(
        `SELECT name, email, phone, role
         FROM repair.contacts
         WHERE tenant_id = $2 AND party_type = 'shop' AND party_ref = $1
           AND deleted_at IS NULL AND active = true
         ORDER BY name
         LIMIT 1`,
        [shopId, tenantId],
      ),
    ]);

    const delivering_lines = lines.rows.map((r) => {
      const mark = String(r.mark);
      const name =
        r.display_name != null
          ? String(r.display_name)
          : r.railroad_name != null
            ? String(r.railroad_name)
            : null;
      return {
        mark,
        name,
        label: name ? `${mark} – ${name}` : mark,
      };
    });

    const contact = contacts.rows[0]
      ? {
          name: String(contacts.rows[0].name),
          email:
            contacts.rows[0].email != null
              ? String(contacts.rows[0].email)
              : null,
          phone:
            contacts.rows[0].phone != null
              ? String(contacts.rows[0].phone)
              : null,
          role:
            contacts.rows[0].role != null
              ? String(contacts.rows[0].role)
              : null,
        }
      : null;

    pins.push({
      id: shopId,
      name: String(row.name),
      shop_mark: row.shop_mark != null ? String(row.shop_mark) : null,
      city: row.city != null ? String(row.city) : null,
      state: row.state != null ? String(row.state) : null,
      active: Boolean(row.active),
      lat,
      lng,
      coord_source,
      delivering_lines,
      capability_ids: caps.rows.map((r) => String(r.id)),
      capability_labels: caps.rows.map((r) => String(r.display_name)),
      car_type_ids: cars.rows.map((r) => String(r.id)),
      car_type_labels: cars.rows.map((r) => String(r.display_name)),
      primary_contact: contact,
    });
  }

  return { pins, ungeocoded };
}

/** Stream simplified NARN MultiLineString GeoJSON (gunzipped). */
export function streamRailLinesGeoJson(res: Response): void {
  if (!existsSync(RAIL_GZ)) {
    res.status(404).json({ error: "Rail overlay data missing" });
    return;
  }
  res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  createReadStream(RAIL_GZ).pipe(createGunzip()).pipe(res);
}
