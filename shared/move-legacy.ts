export type MoveLegacyDestination =
  | { kind: "notice" }
  | { kind: "redirect"; path: string };

/**
 * `/move` is retired. A bare visit is a notice.
 * `?rider=` is a rider id from the old page. It opens the Move dialog with that
 * source rider and does not set a Railcars filter.
 */
export function moveLegacyDestination(search: string): MoveLegacyDestination {
  const rider = new URLSearchParams(String(search ?? "").replace(/^\?/, "")).get("rider") ?? "";
  const trimmed = rider.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) return { kind: "notice" };
  return {
    kind: "redirect",
    path: `/railcars?move_source=${encodeURIComponent(trimmed)}`,
  };
}

/** Hash query is the app's source of truth. location.search covers an old split URL. */
export function moveLegacyDestinationFromSources(
  hashSearch: string,
  locationSearch = "",
): MoveLegacyDestination {
  const fromHash = moveLegacyDestination(hashSearch);
  if (fromHash.kind === "redirect") return fromHash;
  if (String(locationSearch ?? "").replace(/^\?/, "").trim()) return moveLegacyDestination(locationSearch);
  return fromHash;
}

/** Opens the Move dialog for a source rider. Does not read `rider` or `rider_id`. */
export function fleetMoveSource(search: string): number | null {
  const raw = (new URLSearchParams(String(search ?? "").replace(/^\?/, "")).get("move_source") ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}
