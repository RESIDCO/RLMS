import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk13_p0 } from "./part7_chunk13_p0";
import { registerRoutesChunk13_p1 } from "./part7_chunk13_p1";
import { registerRoutesChunk13_p2 } from "./part7_chunk13_p2";

export async function registerRoutesChunk13(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk13_p0(_httpServer, app);
  await registerRoutesChunk13_p1(_httpServer, app);
  await registerRoutesChunk13_p2(_httpServer, app);
}
