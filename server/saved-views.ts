import type { Express, Request, Response } from "express";
import { parseCarPasteListDetailed } from "@shared/programs";
import { splitCarNumber } from "@shared/residco-import";
import {
  INACTIVE_NOTE_MESSAGE,
  SAVED_VIEWS_SCHEMA_MESSAGE,
  VIEWS_UNAVAILABLE_MESSAGE,
  VIEW_MEMBER_CAP,
  VIEW_MEMBER_WRITE_BATCH,
  VIEW_COUNT_TTL_MS,
  VIEW_PIN_CAP,
  abandonedListPatch,
  canonicalViewName,
  countCacheKey,
  createSkipsPasteMatch,
  filterSuppliedRailcars,
  formatEtTime,
  isMissingViewSchema,
  idsWithoutInactive,
  listChangeLogIds,
  memberNoteAllowed,
  memberReaddSnapshots,
  memberRemoveSnapshots,
  parseViewLayout,
  parseViewQuery,
  positiveIds,
  schemaProbeResult,
  snapshotBeforePatch,
  viewCreateSnapshots,
  viewDeleteSnapshots,
  nextPinOrder,
  viewCountFromSplit,
  viewCountMode,
  viewNameKey,
  viewUpdatedAtConflicts,
  viewWriteError,
  viewWriteStatus,
  type ViewKind,
  type ViewLayout,
  type ViewQuery,
} from "@shared/saved-views";
import { recordChange, recordChanges, withChangeGroupResult } from "./change-log";
import { countRailcars, parseRailcarListParams, type RailcarListParams } from "./railcar-list";
import { resolveProgramCars } from "./programs";
import { supabaseAdmin } from "./supabase";

type ViewRow = {
  id: number;
  name: string;
  kind: ViewKind;
  description: string | null;
  shared: boolean;
  pinned: boolean;
  pin_order: number | null;
  owner: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string | null;
  query: ViewQuery;
  layout: ViewLayout;
  deleted_at: string | null;
};

type Actor = { id: string; role: string };

const SCHEMA_TTL_MS = 15_000;
let schemaCache: { at: number; ready: boolean; unavailable: boolean } | null = null;
const countCache = new Map<string, { at: number; value: ViewCount }>();
const nameCache = new Map<string, string>();

export type ViewCount = { count: number; active: number; inactive: number; ms: number };

export function clearViewCountCache() {
  countCache.clear();
}

export function resetSavedViewSchemaCache() {
  schemaCache = null;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function rememberSchema(error: unknown | null) {
  const probe = schemaProbeResult(error);
  schemaCache = { at: Date.now(), ready: probe.ready, unavailable: probe.unavailable };
  return probe;
}

function notReadyMessage(): string {
  return schemaCache?.unavailable ? VIEWS_UNAVAILABLE_MESSAGE : SAVED_VIEWS_SCHEMA_MESSAGE;
}

export async function savedViewsSchemaReady(): Promise<boolean> {
  if (schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.ready;
  try {
    const { error } = await supabaseAdmin.from("car_lists").select("id, kind, deleted_at").limit(1);
    return rememberSchema(error ?? null).ready;
  } catch (error) {
    return rememberSchema(error).ready;
  }
}

async function displayName(userId: string | null | undefined): Promise<string> {
  const id = String(userId ?? "").trim();
  if (!id) return "";
  const cached = nameCache.get(id);
  if (cached) return cached;
  let name = "";
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(id);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    name = String(meta.full_name || meta.name || meta.display_name || data.user?.email || "");
  } catch {
    name = "";
  }
  if (!name) {
    const { data } = await supabaseAdmin.from("user_roles").select("email").eq("user_id", id).maybeSingle();
    name = String(data?.email ?? "");
  }
  const label = name || id;
  nameCache.set(id, label);
  return label;
}

async function nameMap(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  await Promise.all(unique.map((id) => displayName(id)));
  const out = new Map<string, string>();
  for (const id of unique) out.set(id, nameCache.get(id) ?? id);
  return out;
}

function layoutOf(raw: unknown): ViewLayout {
  const parsed = parseViewLayout(raw && Object.keys(raw as object).length ? raw : {});
  if (!parsed.ok) throw httpError(400, parsed.message);
  return parsed.layout;
}

function queryOf(raw: unknown, kind: ViewKind): ViewQuery {
  const parsed = parseViewQuery(raw, kind);
  if (!parsed.ok) throw httpError(400, parsed.message);
  return parsed.query;
}

function asView(row: Record<string, unknown>): ViewRow {
  const kind: ViewKind = row.kind === "query" ? "query" : "fixed";
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    kind,
    description: row.description == null ? null : String(row.description),
    shared: row.shared !== false,
    pinned: row.pinned === true,
    pin_order: row.pin_order == null ? null : Number(row.pin_order),
    owner: row.owner == null ? null : String(row.owner),
    updated_by: row.updated_by == null ? null : String(row.updated_by),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    created_at: row.created_at == null ? null : String(row.created_at),
    query: queryOf(row.query ?? {}, kind),
    layout: layoutOf(row.layout ?? {}),
    deleted_at: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

async function assertSchema() {
  if (!(await savedViewsSchemaReady())) throw httpError(503, notReadyMessage());
}

async function loadRow(id: number): Promise<ViewRow | null> {
  await assertSchema();
  const { data, error } = await supabaseAdmin.from("car_lists").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingViewSchema(error)) throw httpError(503, SAVED_VIEWS_SCHEMA_MESSAGE);
    throw error;
  }
  if (!data || data.deleted_at) return null;
  return asView(data as Record<string, unknown>);
}

