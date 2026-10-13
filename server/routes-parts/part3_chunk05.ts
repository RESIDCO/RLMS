import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk05_p0 } from "./part3_chunk05_p0";
import { registerRoutesChunk05_p1 } from "./part3_chunk05_p1";

export async function registerRoutesChunk05(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk05_p0(_httpServer, app);
  await registerRoutesChunk05_p1(_httpServer, app);
}
