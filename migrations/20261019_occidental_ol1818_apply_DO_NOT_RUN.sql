-- Occidental OL1818 intercompany, not sold (Bruce 2026-10-15).
-- Do not run until Bruce signs off preview_occidental_ol1818_unsold.csv.
-- Touches only master lease 371 and the 30 active OCCX cars on OL1818 (rider 557).
-- Inactive records are never touched. Re-run must not duplicate history.

BEGIN;

UPDATE public.master_leases
SET sold_to = NULL
WHERE id = 371
  AND sold_to = 'Sold to SRIX';

WITH changed AS (
  UPDATE public.railcars rc
  SET sold_to = NULL
  WHERE rc.active IS TRUE
    AND upper(btrim(coalesce(rc.reporting_marks, ''))) = 'OCCX'
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
    )
  RETURNING rc.id
)
INSERT INTO public.assignment_history (
  railcar_id, from_rider_id, to_rider_id, moved_at, moved_by, reason, comment
)
SELECT
  c.id,
  a.rider_id,
  a.rider_id,
  now(),
  'bruce:2026-10-15',
  'OL1818 intercompany, not sold (Bruce 2026-10-15)',
  'OL1818 intercompany, not sold (Bruce 2026-10-15)'
FROM changed c
JOIN LATERAL (
  SELECT a0.rider_id
  FROM public.railcar_assignments a0
  WHERE a0.railcar_id = c.id
  ORDER BY a0.id DESC
  LIMIT 1
) a ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.assignment_history ah
  WHERE ah.railcar_id = c.id
    AND ah.reason = 'OL1818 intercompany, not sold (Bruce 2026-10-15)'
);

COMMIT;
