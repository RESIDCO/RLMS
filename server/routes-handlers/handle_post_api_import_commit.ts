import type { Request, Response } from "express";
import {
  assertRailcarImporterPatch, assertRiderImporterPatch, deriveLeaseKey,
  ensureAccountForLessee, pointCurrentAssignmentAt, requireWrite, supabase,
  synthesizeLeaseNumber
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

import { handle_post_api_import_commit_SRC_0 } from "./handle_post_api_import_commit_src_0";
import { handle_post_api_import_commit_SRC_1 } from "./handle_post_api_import_commit_src_1";
import { handle_post_api_import_commit_SRC_2 } from "./handle_post_api_import_commit_src_2";
import { handle_post_api_import_commit_SRC_3 } from "./handle_post_api_import_commit_src_3";

export async function handle_post_api_import_commit(req: Request, res: Response): Promise<void> {
  const __src = handle_post_api_import_commit_SRC_0 + handle_post_api_import_commit_SRC_1 + handle_post_api_import_commit_SRC_2 + handle_post_api_import_commit_SRC_3;
  const __deps: Record<string, unknown> = {
    assertRailcarImporterPatch,
    assertRiderImporterPatch,
    deriveLeaseKey,
    ensureAccountForLessee,
    pointCurrentAssignmentAt,
    requireWrite,
    supabase,
    synthesizeLeaseNumber,
    errHandler,
  };
  const __keys = Object.keys(__deps);
  const __fn = new Function(
    "req",
    "res",
    "__deps",
    "const { " + __keys.join(", ") + " } = __deps; return (async () => {\n" + __src + "\n})();",
  ) as (req: any, res: any, d: Record<string, unknown>) => Promise<void>;
  await __fn(req, res, __deps);
}
