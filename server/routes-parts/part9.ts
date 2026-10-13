import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart9_p0 } from "./part9_p0";
import { registerRoutesPart9_p1 } from "./part9_p1";
import { registerRoutesPart9_p2 } from "./part9_p2";

export async function registerRoutesPart9(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesPart9_p0(_httpServer, app);
  await registerRoutesPart9_p1(_httpServer, app);
  await registerRoutesPart9_p2(_httpServer, app);
}
