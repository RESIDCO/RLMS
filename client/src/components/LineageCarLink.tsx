import { Link, useLocation } from "wouter";
import { useHashSearch } from "@/lib/hash-location";
import { lineageCarHref } from "@shared/lineage-link";

/** Same-tab Lineage for one car. Back returns to the list that opened it. */
export function LineageCarLink({
  id,
  reportingMarks,
  carNumber,
  query,
}: {
  id?: number | null;
  reportingMarks?: string | null;
  carNumber?: string | null;
  query?: string | null;
}) {
  const carId = Number(id);
  const [path] = useLocation();
  const search = useHashSearch();
  if (!Number.isFinite(carId) || carId <= 0) return null;
  const href = lineageCarHref(
    { id: carId, reporting_marks: reportingMarks, car_number: carNumber, query },
    `${path}${search}`,
  );
  return (
    <Link
      href={href}
      data-testid={`link-lineage-${carId}`}
      className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary"
      onClick={(e) => e.stopPropagation()}
    >
      Lineage
    </Link>
  );
}
