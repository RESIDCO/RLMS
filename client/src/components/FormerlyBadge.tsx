export function FormerlyBadge({ formerly }: { formerly?: string | null }) {
  if (!formerly) return null;
  return (
    <span
      className="text-[10px] rounded bg-muted px-1 py-0.5 text-muted-foreground whitespace-nowrap"
      title={formerly}
    >
      {formerly}
    </span>
  );
}