function canRead(view: ViewRow, actor: Actor): boolean {
  return view.shared || view.owner === actor.id;
}

async function liveNames(exceptId?: number): Promise<{ id: number; name: string }[]> {
  const { data, error } = await supabaseAdmin.from("car_lists").select("id, name").is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .map((row) => ({ id: Number(row.id), name: String(row.name ?? "") }))
    .filter((row) => row.id !== exceptId);
}

async function liveMemberIds(listId: number): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("car_list_members")
    .select("railcar_id")
    .eq("list_id", listId)
    .is("removed_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0);
}

async function recordListChange(opts: {
  id: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  action: string;
  actor: string;
}) {
  const ids = listChangeLogIds(opts.id);
  await recordChange({
    table: "car_lists",
    pk: opts.id,
    before: opts.before,
    after: opts.after,
    action: opts.action,
    entity_type: "railcar",
    entity_id: ids.entity_id,
    railcar_id: ids.railcar_id,
    actor: opts.actor,
    detail: { view_id: opts.id },
  });
}

/** Hide a row whose later create step failed, so the live-name index does not keep it. */
async function abandonCreatedList(id: number) {
  if (!Number.isFinite(id) || id <= 0) return;
  try {
    const { error } = await supabaseAdmin
      .from("car_lists")
      .update(abandonedListPatch(new Date().toISOString()))
      .eq("id", id)
      .is("deleted_at", null);
    if (error) console.error("[views] half-created view left live", id, error.message ?? error.code ?? error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[views] half-created view left live", id, message);
  }
}

async function recordMemberChanges(rows: {
  id: number;
  listId: number;
  railcarId: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  action: string;
  actor: string;
}[]) {
  for (let i = 0; i < rows.length; i += VIEW_MEMBER_WRITE_BATCH) {
    const slice = rows.slice(i, i + VIEW_MEMBER_WRITE_BATCH);
    await recordChanges(slice.map((opts) => ({
      table: "car_list_members",
      pk: opts.id,
      before: opts.before,
      after: opts.after,
      action: opts.action,
      entity_type: "railcar" as const,
      entity_id: opts.railcarId,
      railcar_id: opts.railcarId,
      actor: opts.actor,
      detail: { view_id: opts.listId },
    })));
  }
}

function summary(view: ViewRow, names: Map<string, string>, memberCount: number | null) {
  return {
    id: view.id,
    name: view.name,
    kind: view.kind,
    description: view.description,
    shared: view.shared,
    pinned: view.pinned,
    pin_order: view.pin_order,
    owner: view.owner,
    owner_name: names.get(view.owner ?? "") ?? "",
    updated_by: view.updated_by,
    updated_by_name: names.get(view.updated_by ?? "") ?? "",
    updated_at: view.updated_at,
    updated_at_et: formatEtTime(view.updated_at),
    created_at: view.created_at,
    member_count: memberCount,
    query: view.query,
    layout: view.layout,
  };
}

export async function listSavedViews(actor: Actor) {
  if (!(await savedViewsSchemaReady())) {
    return { schema_ready: false as const, message: notReadyMessage(), views: [] as ReturnType<typeof summary>[] };
  }
  const { data, error } = await supabaseAdmin
    .from("car_lists")
    .select("*")
    .is("deleted_at", null)
    .or(`shared.eq.true,owner.eq.${actor.id}`)
    .order("created_at", { ascending: false });
  if (error) {
    const probe = rememberSchema(error);
    return { schema_ready: false as const, message: probe.message, views: [] };
  }
  const views = (data ?? []).map((row) => asView(row as Record<string, unknown>)).filter((view) => canRead(view, actor));
  const fixedIds = views.filter((view) => view.kind === "fixed").map((view) => view.id);
  const splits = await loadFixedMemberSplits(fixedIds);
  const counts = new Map<number, number>();
  splits.forEach((split, id) => counts.set(id, split.active + split.inactive));
  const names = await nameMap(views.flatMap((view) => [view.owner, view.updated_by]));
  return {
    schema_ready: true as const,
    views: views.map((view) => summary(view, names, view.kind === "fixed" ? counts.get(view.id) ?? 0 : null)),
  };
}

export async function getSavedView(id: number, actor: Actor) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  const names = await nameMap([view.owner, view.updated_by]);
  let members: { railcar_id: number; note: string | null; sort_order: number | null; active: boolean | null }[] = [];
  if (view.kind === "fixed") {
    const { data, error } = await supabaseAdmin
      .from("car_list_members")
      .select("railcar_id, note, sort_order")
      .eq("list_id", id)
      .is("removed_at", null);
    if (error) throw error;
    const ids = (data ?? []).map((row) => Number(row.railcar_id));
    const active = new Map<number, boolean | null>();
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data: cars, error: carError } = await supabaseAdmin.from("railcars").select("id, active").in("id", slice);
      if (carError) throw carError;
      for (const car of cars ?? []) active.set(Number(car.id), car.active == null ? null : car.active !== false);
    }
    members = (data ?? []).map((row) => ({
      railcar_id: Number(row.railcar_id),
      note: row.note == null ? null : String(row.note),
      sort_order: row.sort_order == null ? null : Number(row.sort_order),
      active: active.get(Number(row.railcar_id)) ?? null,
    }));
  }
  return { ...summary(view, names, view.kind === "fixed" ? members.length : null), query: view.query, layout: view.layout, members };
}

