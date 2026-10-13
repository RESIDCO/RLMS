import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart8a } from "./part8a";
import { registerRoutesPart8b } from "./part8b";
import { registerRoutesPart8c } from "./part8c";
import { registerRoutesPart8d } from "./part8d";

export async function registerRoutesPart8(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart8a(httpServer, app);
  await registerRoutesPart8b(httpServer, app);
  await registerRoutesPart8c(httpServer, app);
  await registerRoutesPart8d(httpServer, app);
}
