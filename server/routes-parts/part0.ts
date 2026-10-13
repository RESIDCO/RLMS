import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk00 } from "./part0_chunk00";
import { registerRoutesChunk01 } from "./part0_chunk01";

export async function registerRoutesPart0(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk00(httpServer, app);
  await registerRoutesChunk01(httpServer, app);
}