async function matchPaste(text: string) {
  const detailed = parseCarPasteListDetailed(text);
  const tokens = detailed.tokens;
  if (tokens.length > VIEW_MEMBER_CAP) throw httpError(400, `A view can hold at most ${VIEW_MEMBER_CAP.toLocaleString()} cars`);
  const resolved = await resolveProgramCars({ text: tokens.join("\n") });
  const ordered: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  for (const match of resolved.matched) push(match.railcar_id);
  for (const row of resolved.ambiguous) {
    if (splitCarNumber(row.token).reporting_marks) continue;
    for (const match of row.matches) push(match.railcar_id);
  }
  const ambiguous = resolved.ambiguous
    .filter((row) => Boolean(splitCarNumber(row.token).reporting_marks))
    .map((row) => ({
      token: row.token,
      matches: row.matches.map((match) => ({ id: match.railcar_id, label: match.label })),
    }));
  const cars: { id: number; active: boolean }[] = [];
  for (let i = 0; i < ordered.length; i += 200) {
    const slice = ordered.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("railcars").select("id, active").in("id", slice);
    if (error) throw error;
    for (const car of data ?? []) cars.push({ id: Number(car.id), active: car.active !== false });
  }
  return {
    ids: cars.map((car) => car.id),
    inactiveIds: cars.filter((car) => !car.active).map((car) => car.id),
    notFound: resolved.not_found.map((row) => row.token),
    ambiguous,
    pasted: tokens.length,
  };
}

function stamp(actor: string) {
  return { updated_at: new Date().toISOString(), updated_by: actor };
}

function mergeUnmatched(existing: string[] | undefined, extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of [...(existing ?? []), ...extra]) {
    const value = String(token).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 500) break;
  }
  return out;
}

/** One railcars read per 200 ids. Extra chunks run at the same time. */
async function loadSuppliedCars(ids: number[]) {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += VIEW_MEMBER_WRITE_BATCH) {
    chunks.push(ids.slice(i, i + VIEW_MEMBER_WRITE_BATCH));
  }
  const batches = await Promise.all(
    chunks.map(async (slice) => {
      const { data, error } = await supabaseAdmin
        .from("railcars")
        .select("id, active, reporting_marks, car_number")
        .in("id", slice);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: Number(row.id),
        active: row.active == null ? null : row.active !== false,
        reporting_marks: row.reporting_marks == null ? null : String(row.reporting_marks),
        car_number: row.car_number == null ? null : String(row.car_number),
      }));
    }),
  );
  return batches.flat();
}

export async function createSavedView(actor: Actor, body: Record<string, unknown>) {
  const started = Date.now();
  let memberCount = 0;
  try {
  await assertSchema();
  const kind: ViewKind = body.kind === "query" ? "query" : "fixed";
  const shared = body.shared === false ? false : true;
  const action = shared ? "create_shared" : "create_private";
  if (viewWriteStatus({ role: actor.role, action })) throw httpError(403, "Forbidden");
  const name = canonicalViewName(String(body.name ?? ""));
  if (!name) throw httpError(400, "Name is required");
  if (name.length > 80) throw httpError(400, "Name is too long");
  const layout = layoutOf(body.layout ?? {});
  let query = queryOf(body.query ?? {}, kind);
  let railcarIds: number[] = Array.isArray(body.railcar_ids) ? body.railcar_ids.map(Number).filter((id) => id > 0) : [];
  let paste: Awaited<ReturnType<typeof matchPaste>> | null = null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (kind === "fixed" && createSkipsPasteMatch(body)) {
    const requested = positiveIds(body.railcar_ids).slice(0, VIEW_MEMBER_CAP);
    const pasteText = query.q.trim() || text;
    const found = await loadSuppliedCars(requested);
    const filtered = filterSuppliedRailcars({ requestedIds: requested, cars: found, pasteText });
    railcarIds = filtered.ids;
    const unmatched = mergeUnmatched(query.unmatched, filtered.unmatched);
    query = { ...query, source: "paste", q: query.q || text, unmatched };
    paste = {
      ids: railcarIds,
      inactiveIds: filtered.inactiveIds,
      notFound: unmatched,
      ambiguous: query.ambiguous ?? [],
      pasted: pasteText ? pasteText.split(/\s+/).length : railcarIds.length,
    };
  } else if (kind === "fixed" && text) {
    paste = await matchPaste(text);
    railcarIds = paste.ids;
    query = {
      ...query,
      source: "paste",
      q: text,
      unmatched: paste.notFound,
      ambiguous: paste.ambiguous,
    };
  }
  // A paste create keeps inactive cars. Graymont is 29 active plus 406 and 416.
  railcarIds = Array.from(new Set(railcarIds)).slice(0, VIEW_MEMBER_CAP);
  memberCount = railcarIds.length;
  if (railcarIds.length > VIEW_MEMBER_CAP) throw httpError(400, `A view can hold at most ${VIEW_MEMBER_CAP.toLocaleString()} cars`);
  const pinned = body.pinned !== false;
  let pinOrder: number | null = null;
  if (pinned) {
    const { count, error: countError } = await supabaseAdmin
      .from("car_lists")
      .select("id", { count: "exact", head: true })
      .eq("pinned", true)
      .is("deleted_at", null);
    if (countError) throw countError;
    if ((count ?? 0) >= VIEW_PIN_CAP) throw httpError(400, `Pin at most ${VIEW_PIN_CAP} views`);
    const { data: orders, error: orderError } = await supabaseAdmin
      .from("car_lists")
      .select("pin_order")
      .eq("pinned", true)
      .is("deleted_at", null);
    if (orderError) throw orderError;
    pinOrder = nextPinOrder((orders ?? []).map((row) => row.pin_order as number | null));
  }
  const hiddenAt = new Date().toISOString();
  const result = await withChangeGroupResult(actor.id, async () => {
    const { data, error } = await supabaseAdmin
      .from("car_lists")
      .insert({
        name,
        kind,
        description: body.description == null ? null : String(body.description).slice(0, 500),
        owner: actor.id,
        shared,
        query,
        layout,
        pinned,
        pin_order: pinOrder,
        ...stamp(actor.id),
        deleted_at: null,
      })
      .select("*")
      .single();
    if (error) {
      if (String(error.code) === "23505") throw httpError(409, "A view with that name already exists");
      throw error;
    }
    const row = data as Record<string, unknown>;
    const id = Number(row.id);
    try {
      const snaps = viewCreateSnapshots(row, hiddenAt);
      await recordListChange({
        id,
        before: snaps.before,
        after: snaps.after,
        action: "view_create",
        actor: actor.id,
      });
      const members = [];
      for (let i = 0; i < railcarIds.length; i += VIEW_MEMBER_WRITE_BATCH) {
        const slice = railcarIds.slice(i, i + VIEW_MEMBER_WRITE_BATCH).map((railcar_id, index) => ({
          list_id: row.id,
          railcar_id,
          added_by: actor.id,
          sort_order: i + index,
          note: null,
          removed_at: null,
        }));
        const { data: inserted, error: memberError } = await supabaseAdmin.from("car_list_members").insert(slice).select("*");
        if (memberError) throw memberError;
        const insertedMembers = inserted ?? [];
        await recordMemberChanges(insertedMembers.map((member) => ({
          id: Number(member.id),
          listId: Number(row.id),
          railcarId: Number(member.railcar_id),
          before: {},
          after: member as Record<string, unknown>,
          action: "view_member_add",
          actor: actor.id,
        })));
        for (const member of insertedMembers) members.push(member);
      }
      clearViewCountCache();
      return { view: asView(row), members, paste };
    } catch (later) {
      await abandonCreatedList(id);
      throw later;
    }
  });
  return result;
  } finally {
    console.log(`[views] create ms=${Date.now() - started} n=${memberCount}`);
  }
}

