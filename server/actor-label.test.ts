/** Run: npx tsx server/actor-label.test.ts */
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";

const {
  ACTOR_LABEL_TTL_MS,
  annotateActorLabels,
  clearActorLabelCache,
  emailFromAuthUser,
  labelActors,
} = await import("./actor-label");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const ADA = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISS = "33333333-3333-4333-8333-333333333333";

function source(opts: {
  roles?: Record<string, string | null>;
  auth?: Record<string, string | null>;
  now?: () => number;
  onRoles?: (ids: readonly string[]) => void;
  onAuth?: (id: string) => void;
}) {
  const state = { roleCalls: 0, authCalls: 0 };
  const api = {
    get roleCalls() {
      return state.roleCalls;
    },
    get authCalls() {
      return state.authCalls;
    },
    now: opts.now,
    rolesByUserId: async (ids) => {
      state.roleCalls += 1;
      opts.onRoles?.(ids);
      return ids.map((id) => ({ user_id: id, email: opts.roles?.[id.toLowerCase()] ?? opts.roles?.[id] ?? null }));
    },
    authEmail: async (id) => {
      state.authCalls += 1;
      opts.onAuth?.(id);
      const email = opts.auth?.[id.toLowerCase()] ?? opts.auth?.[id] ?? null;
      return email;
    },
  };
  return api;
}

clearActorLabelCache();
const rolesHit = source({ roles: { [ADA]: "ada@example.com", [BOB]: "bob@example.com" }, auth: { [ADA]: "other@example.com" } });
const labeled = await labelActors([ADA, `  ${BOB}  `, ADA, "", null, BOB], rolesHit);
ok(labeled.get(ADA) === "ada@example.com", "UUID in user_roles becomes that email");
ok(labeled.get(BOB) === "bob@example.com", "trimmed UUID is the map key");
ok(rolesHit.roleCalls === 1, "user_roles is one batch");
ok(rolesHit.authCalls === 0, "a user_roles hit does not call auth admin");
ok(!labeled.has(""), "blank ids are omitted");

clearActorLabelCache();
let batched: readonly string[] = [];
const mixed = source({
  roles: { [ADA]: "ada@example.com", [MISS]: "" },
  auth: { [BOB]: "bob@example.com", [MISS]: null },
  onRoles: (ids) => {
    batched = ids;
  },
});
const both = await labelActors([ADA, BOB, MISS], mixed);
ok(both.get(ADA) === "ada@example.com", "roles email wins when both sources could answer");
ok(both.get(BOB) === "bob@example.com", "auth admin email fills a user_roles miss");
ok(both.get(MISS) === MISS, "a total miss stays the raw UUID");
ok(mixed.authCalls === 2, "auth admin runs only for role misses");
ok(batched.includes(ADA) && batched.includes(BOB) && batched.includes(MISS), "the role batch receives every UUID");

clearActorLabelCache();
const pass = source({ roles: { [ADA]: "should-not@example.com" } });
const system = await labelActors(
  ["vcf-import", "contract-loader", "legacy", "user", "ada@example.com", "legacy-import", `note-${ADA}`],
  pass,
);
ok(system.get("vcf-import") === "vcf-import", "vcf-import passes through");
ok(system.get("contract-loader") === "contract-loader", "contract-loader passes through");
ok(system.get("legacy") === "legacy", "legacy passes through");
ok(system.get("user") === "user", "user passes through");
ok(system.get("ada@example.com") === "ada@example.com", "an email passes through");
ok(system.get("legacy-import") === "legacy-import", "other system labels pass through");
ok(system.get(`note-${ADA}`) === `note-${ADA}`, "a UUID embedded in other text is not looked up");
ok(pass.roleCalls === 0 && pass.authCalls === 0, "pass-through values do not touch user_roles or auth");

clearActorLabelCache();
let now = 1_000;
let roleCalls = 0;
const cached = source({
  roles: { [ADA]: "ada@example.com" },
  now: () => now,
  onRoles: () => {
    roleCalls += 1;
  },
});
ok((await labelActors([ADA], cached)).get(ADA) === "ada@example.com", "first lookup stores the email");
ok((await labelActors([ADA.toUpperCase()], cached)).get(ADA.toUpperCase()) === "ada@example.com", "cache hits ignore UUID case");
ok(roleCalls === 1, "a second lookup inside the TTL does not read user_roles");
now += ACTOR_LABEL_TTL_MS;
ok((await labelActors([ADA], cached)).get(ADA) === "ada@example.com", "an expired cache entry is looked up again");
ok(roleCalls === 2, "the TTL forces a fresh user_roles read");

clearActorLabelCache();
let missAuth = 0;
const missSource = source({
  auth: {},
  onAuth: () => {
    missAuth += 1;
  },
});
ok((await labelActors([MISS], missSource)).get(MISS) === MISS, "a cached miss still returns the UUID");
ok((await labelActors([MISS], missSource)).get(MISS) === MISS, "a miss stays cached for the TTL");
ok(missAuth === 1, "a cached miss does not call auth admin again");

clearActorLabelCache();
const rows = await annotateActorLabels(
  [
    { actor: ADA, action: "note" },
    { actor: "vcf-import", action: "import" },
    { actor: null, action: "note" },
  ],
  (row) => row.actor,
  source({ roles: { [ADA]: "ada@example.com" } }),
);
ok(rows[0].actor === ADA && rows[0].actor_label === "ada@example.com", "actor_label sits beside the raw actor");
ok(rows[1].actor === "vcf-import" && rows[1].actor_label === "vcf-import", "a system label is copied into actor_label");
ok(rows[2].actor === null && rows[2].actor_label === null, "a null actor stays null");

const named = emailFromAuthUser({
  email: "ada@example.com",
  user_metadata: { full_name: "Ada Lovelace", name: "Ada", display_name: "Ada L" },
} as { email: string });
ok(named === "ada@example.com", "auth lookup exposes the email and not the display name");
ok(
  emailFromAuthUser({ email: "  ", user_metadata: { full_name: "Ada Lovelace" } } as { email: string }) === null,
  "a metadata name without an email is a miss",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
