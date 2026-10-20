import type { Request, Response } from "express";
import { requireWrite } from "./auth";

/**
 * Bid files are editor/admin only. Other attachment types keep their existing checks.
 * Returns false after the response has already been sent.
 */
export async function assertAttachmentAccess(req: Request, res: Response, entityType: string): Promise<boolean> {
  if (entityType !== "opportunity") return true;
  const writer = await requireWrite(req, res);
  return writer != null;
}

export function opportunityAttachmentForbidden(role: string | null | undefined, entityType: string): boolean {
  if (entityType !== "opportunity") return false;
  return role !== "admin" && role !== "editor";
}
