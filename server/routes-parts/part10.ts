import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk17 } from "./part10_chunk17";
import { registerRoutesChunk18 } from "./part10_chunk18";

export async function registerRoutesPart10(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk17(httpServer, app);
  await registerRoutesChunk18(httpServer, app);
}
