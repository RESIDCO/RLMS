-- Idempotent: apply Bruce's RESIDCO resp display names + original_filename on documents.
-- Names live in repair.responsibility_codes (admin-editable); not hard-coded in app UI.

BEGIN;

ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS original_filename text;

UPDATE repair.responsibility_codes AS r SET
  display_name = v.display_name,
  description = v.description
FROM (VALUES
  ('0', 'Bad Order', 'RESIDCO responsibility code 0'),
  ('1', 'Owners', 'Public AAR / RESIDCO code 1 — Owners'),
  ('2', 'Handling Line', 'Public AAR / RESIDCO code 2 — Handling Line'),
  ('3', 'Defect Card/JIC', 'Public AAR / RESIDCO code 3 — Defect Card/JIC'),
  ('4', 'Capital Program', 'RESIDCO responsibility code 4'),
  ('5', 'Lease Return', 'RESIDCO responsibility code 5'),
  ('6', 'Auto Rebill', 'RESIDCO responsibility code 6 — Auto Rebill (lessee approval path)'),
  ('7', 'Never Rebill', 'RESIDCO responsibility code 7'),
  ('8', 'Preventive Maintenance', 'RESIDCO responsibility code 8'),
  ('9', 'HM216', 'RESIDCO responsibility code 9')
) AS v(code, display_name, description)
WHERE r.tenant_id = '00000000-0000-4000-8000-000000000001'
  AND r.code = v.code
  AND r.deleted_at IS NULL;

COMMIT;
