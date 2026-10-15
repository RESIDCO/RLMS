/**
 * Hand-entry estimate revision for §G shop portal (open-Q default b: BOTH).
 */
import { uploadEstimate, type EstimateLineInput } from "./estimates";

export async function ensureEstimateForEvent(opts: {
  tenantId: string;
  eventId: string;
  lines: EstimateLineInput[];
  actor: string;
  comment?: string;
}): Promise<
  | { ok: true; estimateId: string; revisionId: string }
  | { ok: false; status: number; error: string }
> {
  const result = await uploadEstimate({
    eventId: opts.eventId,
    tenantId: opts.tenantId,
    actorName: opts.actor,
    actorEmail: opts.actor,
    via: "UI",
    comment: opts.comment,
    lines: opts.lines.map((l, i) => {
      const laborCents = l.laborCents ?? Math.round((l.labor ?? 0) * 100);
      const materialCents = l.materialCents ?? Math.round((l.material ?? 0) * 100);
      return {
        ...l,
        lineNo: l.lineNo ?? i + 1,
        laborCents,
        materialCents,
        labor: laborCents / 100,
        material: materialCents / 100,
        total: (laborCents + materialCents) / 100,
      };
    }),
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status ?? 400,
      error: result.error ?? "Hand entry failed",
    };
  }
  return {
    ok: true,
    estimateId: String(result.estimate.id),
    revisionId: String(result.revision.id),
  };
}
