import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Payload = {
  event: {
    id: string;
    car_mark: string;
    car_number: string;
    status_code: string;
    status_name: string;
    rule: string;
  };
  nextActions: string[];
  estimates: Array<{ id: string; status_code: string; current_revision: number }>;
  revisions: Array<{
    rev_no: number;
    action: string;
    action_at: string;
    actor_name: string;
    labor: string;
    material: string;
    total: string;
    new_status: string;
    old_status: string;
    comment: string | null;
  }>;
};

export default function ShopEventLink() {
  const [, params] = useRoute("/repair/e/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [email, setEmail] = useState("shop.tech@example.invalid");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    const res = await fetch(`/api/repair/e/${token}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Link invalid");
      setData(null);
      return;
    }
    setData(json);
  }

  useEffect(() => {
    if (token) void load();
  }, [token]);

  async function post(path: string, body?: BodyInit, isForm = false) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/repair/e/${token}/${path}`, {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm ? body : JSON.stringify(body ?? { email, comment }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Action failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadEstimate() {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("actorName", email);
    if (comment) fd.set("comment", comment);
    if (file) fd.set("file", file);
    fd.set(
      "lines",
      JSON.stringify([
        {
          lineNo: 1,
          aarJobCode: "DUMMY",
          labor: 100,
          material: 50,
          total: 150,
          respCode: "1",
        },
      ]),
    );
    await post("estimates", fd, true);
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
        Loading event link…
      </div>
    );
  }

  const actions = new Set(data.nextActions);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Shop event link</p>
          <h1 className="text-2xl font-semibold">
            {data.event.car_mark} {data.event.car_number}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.event.status_name} · {data.event.rule}
          </p>
        </header>

        <div className="grid gap-2">
          <Label htmlFor="email">Your email (audit)</Label>
          <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Label htmlFor="comment">Comment</Label>
          <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.has("accept") && (
            <Button disabled={busy} onClick={() => post("accept", { email })}>
              Accept
            </Button>
          )}
          {actions.has("reject") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => post("reject", { email, comment })}
            >
              Reject
            </Button>
          )}
          {actions.has("on-hand") && (
            <Button disabled={busy} onClick={() => post("on-hand", { email })}>
              On hand
            </Button>
          )}
        </div>

        {(actions.has("upload-estimate") || true) && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Upload estimate</h2>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button disabled={busy} onClick={uploadEstimate}>
              Upload estimate
            </Button>
            <p className="text-xs text-muted-foreground">
              Original file is kept with SHA-256. Full 500-byte parsing awaits sample files from Bruce.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <section className="space-y-2 border-t pt-4">
          <h2 className="font-medium">Revision history</h2>
          {data.revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2">Rev</th>
                    <th className="py-1 pr-2">Action</th>
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Total</th>
                    <th className="py-1 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revisions.map((r) => (
                    <tr key={r.rev_no} className="border-b border-border/50">
                      <td className="py-1 pr-2">{r.rev_no}</td>
                      <td className="py-1 pr-2">{r.action}</td>
                      <td className="py-1 pr-2">{new Date(r.action_at).toLocaleString()}</td>
                      <td className="py-1 pr-2">{r.actor_name}</td>
                      <td className="py-1 pr-2">{r.total}</td>
                      <td className="py-1 pr-2">
                        {r.old_status ?? "—"} → {r.new_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
