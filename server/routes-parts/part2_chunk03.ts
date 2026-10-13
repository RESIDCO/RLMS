import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk03_p0 } from "./part2_chunk03_p0";
import { registerRoutesChunk03_p1 } from "./part2_chunk03_p1";

export async function registerRoutesChunk03(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk03_p0(_httpServer, app);
  await registerRoutesChunk03_p1(_httpServer, app);
}
