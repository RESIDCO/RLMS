import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";

type Shop = {
  id: string;
  reporting_mark: string;
  name: string;
  city?: string | null;
  state?: string | null;
  billing_road?: string | null;
  display_label?: string;
};

type BoRule = {
  id: string;
  code: string;
  description: string;
  event_rule: string;
  requires_other_text: boolean;
  active: boolean;
};

export default function RepairHome() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [rules, setRules] = useState<BoRule[]>([]);
  const [carMark, setCarMark] = useState("ARSX");
  const [carNumber, setCarNumber] = useState("100001");
  const [shopId, setShopId] = useState<string>("");
  const [boRuleCode, setBoRuleCode] = useState<string>("RULE_1");
  const [otherText, setOtherText] = useState("");
  const [billingRoad, setBillingRoad] = useState("");
  const [billingOverrideReason, setBillingOverrideReason] = useState("");
  const [billingAuto, setBillingAuto] = useState(true);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [linkToken, setLinkToken] = useState<string>("");
  const [estimateId, setEstimateId] = useState<string>("");
  const [closeEventId, setCloseEventId] = useState<string>("");
  const [closeMsg, setCloseMsg] = useState<string>("");
  const [boEventId, setBoEventId] = useState<string>("");
  const [boDocs, setBoDocs] = useState<
    Array<{ id: string; original_filename?: string; kind: string; lifecycle_status?: string }>
  >([]);
  const [newRuleCode, setNewRuleCode] = useState("");
  const [newRuleDesc, setNewRuleDesc] = useState("");

  const selectedRule = useMemo(
    () => rules.find((r) => r.code === boRuleCode),
    [rules, boRuleCode],
  );
  const selectedShop = useMemo(() => shops.find((s) => s.id === shopId), [shops, shopId]);

  const shopDefaultBilling = (
    selectedShop?.billing_road ||
    selectedShop?.reporting_mark ||
    ""
  )
    .trim()
    .toUpperCase();

  useEffect(() => {
    apiRequest("GET", "/api/repair/shops")
      .then((r) => r.json())
      .then((d) => {
        setShops(d.shops ?? []);
        if (d.shops?.[0]) setShopId(d.shops[0].id);
      })
      .catch(() => setError("Failed to load shops (is repair DB wired + DATABASE_URL set?)"));
    apiRequest("GET", "/api/repair/bo-rules")
      .then((r) => r.json())
      .then((d) => {
        setRules(d.rules ?? []);
        if (d.rules?.[0]) setBoRuleCode(d.rules[0].code);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!shopId) return;
    if (billingAuto) {
      setBillingRoad(shopDefaultBilling);
      setBillingOverrideReason("");
    }
  }, [shopId, shopDefaultBilling, billingAuto]);

  async function refreshBoDocs(eventId: string) {
    try {
      const res = await apiRequest("GET", `/api/repair/events/${eventId}/documents`);
      const data = await res.json();
      setBoDocs(data.documents ?? []);
    } catch {
      setBoDocs([]);
    }
  }

  async function createBo() {
    setError("");
    setResult("");
    try {
      const override =
        billingRoad.trim().toUpperCase() !== shopDefaultBilling && shopDefaultBilling
          ? billingOverrideReason.trim()
          : undefined;
      if (
        billingRoad.trim().toUpperCase() !== shopDefaultBilling &&
        shopDefaultBilling &&
        !override
      ) {
        setError("Billing road override requires a reason");
        return;
      }
      const res = await apiRequest("POST", "/api/repair/bad-orders", {
        carMark,
        carNumber,
        shopId: shopId || undefined,
        boRuleCode,
        boRuleOtherText: selectedRule?.requires_other_text ? otherText : undefined,
        billingRoad: billingRoad || undefined,
        billingRoadOverrideReason: override,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "BO failed");
      setResult(JSON.stringify(data, null, 2));
      setBoEventId(data.event?.id ?? "");
      if (data.event?.id) await refreshBoDocs(String(data.event.id));
      const linkRes = await apiRequest("POST", `/api/repair/events/${data.event.id}/links`, {
        scope: "SHOP",
      });
      const linkData = await linkRes.json();
      setLinkToken(linkData.token);
      setResult((prev) => prev + "\n\nShop link token (once): " + linkData.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "BO failed");
    }
  }

  async function uploadBoAttachment(file: File) {
    if (!boEventId) {
      setError("Create a bad order first");
      return;
    }
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "bo_attachment");
      const res = await fetch(`/api/repair/events/${boEventId}/documents`, {
        method: "POST",
        body: fd,
        headers: { "x-repair-actor": "reviewer@local" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await refreshBoDocs(boEventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function voidBoDoc(id: string) {
    const reason = window.prompt("Reason to VOID attachment (retained, never purged)?");
    if (!reason?.trim()) return;
    try {
      const res = await apiRequest("POST", `/api/repair/documents/${id}/soft-delete`, {
        reason: reason.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Void failed");
      if (boEventId) await refreshBoDocs(boEventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Void failed");
    }
  }

  async function addBoRule() {
    setError("");
    try {
      const res = await apiRequest("POST", "/api/repair/bo-rules", {
        code: newRuleCode,
        description: newRuleDesc,
        eventRule: "RULE_1",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Add rule failed");
      setNewRuleCode("");
      setNewRuleDesc("");
      const list = await apiRequest("GET", "/api/repair/bo-rules");
      const payload = await list.json();
      setRules(payload.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add rule failed");
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <PageHeader
        title="Repair module"
        subtitle="Create a bad order (VCF-checked), issue a shop event link, then review estimates."
      />
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label htmlFor="mark">Car mark</Label>
          <Input id="mark" value={carMark} onChange={(e) => setCarMark(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="num">Car number</Label>
          <Input id="num" value={carNumber} onChange={(e) => setCarNumber(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label>Shop</Label>
          <Select
            value={shopId}
            onValueChange={(v) => {
              setShopId(v);
              setBillingAuto(true);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select shop" />
            </SelectTrigger>
            <SelectContent>
              {shops.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.display_label ||
                    `${s.name} – ${[s.city, s.state].filter(Boolean).join(", ") || s.reporting_mark}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>BO rule</Label>
          <Select value={boRuleCode} onValueChange={setBoRuleCode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rules.map((r) => (
                <SelectItem key={r.id} value={r.code}>
                  {r.code} — {r.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRule?.requires_other_text && (
            <Input
              className="mt-1"
              placeholder="Other — describe the rule / reason"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
            />
          )}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="billing">Billing road</Label>
          <p className="text-xs text-muted-foreground">
            Auto-filled from shop ({shopDefaultBilling || "—"}). Override requires a reason.
          </p>
          <Input
            id="billing"
            value={billingRoad}
            onChange={(e) => {
              setBillingAuto(false);
              setBillingRoad(e.target.value.toUpperCase());
            }}
          />
          {billingRoad.trim().toUpperCase() !== shopDefaultBilling && shopDefaultBilling ? (
            <Input
              placeholder="Override reason (required)"
              value={billingOverrideReason}
              onChange={(e) => setBillingOverrideReason(e.target.value)}
            />
          ) : null}
        </div>
        <Button onClick={createBo}>Create bad order + shop link</Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {linkToken && (
          <p className="text-sm">
            Open shop page:{" "}
            <Link href={`/repair/e/${linkToken}`} className="underline text-primary">
              /repair/e/…token…
            </Link>
          </p>
        )}

        {boEventId && (
          <div className="grid gap-2 border-t border-border pt-4">
            <Label>BO attachments (photos/docs — same storage as estimates)</Label>
            <p className="text-xs text-muted-foreground">
              Delete → VOIDED (retained, never purged).
            </p>
            <Input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadBoAttachment(f);
              }}
            />
            <ul className="text-xs space-y-1">
              {boDocs.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span>
                    {d.original_filename || d.kind}{" "}
                    {d.lifecycle_status === "VOIDED" ? (
                      <span className="text-destructive">VOIDED</span>
                    ) : null}
                  </span>
                  {d.lifecycle_status !== "VOIDED" && (
                    <Button size="sm" variant="ghost" onClick={() => voidBoDoc(d.id)}>
                      Void
                    </Button>
                  )}
                </li>
              ))}
              {boDocs.length === 0 && (
                <li className="text-muted-foreground">No attachments yet.</li>
              )}
            </ul>
          </div>
        )}

        <div className="grid gap-1">
          <Label htmlFor="est">Estimate id (after shop uploads)</Label>
          <Input
            id="est"
            value={estimateId}
            onChange={(e) => setEstimateId(e.target.value)}
            placeholder="uuid"
          />
          {estimateId && (
            <Link
              href={`/repair/estimates/${estimateId}`}
              className="text-sm underline text-primary"
            >
              Open estimate review / Resp 6
            </Link>
          )}
        </div>
        <div className="grid gap-1 border-t border-border pt-4">
          <Label htmlFor="closeEv">Event id — Ready to Close</Label>
          <p className="text-xs text-muted-foreground">
            When invoice total matches the approved final estimate and dispo is entered, status
            becomes Ready to Close. Reviewer closes with one click (audited). No auto-close.
          </p>
          <Input
            id="closeEv"
            value={closeEventId}
            onChange={(e) => setCloseEventId(e.target.value)}
            placeholder="event uuid"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!closeEventId}
              onClick={async () => {
                setCloseMsg("");
                setError("");
                try {
                  const res = await apiRequest(
                    "POST",
                    `/api/repair/events/${closeEventId}/ready-to-close`,
                    {},
                  );
                  const data = await res.json();
                  setCloseMsg(JSON.stringify(data, null, 2));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Ready-to-close check failed");
                }
              }}
            >
              Check / mark Ready to Close
            </Button>
            <Button
              disabled={!closeEventId}
              onClick={async () => {
                setCloseMsg("");
                setError("");
                try {
                  const res = await apiRequest("POST", `/api/repair/events/${closeEventId}/close`, {
                    actorRole: "reviewer",
                  });
                  const data = await res.json();
                  setCloseMsg(JSON.stringify(data, null, 2));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Close failed");
                }
              }}
            >
              Close event
            </Button>
          </div>
          {closeMsg && (
            <pre className="text-xs bg-muted p-3 overflow-auto rounded-md max-h-40">{closeMsg}</pre>
          )}
        </div>
        {result && (
          <pre className="text-xs bg-muted p-3 overflow-auto rounded-md max-h-80">{result}</pre>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-6">
        <h2 className="font-medium">Admin — add BO rule</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Code (e.g. RULE_88)"
            value={newRuleCode}
            onChange={(e) => setNewRuleCode(e.target.value)}
          />
          <Input
            placeholder="Description"
            value={newRuleDesc}
            onChange={(e) => setNewRuleDesc(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          onClick={addBoRule}
          disabled={!newRuleCode.trim() || !newRuleDesc.trim()}
        >
          Add rule
        </Button>
      </div>

      <DistributionListPanel />
    </div>
  );
}

function DistributionListPanel() {
  const [entries, setEntries] = useState<
    Array<{ id: string; email: string; name: string | null; active: boolean }>
  >([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      const res = await apiRequest("GET", "/api/repair/distribution-list");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setErr("Distribution list unavailable (DB wired?)");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add() {
    setErr("");
    try {
      await apiRequest("POST", "/api/repair/distribution-list", { email, name });
      setEmail("");
      setName("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-6">
      <h2 className="font-medium">Distribution list</h2>
      <p className="text-xs text-muted-foreground">
        Plain email recipients for BO notifications. Anyone can be added — not Resp 6 / lessee
        contact fields.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button variant="secondary" onClick={add} disabled={!email.includes("@")}>
        Add recipient
      </Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <ul className="text-xs space-y-1">
        {entries.map((c) => (
          <li key={c.id}>
            {c.name ? `${c.name} ` : ""}
            &lt;{c.email}&gt;
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-muted-foreground">No recipients yet.</li>
        )}
      </ul>
    </div>
  );
}
