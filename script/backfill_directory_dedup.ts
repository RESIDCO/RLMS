import { config } from "dotenv";
config({ path: ".env.local" });
config();
const { backfillAgentAndFamilyCandidates } = await import("../server/directory-dedup");

const result = await backfillAgentAndFamilyCandidates();
console.log(JSON.stringify(result, null, 2));