export async function patchSavedView(id: number, actor: Actor, body: Record<string, unknown>) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  if (viewWriteStatus({ role: actor.role, action: "update" })) throw httpError(403, "Forbidden");
  if (viewUpdatedAtConflicts(view.updated_at, body.expected_updated_at == null ? "" : String(body.expected_updated_at))) {
    const who = await displayName(view.updated_by);
    throw httpError(409, `Changed by ${who || "someone else"} at ${formatEtTime(view.updated_at)}. Reload, or Save as a copy.`);
  }
  const patch: Record<string, unknown> = { ...stamp(actor.id) };
  if (body.name != null) {
    const name = canonicalViewName(String(body.name));
    if (!name) throw httpError(400, "Name is required");
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description == null ? null : String(body.description).slice(0, 500);
  if (body.query != null) patch.query = queryOf(body.query, view.kind);
  if (body.layout != null) patch.layout = layoutOf(body.layout);
  if (body.shared != null) patch.shared = body.shared !== false;
  if (body.pinned != null) patch.pinned = body.pinned === true;
  if (body.pin_order != null) patch.pin_order = Number(body.pin_order);
  if (body.pinned === true && body.pin_order == null) {
    if (!view.pinned) {
      const { count, error: countError } = await supabaseAdmin
        .from("car_lists")
        .select("id", { count: "exact", head: true })
        .eq("pinned", true)
        .is("deleted_at", null);
      if (countError) throw countError;
      if ((count ?? 0) >= VIEW_PIN_CAP) throw httpError(400, `Pin at most ${VIEW_PIN_CAP} views`);
    }
    if (view.pinned && view.pin_order != null) {
      patch.pin_order = view.pin_order;
    } else {
      const { data: orders, error: orderError } = await supabaseAdmin
        .from("car_lists")
        .select("pin_order")
        .eq("pinned", true)
        .is("deleted_at", null);
      if (orderError) throw orderError;
      patch.pin_order = nextPinOrder((orders ?? []).map((row) => row.pin_order as number | null));
    }
  }
  if (body.pinned === false) patch.pin_order = null;
  const before = snapshotBeforePatch(view as unknown as Record<string, unknown>, patch);
  const result = await withChangeGroupResult(actor.id, async () => {
    const { data, error } = await supabaseAdmin.from("car_lists").update(patch).eq("id", id).select("*").single();
    if (error) {
      if (String(error.code) === "23505") throw httpError(409, "A view with that name already exists");
      throw error;
    }
    await recordListChange({
      id,
      before,
      after: patch,
      action: "view_update",
      actor: actor.id,
    });
    clearViewCountCache();
    return asView(data as Record<string, unknown>);
  });
  return result;
}

