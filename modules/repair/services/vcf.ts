import { assertCarInVcf } from "../integration/rlms";
import type { VcfCheckResult } from "../types";

export async function requireVcfCar(
  carMark: string,
  carNumber: string,
): Promise<VcfCheckResult> {
  return assertCarInVcf(carMark, carNumber);
}
