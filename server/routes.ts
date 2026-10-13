import type { Express } from "express";
import type { Server } from "http";
import { requireApiAuth, requireUser } from "./auth";
import { recoverStaleExportJobs } from "./vcf-export-job";
import {
  registerRepairPublicRoutes,
  registerRepairAuthedRoutes,
} from "../modules/repair";
import { registerRoutesPart0 } from "./routes-parts/part0";
import { registerRoutesPart1 } from "./routes-parts/part1";
import { registerRoutesPart2 } from "./routes-parts/part2";
import { registerRoutesPart3 } from "./routes-parts/part3";
import { registerRoutesPart4 } from "./routes-parts/part4";
import { registerRoutesPart5 } from "./routes-parts/part5";
import { registerRoutesPart6 } from "./routes-parts/part6";
import { registerRoutesPart7 } from "./routes-parts/part7";
import { registerRoutesPart8 } from "./routes-parts/part8";
import { registerRoutesPart9 } from "./routes-parts/part9";
import { registerRoutesPart10 } from "./routes-parts/part10";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Repair module public routes (shop/lessee links, VCF check) — before API auth gate.
  registerRepairPublicRoutes(app, { requireUser });

  // Gate every /api route: valid Supabase session (Bearer JWT) required.
  // Writes still use requireWrite / requireAdmin for role checks on top of this.
  app.use("/api", requireApiAuth);

  // Repair module authenticated routes (BO create, review, status admin reads).
  registerRepairAuthedRoutes(app, { requireUser });

  await recoverStaleExportJobs();

  await registerRoutesPart0(httpServer, app);
  await registerRoutesPart1(httpServer, app);
  await registerRoutesPart2(httpServer, app);
  await registerRoutesPart3(httpServer, app);
  await registerRoutesPart4(httpServer, app);
  await registerRoutesPart5(httpServer, app);
  await registerRoutesPart6(httpServer, app);
  await registerRoutesPart7(httpServer, app);
  await registerRoutesPart8(httpServer, app);
  await registerRoutesPart9(httpServer, app);
  await registerRoutesPart10(httpServer, app);

  return httpServer;
}
