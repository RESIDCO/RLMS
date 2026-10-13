import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart5a } from "./part5a";
import { registerRoutesPart5b } from "./part5b";
import { registerRoutesPart5c } from "./part5c";
import { registerRoutesPart5d } from "./part5d";
import { registerRoutesPart5e } from "./part5e";
import { registerRoutesPart5f } from "./part5f";

export async function registerRoutesPart5(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart5a(httpServer, app);
  await registerRoutesPart5b(httpServer, app);
  await registerRoutesPart5c(httpServer, app);
  await registerRoutesPart5d(httpServer, app);
  await registerRoutesPart5e(httpServer, app);
  await registerRoutesPart5f(httpServer, app);
}
