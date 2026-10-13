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
        {result && (
          <pre className="text-xs bg-muted p-3 overflow-auto rounded-md max-h-80">{result}</pre>
        )}
      </div>
    </div>
  );
}
