/* eslint-disable no-console */
/** Run: npx tsx client/src/components/search/saved-view-share.test.ts */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const bar = readFileSync(join(root, "client/src/components/search/SearchViewBar.tsx"), "utf8");
const search = readFileSync(join(root, "client/src/pages/Search.tsx"), "utf8");
const auth = readFileSync(join(root, "client/src/lib/AuthContext.tsx"), "utf8");
const server = readFileSync(join(root, "server/saved-views.ts"), "utf8");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const shareStart = bar.indexOf("data-testid={`view-share-");
const shareItem = bar.slice(Math.max(0, shareStart - 120), shareStart + 280);
ok(shareStart > 0, "the sidebar row menu has a share item");
ok(shareItem.includes("disabled={!canEdit}"), "share is gated by the same canEditFleet flag as the other row edits");
ok(shareItem.includes("Share with all users") && shareItem.includes("Make private"), "the menu says Share with all users or Make private");
ok(shareItem.includes("onShare(view)"), "the row menu shares that view, not only the open one");

const pinned = bar.slice(bar.indexOf("export function PinnedViewStrip"), bar.indexOf("function ViewRow"));
const row = bar.slice(bar.indexOf("function ViewRow"), bar.indexOf("export function ViewsMenu"));
ok(pinned.includes("<ViewVisibilityIcon"), "the pinned strip shows shared versus private");
ok(row.includes("<ViewVisibilityIcon"), "each sidebar row shows shared versus private");
ok(bar.includes("shared ? Users : Lock"), "shared uses the people icon and private uses the lock");
ok(bar.includes('aria-label={shared ? "Shared with all users" : "Private"}'), "the icons name the sharing state");

ok(search.includes("const canEdit = useCanEdit()"), "search passes the fleet edit permission into the menu");
ok(auth.includes("return usePermissions().canEditFleet"), "useCanEdit is canEditFleet");
ok(search.includes("onShare: (view: ViewSummary) => { void toggleShare(view); }"), "the sidebar calls the share handler");
ok(search.includes("void toggleShare(activeView)"), "the top menu uses the same handler");
const toggle = search.slice(search.indexOf("async function toggleShare"), search.indexOf("async function renameView"));
ok(toggle.includes("shared: !view.shared") && toggle.includes("expected_updated_at: view.updated_at"), "share PATCHes shared with the row timestamp");
ok(toggle.includes("patchView(view.id"), "share goes through the views PATCH helper");
ok(search.includes('apiRequest("PATCH", `/api/views/${id}`'), "that helper PATCHes /api/views/:id");
ok(server.includes('if (body.shared != null) patch.shared = body.shared !== false'), "the route writes car_lists.shared");
ok(server.includes('.from("car_lists").update(patch)'), "the update is the car_lists row");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
