import { importActivityMessage, type BidColumnMapping } from "@shared/bid-import";

export type ImportLogRow = {
  table_name: string;
  row_pk: number;
  op: "insert" | "update" | "delete";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export function revertPlan(rows: readonly ImportLogRow[]): {
  deletes: { table: string; id: number }[];
  restores: { table: string; id: number; values: Record<string, unknown> }[];
} {
  const deletes: { table: string; id: number }[] = [];
  const restores: { table: string; id: number; values: Record<string, unknown> }[] = [];
  for (const row of rows) {
    if (row.op === "insert") deletes.push({ table: row.table_name, id: row.row_pk });
    else if (row.op === "update") restores.push({ table: row.table_name, id: row.row_pk, values: { ...row.before } });
  }
  return { deletes, restores };
}

export type CommitDeps = {
  upload(path: string, bytes: Buffer, mime: string): Promise<void>;
  remove(path: string): Promise<void>;
  inGroup<T>(actor: string, fn: (group: string) => Promise<T>): Promise<T>;
  saveLines(opportunityId: number, body: { lines: unknown[]; delete_ids: number[] }, actor: string): Promise<void>;
  patchHeader(opportunityId: number, patch: Record<string, unknown>, actor: string): Promise<void>;
  attach(opts: {
    opportunityId: number;
    actor: string;
    path: string;
    name: string;
    size: number;
    mime: string;
    action: string;
  }): Promise<void>;
  rollback(group: string, actor: string): Promise<void>;
};

/**
 * Runs only after the lines are committed. A missing company or a failed write
 * leaves the import in place so a retry does not collide with the new lines.
 */
export async function rememberBidMapping(input: {
  remember: boolean;
  companyId: number | null;
  mapping: BidColumnMapping | null;
  save: () => Promise<void>;
}): Promise<boolean> {
  if (!input.remember || input.companyId == null || !Number.isInteger(input.companyId) || input.companyId <= 0) return false;
  if (!input.mapping || Object.keys(input.mapping).length === 0) return false;
  try {
    await input.save();
    return true;
  } catch (err) {
    console.error("[crm-bid-import] mapping was not saved", err);
    return false;
  }
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "bid-sheet";
}

export async function commitBidImport(
  input: {
    opportunityId: number;
    actor: string;
    filename: string;
    mime: string;
    bytes: Buffer;
    lines: unknown[];
    header: Record<string, unknown> | null;
    deleteIds: number[];
  },
  deps: CommitDeps,
): Promise<{ change_group: string; storage_path: string; message: string }> {
  const storagePath = `opportunity/${input.opportunityId}/bid-import/${Date.now()}-${safeName(input.filename)}`;
  const cars = input.lines.reduce<number>((sum, line) => {
    const count = line && typeof line === "object" ? Number((line as { car_count?: unknown }).car_count ?? 0) : 0;
    return sum + (Number.isFinite(count) ? count : 0);
  }, 0);
  const message = importActivityMessage(input.lines.length, cars, input.filename);
  let uploaded = false;
  let groupId: string | null = null;
  try {
    await deps.upload(storagePath, input.bytes, input.mime);
    uploaded = true;
    const group = await deps.inGroup(input.actor, async (id) => {
      groupId = id;
      await deps.saveLines(input.opportunityId, { lines: input.lines, delete_ids: input.deleteIds }, input.actor);
      if (input.header && Object.keys(input.header).length) {
        await deps.patchHeader(input.opportunityId, input.header, input.actor);
      }
      await deps.attach({
        opportunityId: input.opportunityId,
        actor: input.actor,
        path: storagePath,
        name: input.filename,
        size: input.bytes.length,
        mime: input.mime,
        action: message,
      });
      return id;
    });
    return { change_group: group, storage_path: storagePath, message };
  } catch (err) {
    if (groupId) {
      try {
        await deps.rollback(groupId, input.actor);
      } catch (rollbackErr) {
        console.error("[crm-bid-import] rollback failed", rollbackErr);
      }
    }
    if (uploaded) {
      try {
        await deps.remove(storagePath);
      } catch (removeErr) {
        console.error("[crm-bid-import] storage remove failed", removeErr);
      }
    }
    throw err;
  }
}
