/**
 * Lease-level riders.entity. Same three values as railcars.entity.
 * riders.owner_entity stays the legal owner and is a different column.
 */

export const RIDER_ENTITY_VALUES = ["Main", "Rail Partners Select", "Coal"] as const;

export type RiderEntity = (typeof RIDER_ENTITY_VALUES)[number];

export class RiderEntityError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "RiderEntityError";
  }
}

export function isRiderEntity(value: unknown): value is RiderEntity {
  return (RIDER_ENTITY_VALUES as readonly unknown[]).includes(value);
}

/** Edit path. Blank becomes null. A stored value must match railcars.entity exactly, with no padding. */
export function editedRiderEntity(value: unknown): RiderEntity | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new RiderEntityError(
      `Entity must be ${RIDER_ENTITY_VALUES.join(", ")}`,
    );
  }
  if (!value.trim()) return null;
  if (!isRiderEntity(value)) {
    throw new RiderEntityError(
      `Entity must be ${RIDER_ENTITY_VALUES.join(", ")}`,
    );
  }
  return value;
}

/** New rider setup. A value is required. */
export function requireRiderEntity(value: unknown): RiderEntity {
  const entity = editedRiderEntity(value);
  if (!entity) throw new RiderEntityError("Entity is required for a new rider");
  return entity;
}

/** Wizard / setup-lease rider object. Does not touch owner_entity. */
export function withRequiredRiderEntity<T extends Record<string, unknown>>(
  row: T,
  entity: unknown,
): T & { entity: RiderEntity } {
  return { ...row, entity: requireRiderEntity(entity) };
}

export type EntityCar = {
  id: number;
  entity?: string | null;
  label?: string | null;
};

export type EntityMismatch = {
  riderEntity: string;
  cars: Array<{ id: number; entity: string | null; label: string }>;
  message: string;
};

function carLabel(car: EntityCar): string {
  const label = String(car.label ?? "").trim();
  return label || (car.id > 0 ? `#${car.id}` : "car");
}

/**
 * Non-blocking warning. Null or blank rider entity skips the warning.
 * A set rider entity warns when a car's railcars.entity is different, including blank.
 */
export function entityMismatchWarning(
  riderEntity: string | null | undefined,
  cars: readonly EntityCar[],
): EntityMismatch | null {
  const rider = String(riderEntity ?? "").trim();
  if (!rider) return null;
  const mismatched = cars
    .filter((car) => String(car.entity ?? "").trim() !== rider)
    .map((car) => ({
      id: car.id,
      entity: String(car.entity ?? "").trim() || null,
      label: carLabel(car),
    }));
  if (!mismatched.length) return null;
  const shown = mismatched.slice(0, 6).map((car) => {
    const theirs = car.entity ?? "blank";
    return `${car.label} (${theirs})`;
  });
  const extra = mismatched.length > shown.length ? `, +${mismatched.length - shown.length} more` : "";
  const noun = mismatched.length === 1 ? "car" : "cars";
  return {
    riderEntity: rider,
    cars: mismatched,
    message: `${mismatched.length} ${noun} ${mismatched.length === 1 ? "has" : "have"} an entity different from this rider (${rider}): ${shown.join(", ")}${extra}. Assign anyway?`,
  };
}
