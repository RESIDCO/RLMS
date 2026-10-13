import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart3a } from "./part3a";
import { registerRoutesPart3b } from "./part3b";
import { registerRoutesPart3c } from "./part3c";
import { registerRoutesPart3d } from "./part3d";

export async function registerRoutesPart3(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart3a(httpServer, app);
  await registerRoutesPart3b(httpServer, app);
  await registerRoutesPart3c(httpServer, app);
  await registerRoutesPart3d(httpServer, app);
}