export async function duplicateSavedView(id: number, actor: Actor, body: Record<string, unknown>) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  const shared = body.shared === true ? true : body.shared === false ? false : false;
  if (viewWriteStatus({ role: actor.role, action: shared ? "create_shared" : "create_private" })) {
    throw httpError(403, "Forbidden");
  }
  const ids = view.kind === "fixed" ? await liveMemberIds(id) : [];
  const name = canonicalViewName(String(body.name ?? `${view.name} copy`));
  return createSavedView(actor, {
    name,
    kind: view.kind,
    description: body.description ?? view.description,
    query: view.query,
    layout: body.layout ?? view.layout,
    shared,
    pinned: body.pinned === true,
    railcar_ids: ids,
  });
}

export async function deleteSavedView(id: number, actor: Actor) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  if (viewWriteStatus({ role: actor.role, action: "delete", actorId: actor.id, ownerId: view.owner })) {
    throw httpError(403, "Forbidden");
  }
  const hiddenAt = new Date().toISOString();
  const snaps = viewDeleteSnapshots(hiddenAt);
  return withChangeGroupResult(actor.id, async () => {
    const { error } = await supabaseAdmin.from("car_lists").update({ deleted_at: hiddenAt, ...stamp(actor.id) }).eq("id", id);
    if (error) throw error;
    await recordListChange({ id, before: snaps.before, after: snaps.after, action: "view_delete", actor: actor.id });
    clearViewCountCache();
    return { id, deleted_at: hiddenAt };
  });
}

async function recordListStamp(view: ViewRow, actor: Actor) {
  const next = stamp(actor.id);
  const { error } = await supabaseAdmin.from("car_lists").update(next).eq("id", view.id);
  if (error) throw error;
  await recordListChange({
    id: view.id,
    before: { updated_at: view.updated_at, updated_by: view.updated_by },
    after: next,
    action: "view_update",
    actor: actor.id,
  });
}

/** Selected ids only. Inactive cars stay in the view and are not added from a checkbox. */
async function withoutInactive(ids: number[]): Promise<number[]> {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  if (!unique.length) return [];
  const inactive = new Set<number>();
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("railcars").select("id, active").in("id", slice);
    if (error) throw error;
    for (const car of data ?? []) {
      if (car.active === false) inactive.add(Number(car.id));
    }
  }
  return idsWithoutInactive(unique, inactive);
}

async function addMemberIds(listId: number, actor: Actor, ids: number[]) {
  const existing = await supabaseAdmin
    .from("car_list_members")
    .select("id, railcar_id, removed_at")
    .eq("list_id", listId)
    .in("railcar_id", ids.length ? ids : [-1]);
  const { data: prior, error } = await existing;
  if (error) throw error;
  const byCar = new Map((prior ?? []).map((row) => [Number(row.railcar_id), row]));
  const live = new Set(await liveMemberIds(listId));
  const room = VIEW_MEMBER_CAP - live.size;
  const readd: { id: number; railcarId: number; removedAt: string }[] = [];
  const fresh: number[] = [];
  for (const railcarId of ids) {
    if (live.has(railcarId)) continue;
    if (readd.length + fresh.length >= room) throw httpError(400, `A view can hold at most ${VIEW_MEMBER_CAP.toLocaleString()} cars`);
    const previous = byCar.get(railcarId);
    if (previous?.removed_at) readd.push({ id: Number(previous.id), railcarId, removedAt: String(previous.removed_at) });
    else if (!previous) fresh.push(railcarId);
    live.add(railcarId);
  }
  const addedAt = new Date().toISOString();
  for (let i = 0; i < fresh.length; i += VIEW_MEMBER_WRITE_BATCH) {
    const slice = fresh.slice(i, i + VIEW_MEMBER_WRITE_BATCH).map((railcar_id) => ({
      list_id: listId,
      railcar_id,
      added_by: actor.id,
      removed_at: null,
    }));
    const { data, error: insertError } = await supabaseAdmin.from("car_list_members").insert(slice).select("*");
    if (insertError) throw insertError;
    await recordMemberChanges((data ?? []).map((member) => ({
      id: Number(member.id),
      listId,
      railcarId: Number(member.railcar_id),
      before: {},
      after: member as Record<string, unknown>,
      action: "view_member_add",
      actor: actor.id,
    })));
  }
  for (let i = 0; i < readd.length; i += VIEW_MEMBER_WRITE_BATCH) {
    const slice = readd.slice(i, i + VIEW_MEMBER_WRITE_BATCH);
    const { error: updateError } = await supabaseAdmin
      .from("car_list_members")
      .update({ removed_at: null, added_by: actor.id, added_at: addedAt })
      .in("id", slice.map((row) => row.id));
    if (updateError) throw updateError;
    await recordMemberChanges(slice.map((row) => {
      const snaps = memberReaddSnapshots(row.removedAt);
      return {
        id: row.id,
        listId,
        railcarId: row.railcarId,
        before: snaps.before,
        after: snaps.after,
        action: "view_member_add",
        actor: actor.id,
      };
    }));
  }
  return readd.length + fresh.length;
}

export async function addViewMembers(id: number, actor: Actor, body: Record<string, unknown>) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  if (view.kind !== "fixed") throw httpError(400, "Only a fixed list can take cars");
  if (viewWriteStatus({ role: actor.role, action: "members" })) throw httpError(403, "Forbidden");
  let ids = Array.isArray(body.ids) ? await withoutInactive(body.ids.map(Number)) : [];
  let paste: Awaited<ReturnType<typeof matchPaste>> | null = null;
  if (typeof body.text === "string" && body.text.trim()) {
    paste = await matchPaste(body.text);
    ids = Array.from(new Set([...ids, ...paste.ids]));
  }
  const result = await withChangeGroupResult(actor.id, async () => {
    const added = await addMemberIds(id, actor, ids);
    await recordListStamp(view, actor);
    clearViewCountCache();
    return { added, paste };
  });
  return result;
}

