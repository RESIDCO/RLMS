import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart1_p0 } from "./part1_p0";
import { registerRoutesPart1_p1 } from "./part1_p1";
import { registerRoutesPart1_p2 } from "./part1_p2";

export async function registerRoutesPart1(_httpServer: Server,
  app: Express,): Promise<void> {
  await registerRoutesPart1_p0(_httpServer, app);
  await registerRoutesPart1_p1(_httpServer, app);
  await registerRoutesPart1_p2(_httpServer, app);
}
