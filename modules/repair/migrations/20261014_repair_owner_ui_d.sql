-- Owner UI §D Estimate Review — billing category + line display columns.
-- Soft-add only; no hard deletes.

ALTER TABLE repair.estimates
  ADD COLUMN IF NOT EXISTS billing_category text NOT NULL DEFAULT 'Bad Order';

ALTER TABLE repair.estimate_lines
  ADD COLUMN IF NOT EXISTS location_on_car text,
  ADD COLUMN IF NOT EXISTS quantity text,
  ADD COLUMN IF NOT EXISTS removed_job_code text,
  ADD COLUMN IF NOT EXISTS removed_qualifier text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS machine_priceable text;

-- Shot 05 labels for owner-settable codes (admin-editable thereafter).
UPDATE repair.responsibility_codes AS r SET
  display_name = v.display_name,
  description = COALESCE(r.description, v.description)
FROM (VALUES
  ('1', 'Owners', 'RESIDCO responsibility code 1'),
  ('2', 'Handling Line', 'RESIDCO responsibility code 2'),
  ('4', 'Capital Program', 'RESIDCO responsibility code 4'),
  ('5', 'Lease Return', 'RESIDCO responsibility code 5'),
  ('6', 'Rebill', 'RESIDCO responsibility code 6 — Rebill (lessee approval path)'),
  ('7', 'No Rebill', 'RESIDCO responsibility code 7'),
  ('8', 'Preventive Maintenance', 'RESIDCO responsibility code 8'),
  ('9', 'HM216', 'RESIDCO responsibility code 9')
) AS v(code, display_name, description)
WHERE r.code = v.code AND r.deleted_at IS NULL;
