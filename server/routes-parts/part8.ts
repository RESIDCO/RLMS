import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart8a } from "./part8a";
import { registerRoutesPart8b } from "./part8b";
import { registerRoutesPart8c } from "./part8c";

export async function registerRoutesPart8(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart8a(httpServer, app);
  await registerRoutesPart8b(httpServer, app);
  await registerRoutesPart8c(httpServer, app);
}
