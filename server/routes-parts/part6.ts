import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart6a } from "./part6a";
import { registerRoutesPart6b } from "./part6b";
import { registerRoutesPart6c } from "./part6c";
import { registerRoutesPart6d } from "./part6d";

export async function registerRoutesPart6(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart6a(httpServer, app);
  await registerRoutesPart6b(httpServer, app);
  await registerRoutesPart6c(httpServer, app);
  await registerRoutesPart6d(httpServer, app);
}
