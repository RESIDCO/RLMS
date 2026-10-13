import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk12_p0 } from "./part7_chunk12_p0";
import { registerRoutesChunk12_p1 } from "./part7_chunk12_p1";
import { registerRoutesChunk12_p2 } from "./part7_chunk12_p2";

export async function registerRoutesChunk12(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk12_p0(_httpServer, app);
  await registerRoutesChunk12_p1(_httpServer, app);
  await registerRoutesChunk12_p2(_httpServer, app);
}
