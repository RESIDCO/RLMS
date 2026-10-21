/**
 * Local-only repair smoke probe.
 * Starts the repair API, hits /api/repair/health, then exits 0 or 1.
 *   REPAIR_DEV_BYPASS_AUTH=1 npx tsx modules/repair/dev/smoke-server.ts
 */
import express from "express";
import {
  registerRepairPublicRoutes,
  registerRepairAuthedRoutes,
} from "../routes";

const port = parseInt(process.env.REPAIR_SMOKE_PORT || "5055", 10);
process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH || "1";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

registerRepairPublicRoutes(app);
registerRepairAuthedRoutes(app);

const server = app.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/api/repair/health`;
  fetch(url)
    .then(async (res) => {
      const body = (await res.json()) as { ok?: boolean };
      if (!res.ok || !body.ok) {
        console.error(`[repair-smoke] health failed ${res.status}`);
        server.close(() => process.exit(1));
        return;
      }
      console.log(`[repair-smoke] health ok ${url}`);
      server.close(() => process.exit(0));
    })
    .catch((err) => {
      console.error("[repair-smoke] health request failed", err);
      server.close(() => process.exit(1));
    });
});

server.on("error", (err) => {
  console.error("[repair-smoke] listen failed", err);
  process.exit(1);
});
