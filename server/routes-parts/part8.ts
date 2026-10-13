import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk14 } from "./part8_chunk14";
import { registerRoutesChunk15 } from "./part8_chunk15";

export async function registerRoutesPart8(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk14(httpServer, app);
  await registerRoutesChunk15(httpServer, app);
}
