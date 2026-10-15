/** In-memory VCF preview rows so commit can send only previewId, not 40k JSON rows. */
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 4;

type Entry = { rows: Record<string, string>[]; writerId: string; createdAt: number };

const store = new Map<string, Entry>();

function prune() {
  const now = Date.now();
  for (const [id, e] of Array.from(store.entries())) {
    if (now - e.createdAt > TTL_MS) store.delete(id);
  }
  if (store.size <= MAX_ENTRIES) return;
  const oldest = Array.from(store.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  for (let i = 0; i < oldest.length - MAX_ENTRIES; i++) store.delete(oldest[i][0]);
}

export function putVcfPreview(writerId: string, rows: Record<string, string>[]): string {
  prune();
  const id = crypto.randomUUID();
  store.set(id, { rows, writerId, createdAt: Date.now() });
  return id;
}

export function getVcfPreview(id: string, writerId: string): Record<string, string>[] | null {
  prune();
  const e = store.get(id);
  if (!e || e.writerId !== writerId) return null;
  return e.rows;
}
