import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk15_p0 } from "./part8_chunk15_p0";
import { registerRoutesChunk15_p1 } from "./part8_chunk15_p1";
import { registerRoutesChunk15_p2 } from "./part8_chunk15_p2";

export async function registerRoutesChunk15(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk15_p0(_httpServer, app);
  await registerRoutesChunk15_p1(_httpServer, app);
  await registerRoutesChunk15_p2(_httpServer, app);
}
