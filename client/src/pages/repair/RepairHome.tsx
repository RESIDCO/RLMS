import { useEffect, useState } from "react";
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

type Shop = { id: string; reporting_mark: string; name: string };

export default function RepairHome() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [carMark, setCarMark] = useState("ARSX");
  const [carNumber, setCarNumber] = useState("100001");
  const [shopId, setShopId] = useState<string>("");
  const [rule, setRule] = useState<"RULE_1" | "RULE_107">("RULE_1");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [linkToken, setLinkToken] = useState<string>("");
  const [estimateId, setEstimateId] = useState<string>("");
  const [closeEventId, setCloseEventId] = useState<string>("");
  const [closeMsg, setCloseMsg] = useState<string>("");

  useEffect(() => {
    apiRequest("GET", "/api/repair/shops")
      .then((r) => r.json())
      .then((d) => {
        setShops(d.shops ?? []);
        if (d.shops?.[0]) setShopId(d.shops[0].id);
      })
      .catch(() => setError("Failed to load shops (is repair DB wired + DATABASE_URL set?)"));
  }, []);

  async function createBo() {
    setError("");
    setResult("");
    try {
      const res = await apiRequest("POST", "/api/repair/bad-orders", {
        carMark,
        carNumber,
        shopId: shopId || undefined,
        rule,
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
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
          <Select value={shopId} onValueChange={setShopId}>
            <SelectTrigger>
              <SelectValue placeholder="Select shop" />
            </SelectTrigger>
            <SelectContent>
              {shops.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.reporting_mark} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Rule</Label>
          <Select value={rule} onValueChange={(v) => setRule(v as "RULE_1" | "RULE_107")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RULE_1">Rule 1</SelectItem>
              <SelectItem value="RULE_107">Rule 107</SelectItem>
            </SelectContent>
          </Select>
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

      <ContactBankPanel />
    </div>
  );
}

function ContactBankPanel() {
  const [contacts, setContacts] = useState<
    Array<{ id: string; party_type: string; name: string; email: string | null }>
  >([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [partyType, setPartyType] = useState<"shop" | "lessee" | "other">("lessee");
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      const res = await apiRequest("GET", "/api/repair/contacts");
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } catch {
      setErr("Contacts unavailable (DB wired?)");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add() {
    setErr("");
    try {
      await apiRequest("POST", "/api/repair/contacts", { partyType, name, email });
      setName("");
      setEmail("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-6">
      <h2 className="font-medium">Contact bank (optional)</h2>
      <p className="text-xs text-muted-foreground">
        Shops and lessees. Per-event ad hoc emails and notification rules (Resp 6 never goes to the
        shop) are available via API.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={partyType} onValueChange={(v) => setPartyType(v as typeof partyType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lessee">Lessee</SelectItem>
            <SelectItem value="shop">Shop</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button variant="secondary" onClick={add} disabled={!name}>
        Add contact
      </Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <ul className="text-xs space-y-1">
        {contacts.map((c) => (
          <li key={c.id}>
            [{c.party_type}] {c.name} {c.email ? `<${c.email}>` : ""}
          </li>
        ))}
        {contacts.length === 0 && (
          <li className="text-muted-foreground">No contacts yet.</li>
        )}
      </ul>
    </div>
  );
}
