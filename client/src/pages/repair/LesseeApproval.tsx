import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/PageHeader";
import {
  EstimateDataFile,
  type EstimateLine,
  type HeaderFieldDef,
  type DocRow,
} from "./EstimateDataFile";

function formatDisplayMoney(cents: number): string {
  const n = Math.trunc(cents) / 100;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

export default function LesseeApproval() {
  const [, params] = useRoute("/repair/lessee/:token");
  const token = params?.token ?? "";
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [car, setCar] = useState("");
  const [ownLines, setOwnLines] = useState<EstimateLine[]>([]);
  const [ownResp, setOwnResp] = useState<string[]>(["6"]);
  const [totalCents, setTotalCents] = useState(0);
  const [amountMoney, setAmountMoney] = useState("$0.00");
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [headerFields, setHeaderFields] = useState<HeaderFieldDef[]>([]);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/repair/lessee/${token}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load");
        setCar(`${data.event?.car_mark ?? ""} ${data.event?.car_number ?? ""}`.trim());
        // Only Resp 6 lines — never allLines / owner / internal
        const own = (data.lines ?? []) as EstimateLine[];
        setOwnLines(own);
        setOwnResp(data.ownRespCodes ?? ["6"]);
        setHeader(data.header ?? {});
        setHeaderFields(data.headerFields ?? []);
        setDocuments(data.documents ?? []);
        const cents =
          data.amountPresentedCents != null
            ? Math.trunc(Number(data.amountPresentedCents))
            : own.reduce(
                (s, l) =>
                  s +
                  (l.total_cents != null
                    ? Math.trunc(Number(l.total_cents))
                    : Math.round(Number(l.total ?? 0) * 100)),
                0,
              );
        setTotalCents(cents);
        setAmountMoney(data.amountMoney ?? formatDisplayMoney(cents));
        setNote(data.note ?? "");
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
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Decision failed");
      setDone(
        decision === "APPROVE"
          ? "Approved via link (your responsibility lines)."
          : "Disputed / rejected via link.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    }
  }

  return (
    <div className="min-h-screen bg-background p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Lessee estimate review"
        subtitle={car ? `Car ${car}` : "Login-free approval link"}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm font-medium">{done}</p>}
      {note && !done && <p className="text-xs text-muted-foreground">{note}</p>}

      {!done && (
        <>
          <EstimateDataFile
            header={header}
            headerFields={headerFields}
            lines={ownLines}
            documents={documents}
            readOnly
            canPencilEdit={false}
            ownRespCodes={ownResp}
            onDecideLine={(_line, decision) => {
              void decide(decision === "APPROVE" ? "APPROVE" : "REJECT");
            }}
          />

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-sm">
              Your responsibility lines ({ownResp.join(", ")}):{" "}
              <strong>{ownLines.length}</strong> · presented total{" "}
              <strong className="tabular-nums">{amountMoney}</strong>{" "}
              <span className="text-xs text-muted-foreground">({totalCents}¢)</span>
            </p>
            <Textarea
              className="text-sm"
              rows={2}
              placeholder="Comment (optional for approve; recommended for dispute)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => decide("APPROVE")}>Approve my lines</Button>
              <Button variant="outline" onClick={() => decide("REJECT")}>
                Dispute my lines
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
