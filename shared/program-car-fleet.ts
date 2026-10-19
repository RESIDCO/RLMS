import { isInactiveCarStatus } from "./car-lifecycle-status";

/**
 * Whether a fleet car is frozen for program side effects.
 *
 * This is the same rule PR #40 names isFrozenRailcar: active is false, or
 * the status is Inactive. When that function lands, replace this body with
 * `return isFrozenRailcar(car)` and delete the active/status check here.
 * isFrozenRailcar wins. Do not keep `active !== true` beside it.
 *
 * applyOneCarUpdates uses this only to skip commitment writes. A program-car
 * status or complete-flag patch still saves, including on a frozen car.
 */
export function programCarFleetFrozen(car: {
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return car.active === false || isInactiveCarStatus(car.status);
}
