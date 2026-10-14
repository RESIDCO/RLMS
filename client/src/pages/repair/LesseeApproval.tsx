import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";

type Line = {
  line_no: number;
  aar_job_code: string | null;
  resp_code: string | null;
  labor: number;
  material: number;
  total: number;
  repair_category: string | null;
};

export default function LesseeApproval() {
  const [, params] = useRoute("/repair/lessee/:token");
  const token = params?.token ?? "";
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [car, setCar] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/repair/lessee/${token}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load");
        setCar(`${data.event?.car_mark ?? ""} ${data.event?.car_number ?? ""}`.trim());
        setLines(data.lines ?? []);
        const t =
          data.amountPresented != null
            ? Number(data.amountPresented)
            : (data.lines ?? []).reduce(
                (s: number, l: Line) => s + Number(l.total ?? 0),
                0,
              );
        setTotal(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [token]);

  async function decide(decision: "APPROVE" | "REJECT") {
    setError("");
    setDone("");
    try {
      const res = await fetch(`/api/repair/lessee/${token}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Decision failed");
      setDone(decision === "APPROVE" ? "Approved via link." : "Rejected via link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    }
  }

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Lessee estimate approval"
        subtitle={car ? `Car ${car}` : "Login-free approval link"}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm font-medium">{done}</p>}
      {!done && (
        <>
          <p className="text-sm text-muted-foreground">
            Review the Resp 6 (lessee) portion below. Approving here is the primary path.
            If you replied by email instead, a RESIDCO reviewer must confirm that reply.
          </p>
          <div className="overflow-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Line</th>
                  <th className="p-2">Resp</th>
                  <th className="p-2">Job</th>
                  <th className="p-2">Category</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line_no} className="border-t border-border">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2">{l.resp_code}</td>
                    <td className="p-2">{l.aar_job_code}</td>
                    <td className="p-2">{l.repair_category}</td>
                    <td className="p-2 text-right">{Number(l.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm font-medium">Total ${total.toFixed(2)}</p>
          <div className="flex gap-2">
            <Button onClick={() => decide("APPROVE")}>Approve</Button>
            <Button variant="outline" onClick={() => decide("REJECT")}>
              Reject
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
