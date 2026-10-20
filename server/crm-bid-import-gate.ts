import type { Request, Response } from "express";
import { BidImportError } from "@shared/bid-import";

export function positiveOpportunityId(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Editor or admin, and a real opportunity id, before any upload is accepted. */
export async function authorizeBidUpload(
  req: Request,
  res: Response,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
): Promise<{ user: string; id: number } | null> {
  const user = await requireWrite(req, res);
  if (!user) return null;
  const id = positiveOpportunityId(req.params.id);
  if (!id) {
    res.status(400).json({ message: "Invalid opportunity" });
    return null;
  }
  return { user, id };
}

/**
 * requireWrite runs first. The upload callback is not invoked for anonymous
 * callers, viewers, or a bad id, so their body is never buffered.
 */
export async function receiveAuthorizedBidFile<TFile>(
  req: Request & { file?: TFile },
  res: Response,
  deps: {
    requireWrite: (req: Request, res: Response) => Promise<string | null>;
    upload: (req: Request, res: Response, callback: (err: unknown) => void) => void;
  },
  handle: (user: string, id: number, file: TFile) => Promise<void>,
): Promise<void> {
  const auth = await authorizeBidUpload(req, res, deps.requireWrite);
  if (!auth) return;
  const file = await new Promise<TFile>((resolve, reject) => {
    deps.upload(req, res, (err: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      if (req.file == null) {
        reject(new BidImportError(400, "Choose an .xlsx or .csv file"));
        return;
      }
      resolve(req.file);
    });
  });
  await handle(auth.user, auth.id, file);
}
