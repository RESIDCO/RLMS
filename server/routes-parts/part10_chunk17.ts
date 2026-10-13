import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk17_p0 } from "./part10_chunk17_p0";
import { registerRoutesChunk17_p1 } from "./part10_chunk17_p1";
import { registerRoutesChunk17_p2 } from "./part10_chunk17_p2";

export async function registerRoutesChunk17(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk17_p0(_httpServer, app);
  await registerRoutesChunk17_p1(_httpServer, app);
  await registerRoutesChunk17_p2(_httpServer, app);
}
