-- Forward-looking lease expiry estimate for active cars, derived from the
-- Asset Report (rider_financial_summary.months_until_lease_exp).
-- Never reuse lease_end_date / lease_expiry — those stay VCF termination dates.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS estimated_lease_expiry date,
  ADD COLUMN IF NOT EXISTS lease_expiry_snapshot_month date;

COMMENT ON COLUMN public.railcars.estimated_lease_expiry IS
  'Derived expiry for an active car from the Asset Report rider+legal_owner term. Not a contractual VCF end date.';

COMMENT ON COLUMN public.railcars.lease_expiry_snapshot_month IS
  'rider_financial_summary.snapshot_month that produced estimated_lease_expiry.';

CREATE INDEX IF NOT EXISTS idx_railcars_estimated_lease_expiry
  ON public.railcars (estimated_lease_expiry)
  WHERE active IS TRUE AND estimated_lease_expiry IS NOT NULL;

-- One-time backfill against the latest rider_financial_summary snapshot.
-- Same formula as shared/lease-authority.ts (add N months, then minus 1 day).
-- Conflicting rider+legal_owner month counts stay null. Inactive cars are not touched.
-- Re-running is safe. Monthly refreshes after this are done by Financial Data Refresh.

WITH latest AS (
  SELECT max(snapshot_month)::date AS snap
  FROM public.rider_financial_summary
),
grouped AS (
  SELECT
    upper(btrim(rider_id)) AS rider,
    upper(btrim(coalesce(legal_owner, ''))) AS owner,
    array_agg(DISTINCT round(months_until_lease_exp::numeric)) AS months
  FROM public.rider_financial_summary r
  JOIN latest l ON r.snapshot_month = l.snap
  WHERE r.months_until_lease_exp IS NOT NULL
    AND btrim(coalesce(r.rider_id, '')) <> ''
  GROUP BY 1, 2
),
ok AS (
  SELECT rider, owner, months[1]::int AS months
  FROM grouped
  WHERE cardinality(months) = 1
),
computed AS (
  SELECT
    c2.id,
    CASE
      WHEN o.months IS NULL THEN NULL
      ELSE ((l.snap + (o.months * interval '1 month'))::date - 1)
    END AS estimated,
    CASE WHEN o.months IS NULL THEN NULL ELSE l.snap END AS snap
  FROM public.railcars c2
  CROSS JOIN latest l
  LEFT JOIN ok o
    ON o.rider = upper(btrim(coalesce(c2.rider_external_id, '')))
   AND o.owner = upper(btrim(coalesce(c2.legal_owner, '')))
  WHERE c2.active IS TRUE
)
UPDATE public.railcars c
SET
  estimated_lease_expiry = v.estimated,
  lease_expiry_snapshot_month = v.snap
FROM computed v
WHERE c.id = v.id
  AND c.active IS TRUE;

SELECT
  (SELECT count(*) FROM public.railcars WHERE active IS TRUE AND estimated_lease_expiry IS NOT NULL) AS active_with_estimate,
  (SELECT count(*) FROM public.railcars WHERE active IS TRUE AND estimated_lease_expiry IS NULL) AS active_without_estimate,
  (SELECT count(*) FROM public.railcars WHERE active IS NOT TRUE AND estimated_lease_expiry IS NOT NULL) AS inactive_with_estimate,
  (SELECT min(estimated_lease_expiry::text) FROM public.railcars WHERE active IS TRUE AND rider_external_id ILIKE 'OL1706') AS ol1706_estimated_lease_expiry,
  (SELECT min(lease_expiry_snapshot_month::text) FROM public.railcars WHERE active IS TRUE AND rider_external_id ILIKE 'OL1706') AS ol1706_snapshot_month;