export async function removeViewMembers(id: number, actor: Actor, ids: number[]) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  if (view.kind !== "fixed") throw httpError(400, "Only a fixed list has cars to remove");
  if (viewWriteStatus({ role: actor.role, action: "members" })) throw httpError(403, "Forbidden");
  const unique = await withoutInactive(ids);
  const hiddenAt = new Date().toISOString();
  return withChangeGroupResult(actor.id, async () => {
    const { data, error } = await supabaseAdmin
      .from("car_list_members")
      .select("id, railcar_id, removed_at")
      .eq("list_id", id)
      .in("railcar_id", unique.length ? unique : [-1])
      .is("removed_at", null);
    if (error) throw error;
    const snaps = memberRemoveSnapshots(hiddenAt);
    const rows = data ?? [];
    for (let i = 0; i < rows.length; i += VIEW_MEMBER_WRITE_BATCH) {
      const slice = rows.slice(i, i + VIEW_MEMBER_WRITE_BATCH);
      const { error: updateError } = await supabaseAdmin
        .from("car_list_members")
        .update({ removed_at: hiddenAt })
        .in("id", slice.map((row) => Number(row.id)));
      if (updateError) throw updateError;
      await recordMemberChanges(slice.map((row) => ({
        id: Number(row.id),
        listId: id,
        railcarId: Number(row.railcar_id),
        before: snaps.before,
        after: snaps.after,
        action: "view_member_remove",
        actor: actor.id,
      })));
    }
    await recordListStamp(view, actor);
    clearViewCountCache();
    return { removed: (data ?? []).length };
  });
}

export async function patchMemberNote(id: number, railcarId: number, actor: Actor, note: string) {
  const view = await loadRow(id);
  if (!view || !canRead(view, actor)) throw httpError(404, "View not found");
  if (viewWriteStatus({ role: actor.role, action: "note" })) throw httpError(403, "Forbidden");
  const { data: car, error: carError } = await supabaseAdmin.from("railcars").select("id, active").eq("id", railcarId).maybeSingle();
  if (carError) throw carError;
  if (!car) throw httpError(404, "Car not found");
  const allowed = memberNoteAllowed(car.active !== false);
  if (!allowed.ok) throw httpError(allowed.status, allowed.message || INACTIVE_NOTE_MESSAGE);
  const { data: member, error } = await supabaseAdmin
    .from("car_list_members")
    .select("id, note, removed_at")
    .eq("list_id", id)
    .eq("railcar_id", railcarId)
    .maybeSingle();
  if (error) throw error;
  if (!member || member.removed_at) throw httpError(404, "Car is not in this view");
  const next = note.trim().slice(0, 240) || null;
  return withChangeGroupResult(actor.id, async () => {
    const { error: updateError } = await supabaseAdmin.from("car_list_members").update({ note: next }).eq("id", member.id);
    if (updateError) throw updateError;
    await recordMemberChanges([{
      id: Number(member.id),
      listId: id,
      railcarId,
      before: { note: member.note ?? null },
      after: { note: next },
      action: "view_member_note",
      actor: actor.id,
    }]);
    clearViewCountCache();
    return { railcar_id: railcarId, note: next };
  });
}

export async function orderPins(actor: Actor, order: number[]) {
  if (viewWriteStatus({ role: actor.role, action: "pin" })) throw httpError(403, "Forbidden");
  const ids = Array.from(new Set(order.map(Number).filter((id) => id > 0))).slice(0, VIEW_PIN_CAP);
  if (order.length > VIEW_PIN_CAP) throw httpError(400, `Pin at most ${VIEW_PIN_CAP} views`);
  await assertSchema();
  const { data, error } = await supabaseAdmin.from("car_lists").select("id, pinned, pin_order").is("deleted_at", null).eq("pinned", true);
  if (error) throw error;
  return withChangeGroupResult(actor.id, async () => {
    const pinnedNow = new Set((data ?? []).map((row) => Number(row.id)));
    for (const row of data ?? []) {
      if (ids.includes(Number(row.id))) continue;
      await supabaseAdmin.from("car_lists").update({ pinned: false, pin_order: null, ...stamp(actor.id) }).eq("id", row.id);
      await recordListChange({
        id: Number(row.id),
        before: { pinned: true, pin_order: row.pin_order },
        after: { pinned: false, pin_order: null },
        action: "view_update",
        actor: actor.id,
      });
    }
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const prior = (data ?? []).find((row) => Number(row.id) === id);
      await supabaseAdmin.from("car_lists").update({ pinned: true, pin_order: index, ...stamp(actor.id) }).eq("id", id).is("deleted_at", null);
      await recordListChange({
        id,
        before: { pinned: prior ? true : false, pin_order: prior?.pin_order ?? null },
        after: { pinned: true, pin_order: index },
        action: "view_update",
        actor: actor.id,
      });
      pinnedNow.add(id);
    }
    clearViewCountCache();
    return { order: ids };
  });
}

