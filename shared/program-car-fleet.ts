import { isFrozenRailcar } from "./car-lifecycle-status";

/**
 * Whether a fleet car is frozen for program side effects.
 *
 * isFrozenRailcar is the rule: active is false, or the status is Inactive.
 * applyOneCarUpdates uses this only to skip railcar and commitment writes.
 * A program-car status or complete-flag patch still saves on a frozen car.
 */
export function programCarFleetFrozen(car: {
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return isFrozenRailcar(car);
}
