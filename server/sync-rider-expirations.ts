/**
 * @deprecated Use governLeaseDates — Asset Report first, V_Valid only as fallback.
 * Kept so existing routes keep a stable import path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { governLeaseDates, type GovernLeaseDatesResult } from "./govern-lease-dates";

export type RiderExpirationSyncResult = {
  ridersScanned: number;
  ridersUpdated: number;
  olsWithKnownEnd: number;
  governance?: GovernLeaseDatesResult;
};

export async function syncRiderExpirationsFromCars(
  supabase: SupabaseClient
): Promise<RiderExpirationSyncResult> {
  const governance = await governLeaseDates(supabase);
  return {
    ridersScanned: governance.ridersScanned,
    ridersUpdated: governance.ridersUpdated,
    olsWithKnownEnd: governance.olsWithAsset + governance.olsWithCarFallback,
    governance,
  };
}
