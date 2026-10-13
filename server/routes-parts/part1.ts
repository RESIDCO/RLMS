import type { Express } from "express";
import type { Server } from "http";

/** Stub: full RLMS route table for this slice lives in the pre-split monolith.
 *  Restore server/routes.ts from master + repair wireup when MCP size limits allow
 *  (~251KB create_or_update_file). part0 + part10 remain real. */
export async function registerRoutesPart1(
  _httpServer: Server,
  _app: Express,
): Promise<void> {}
