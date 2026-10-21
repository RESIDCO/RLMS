/**
 * Shared Loc / WM / C / Resp (and job/qualifier) hover help.
 * Format: "<code> – <description>"; missing → "<code> – not in reference table".
 */
import { useEffect, useId, useState } from "react";
import { closeHover, openHover, subscribeHover } from "./codeHoverBus";

export type CodeHoverKind =
  | "location"
  | "condition"
  | "why_made"
  | "responsibility"
  | "job"
  | "qualifier"
  | "removed_qualifier"
  | "car_part"
  | "category"
  | "detail_source"
  | "facility_type"
  | "record_format";

export function formatCodeTip(code: string, found: boolean, description: string): string {
  const c = (code || "").trim() || "—";
  if (!found) return `${c} – not in reference table`;
  const desc = (description || "").trim() || "not in reference table";
  // Avoid "code – code" when description is just the code
  if (desc.toLowerCase() === c.toLowerCase()) return `${c} – ${desc}`;
  return `${c} – ${desc}`;
}

/**
 * Login-free fetch for lessee pages; falls back to apiRequest when auth is present.
 * Ref lookup is intentionally public (codes are not secrets).
 */
async function lookupRef(kind: string, code: string, qualifier?: string | null) {
  const qs = new URLSearchParams({ kind, code: code ?? "" });
  if (qualifier != null) qs.set("qualifier", qualifier);
  const res = await fetch(`/api/repair/ref/lookup?${qs}`);
  if (!res.ok) {
    return { found: false, description: "not in reference table" };
  }
  return res.json() as Promise<{
    found?: boolean;
    description?: string;
    category?: string | null;
    sub_category?: string | null;
  }>;
}

export function CodeHover({
  kind,
  code,
  qualifier,
  children,
  className,
}: {
  kind: CodeHoverKind | string;
  code?: string | null;
  qualifier?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const [tip, setTip] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => subscribeHover((a) => setActive(a === id)), [id]);
  useEffect(() => {
    const isQual = kind === "qualifier" || kind === "removed_qualifier";
    if (!active || (!code && !isQual)) return;
    let cancelled = false;
    void lookupRef(kind, code ?? "", isQual || qualifier != null ? qualifier ?? "" : null)
      .then((data) => {
        if (cancelled) return;
        const cat = [data.category, data.sub_category].filter(Boolean).join(" / ");
        const base = data.description || "not in reference table";
        const withCat = cat ? `${base} · ${cat}` : base;
        setTip(formatCodeTip(code ?? "", Boolean(data.found), withCat));
      })
      .catch(() => {
        if (!cancelled) setTip(formatCodeTip(code ?? "", false, "not in reference table"));
      });
    return () => {
      cancelled = true;
    };
  }, [active, kind, code, qualifier]);

  const isQual = kind === "qualifier" || kind === "removed_qualifier";
  if (!code && !isQual) return <>{children}</>;

  return (
    <span
      className={
        className ??
        "relative cursor-help border-b border-dotted border-slate-500/60 text-inherit"
      }
      tabIndex={0}
      onMouseEnter={() => openHover(id)}
      onMouseLeave={() => closeHover(id)}
      onFocus={() => openHover(id)}
      onBlur={() => closeHover(id)}
    >
      {children}
      {active && tip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-30 left-0 top-full mt-1 max-w-[18rem] rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 shadow-md whitespace-normal"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}

export type CodeFace = { found: boolean; description: string };

/** Visible code plus description. Missing reference rows say "unknown code". */
export function repairCodeText(code: string | null | undefined, face: CodeFace | null | undefined): string {
  const c = (code || "").trim() || "—";
  if (!face) return c;
  if (!face.found) return `${c} – unknown code`;
  const desc = face.description.trim();
  if (!desc || desc.toLowerCase() === "not in reference table") return `${c} – unknown code`;
  return `${c} – ${desc}`;
}

/**
 * Same hover tooltip as estimate review, with the decoded description in the cell
 * when a reference lookup result is already available.
 */
export function RepairCode({
  kind,
  code,
  qualifier,
  face,
}: {
  kind: CodeHoverKind;
  code?: string | null;
  qualifier?: string | null;
  face?: CodeFace | null;
}) {
  const text = repairCodeText(code, face);
  const tip = face
    ? formatCodeTip(code ?? "", face.found, face.found ? face.description : "not in reference table")
    : undefined;
  return (
    <CodeHover kind={kind} code={code} qualifier={qualifier}>
      <span title={tip}>{text}</span>
    </CodeHover>
  );
}

/** Display blank codes as an em dash for readability. */
export function dash(v: unknown): string {
  if (v == null) return "—";
  const s = String(v).trim();
  return s === "" ? "—" : s;
}
