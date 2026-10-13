import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart5_p0 } from "./part5_p0";
import { registerRoutesPart5_p1 } from "./part5_p1";
import { registerRoutesPart5_p2 } from "./part5_p2";

export async function registerRoutesPart5(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesPart5_p0(_httpServer, app);
  await registerRoutesPart5_p1(_httpServer, app);
  await registerRoutesPart5_p2(_httpServer, app);
}
