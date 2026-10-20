export type MoveLegacyDestination =
  | { kind: "notice" }
  | { kind: "redirect"; path: string };

/**
 * `/move` is retired. A bare visit is a notice. `?rider=` is a rider id
 * (the old Move Cars query), never the Railcars OL-code filter named `rider`.
 */
export function moveLegacyDestination(search: string): MoveLegacyDestination {
  const rider = new URLSearchParams(String(search ?? "").replace(/^\?/, "")).get("rider") ?? "";
  const trimmed = rider.trim();
  if (!trimmed) return { kind: "notice" };
  return {
    kind: "redirect",
    path: `/railcars?rider_id=${encodeURIComponent(trimmed)}&move=1`,
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

/** `rider_id` filters Railcars by rider. `rider` stays the OL-code filter. */
export function fleetMoveLaunch(search: string): { riderId: string; openMove: boolean } {
  const qs = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  return {
    riderId: (qs.get("rider_id") || "").trim(),
    openMove: qs.get("move") === "1",
  };
}
