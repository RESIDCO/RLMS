import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk00_p0 } from "./part0_chunk00_p0";
import { registerRoutesChunk00_p1 } from "./part0_chunk00_p1";
import { registerRoutesChunk00_p2 } from "./part0_chunk00_p2";
import { registerRoutesChunk00_p3 } from "./part0_chunk00_p3";

export async function registerRoutesChunk00(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk00_p0(_httpServer, app);
  await registerRoutesChunk00_p1(_httpServer, app);
  await registerRoutesChunk00_p2(_httpServer, app);
  await registerRoutesChunk00_p3(_httpServer, app);
}
