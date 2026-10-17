import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { previewAndUndo } from "@/lib/undo";

type Eligible = {
  change_group: string;
  count: number;
  occurred_at?: string;
  action?: string;
} | null;

export function UndoLastChange({
  railcarId,
  programId,
}: {
  railcarId?: number;
  programId?: number;
}) {
  const params = new URLSearchParams();
  if (railcarId) params.set("railcar_id", String(railcarId));
  if (programId) params.set("program_id", String(programId));
  const { data, refetch } = useQuery<Eligible>({
    queryKey: ["/api/undo/eligible", railcarId ?? null, programId ?? null],
    queryFn: () => apiRequest("GET", `/api/undo/eligible?${params.toString()}`).then((r) => r.json()),
    enabled: Boolean(railcarId || programId),
  });
  if (!data?.change_group) return null;
  const label = (data.count ?? 1) > 1 ? `Undo ${data.count} changes` : "Undo last change";
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        const ok = await previewAndUndo(data.change_group);
        if (ok) void refetch();
      }}
    >
      {label}
    </Button>
  );
}
