import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk06_p0 } from "./part3_chunk06_p0";
import { registerRoutesChunk06_p1 } from "./part3_chunk06_p1";
import { registerRoutesChunk06_p2 } from "./part3_chunk06_p2";

export async function registerRoutesChunk06(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk06_p0(_httpServer, app);
  await registerRoutesChunk06_p1(_httpServer, app);
  await registerRoutesChunk06_p2(_httpServer, app);
}
