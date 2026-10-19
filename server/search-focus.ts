import { searchWantsFocus } from "@shared/saved-views";

type FocusRow = { id: number; notes?: string | null };

/**
 * Paste search (POST /api/search) does not go through the railcar list.
 * Focus columns are attached only when the client sends focus=1.
 */
export async function decoratePasteSearch<T extends { railcars: FocusRow[] }>(
  result: T,
  body: { focus?: unknown; view_id?: unknown },
  attach: (rows: T["railcars"], opts: { viewId?: number | null }) => Promise<T["railcars"]>,
): Promise<T> {
  if (!searchWantsFocus(body.focus) || result.railcars.length === 0) return result;
  const viewId = Number(body.view_id);
  const railcars = await attach(result.railcars, {
    viewId: Number.isFinite(viewId) && viewId > 0 ? viewId : null,
  });
  return { ...result, railcars };
}
