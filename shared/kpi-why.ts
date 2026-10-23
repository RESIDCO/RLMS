import { kpiBucketTitle } from "./kpi-buckets";

export type KpiWhyInput = {
  bucket: string;
  reason?: string | null;
  primary?: string | null;
  statusTag?: string | null;
  derivedStatus?: string | null;
  lease?: string | null;
  lessee?: string | null;
};

export type KpiWhyLines = {
  title: string;
  status: string;
  lease: string;
};

function dash(value: string | null | undefined): string {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

/** The three lines in the optional "Why in this KPI" block on the shared car panel. */
export function kpiWhyLines(input: KpiWhyInput): KpiWhyLines {
  const reason = input.reason == null ? "" : String(input.reason).trim();
  return {
    title: reason || kpiBucketTitle(input.bucket),
    status: `${kpiBucketTitle(input.primary)} · tag ${dash(input.statusTag)} · derived ${dash(input.derivedStatus)}`,
    lease: `Lease ${dash(input.lease)} · ${dash(input.lessee)}`,
  };
}
