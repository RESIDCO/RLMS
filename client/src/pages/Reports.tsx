import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, Download, FileSpreadsheet } from "lucide-react";
import { apiRequest, apiGet } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ExportJob = {
  id: string;
  status: "running" | "ready" | "error";
  error?: string;
  filename?: string;
  rowCount?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Reports() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportVValid() {
    setExporting(true);
    try {
      const startRes = await apiRequest("POST", "/api/reports/v-valid-cars/jobs");
      const started = (await startRes.json()) as { id: string };
      const deadline = Date.now() + 180_000;
      let job: ExportJob | null = null;
      while (Date.now() < deadline) {
        await sleep(1000);
        job = await apiGet<ExportJob>(`/api/reports/v-valid-cars/jobs/${started.id}`);
        if (job.status === "ready") break;
        if (job.status === "error") {
          throw new Error(job.error || "Export failed");
        }
      }
      if (!job || job.status !== "ready") {
        throw new Error("Export is still running after 3 minutes. Try again.");
      }
      const res = await apiRequest("GET", `/api/reports/v-valid-cars/jobs/${started.id}/file`);
      const blob = await res.blob();
      const filename = job.filename || `V_VALID_CARS_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({
        title: "Export failed",
        description: e.message ?? "Could not build the V_Valid Car File.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Fleet, lease, and financial reporting — coming soon"
      />
      <div className="px-4 sm:px-8 py-8 max-w-2xl space-y-4">
        <Card data-testid="card-vcf-export">
          <CardContent className="pt-6 flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-umler-panel2">
              <FileSpreadsheet className="h-5 w-5 text-umler-steel" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-base font-semibold tracking-tight text-foreground">
                V_Valid Car File Export
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                Reconstructs the original monthly car/assignment file format from live RLMS data — one
                row per assignment period, active and inactive, for every car ever loaded.
              </p>
              <Button
                className="mt-4"
                onClick={exportVValid}
                disabled={exporting}
                data-testid="button-export-v-valid"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Building export…" : "Export V_Valid Car File (.xlsx)"}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Builds in the background so the download is not cut off by a proxy timeout. OLD_CAR_INITIAL
                / OLD_CAR_NUMBER are matched when a remark’s date equals that period’s start date — a
                best-effort reconstruction, not a guaranteed row-level link.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-umler-panel2">
              <ClipboardList className="h-5 w-5 text-umler-steel" />
            </div>
            <div>
              <h2 className="font-serif text-base font-semibold tracking-tight text-foreground">
                Coming soon
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                Reports will live here — scheduled and on-demand views of the fleet, leases,
                utilization, and financials. This section is a placeholder while we spec the first
                report set.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
