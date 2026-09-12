-- railcars.current_assignment_id is the internal railcar_assignments.id,
-- not the VCF source ASSIGNMENT_ID (that lives on assignment_history.assignment_id_ext).

COMMENT ON COLUMN public.railcars.current_assignment_id IS
  'Internal railcar_assignments.id (text). Not the VCF ASSIGNMENT_ID.';

UPDATE public.railcars r
SET current_assignment_id = a.id::text
FROM public.railcar_assignments a
WHERE a.railcar_id = r.id
  AND r.current_assignment_id IS DISTINCT FROM a.id::text;

UPDATE public.railcars r
SET current_assignment_id = NULL
WHERE r.current_assignment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.railcar_assignments a
    WHERE a.railcar_id = r.id
      AND a.id::text = r.current_assignment_id
  );
