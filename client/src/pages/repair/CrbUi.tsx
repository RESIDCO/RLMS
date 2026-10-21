/**
 * Shared CRB review widgets. Colors come from --repair-* chip classes.
 */
import type { ReactNode } from "react";

export function crbMoney(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  return (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function crbPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
}

export type ChipTone = "ok" | "warn" | "stop" | "info";

export function CrbChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`repair-chip repair-chip-${tone}`}>{children}</span>;
}

export function toneForStatus(status: string): ChipTone {
  if (status === "APPROVED" || status === "READY" || status === "BALANCED") return "ok";
  if (status === "HARD_STOP" || status === "OUT_OF_BALANCE" || status === "REJECTED" || status === "RETURN_UNPAID") {
    return "stop";
  }
  if (status === "WARN" || status === "IN_REVIEW" || status === "OVERRIDDEN" || status === "REJECTED_PARTIAL") {
    return "warn";
  }
  return "info";
}

export async function crbJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
