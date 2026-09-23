import { useRef, useState } from "react";
import { Link } from "wouter";
import { useCanEdit } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { confirmAction } from "@/components/ConfirmActionDialog";

declare const XLSX: any;

async function loadXLSX(): Promise<void> {
  if (typeof XLSX !== "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function looksLikeMarkSheet(name: string): boolean {
  return /mark\s*contacts/i.test(name);
}

type MarkSkip = { row: number; company: string; name: string; reason: string };

type MarkPreview = {
  sourceRows: number;
  companiesToCreate: number;
  contactsToCreate: number;
  companiesAlreadyPresent: number;
  contactsAlreadyPresent: number;
  skipped: MarkSkip[];
  multiSpellingGroups: Array<{ normalized: string; spellings: string[]; rowCount: number }>;
  markConflictGroups: Array<{ name: string; signatures: string[] }>;
  spellingSplits: Array<{
    normalized: string;
    companies: Array<{ name: string; spellings: string[]; marks: string[] }>;
    borderline: boolean;
  }>;
};

type MarkCommit = {
  ok: boolean;
  companiesCreated: number;
  contactsCreated: number;
  companiesSkippedExisting: number;
  contactsSkippedExisting: number;
  skippedSource: number;
};

export default function MarkContactsImportSection() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<MarkPreview | null>(null);
  const [committed, setCommitted] = useState<MarkCommit | null>(null);

  async function handleFile(file: File) {
    setPreview(null);
    setCommitted(null);
    setFileName(file.name);
    setLoading(true);
    try {
      await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName =
        wb.SheetNames.find((n: string) => looksLikeMarkSheet(n)) ||
        (wb.SheetNames.includes("MARK Contacts") ? "MARK Contacts" : null);
      if (!sheetName) {
        throw new Error('Workbook has no "MARK Contacts" sheet. Use Working_File_for_CRM_Data_8_11_26.xlsx.');
      }
      const parsed = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" }) as Record<string, unknown>[];
      if (!parsed.length) throw new Error("MARK Contacts sheet has no data rows.");
      setRows(parsed);
      const res = await apiRequest("POST", "/api/import/mark-contacts/preview", { rows: parsed });
      const result: MarkPreview = await res.json();
      setPreview(result);
    } catch (e: any) {
      toast({ title: "MARK Contacts preview failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!preview || !rows.length) return;
    const ok = await confirmAction({
      title: `Import ${preview.companiesToCreate} companies and ${preview.contactsToCreate} contacts from MARK Contacts?`,
      description:
        "Creates unclassified companies (no account link). Re-running skips companies/contacts already imported from this source.",
      confirmLabel: "Import",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/import/mark-contacts/commit", { rows });
      const result: MarkCommit = await res.json();
      setCommitted(result);
      setPreview(null);
      toast({ title: `Imported ${result.companiesCreated} companies, ${result.contactsCreated} contacts` });
    } catch (e: any) {
      toast({ title: "MARK Contacts import failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function skipLabel(r: string) {
    if (r === "missing_company") return "Missing Company";
    if (r === "missing_name") return "Missing name";
    if (r === "duplicate_row") return "Duplicate name+email in group";
    return r;
  }

  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card p-5" data-testid="section-mark-contacts-import">
      <header className="mb-4">
        <h2 className="text-base font-semibold">MARK Contacts (CRM)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Imports the MARK Contacts tab into <span className="font-mono">companies</span> /{" "}
          <span className="font-mono">company_contacts</span> only. Does not write accounts, leases, cars, or rider contacts.
          Re-run is idempotent: same normalized company + name/email is skipped.
        </p>
      </header>

      {committed && (
        <div className="rounded-lg border border-umler-teal/30 bg-umler-teal/10 p-5 mb-4" data-testid="mark-contacts-commit-report">
          <CheckCircle2 className="h-7 w-7 text-emerald-400 mb-2" />
          <div className="text-sm font-semibold">MARK Contacts committed</div>
          <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <div>Companies created: <span className="font-mono-num">{committed.companiesCreated}</span></div>
            <div>Contacts created: <span className="font-mono-num">{committed.contactsCreated}</span></div>
            <div>Companies already present: <span className="font-mono-num">{committed.companiesSkippedExisting}</span></div>
            <div>Contacts already present: <span className="font-mono-num">{committed.contactsSkippedExisting}</span></div>
            <div>Source rows skipped: <span className="font-mono-num">{committed.skippedSource}</span></div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Directory search is live at <Link href="/contacts" className="underline">Contacts</Link>.
          </p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => { setCommitted(null); setFileName(null); setRows([]); }}>
            Import again
          </Button>
        </div>
      )}

      {!committed && (
        <>
          <div
            className={cn(
              "rounded-lg border-2 border-dashed border-border bg-background hover:border-primary/50 transition-colors cursor-pointer text-center p-8",
              loading && "opacity-60 pointer-events-none",
            )}
            onClick={() => canEdit && fileRef.current?.click()}
          >
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm">{fileName || "Drop Working_File_for_CRM_Data workbook (MARK Contacts sheet)"}</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={!canEdit}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </>
      )}

      {loading && <div className="text-xs text-muted-foreground mt-3">Working…</div>}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border p-3 text-sm grid grid-cols-2 gap-1">
            <div>Source rows: <span className="font-mono-num">{preview.sourceRows}</span></div>
            <div>Companies to create: <span className="font-mono-num">{preview.companiesToCreate}</span></div>
            <div>Contacts to create: <span className="font-mono-num">{preview.contactsToCreate}</span></div>
            <div>Already imported companies: <span className="font-mono-num">{preview.companiesAlreadyPresent}</span></div>
            <div>Already imported contacts: <span className="font-mono-num">{preview.contactsAlreadyPresent}</span></div>
            <div>Skipped rows: <span className="font-mono-num">{preview.skipped.length}</span></div>
          </div>

          {preview.skipped.length > 0 && (
            <div className="text-xs text-amber-400">
              <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
              Skips: {preview.skipped.slice(0, 12).map((s) => `r${s.row} ${skipLabel(s.reason)}`).join("; ")}
              {preview.skipped.length > 12 ? "…" : ""}
            </div>
          )}

          {preview.multiSpellingGroups.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <Info className="inline h-3.5 w-3.5 mr-1" />
              {preview.multiSpellingGroups.length} groups with more than 2 original spellings (review, not a stop):
              <ul className="mt-1 list-disc pl-5">
                {preview.multiSpellingGroups.map((g) => (
                  <li key={g.normalized}>{g.spellings.join(" / ")} ({g.rowCount} rows)</li>
                ))}
              </ul>
            </div>
          )}

          {preview.spellingSplits?.length > 0 && (
            <div className="text-xs text-amber-400">
              <Info className="inline h-3.5 w-3.5 mr-1" />
              Split into separate companies (light-normalize + disjoint marks). Undo later via merge if wrong:
              <ul className="mt-1 list-disc pl-5">
                {preview.spellingSplits.map((g) => (
                  <li key={g.normalized}>
                    {g.borderline ? "Borderline (suffix present vs omitted) — " : ""}
                    {g.companies.map((c) => `${c.name} [${c.marks.join(", ") || "no marks"}]`).join("  |  ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.markConflictGroups.length > 0 && (
            <div className="text-xs text-amber-400">
              {preview.markConflictGroups.length} companies have conflicting reporting-mark sets across rows (union kept):
              <ul className="mt-1 list-disc pl-5">
                {preview.markConflictGroups.map((g) => (
                  <li key={g.name}>{g.name}</li>
                ))}
              </ul>
            </div>
          )}

          {canEdit && (
            <Button onClick={() => void handleCommit()} disabled={loading || preview.companiesToCreate + preview.contactsToCreate === 0}>
              Import {preview.companiesToCreate} companies and {preview.contactsToCreate} contacts from MARK Contacts?
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
