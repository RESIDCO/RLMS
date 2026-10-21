/**
 * Browser-only draft for the deal calculator.
 * Nothing here is sent to the server. Logout clears every key for this prefix.
 */

export const DRAFT_PREFIX = "rlms.dealcalc.draft.";

export type DealCalcDraft<T> = {
  inputs: T;
  name: string;
  notes: string;
  savedAt: string;
};

export function draftStorageKey(userId: string, scenarioId: number | "scratch"): string {
  const user = userId.trim() || "anonymous";
  return `${DRAFT_PREFIX}${user}.${scenarioId}`;
}

export function readDraft<T>(storage: Pick<Storage, "getItem">, key: string): DealCalcDraft<T> | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DealCalcDraft<T>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "string") return null;
    if (typeof parsed.name !== "string" || typeof parsed.notes !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft<T>(storage: Pick<Storage, "setItem">, key: string, draft: DealCalcDraft<T>): void {
  storage.setItem(key, JSON.stringify(draft));
}

export function clearDraft(storage: Pick<Storage, "removeItem">, key: string): void {
  storage.removeItem(key);
}

export function clearAllDealCalcDrafts(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(DRAFT_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** True when the local draft is newer than the saved row. A missing saved time loses to any draft. */
export function draftIsNewer(draftSavedAt: string, savedUpdatedAt: string | null | undefined): boolean {
  const draftTime = Date.parse(draftSavedAt);
  if (!Number.isFinite(draftTime)) return false;
  if (!savedUpdatedAt) return true;
  const savedTime = Date.parse(savedUpdatedAt);
  if (!Number.isFinite(savedTime)) return true;
  return draftTime > savedTime;
}
