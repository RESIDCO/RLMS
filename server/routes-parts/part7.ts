import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart7a } from "./part7a";
import { registerRoutesPart7b } from "./part7b";
import { registerRoutesPart7c } from "./part7c";
import { registerRoutesPart7d } from "./part7d";
import { registerRoutesPart7e } from "./part7e";

export async function registerRoutesPart7(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart7a(httpServer, app);
  await registerRoutesPart7b(httpServer, app);
  await registerRoutesPart7c(httpServer, app);
  await registerRoutesPart7d(httpServer, app);
  await registerRoutesPart7e(httpServer, app);
}
