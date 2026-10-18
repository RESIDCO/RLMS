-- Additive: unlinked-car issue view was missing master_lease_id (no assignment row).
CREATE OR REPLACE VIEW public.v_lease_issue_unlinked AS
SELECT
  c.id AS railcar_id,
  btrim(coalesce(c.reporting_marks, '')) || ' ' || btrim(coalesce(c.car_number, '')) AS car,
  c.fleet_status,
  c.rider_external_id AS car_says_ol,
  c.lessee_name,
  rd.id AS proposed_rider_id,
  ml.lessee AS rider_lessee,
  ml.id AS master_lease_id
FROM public.railcars c
LEFT JOIN public.railcar_assignments a ON a.railcar_id = c.id
LEFT JOIN public.riders rd ON rd.rider_name = c.rider_external_id
LEFT JOIN public.master_leases ml ON ml.id = rd.master_lease_id
WHERE c.active = true
  AND a.id IS NULL;

GRANT SELECT ON public.v_lease_issue_unlinked TO authenticated, service_role;