function paramsFromView(view: ViewRow): RailcarListParams {
  const filters = view.layout.filters;
  const queryFilters = view.query.filters;
  const active = view.layout.showInactive ? "all" : filters.active || queryFilters.active || "active";
  return parseRailcarListParams({
    search: view.kind === "query" ? view.query.q : undefined,
    fleet: view.query.fleet ? "1" : "0",
    search_cars: view.query.scope.cars ? "1" : "0",
    search_leases: view.query.scope.leases ? "1" : "0",
    search_car_data: view.query.scope.carData ? "1" : "0",
    type: filters.type || queryFilters.type,
    mech: filters.mech || queryFilters.mech,
    aar: filters.aar || queryFilters.aar,
    entity: filters.entity || queryFilters.entity,
    status: filters.status || queryFilters.status,
    active,
    open_stop: filters.open_stop || queryFilters.open_stop,
    program: filters.program || queryFilters.program,
    tag: filters.tag || queryFilters.tag,
    pageSize: view.layout.pageSize,
  });
}

function missingCountFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  if (code === "42883" || code === "PGRST202") return true;
  return /rlms_saved_view_member_counts/i.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

/** Active and inactive cars for every fixed list, in one database call when the function exists. */
async function loadFixedMemberSplits(ids: number[]): Promise<Map<number, { active: number; inactive: number }>> {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  const out = new Map<number, { active: number; inactive: number }>();
  for (const id of unique) out.set(id, { active: 0, inactive: 0 });
  if (!unique.length) return out;
  const rpc = await supabaseAdmin.rpc("rlms_saved_view_member_counts", { p_list_ids: unique });
  if (!rpc.error) {
    for (const row of (rpc.data ?? []) as { list_id?: number; active_count?: number; inactive_count?: number }[]) {
      out.set(Number(row.list_id), {
        active: Number(row.active_count ?? 0),
        inactive: Number(row.inactive_count ?? 0),
      });
    }
    return out;
  }
  if (!missingCountFunction(rpc.error)) throw rpc.error;
  const { data: members, error } = await supabaseAdmin
    .from("car_list_members")
    .select("list_id, railcar_id")
    .in("list_id", unique)
    .is("removed_at", null);
  if (error) throw error;
  const railcarIds = Array.from(new Set((members ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0)));
  const activeById = new Map<number, boolean>();
  for (let i = 0; i < railcarIds.length; i += 200) {
    const slice = railcarIds.slice(i, i + 200);
    const { data, error: carError } = await supabaseAdmin.from("railcars").select("id, active").in("id", slice);
    if (carError) throw carError;
    for (const car of data ?? []) activeById.set(Number(car.id), car.active !== false);
  }
  for (const row of members ?? []) {
    const split = out.get(Number(row.list_id));
    if (!split) continue;
    const active = activeById.get(Number(row.railcar_id));
    if (active === false) split.inactive += 1;
    else if (active === true) split.active += 1;
  }
  return out;
}

function countForView(view: ViewRow, active: number, inactive: number, started: number): ViewCount {
  const mode = viewCountMode(view.layout.showInactive, view.layout.filters.active);
  return { ...viewCountFromSplit(active, inactive, mode), ms: Date.now() - started };
}

