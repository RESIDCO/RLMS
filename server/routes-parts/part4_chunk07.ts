import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk07_p0 } from "./part4_chunk07_p0";
import { registerRoutesChunk07_p1 } from "./part4_chunk07_p1";

export async function registerRoutesChunk07(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk07_p0(_httpServer, app);
  await registerRoutesChunk07_p1(_httpServer, app);
}
