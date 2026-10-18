import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function SavedFilters({
  onPick,
}: {
  onPick: (query: unknown) => void;
}) {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/railcars/lists"],
    queryFn: () => apiRequest("GET", "/api/railcars/lists").then((r) => r.json()).catch(() => []),
  });
  if (!data.length) return null;
  return (
    <select
      className="h-8 border rounded px-2 text-xs"
      defaultValue=""
      onChange={(e) => {
        const row = data.find((d) => String(d.id) === e.target.value);
        if (row) onPick(row.query);
      }}
    >
      <option value="">Saved filters</option>
      {data.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}
