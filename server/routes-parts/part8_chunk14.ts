import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk14_p0 } from "./part8_chunk14_p0";
import { registerRoutesChunk14_p1 } from "./part8_chunk14_p1";
import { registerRoutesChunk14_p2 } from "./part8_chunk14_p2";

export async function registerRoutesChunk14(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk14_p0(_httpServer, app);
  await registerRoutesChunk14_p1(_httpServer, app);
  await registerRoutesChunk14_p2(_httpServer, app);
}
