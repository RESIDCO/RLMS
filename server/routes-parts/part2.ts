import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart2a } from "./part2a";
import { registerRoutesPart2b } from "./part2b";
import { registerRoutesPart2c } from "./part2c";

export async function registerRoutesPart2(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart2a(httpServer, app);
  await registerRoutesPart2b(httpServer, app);
  await registerRoutesPart2c(httpServer, app);
}
