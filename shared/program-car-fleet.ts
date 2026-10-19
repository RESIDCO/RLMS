import { isFrozenRailcar } from "./car-lifecycle-status";

/**
 * Whether a fleet car is frozen for program side effects.
 *
 * isFrozenRailcar is the rule: active is false, or the status is Inactive.
 * Commitment and railcar writes stay blocked. Program-row edits on a frozen
 * car are allowed only when that row's Keep open flag is set.
 */
export function programCarFleetFrozen(car: {
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return isFrozenRailcar(car);
}
