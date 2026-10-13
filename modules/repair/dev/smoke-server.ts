/**
 * Local-only repair smoke server (no Supabase required).
 *   REPAIR_DEV_BYPASS_AUTH=1 DATABASE_URL=... npx tsx modules/repair/dev/smoke-server.ts
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

app.listen(port, "0.0.0.0", () => {
  console.log(`[repair-smoke] http://127.0.0.1:${port}/api/repair/health`);
});
