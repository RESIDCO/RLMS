import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMonthLong, moneyAbbrev, type LoadChangeReport } from "@shared/financial-load-review";

export type IntegrityCheckView = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  warning?: boolean;
};

function ReviewBlock({
  title,
  count,
  danger,
  children,
}: {
  title: string;
  count: number;
  danger?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <div
      className={cn(
        "rounded-lg border bg-background",
        danger && count > 0 ? "border-amber-500/50" : "border-border"
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span>{title}</span>
        <span className={cn("ml-auto tabular-nums text-xs", count ? "text-foreground" : "text-muted-foreground")}>
          {count}
        </span>
      </button>
      {open && <div className="border-t border-border px-4 py-3 text-xs">{children}</div>}
    </div>
  );
}

function delta(n: number, money = false): string {
  const sign = n > 0 ? "+" : "";
  return money ? `${sign}${moneyAbbrev(n)}` : `${sign}${n.toLocaleString()}`;
}

export function FinancialChangeSections({ report }: { report: LoadChangeReport }) {
  const t = report.totals;
  return (
    <div className="space-y-3">
      {report.gap && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <div className="font-medium text-foreground">Snapshot gap</div>
              <div className="mt-1 text-xs text-muted-foreground">{report.gap.message}</div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium"> </th>
              <th className="px-3 py-2 text-right font-medium">{t.baseLabel ?? "Prior"}</th>
              <th className="px-3 py-2 text-right font-medium">{formatMonthLong(report.snapshotMonth)}</th>
              <th className="px-3 py-2 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-3 py-1.5">Cars</td>
              <td className="px-3 py-1.5 text-right font-mono">{(t.base?.cars ?? 0).toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono">{t.file.cars.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono">{delta(t.delta.cars)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-3 py-1.5">Total book value</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.base?.totalBookValue ?? 0)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.file.totalBookValue)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{delta(t.delta.totalBookValue, true)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-3 py-1.5">Monthly rent</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.base?.monthlyRent ?? 0)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.file.monthlyRent)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{delta(t.delta.monthlyRent, true)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-3 py-1.5">Monthly depreciation</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.base?.monthlyDepreciation ?? 0)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{moneyAbbrev(t.file.monthlyDepreciation)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{delta(t.delta.monthlyDepreciation, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ReviewBlock title="New keys" count={report.newKeys.length}>
        {report.newKeys.length === 0 ? (
          <div className="text-muted-foreground">None — every key was already in {t.baseLabel ?? "the prior month"}.</div>
        ) : (
          <ul className="space-y-1">
            {report.newKeys.map((k) => (
              <li key={`${k.rider_id}|${k.car_type}|${k.entity}`}>
                <span className="font-mono">{k.rider_id}</span> · {k.car_type} ({k.entity}) × {k.new_count}
              </li>
            ))}
          </ul>
        )}
      </ReviewBlock>

      <ReviewBlock title="Dropped keys" count={report.droppedKeys.length} danger>
        {report.droppedKeys.length === 0 ? (
          <div className="text-muted-foreground">None — no key from {t.baseLabel ?? "the prior month"} is missing.</div>
        ) : (
          <div>
            <div className="mb-2 font-medium text-amber-600">
              A dropped key can mean a sheet or row was lost. Confirm before committing.
            </div>
            <ul className="space-y-1">
              {report.droppedKeys.map((k) => (
                <li key={`${k.rider_id}|${k.car_type}|${k.entity}`}>
                  <span className="font-mono">{k.rider_id}</span> · {k.car_type} ({k.entity}) was × {k.old_count}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ReviewBlock>

      <ReviewBlock title="Car count changes" count={report.carCountChanges.length}>
        <ul className="max-h-56 space-y-1 overflow-auto">
          {report.carCountChanges.map((k) => (
            <li key={`${k.rider_id}|${k.car_type}|${k.entity}`}>
              <span className="font-mono">{k.rider_id}</span> · {k.car_type} ({k.entity}) {k.old_count} → {k.new_count}
            </li>
          ))}
        </ul>
      </ReviewBlock>

      <ReviewBlock title="Lease date changes" count={report.leaseDateChanges.length}>
        <ul className="max-h-56 space-y-1 overflow-auto">
          {report.leaseDateChanges.map((k) => (
            <li key={k.rider_id}>
              <span className="font-mono">{k.rider_id}</span> {k.old_date ?? "(none)"} → {k.new_date} · {k.cars} cars
              {k.possible_renewal && (
                <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-600">
                  possible renewal{k.months_delta != null ? ` (${k.months_delta} months)` : ""}
                </span>
              )}
              {k.active_to_expired && (
                <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-600">
                  active → expired
                </span>
              )}
            </li>
          ))}
        </ul>
      </ReviewBlock>

      <ReviewBlock title="Rent and cost changes" count={report.rentCostChanges.length}>
        <ul className="max-h-56 space-y-1 overflow-auto">
          {report.rentCostChanges.map((k) => (
            <li key={`${k.rider_id}|${k.car_type}|${k.entity}`}>
              <span className="font-mono">{k.rider_id}</span> · {k.car_type}
              {k.old_rent_per_car != null && k.new_rent_per_car != null && k.old_rent_per_car !== k.new_rent_per_car && (
                <> · rent ${k.old_rent_per_car} → ${k.new_rent_per_car}</>
              )}
              {k.old_cost_per_car != null && k.new_cost_per_car != null && k.old_cost_per_car !== k.new_cost_per_car && (
                <> · cost ${Number(k.old_cost_per_car).toLocaleString()} → ${Number(k.new_cost_per_car).toLocaleString()}</>
              )}
              {" "}on {k.new_count} cars
            </li>
          ))}
        </ul>
      </ReviewBlock>

      <ReviewBlock title="Status changes" count={report.statusChanges.length}>
        <ul className="space-y-1">
          {report.statusChanges.map((k) => (
            <li key={k.rider_id}>
              <span className="font-mono">{k.rider_id}</span> {k.old_cell} → {k.new_cell} · {k.cars} cars
            </li>
          ))}
        </ul>
      </ReviewBlock>

      <ReviewBlock
        title="Book value outliers"
        count={report.bvOutliers.length + report.bvIncreases.length + report.financedLeasePaydowns.length}
      >
        <div className="mb-2 text-muted-foreground">
          {report.bvWithinTolerance} of {report.bvSameCountKeys} same-count keys within ±15% of expected depreciation
          {report.gap ? ` × ${report.gap.monthsElapsed} months` : ""}.
        </div>
        {report.bvIncreases.length > 0 && (
          <div className="mb-2">
            <div className="font-medium text-amber-600">BV increased</div>
            <ul className="space-y-1">
              {report.bvIncreases.map((k) => (
                <li key={`inc-${k.rider_id}-${k.car_type}`}>
                  <span className="font-mono">{k.rider_id}</span> {moneyAbbrev(k.old_bv ?? 0)} → {moneyAbbrev(k.new_bv ?? 0)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.financedLeasePaydowns.length > 0 && (
          <div className="mb-2">
            <div className="font-medium">Financed-lease paydown (zero depreciation, falling BV)</div>
            <ul className="space-y-1">
              {report.financedLeasePaydowns.map((k) => (
                <li key={`fl-${k.rider_id}-${k.car_type}`}>
                  <span className="font-mono">{k.rider_id}</span> {moneyAbbrev(k.old_bv ?? 0)} → {moneyAbbrev(k.new_bv ?? 0)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.bvOutliers.length > 0 && (
          <div>
            <div className="font-medium">Outside ±15% of expected</div>
            <ul className="max-h-48 space-y-1 overflow-auto">
              {report.bvOutliers.map((k) => (
                <li key={`out-${k.rider_id}-${k.car_type}`}>
                  <span className="font-mono">{k.rider_id}</span> drop {moneyAbbrev(k.actual_bv_drop ?? 0)} vs expected{" "}
                  {moneyAbbrev(k.expected_bv_drop ?? 0)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ReviewBlock>

      <ReviewBlock title="Rider car-count mismatches" count={report.riderMismatches.length}>
        <ul className="max-h-64 space-y-1 overflow-auto">
          {report.riderMismatches.map((k) => (
            <li key={k.rider_id}>
              <span className="font-mono">{k.rider_id}</span> file {k.file_cars} vs RLMS {k.rlms_active_cars}{" "}
              ({k.difference > 0 ? "+" : ""}
              {k.difference})
            </li>
          ))}
        </ul>
      </ReviewBlock>

      <ReviewBlock title="Suggested matches for unmatched riders" count={report.suggestedMatches.length}>
        {report.suggestedMatches.length === 0 ? (
          <div className="text-muted-foreground">No Former Deal suggestions. Nothing is auto-applied.</div>
        ) : (
          <ul className="space-y-1">
            {report.suggestedMatches.map((s) => (
              <li key={s.file_rider}>
                <span className="font-mono">{s.file_rider}</span> → <span className="font-mono">{s.suggested_rider}</span>
                <span className="text-muted-foreground"> — {s.note}</span>
              </li>
            ))}
          </ul>
        )}
      </ReviewBlock>
    </div>
  );
}

export function IntegrityChecksList({ checks }: { checks: IntegrityCheckView[] }) {
  return (
    <div className="space-y-2">
      {checks.map((c) => {
        const failed = !c.pass;
        const warn = !!c.warning && c.pass;
        return (
          <div
            key={c.id}
            className={cn(
              "rounded-md border p-3 text-xs",
              failed && "border-red-500/40 bg-red-500/10",
              warn && "border-amber-500/40 bg-amber-500/10",
              !failed && !warn && "border-emerald-500/30 bg-emerald-500/10"
            )}
          >
            <div className="flex items-start gap-2">
              {failed ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              ) : warn ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              )}
              <div>
                <div className="font-medium text-foreground">
                  {failed ? "FAIL" : warn ? "Warning" : "Pass"} — {c.label}
                </div>
                <div className="mt-0.5 text-muted-foreground">{c.detail}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function sheet(rows: Record<string, unknown>[]) {
  return rows.length ? rows : [{ note: "none" }];
}

export async function downloadChangeReportXlsx(
  report: LoadChangeReport,
  checks: IntegrityCheckView[] | undefined,
  fileBase: string
) {
  const XLSX = (window as any).XLSX;
  if (!XLSX) return;
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet(rows)), name.slice(0, 31));
  };
  add("Totals", [
    {
      metric: "cars",
      prior: report.totals.base?.cars ?? 0,
      file: report.totals.file.cars,
      delta: report.totals.delta.cars,
    },
    {
      metric: "total_book_value",
      prior: report.totals.base?.totalBookValue ?? 0,
      file: report.totals.file.totalBookValue,
      delta: report.totals.delta.totalBookValue,
    },
    {
      metric: "monthly_rent",
      prior: report.totals.base?.monthlyRent ?? 0,
      file: report.totals.file.monthlyRent,
      delta: report.totals.delta.monthlyRent,
    },
    {
      metric: "monthly_depreciation",
      prior: report.totals.base?.monthlyDepreciation ?? 0,
      file: report.totals.file.monthlyDepreciation,
      delta: report.totals.delta.monthlyDepreciation,
    },
  ]);
  if (report.gap) add("Snapshot gap", [{ message: report.gap.message }]);
  add("New keys", report.newKeys as unknown as Record<string, unknown>[]);
  add("Dropped keys", report.droppedKeys as unknown as Record<string, unknown>[]);
  add("Car count changes", report.carCountChanges as unknown as Record<string, unknown>[]);
  add("Lease date changes", report.leaseDateChanges as unknown as Record<string, unknown>[]);
  add("Rent and cost", report.rentCostChanges as unknown as Record<string, unknown>[]);
  add("Status changes", report.statusChanges as unknown as Record<string, unknown>[]);
  add("BV outliers", [...report.bvIncreases, ...report.bvOutliers, ...report.financedLeasePaydowns] as unknown as Record<string, unknown>[]);
  add("Rider mismatches", report.riderMismatches as unknown as Record<string, unknown>[]);
  add("Suggested matches", report.suggestedMatches as unknown as Record<string, unknown>[]);
  if (checks?.length) add("Integrity", checks as unknown as Record<string, unknown>[]);
  XLSX.writeFile(wb, `${fileBase}-change-report.xlsx`);
}

export function DownloadChangeReportButton({
  report,
  checks,
  fileBase,
}: {
  report: LoadChangeReport;
  checks?: IntegrityCheckView[];
  fileBase: string;
}) {
  return (
    <Button
      variant="secondary"
      onClick={() => downloadChangeReportXlsx(report, checks, fileBase)}
      data-testid="button-download-change-report"
    >
      <Download className="mr-1.5 h-3.5 w-3.5" />
      Download change report
    </Button>
  );
}
