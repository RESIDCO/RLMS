import { formatCarId, type CarIdInput } from "@shared/residco-import";

/**
 * Identity fields a car-list row may already have. Read-only: this module
 * never writes, never touches the query cache, and never builds a request.
 */
export type CopyCarIdentity = CarIdInput & {
  marks?: string | null;
  mark?: string | null;
  number?: string | null;
  id?: number | string | null;
  railcar_id?: number | string | null;
};

export type CopyCarsMode = "selected" | "all";

export type CopyCarsResolution<T> = {
  mode: CopyCarsMode;
  rows: T[];
  fetchedAll: boolean;
};

/** "MARK NUMBER", using the fleet display formatter (e.g. "OFOX 310100"). */
export function copyCarLine(car: CopyCarIdentity | string | null | undefined): string {
  if (car == null) return "";
  if (typeof car === "string") return formatCarId(car).trim();
  const mark = String(car.reporting_marks ?? car.marks ?? car.car_initial ?? car.mark ?? "").trim();
  const number = String(car.car_number ?? car.number ?? "").trim();
  if (!mark && !number) {
    const combined = String(car.car ?? "").trim();
    return combined ? formatCarId(combined).trim() : "";
  }
  return formatCarId({
    reporting_marks: mark || null,
    car_number: number || null,
    car_initial: car.car_initial ?? null,
  }).trim();
}

/** Drop blanks and later copies of the same line. First-seen order is kept. */
function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    unique.push(line);
  }
  return unique;
}

/** One car per line. Blank identities are omitted. Duplicate lines are dropped. */
export function formatCarsClipboard(cars: readonly (CopyCarIdentity | string | null | undefined)[]): string {
  return uniqueLines(cars.map((car) => copyCarLine(car))).join("\n");
}

export function formatCopyRows<T>(
  rows: readonly T[],
  lineOf?: (row: T) => CopyCarIdentity | string | null | undefined,
): string {
  if (!lineOf) return formatCarsClipboard(rows as readonly CopyCarIdentity[]);
  return formatCarsClipboard(rows.map((row) => lineOf(row)));
}

export function copiedCarCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

/** Toast title. One car is singular; every other count, including zero, is plural. */
export function copyCarsToastTitle(count: number): string {
  return count === 1 ? "Copied 1 car" : `Copied ${count} cars`;
}

function defaultIdOf<T>(row: T): number | string | null | undefined {
  const record = row as { id?: number | string | null; railcar_id?: number | string | null };
  return record.id ?? record.railcar_id ?? null;
}

function selectedIdList(selectedIds: Iterable<number | string> | null | undefined): string[] {
  if (!selectedIds) return [];
  return Array.from(selectedIds)
    .filter((id) => id != null && String(id) !== "")
    .map((id) => String(id));
}

/**
 * Checked rows win, in the order of the list they came from.
 * Otherwise the full filtered result. When the in-memory rows are only a
 * page (or a checked id is on another page), `loadAll` supplies the filtered
 * set. Callers must make `loadAll` a read-only GET.
 */
export async function resolveCarsToCopy<T>(input: {
  rows: readonly T[];
  selectedIds?: Iterable<number | string> | null;
  idOf?: (row: T) => number | string | null | undefined;
  totalCount?: number | null;
  loadAll?: () => Promise<readonly T[]>;
}): Promise<CopyCarsResolution<T>> {
  const idOf = input.idOf ?? defaultIdOf;
  const selectedList = selectedIdList(input.selectedIds);
  const selected = new Set(selectedList);
  const pick = (source: readonly T[]) =>
    source.filter((row) => {
      const id = idOf(row);
      return id != null && selected.has(String(id));
    });

  if (selected.size > 0) {
    const onHand = pick(input.rows);
    const have = new Set(
      onHand.map((row) => {
        const id = idOf(row);
        return id == null ? "" : String(id);
      }),
    );
    const missing = selectedList.some((id) => !have.has(id));
    if (!missing || !input.loadAll) {
      return { mode: "selected", rows: onHand, fetchedAll: false };
    }
    const all = await input.loadAll();
    return { mode: "selected", rows: pick(all), fetchedAll: true };
  }

  const total = input.totalCount;
  const needsRest = Boolean(input.loadAll) && (total == null || total > input.rows.length);
  if (needsRest && input.loadAll) {
    const all = await input.loadAll();
    return { mode: "all", rows: [...all], fetchedAll: true };
  }
  return { mode: "all", rows: [...input.rows], fetchedAll: false };
}

/** Walk an existing paged read until `total` rows are collected. */
export async function collectPages<T>(
  loadPage: (page: number, pageSize: number) => Promise<{ rows: readonly T[]; total: number }>,
  pageSize = 500,
): Promise<T[]> {
  const size = Math.max(1, pageSize);
  const out: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let page = 1; page <= 400 && out.length < total; page += 1) {
    const body = await loadPage(page, size);
    const batch = body.rows ?? [];
    if (Number.isFinite(body.total)) total = body.total;
    out.push(...batch);
    if (batch.length === 0) break;
  }
  return out;
}

/**
 * Clipboard write. Tries navigator.clipboard.writeText, then a hidden
 * textarea + document.execCommand("copy").
 */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permission or insecure context: fall through to the textarea path.
  }
  if (typeof document === "undefined") {
    throw new Error("Copy is not available");
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(area);
  }
  if (!ok) throw new Error("Copy failed");
}
