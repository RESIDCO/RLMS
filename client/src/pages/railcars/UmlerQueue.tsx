import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { BulkEditDrawer } from "./BulkEditDrawer";
import { formatCarId } from "@shared/residco-import";

export default function UmlerQueue() {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/railcars/umler-queue"],
    queryFn: () => apiRequest("GET", "/api/railcars/umler-queue").then((r) => r.json()),
  });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [drawer, setDrawer] = useState(false);
  const ids = data.map((r) => Number(r.id));
  return (
    <div className="p-4">
      <PageHeader title="UMLER deletion queue" subtitle={`${data.length} cars with scrapped_at pending UMLER deleted`} />
      <div className="flex gap-2 mb-3">
        <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button
          size="sm"
          disabled={!ids.length}
          onClick={() => {
            setDrawer(true);
          }}
        >
          Mark deleted in UMLER ({date})
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground text-xs">
            <th>Car</th><th>Scrapped</th><th>UMLER</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="font-mono">{formatCarId(r)}</td>
              <td>{String(r.scrapped_at ?? "").slice(0, 10)}</td>
              <td>{r.umler_status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {drawer ? (
        <BulkEditDrawer railcarIds={ids} onClose={() => setDrawer(false)} />
      ) : null}
    </div>
  );
}
