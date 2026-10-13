import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart1a } from "./part1a";
import { registerRoutesPart1b } from "./part1b";
import { registerRoutesPart1c } from "./part1c";

export async function registerRoutesPart1(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart1a(httpServer, app);
  await registerRoutesPart1b(httpServer, app);
  await registerRoutesPart1c(httpServer, app);
}
