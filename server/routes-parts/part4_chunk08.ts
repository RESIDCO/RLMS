import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk08_p0 } from "./part4_chunk08_p0";
import { registerRoutesChunk08_p1 } from "./part4_chunk08_p1";

export async function registerRoutesChunk08(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk08_p0(_httpServer, app);
  await registerRoutesChunk08_p1(_httpServer, app);
}
