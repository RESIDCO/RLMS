import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk04_p0 } from "./part2_chunk04_p0";
import { registerRoutesChunk04_p1 } from "./part2_chunk04_p1";
import { registerRoutesChunk04_p2 } from "./part2_chunk04_p2";

export async function registerRoutesChunk04(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk04_p0(_httpServer, app);
  await registerRoutesChunk04_p1(_httpServer, app);
  await registerRoutesChunk04_p2(_httpServer, app);
}
