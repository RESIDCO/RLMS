import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart9a } from "./part9a";
import { registerRoutesPart9b } from "./part9b";
import { registerRoutesPart9c } from "./part9c";

export async function registerRoutesPart9(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart9a(httpServer, app);
  await registerRoutesPart9b(httpServer, app);
  await registerRoutesPart9c(httpServer, app);
}
