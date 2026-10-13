import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesChunk01_p0 } from "./part0_chunk01_p0";
import { registerRoutesChunk01_p1 } from "./part0_chunk01_p1";
import { registerRoutesChunk01_p2 } from "./part0_chunk01_p2";

export async function registerRoutesChunk01(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesChunk01_p0(_httpServer, app);
  await registerRoutesChunk01_p1(_httpServer, app);
  await registerRoutesChunk01_p2(_httpServer, app);
}
