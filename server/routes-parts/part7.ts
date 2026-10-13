import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk12 } from "./part7_chunk12";
import { registerRoutesChunk13 } from "./part7_chunk13";

export async function registerRoutesPart7(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk12(httpServer, app);
  await registerRoutesChunk13(httpServer, app);
}
