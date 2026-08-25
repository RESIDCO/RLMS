-- Attachments provenance + allow account-level entity_type.
-- Confirmed empty before apply (0 rows).

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS source_module text NOT NULL DEFAULT 'manual';

ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_source_module_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_source_module_check
  CHECK (source_module = ANY (ARRAY['manual'::text, 'account_transitions'::text, 'lease_management'::text, 'programs'::text]));

COMMENT ON COLUMN public.attachments.source_module IS
  'Which part of the app the document was uploaded through. Set automatically at upload time by whichever module''s uploader wrote the row — never user-editable after the fact.';

ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_entity_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type = ANY (ARRAY['master_lease'::text, 'rider'::text, 'railcar'::text, 'account'::text]));
