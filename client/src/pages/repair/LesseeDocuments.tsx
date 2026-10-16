/**
 * §E Document Viewer in lessee mode — granted attachments only, login-free.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";

type DocRow = {
  id: string;
  kind: string;
  original_filename?: string | null;
  mime?: string | null;
  size?: number;
  category_code?: string | null;
  uploaded_at?: string;
};

export default function LesseeDocuments() {
  const [, params] = useRoute("/repair/lessee/:token/documents");
  const token = params?.token ?? "";
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [car, setCar] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    const res = await fetch(
      `/api/repair/lessee/${token}/documents-viewer`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Load failed");
    setDocs((data.documents ?? []) as DocRow[]);
    setCar(String(data.scope?.carLabel ?? ""));
    if (!selectedId && data.documents?.[0]?.id) {
      setSelectedId(String(data.documents[0].id));
    }
  }, [token, selectedId]);

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Load failed"),
    );
  }, [load]);

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  );

  const previewUrl = selected
    ? `/api/repair/lessee/${token}/attachments/${selected.id}`
    : null;
  const isImage = (selected?.mime ?? "").startsWith("image/");
  const isPdf =
    (selected?.mime ?? "").includes("pdf") ||
    (selected?.original_filename ?? "").toLowerCase().endsWith(".pdf");

  return (
    <div className="min-h-screen repair-page-bg">
      <header className="repair-brand-bar px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xl font-bold tracking-wide">RESIDCO</div>
          <div className="text-sm text-white/85">
            File Attachments {car ? `· ${car}` : ""} (granted only)
          </div>
        </div>
        <Link href={`/repair/lessee/${token}`}>
          <Button variant="secondary" size="sm">
            Back to estimate
          </Button>
        </Link>
      </header>

      <div className="max-w-6xl mx-auto p-4 grid gap-4 md:grid-cols-[16rem_1fr]">
        {error && (
          <p className="text-sm text-destructive md:col-span-2">{error}</p>
        )}
        <aside className="border border-border rounded-md bg-white p-2 space-y-1 max-h-[70vh] overflow-auto">
          {docs.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">
              No granted attachments on this send.
            </p>
          )}
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                selectedId === d.id ? "repair-brand-soft-bg font-medium" : "hover:bg-muted"
              }`}
              onClick={() => setSelectedId(d.id)}
            >
              <div className="truncate">
                {d.original_filename || d.kind}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {d.category_code || d.kind}
              </div>
            </button>
          ))}
        </aside>
        <main className="border border-border rounded-md bg-white min-h-[20rem] p-3">
          {!selected && (
            <p className="text-sm text-muted-foreground">Select a file</p>
          )}
          {selected && previewUrl && isImage && (
            <img
              src={previewUrl}
              alt={selected.original_filename || "attachment"}
              className="max-w-full max-h-[70vh] mx-auto"
            />
          )}
          {selected && previewUrl && isPdf && (
            <iframe
              title={selected.original_filename || "pdf"}
              src={previewUrl}
              className="w-full h-[70vh] border-0"
            />
          )}
          {selected && previewUrl && !isImage && !isPdf && (
            <div className="space-y-2 text-sm">
              <p>Preview not available for this type. Download only.</p>
              <a className="underline text-sky-800" href={previewUrl} download>
                Download {selected.original_filename || selected.kind}
              </a>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
