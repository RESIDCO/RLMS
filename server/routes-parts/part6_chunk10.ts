import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk10_p0 } from "./part6_chunk10_p0";
import { registerRoutesChunk10_p1 } from "./part6_chunk10_p1";
import { registerRoutesChunk10_p2 } from "./part6_chunk10_p2";

export async function registerRoutesChunk10(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk10_p0(_httpServer, app);
  await registerRoutesChunk10_p1(_httpServer, app);
  await registerRoutesChunk10_p2(_httpServer, app);
}
