-- K1: Lease-ended watch excludes scrap-program cars (lease_status matching SCRAP, including SCRAPPING).
-- Only the watch predicate changes. Leased and on rent are unchanged.
-- Expected delta: lease-ended watch about -13 (OL1826 Ingevity TFOX). Measured 13 on 2026-10-22.
-- Watch predicate added to the live function: coalesce(v.lease_status, '') !~* 'SCRAP'
-- Does not replace public.rlms_fleet_kpis(); the wrapper still calls this function.
--
-- The live function is patched in place. pg_get_functiondef must match the
-- 2026-10-22 baseline (md5 fe36996c988eb4913630512417f5fe39) or this migration
-- raises and leaves the function alone. A re-run after the SCRAP exclusion is
-- present does not rewrite the function.

DO $k1$
DECLARE
  live text;
  patched text;
  anchor text := $a$AND upper(btrim(coalesce(v.lease_status, ''))) !~ '(MTM|MONTH[[:space:]]*TO[[:space:]]*MONTH)'$a$;
  baseline text := 'fe36996c988eb4913630512417f5fe39';
  insertion text := anchor || E'\n    AND coalesce(v.lease_status, '''') !~* ''SCRAP''';
BEGIN
  live := pg_get_functiondef('public.rlms_fleet_kpis_core()'::regprocedure);
  IF live LIKE '%!~* ''SCRAP''%' THEN
    RAISE NOTICE 'K1 already applied to rlms_fleet_kpis_core()';
    RETURN;
  END IF;
  IF md5(live) IS DISTINCT FROM baseline THEN
    RAISE EXCEPTION 'rlms_fleet_kpis_core() does not match the K1 baseline (live md5 %, expected %); refusing to replace it', md5(live), baseline;
  END IF;
  IF strpos(live, anchor) = 0
     OR strpos(substr(live, strpos(live, anchor) + length(anchor)), anchor) > 0 THEN
    RAISE EXCEPTION 'K1 watch anchor is missing or not unique in rlms_fleet_kpis_core()';
  END IF;
  patched := replace(live, anchor, insertion);
  IF patched = live THEN
    RAISE EXCEPTION 'K1 did not insert the SCRAP exclusion';
  END IF;
  EXECUTE patched;
END
$k1$;

REVOKE ALL ON FUNCTION public.rlms_fleet_kpis_core() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis_core() TO service_role;