async function countQueryView(view: ViewRow): Promise<ViewCount> {
  const started = Date.now();
  const base = paramsFromView(view);
  const [active, inactive] = await Promise.all([
    countRailcars({ ...base, active: "active" }),
    countRailcars({ ...base, active: "inactive" }),
  ]);
  return countForView(view, active, inactive, started);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function countSavedViews(ids: number[], actor: Actor) {
  if (!(await savedViewsSchemaReady())) {
    return { schema_ready: false as const, message: notReadyMessage(), counts: {} as Record<string, ViewCount | null> };
  }
  const unique = Array.from(new Set(ids.map(Number).filter((id) => id > 0))).slice(0, VIEW_PIN_CAP);
  const started = Date.now();
  let cold = 0;
  let cached = 0;
  const counts: Record<string, ViewCount | null> = {};
  for (const id of unique) counts[String(id)] = null;
  const { data, error } = await supabaseAdmin.from("car_lists").select("*").in("id", unique.length ? unique : [-1]).is("deleted_at", null);
  if (error) {
    if (isMissingViewSchema(error)) {
      return { schema_ready: false as const, message: SAVED_VIEWS_SCHEMA_MESSAGE, counts };
    }
    throw error;
  }
  const views = (data ?? []).map((row) => asView(row as Record<string, unknown>)).filter((view) => canRead(view, actor));
  const pending: ViewRow[] = [];
  for (const view of views) {
    const key = countCacheKey(view.id, view.updated_at, view.layout.showInactive, view.layout.filters.active);
    const hit = countCache.get(key);
    if (hit && Date.now() - hit.at < VIEW_COUNT_TTL_MS) {
      cached += 1;
      counts[String(view.id)] = hit.value;
      continue;
    }
    pending.push(view);
  }
  cold = pending.length;
  const fixed = pending.filter((view) => view.kind === "fixed");
  const queries = pending.filter((view) => view.kind === "query");
  const [splits] = await Promise.all([
    loadFixedMemberSplits(fixed.map((view) => view.id)),
    Promise.all(queries.map(async (view) => {
      const value = await withTimeout(countQueryView(view), 5000);
      if (value) {
        const key = countCacheKey(view.id, view.updated_at, view.layout.showInactive, view.layout.filters.active);
        countCache.set(key, { at: Date.now(), value });
      }
      counts[String(view.id)] = value;
    })),
  ]);
  for (const view of fixed) {
    const split = splits.get(view.id) ?? { active: 0, inactive: 0 };
    const value = countForView(view, split.active, split.inactive, started);
    const key = countCacheKey(view.id, view.updated_at, view.layout.showInactive, view.layout.filters.active);
    countCache.set(key, { at: Date.now(), value });
    counts[String(view.id)] = value;
  }
  console.log(`[search] views/counts n=${unique.length} cold=${cold} cached=${cached} ms=${Date.now() - started}`);
  return { schema_ready: true as const, counts };
}

export async function nameAvailable(name: string, exceptId?: number) {
  if (!(await savedViewsSchemaReady())) return { schema_ready: false, available: false, message: notReadyMessage() };
  const canonical = canonicalViewName(name);
  if (!canonical) return { schema_ready: true, available: false };
  const names = await liveNames(exceptId);
  return { schema_ready: true, available: !names.some((row) => viewNameKey(row.name) === viewNameKey(canonical)), name: canonical };
}

function has(raw: Record<string, unknown>, key: string) {
  return raw[key] != null && String(raw[key]).trim() !== "";
}

/** `view_id` on the railcars list, ids, summary, and export. */
export async function applyViewToParams(params: RailcarListParams, raw: Record<string, unknown>): Promise<RailcarListParams> {
  const viewId = Number(raw.view_id);
  if (!Number.isFinite(viewId) || viewId <= 0) return params;
  if (!(await savedViewsSchemaReady())) throw httpError(503, notReadyMessage());
  const { data, error } = await supabaseAdmin.from("car_lists").select("*").eq("id", viewId).maybeSingle();
  if (error) {
    if (isMissingViewSchema(error)) throw httpError(503, SAVED_VIEWS_SCHEMA_MESSAGE);
    throw error;
  }
  if (!data || data.deleted_at) throw httpError(404, "View not found");
  const view = asView(data as Record<string, unknown>);
  const next: RailcarListParams = { ...params, viewId: view.id };
  if (raw.focus === "1" || raw.focus === "true" || raw.focus === "yes") next.focus = true;
  if (view.kind === "fixed") {
    const ids = await liveMemberIds(view.id);
    const limited = ids.length ? ids : [-1];
    next.ids = params.ids?.length ? limited.filter((id) => params.ids!.includes(id)) : limited;
    if (!has(raw, "active")) next.active = view.layout.showInactive ? "all" : view.layout.filters.active || "all";
    return next;
  }
  const stored = paramsFromView(view);
  if (!has(raw, "search") && stored.search) next.search = stored.search;
  if (!has(raw, "type") && !has(raw, "car_type") && stored.carType) next.carType = stored.carType;
  if (!has(raw, "mech") && stored.mech) next.mech = stored.mech;
  if (!has(raw, "aar") && stored.aar) next.aar = stored.aar;
  if (!has(raw, "entity") && stored.entity) next.entity = stored.entity;
  if (!has(raw, "status") && stored.status) next.status = stored.status;
  if (!has(raw, "open_stop") && stored.openStop) next.openStop = stored.openStop;
  if (!has(raw, "program") && stored.program) next.program = stored.program;
  if (!has(raw, "tag") && stored.tag) next.tag = stored.tag;
  if (!has(raw, "active")) next.active = stored.active;
  if (!has(raw, "fleet")) next.fleetCodes = stored.fleetCodes;
  if (!has(raw, "search_cars") && stored.searchScope) next.searchScope = stored.searchScope;
  return next;
}

function actorFrom(req: Request): Actor | null {
  const id = req.authUser?.id;
  if (!id) return null;
  return { id, role: req.authRole || "viewer" };
}

function sendError(res: Response, error: unknown) {
  if (isMissingViewSchema(error)) {
    schemaCache = { at: Date.now(), ready: false, unavailable: false };
  }
  const { status, ...body } = viewWriteError(error);
  res.status(status).json(body);
}

export function registerSavedViewRoutes(
  app: Express,
  requireUser: (req: Request, res: Response) => Promise<string | null>,
) {
  app.get("/api/views", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await listSavedViews(actor));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/views/counts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      const ids = String(req.query.ids ?? "").split(/[,\s]+/).map(Number);
      res.json(await countSavedViews(ids, actor));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/views/available", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const except = Number(req.query.except);
      res.json(await nameAvailable(String(req.query.name ?? ""), Number.isFinite(except) ? except : undefined));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/views/pins", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : [];
      res.json(await orderPins(actor, order));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/views/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await getSavedView(Number(req.params.id), actor));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/views", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await createSavedView(actor, req.body ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/views/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await patchSavedView(Number(req.params.id), actor, req.body ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/views/:id/duplicate", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await duplicateSavedView(Number(req.params.id), actor, req.body ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/views/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await deleteSavedView(Number(req.params.id), actor));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/views/:id/members", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await addViewMembers(Number(req.params.id), actor, req.body ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/views/:id/members/remove", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      res.json(await removeViewMembers(Number(req.params.id), actor, ids));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/views/:id/members/:railcarId", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const actor = actorFrom(req);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      res.json(await patchMemberNote(Number(req.params.id), Number(req.params.railcarId), actor, String(req.body?.note ?? "")));
    } catch (error) {
      sendError(res, error);
    }
  });
}

/** Old list routes keep working and share this code. */
export async function legacyListCarLists(actorId: string) {
  const listed = await listSavedViews({ id: actorId, role: "viewer" });
  if (!listed.schema_ready) {
    const { data, error } = await supabaseAdmin
      .from("car_lists")
      .select("*")
      .or(`owner.eq.${actorId},shared.eq.true`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  return listed.views;
}
