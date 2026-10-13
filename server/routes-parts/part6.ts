import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk10 } from "./part6_chunk10";
import { registerRoutesChunk11 } from "./part6_chunk11";

export async function registerRoutesPart6(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk10(httpServer, app);
  await registerRoutesChunk11(httpServer, app);
}
