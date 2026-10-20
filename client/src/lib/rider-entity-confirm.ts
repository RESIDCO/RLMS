import { confirmAction } from "@/components/ConfirmActionDialog";
import { entityMismatchWarning, type EntityCar } from "@shared/rider-entity";

/** Confirm dialog. Returns true when there is nothing to warn about or the user confirms. */
export async function confirmRiderEntityMismatch(
  riderEntity: string | null | undefined,
  cars: readonly EntityCar[],
): Promise<boolean> {
  const warning = entityMismatchWarning(riderEntity, cars);
  if (!warning) return true;
  return confirmAction({
    title: "Car entity differs from this rider",
    description: warning.message,
    confirmLabel: "Assign anyway",
    cancelLabel: "Go back",
  });
}
