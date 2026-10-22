-- K2: an ended assignment or rider is not an OL link.
-- assignment_status = off_lease_pending_remarketing, or rider lifecycle_status
-- off_lease_pending_remarketing / closed, makes on_ol false. The car then follows
-- the off-rent buckets, so a car whose lease was ended and set to Unassigned
-- counts as Unassigned rather than on rent or on lease-ended watch.
-- Expected effect is 0 until OL2222 writes those statuses onto cars that still
-- match an OL name. Rows already off the OL (EA2435 / OL2513 and other inactive
-- or EA riders) stay out of the operating KPIs.
-- Does not change public.rlms_is_on_ol. The gate is applied to its has_assignment argument.
--
-- Grants: service_role only.
-- v_rlms_car_kpi is not security_invoker and is owned by postgres, the same role
-- that creates this helper. A SELECT of that view runs as the owner, who can
-- execute the helper without a GRANT. The application never reads the view as
-- anon or authenticated: the server uses the service-role client, and the
-- browser client is auth-only. Those two roles are not callers, so they are
-- not granted EXECUTE. A direct call by anon or authenticated is denied.
--
-- The view is patched only when pg_get_viewdef (pretty) matches the 2026-10-22
-- baseline, md5 b1910c6f1b309dcfb500088d4ea5139a. In that definition the text
-- "a.railcar_id IS NOT NULL" is the has_assignment argument, eight times, and
-- nowhere else. Any other definition raises instead of being rewritten.
-- Re-running after the helper is already in the view is a no-op.

CREATE OR REPLACE FUNCTION public.rlms_kpi_has_ol_link(
  has_assignment boolean,
  assignment_status text,
  lifecycle_status text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(has_assignment, false) IS TRUE
    AND coalesce(assignment_status, '') IS DISTINCT FROM 'off_lease_pending_remarketing'
    AND coalesce(lifecycle_status, '') NOT IN ('off_lease_pending_remarketing', 'closed');
$$;

COMMENT ON FUNCTION public.rlms_kpi_has_ol_link(boolean, text, text) IS
  'False when the latest assignment or its rider is ended, so v_rlms_car_kpi.on_ol follows the lease end.';

REVOKE ALL ON FUNCTION public.rlms_kpi_has_ol_link(boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_kpi_has_ol_link(boolean, text, text) TO service_role;

DO $$
DECLARE
  def text;
  patched text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'railcar_assignments'
      AND column_name = 'assignment_status'
  ) THEN
    RAISE EXCEPTION 'railcar_assignments.assignment_status is required before K2';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'riders'
      AND column_name = 'lifecycle_status'
  ) THEN
    RAISE EXCEPTION 'riders.lifecycle_status is required before K2';
  END IF;

  def := pg_get_viewdef('public.v_rlms_car_kpi'::regclass, true);
  IF def LIKE '%rlms_kpi_has_ol_link%' THEN
    RETURN;
  END IF;
  IF md5(def) IS DISTINCT FROM 'b1910c6f1b309dcfb500088d4ea5139a' THEN
    RAISE EXCEPTION 'v_rlms_car_kpi does not match the K2 baseline (live md5 %, expected b1910c6f1b309dcfb500088d4ea5139a); refusing to replace it', md5(def);
  END IF;
  IF array_length(string_to_array(def, 'a.railcar_id IS NOT NULL'), 1) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'v_rlms_car_kpi has_assignment predicate is not the K2 baseline of 8';
  END IF;
  IF array_length(string_to_array(def, 'a0.rent_start_set_at'), 1) IS DISTINCT FROM 2
     OR position('a0.assignment_status' in def) > 0 THEN
    RAISE EXCEPTION 'v_rlms_car_kpi assignment column anchor is not the K2 baseline';
  END IF;

  def := replace(def, 'a0.rent_start_set_at', 'a0.rent_start_set_at, a0.assignment_status');

  patched := replace(
    def,
    'a.railcar_id IS NOT NULL',
    'public.rlms_kpi_has_ol_link(a.railcar_id IS NOT NULL, a.assignment_status, r.lifecycle_status)'
  );
  IF patched = def THEN
    RAISE EXCEPTION 'v_rlms_car_kpi predicate was not updated';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.v_rlms_car_kpi AS ' || patched;
END $$;
