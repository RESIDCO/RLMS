import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk11_p0 } from "./part6_chunk11_p0";
import { registerRoutesChunk11_p1 } from "./part6_chunk11_p1";
import { registerRoutesChunk11_p2 } from "./part6_chunk11_p2";

export async function registerRoutesChunk11(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk11_p0(_httpServer, app);
  await registerRoutesChunk11_p1(_httpServer, app);
  await registerRoutesChunk11_p2(_httpServer, app);
}
