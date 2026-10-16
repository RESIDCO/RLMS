-- Occidental OL1818 intercompany, not sold (Bruce 2026-10-15).
-- Do not run until Bruce signs off preview_occidental_ol1818_unsold.csv.
-- Active cars only. Never touch the 66 inactive AEX/HMBX rows.

UPDATE public.master_leases
SET sold_to = NULL
WHERE id = 371
  AND sold_to = 'Sold to SRIX';

UPDATE public.railcars rc
SET sold_to = NULL
WHERE rc.active IS TRUE
  AND rc.sold_to = 'Sold to SRIX'
  AND EXISTS (
    SELECT 1
    FROM public.railcar_assignments a0
    JOIN public.riders r ON r.id = a0.rider_id
    WHERE a0.railcar_id = rc.id
      AND r.id = 557
      AND a0.id = (
        SELECT max(a1.id) FROM public.railcar_assignments a1 WHERE a1.railcar_id = rc.id
      )
  );

INSERT INTO public.assignment_history (
  railcar_id, from_rider_id, to_rider_id, moved_at, moved_by, reason, comment
)
SELECT
  rc.id,
  a.rider_id,
  a.rider_id,
  now(),
  'bruce:2026-10-15',
  'OL1818 intercompany, not sold (Bruce 2026-10-15)',
  'OL1818 intercompany, not sold (Bruce 2026-10-15)'
FROM public.railcars rc
JOIN LATERAL (
  SELECT a0.rider_id
  FROM public.railcar_assignments a0
  WHERE a0.railcar_id = rc.id
  ORDER BY a0.id DESC
  LIMIT 1
) a ON true
JOIN public.riders r ON r.id = a.rider_id AND r.id = 557
WHERE rc.active IS TRUE;
