import type { Express } from "express";
import type { Server } from "http";
import { registerRoutesPart4a } from "./part4a";
import { registerRoutesPart4b } from "./part4b";
import { registerRoutesPart4c } from "./part4c";
import { registerRoutesPart4d } from "./part4d";

export async function registerRoutesPart4(
  httpServer: Server,
  app: Express,
): Promise<void> {
  await registerRoutesPart4a(httpServer, app);
  await registerRoutesPart4b(httpServer, app);
  await registerRoutesPart4c(httpServer, app);
  await registerRoutesPart4d(httpServer, app);
}
