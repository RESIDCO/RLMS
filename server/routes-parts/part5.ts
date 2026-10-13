import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart5a } from "./part5a";
import { registerRoutesPart5b } from "./part5b";
import { registerRoutesPart5c } from "./part5c";

export async function registerRoutesPart5(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart5a(httpServer, app);
  await registerRoutesPart5b(httpServer, app);
  await registerRoutesPart5c(httpServer, app);
}
