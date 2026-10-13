import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk07 } from "./part4_chunk07";
import { registerRoutesChunk08 } from "./part4_chunk08";

export async function registerRoutesPart4(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk07(httpServer, app);
  await registerRoutesChunk08(httpServer, app);
}
