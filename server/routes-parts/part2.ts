import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk03 } from "./part2_chunk03";
import { registerRoutesChunk04 } from "./part2_chunk04";

export async function registerRoutesPart2(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesChunk03(httpServer, app);
  await registerRoutesChunk04(httpServer, app);
}
