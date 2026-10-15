/**
 * §F Lessee screen — login-free signed link.
 * RESIDCO brand, car, shop+location, Resp 6 BRC lines, matching total,
 * §E viewer (granted only), Resp6 downloads, Accept/Reject whole estimate.
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

type PendingDecision = "APPROVE" | "REJECT" | null;

export default function LesseeApproval() {
  const [, params] = useRoute("/repair/lessee/:token");
  const token = params?.token ?? "";
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [car, setCar] = useState("");
  const [shopDisplay, setShopDisplay] = useState("");
  const [workspace, setWorkspace] = useState("RESIDCO");
  const [ownLines, setOwnLines] = useState<EstimateLine[]>([]);
  const [ownResp, setOwnResp] = useState<string[]>(["6"]);
  const [totalCents, setTotalCents] = useState(0);
  const [amountMoney, setAmountMoney] = useState("$0.00");
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [headerFields, setHeaderFields] = useState<HeaderFieldDef[]>([]);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [canDecide, setCanDecide] = useState(true);
  const [dueEt, setDueEt] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<{
    pdf?: { filename: string; url: string };
    data500?: { filename: string; url: string };
  }>({});
  const [pending, setPending] = useState<PendingDecision>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/repair/lessee/${token}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load");
        setCar(
          `${data.event?.car_mark ?? ""} ${data.event?.car_number ?? ""}`.trim(),
        );
        setShopDisplay(String(data.shopDisplay ?? ""));
        setWorkspace(String(data.workspaceTitle ?? "RESIDCO"));
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
        setCanDecide(data.canDecide !== false);
        setDueEt(data.approval?.responseDueAtEt ?? null);
        setDownloads(data.downloads ?? {});
        if (data.approval?.decision === "APPROVED") {
          setDone("Accepted — thank you. This link is now read-only.");
        } else if (data.approval?.decision === "REJECTED") {
          setDone("Rejected — your comment was recorded. This link is now read-only.");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [token]);

  function openConfirm(decision: "APPROVE" | "REJECT") {
    setError("");
    if (!name.trim() || !email.trim().includes("@")) {
      setError("Name and email are required.");
      return;
    }
    if (decision === "REJECT" && !comment.trim()) {
      setError("Reject requires a comment.");
      return;
    }
    setPending(decision);
  }

  async function confirmDecide() {
    if (!pending) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/repair/lessee/${token}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: pending,
          comment: comment.trim() || undefined,
          name: name.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Decision failed");
      setDone(
        pending === "APPROVE"
          ? "Accepted — thank you. This link is now read-only."
          : "Rejected — your comment was recorded. This link is now read-only.",
      );
      setCanDecide(false);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef]">
      <header className="bg-[#8B1E1E] text-white px-4 py-3 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-2xl font-bold tracking-[0.08em]">{workspace}</div>
            <div className="text-sm text-white/85 mt-0.5">
              Lessee responsibility review
            </div>
          </div>
          <div className="text-right text-sm">
            {car ? <div className="font-semibold">Car {car}</div> : null}
            {shopDisplay ? (
              <div className="text-white/85">{shopDisplay}</div>
            ) : null}
            {dueEt ? (
              <div className="text-xs text-white/75 mt-1">Respond by {dueEt}</div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && <p className="text-sm font-medium text-foreground">{done}</p>}
        {note && !done && (
          <p className="text-xs text-muted-foreground">{note}</p>
        )}

        <EstimateDataFile
          header={header}
          headerFields={headerFields}
          lines={ownLines}
          documents={documents}
          readOnly
          canPencilEdit={false}
          ownRespCodes={ownResp}
        />

        <div className="flex flex-wrap gap-3 text-sm items-center border border-border rounded-md bg-white px-3 py-2">
          <span>
            Resp 6 total{" "}
            <strong className="tabular-nums">{amountMoney}</strong>{" "}
            <span className="text-xs text-muted-foreground">({totalCents}¢)</span>
          </span>
          {downloads.pdf?.url ? (
            <a
              className="underline text-sky-800"
              href={downloads.pdf.url}
              download={downloads.pdf.filename}
            >
              Download {downloads.pdf.filename}
            </a>
          ) : null}
          {downloads.data500?.url ? (
            <a
              className="underline text-sky-800"
              href={downloads.data500.url}
              download={downloads.data500.filename}
            >
              Download {downloads.data500.filename}
            </a>
          ) : null}
          {token ? (
            <Link
              href={`/repair/lessee/${token}/documents`}
              className="underline text-sky-800"
            >
              Open File Attachments (§E)
            </Link>
          ) : null}
        </div>

        {canDecide && !done && (
          <div className="border border-border rounded-md bg-white p-4 space-y-3">
            <p className="text-sm font-medium">
              Accept or Reject the whole estimate (not per line)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Your name</label>
                <Input
                  className="mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Your email</label>
                <Input
                  className="mt-1"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </div>
            </div>
            <Textarea
              className="text-sm"
              rows={2}
              placeholder="Comment (required to Reject)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => openConfirm("APPROVE")}>Accept</Button>
              <Button variant="outline" onClick={() => openConfirm("REJECT")}>
                Reject
              </Button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "APPROVE" ? "Confirm Accept" : "Confirm Reject"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "APPROVE"
                ? `Accept Resp 6 total ${amountMoney} for car ${car || "—"}? Your name, email, IP, and send version will be logged.`
                : `Reject Resp 6 for car ${car || "—"} with your comment? Your name, email, IP, and send version will be logged.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={() => void confirmDecide()}>
              {submitting ? "Submitting…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
