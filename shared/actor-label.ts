/** Dashed UUID text. Emails and system labels do not match. */
const ACTOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isActorUuid(value: string | null | undefined): boolean {
  return ACTOR_UUID.test(String(value ?? "").trim());
}
