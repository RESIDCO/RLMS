import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk05 } from "./part3_chunk05";
import { registerRoutesChunk06 } from "./part3_chunk06";

export async function registerRoutesPart3(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk05(httpServer, app);
  await registerRoutesChunk06(httpServer, app);
}
